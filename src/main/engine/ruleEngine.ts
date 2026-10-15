/**
 * Which rules fire for what happens. Pure: the clock, the dice and what is
 * running are all passed in, so every decision here is testable without a
 * desktop.
 */

import type { Character } from '@shared/character';
import type { Rule, RuleCondition, Trigger } from '@shared/rules';
import { appStem } from '../characters/presence';
import { isWithinClockWindow, minutesOfDay } from './timeOfDay';
import type { Rng } from './selector';

/** Something that happened, in the terms triggers are written in. Programs are by stem: 'dota2'. */
export type RuleEvent =
  | { type: 'programStarted' | 'programStopped' | 'programFocused'; program: string }
  | { type: 'time'; at: string }
  | { type: 'returned'; awayMinutes: number }
  | { type: 'startup' }
  | { type: 'clicked'; characterId: string }
  /** An `every` rule's turn has come round. Made by the engine itself. */
  | { type: 'every'; characterId: string; ruleId: string };

/** A rule that fired, with what its lines may fill their `{slots}` from. */
export interface Fired {
  character: Character;
  rule: Rule;
  slots: Record<string, string | number>;
}

/** What has to be watched for the current rules — nothing else is. */
export interface RuleNeeds {
  /** Programs whose starting or stopping is a trigger, by stem. */
  startStop: Set<string>;
  /** Programs some condition asks about, by stem. */
  running: Set<string>;
  focus: boolean;
  time: boolean;
  every: boolean;
  returned: boolean;
}

export interface RuleContext {
  now: number;
  /** Whether a program is running, by stem; null when that is not known. */
  isRunning: (program: string) => boolean | null;
}

const MINUTE = 60_000;

function activeRules(character: Character): Rule[] {
  return character.enabled ? character.rules.filter((rule) => rule.enabled) : [];
}

export function ruleNeeds(characters: readonly Character[]): RuleNeeds {
  const needs: RuleNeeds = { startStop: new Set(), running: new Set(), focus: false, time: false, every: false, returned: false };
  for (const character of characters) {
    for (const rule of activeRules(character)) {
      const { when } = rule;
      if (when.type === 'programStarted' || when.type === 'programStopped') needs.startStop.add(appStem(when.program));
      if (when.type === 'programFocused') needs.focus = true;
      if (when.type === 'time') needs.time = true;
      if (when.type === 'every') needs.every = true;
      if (when.type === 'returned') needs.returned = true;
      for (const condition of rule.if) {
        if (condition.type === 'programRunning') needs.running.add(appStem(condition.program));
      }
    }
  }
  return needs;
}

export function triggerMatches(trigger: Trigger, event: RuleEvent, character: Character, rule: Rule): boolean {
  switch (trigger.type) {
    case 'programStarted':
    case 'programStopped':
    case 'programFocused':
      return event.type === trigger.type && event.program === appStem(trigger.program);
    case 'time':
      return event.type === 'time' && event.at === trigger.at;
    case 'returned':
      return event.type === 'returned' && event.awayMinutes >= trigger.afterMinutes;
    case 'startup':
      return event.type === 'startup';
    case 'clicked':
      return event.type === 'clicked' && event.characterId === character.id;
    case 'every':
      return event.type === 'every' && event.characterId === character.id && event.ruleId === rule.id;
  }
}

export function conditionPasses(condition: RuleCondition, ctx: RuleContext, rng: Rng): boolean {
  switch (condition.type) {
    case 'chance':
      return rng() * 100 < condition.percent;
    case 'timeBetween':
      return isWithinClockWindow(minutesOfDay(ctx.now), condition.from, condition.to);
    case 'programRunning': {
      const running = ctx.isRunning(appStem(condition.program));
      // Not known is not the same as not running: neither answer is safe, so the rule waits.
      return running !== null && running === condition.running;
    }
  }
}

function clock(now: number): string {
  const date = new Date(now);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** What `{slots}` in a line can be filled from, for this event. */
function slotsFor(event: RuleEvent, character: Character, now: number): Record<string, string | number> {
  const slots: Record<string, string | number> = { name: character.name, time: clock(now) };
  if ('program' in event) slots.program = event.program;
  if (event.type === 'returned') slots.minutes = Math.round(event.awayMinutes);
  return slots;
}

interface Planned {
  at: number;
  /** min–max as it was planned with; a change to either replans. */
  span: string;
}

export class RuleEngine {
  private characters: Character[] = [];
  private readonly lastFired = new Map<string, number>();
  private readonly planned = new Map<string, Planned>();

  constructor(private readonly rng: Rng = Math.random) {}

  /** The characters whose rules run. Disabled ones and disabled rules are simply never matched. */
  setCharacters(characters: readonly Character[], now: number): void {
    this.characters = [...characters];
    // Plan each `every` rule's next turn, keeping turns already planned for rules that did not change.
    const keep = new Set<string>();
    for (const character of this.characters) {
      for (const rule of activeRules(character)) {
        if (rule.when.type !== 'every') continue;
        const key = this.key(character, rule);
        const span = `${rule.when.minMinutes}-${rule.when.maxMinutes}`;
        keep.add(key);
        if (this.planned.get(key)?.span !== span) this.planned.set(key, { at: this.nextTurn(now, rule.when), span });
      }
    }
    for (const key of [...this.planned.keys()]) if (!keep.has(key)) this.planned.delete(key);
  }

  get needs(): RuleNeeds {
    return ruleNeeds(this.characters);
  }

  /** The rules this event sets off, in character order. Each one that fires starts its cooldown. */
  handle(event: RuleEvent, ctx: RuleContext): Fired[] {
    const fired: Fired[] = [];
    for (const character of this.characters) {
      for (const rule of activeRules(character)) {
        if (!triggerMatches(rule.when, event, character, rule)) continue;
        const key = this.key(character, rule);
        const last = this.lastFired.get(key);
        if (last !== undefined && rule.cooldownSec > 0 && ctx.now - last < rule.cooldownSec * 1000) continue;
        // Every condition is checked — the dice too — before anything is spent.
        if (!rule.if.every((condition) => conditionPasses(condition, ctx, this.rng))) continue;
        this.lastFired.set(key, ctx.now);
        fired.push({ character, rule, slots: slotsFor(event, character, ctx.now) });
      }
    }
    return fired;
  }

  /** `every` turns that have come round, each planned again for its next time. */
  due(now: number): RuleEvent[] {
    const events: RuleEvent[] = [];
    for (const character of this.characters) {
      for (const rule of activeRules(character)) {
        if (rule.when.type !== 'every') continue;
        const key = this.key(character, rule);
        const plan = this.planned.get(key);
        if (!plan || plan.at > now) continue;
        plan.at = this.nextTurn(now, rule.when);
        events.push({ type: 'every', characterId: character.id, ruleId: rule.id });
      }
    }
    return events;
  }

  /** When the soonest `every` turn is; null when there are none. */
  nextDue(): number | null {
    let soonest: number | null = null;
    for (const plan of this.planned.values()) if (soonest === null || plan.at < soonest) soonest = plan.at;
    return soonest;
  }

  private nextTurn(now: number, every: { minMinutes: number; maxMinutes: number }): number {
    return now + (every.minMinutes + this.rng() * (every.maxMinutes - every.minMinutes)) * MINUTE;
  }

  private key(character: Character, rule: Rule): string {
    return `${character.id}:${rule.id}`;
  }
}

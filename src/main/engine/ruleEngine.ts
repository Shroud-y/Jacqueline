/**
 * Which rules fire for what happens. Pure: the clock, the dice and what is
 * running are all passed in, so every decision here is testable without a
 * desktop.
 */

import type { Character } from '@shared/character';
import { heroName, type GameHappening } from '@shared/game';
import { usesMusic } from '@shared/lines';
import { daysText, type Rule, type RuleCondition, type Trigger } from '@shared/rules';
import type { CheckItem } from '@shared/types';
import { appStem } from '../characters/presence';
import type { MusicEventType, MusicNow } from './musicTracker';
import { isWithinClockWindow, minutesOfDay } from './timeOfDay';
import type { Rng } from './selector';

/** Something that happened, in the terms triggers are written in. Programs are by stem: 'dota2'. */
export type RuleEvent =
  | { type: 'programStarted' | 'programStopped' | 'programFocused'; program: string }
  | { type: 'time'; at: string }
  | { type: 'returned'; awayMinutes: number }
  | { type: 'startup' }
  | { type: 'clicked'; characterId: string }
  | { type: MusicEventType; track: string; artist: string; app: string }
  /** From outside, `--signal <name>`, with the `--text` that came with it. */
  | {
      type: 'signal';
      name: string;
      text: string | null;
      /** Sent by a rule rather than from outside: how many signals deep this one is, so a loop runs out. */
      hops?: number;
    }
  /** In the Dota 2 match being played. `streakBefore` is the kill streak before this update. */
  | { type: 'game'; event: GameHappening; hero: string | null; kills: number; deaths: number; streak: number; streakBefore: number }
  /** An `every` rule's turn has come round. Made by the engine itself. */
  | { type: 'every'; characterId: string; ruleId: string };

/** A rule that fired, with what its lines may fill their `{slots}` from. */
export interface Fired {
  character: Character;
  rule: Rule;
  slots: Record<string, string | number>;
  /** For a signal one rule sent another: how many deep it is. */
  hops?: number;
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
  /** What is playing, for a rule or a line that asks. */
  music: boolean;
  /** What happens in a game: the local listener Dota posts to. */
  game: boolean;
}

export interface RuleContext {
  now: number;
  /** Whether a program is running, by stem; null when that is not known. */
  isRunning: (program: string) => boolean | null;
  /** What is playing; null when that is not known. */
  music?: () => MusicNow | null;
}

const MINUTE = 60_000;

function activeRules(character: Character): Rule[] {
  return character.enabled ? character.rules.filter((rule) => rule.enabled) : [];
}

export function ruleNeeds(characters: readonly Character[]): RuleNeeds {
  const needs: RuleNeeds = { startStop: new Set(), running: new Set(), focus: false, time: false, every: false, returned: false, music: false, game: false };
  for (const character of characters) {
    if (character.enabled && usesMusic(character)) needs.music = true;
    for (const rule of activeRules(character)) {
      const { when } = rule;
      if (when.type === 'programStarted' || when.type === 'programStopped') needs.startStop.add(appStem(when.program));
      if (when.type === 'programFocused') needs.focus = true;
      if (when.type === 'time') needs.time = true;
      if (when.type === 'every') needs.every = true;
      if (when.type === 'returned') needs.returned = true;
      if (when.type === 'game') needs.game = true;
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
    case 'musicStarted':
    case 'musicStopped':
    case 'trackChanged':
      return event.type === trigger.type;
    case 'signal':
      return event.type === 'signal' && event.name === trigger.name;
    case 'game':
      if (event.type !== 'game') return false;
      // A streak rule fires on the kill that takes the streak up to its number, however many came at once.
      if (trigger.event === 'streak') return event.event === 'kill' && event.streakBefore < trigger.streak && event.streak >= trigger.streak;
      return event.event === trigger.event;
  }
}

/** Why a condition held the rule back, in words; for the Activity log. */
export function conditionFailure(condition: RuleCondition, ctx: RuleContext): string {
  switch (condition.type) {
    case 'chance':
      return `its ${condition.percent} % chance did not come up`;
    case 'timeBetween':
      return `it is not between ${condition.from} and ${condition.to}`;
    case 'programRunning': {
      const running = ctx.isRunning(appStem(condition.program));
      if (running === null) return `it is not known yet whether ${condition.program} runs`;
      return running ? `${condition.program} runs` : `${condition.program} does not run`;
    }
    case 'musicPlaying': {
      const music = ctx.music?.() ?? null;
      if (music === null) return 'it is not known yet whether music plays';
      return music.playing ? 'music plays' : 'no music plays';
    }
    case 'days': {
      const said = daysText(condition.days);
      if (said === 'on weekdays') return 'today is not a weekday';
      if (said === 'at weekends') return 'today is not a weekend day';
      return `today is not one of its days (${said.replace(/^on /, '')})`;
    }
  }
}


/** What stands between the rule and firing right now — its wait and each condition — without rolling any dice. */
export function checkRule(rule: Rule, ctx: RuleContext, lastFired: number | undefined): CheckItem[] {
  const items: CheckItem[] = [];
  if (rule.cooldownSec > 0) {
    const left = lastFired === undefined ? 0 : rule.cooldownSec * 1000 - (ctx.now - lastFired);
    items.push(
      left > 0
        ? { ok: false, text: `Waits ${Math.ceil(left / 1000)} s more before it may fire again.` }
        : { ok: true, text: 'Its wait is over.' }
    );
  }
  for (const condition of rule.if) {
    if (condition.type === 'chance') {
      items.push({ ok: null, text: `${condition.percent} % chance — rolled when it fires.` });
      continue;
    }
    // A dice-free condition, so passing it no rng is safe.
    const ok = conditionPasses(condition, ctx, () => 0);
    items.push({ ok, text: ok ? passText(condition) : `${capital(conditionFailure(condition, ctx))}.` });
  }
  return items;
}

function passText(condition: Exclude<RuleCondition, { type: 'chance' }>): string {
  switch (condition.type) {
    case 'timeBetween':
      return `It is between ${condition.from} and ${condition.to}.`;
    case 'programRunning':
      return condition.running ? `${condition.program} runs.` : `${condition.program} does not run.`;
    case 'musicPlaying':
      return condition.playing ? 'Music plays.' : 'No music plays.';
    case 'days':
      return `Today is one of its days (${daysText(condition.days)}).`;
  }
}

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** A rule that matched what happened and still did not fire, and why. */
export interface Skipped {
  character: Character;
  rule: Rule;
  why: string;
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
    case 'musicPlaying': {
      const music = ctx.music?.() ?? null;
      return music !== null && music.playing === condition.playing;
    }
    case 'days':
      return condition.days.includes(new Date(ctx.now).getDay());
  }
}

/** 'HH:mm', as `{time}` reads. */
export function clock(now: number): string {
  const date = new Date(now);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** `{track}` and `{artist}`, for as far as they are known. A line asking for one that is not is not said. */
export function musicSlots(music: { track: string; artist: string } | null | undefined): Record<string, string> {
  const slots: Record<string, string> = {};
  if (music?.track) slots.track = music.track;
  if (music?.artist) slots.artist = music.artist;
  return slots;
}

/** `{kills}`, `{deaths}`, `{streak}` and, when Dota said, `{hero}`. */
export function gameSlots(event: { hero: string | null; kills: number; deaths: number; streak: number }): Record<string, string | number> {
  const slots: Record<string, string | number> = { kills: event.kills, deaths: event.deaths, streak: event.streak };
  if (event.hero) slots.hero = heroName(event.hero);
  return slots;
}

/** What `{slots}` in a line can be filled from, for this event. */
function slotsFor(event: RuleEvent, character: Character, now: number, music: MusicNow | null): Record<string, string | number> {
  const playing = music?.playing ? music : null;
  // The event's own track first: by the time music has stopped, it is the only one there is.
  const slots: Record<string, string | number> = { name: character.name, time: clock(now), ...musicSlots('track' in event ? event : playing) };
  if ('program' in event) slots.program = event.program;
  if (event.type === 'returned') slots.minutes = Math.round(event.awayMinutes);
  if (event.type === 'signal' && event.text !== null) slots.text = event.text;
  if (event.type === 'game') Object.assign(slots, gameSlots(event));
  return slots;
}

/**
 * What a line tried from the editor is filled with: whatever this moment
 * gives, and a likely value for what only an event could.
 */
export function sampleSlots(character: Character, now: number): Record<string, string | number> {
  return { name: character.name, time: clock(now), program: character.presence.apps[0] ?? 'notepad.exe', minutes: 15, track: 'Some Song', artist: 'Someone', text: 'something from outside', hero: 'Pudge', kills: 7, deaths: 2, streak: 3 };
}

interface Planned {
  at: number;
  /** min–max as it was planned with; a change to either replans. */
  span: string;
}

export class RuleEngine {
  private characters: Character[] = [];
  /** Characters whose rules do not run now — off or hidden — with why, so a matching rule can say so. */
  private dormant: { character: Character; why: string }[] = [];
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

  /** Characters that are about, but whose rules wait: only ever named in `onSkip`, never fired. */
  setDormant(dormant: readonly { character: Character; why: string }[]): void {
    this.dormant = [...dormant];
  }

  /** When the rule last fired since Jacqueline started; undefined if it has not. */
  lastFiredAt(characterId: string, ruleId: string): number | undefined {
    return this.lastFired.get(`${characterId}:${ruleId}`);
  }

  /** When an `every` rule's next turn is; undefined for any other rule. */
  plannedAt(characterId: string, ruleId: string): number | undefined {
    return this.planned.get(`${characterId}:${ruleId}`)?.at;
  }

  get needs(): RuleNeeds {
    return ruleNeeds(this.characters);
  }

  /** The rules this event sets off, in character order. Each one that fires starts its cooldown. */
  handle(event: RuleEvent, ctx: RuleContext, onSkip?: (skipped: Skipped) => void): Fired[] {
    const fired: Fired[] = [];
    for (const character of this.characters) {
      // A rule that fired and stops the rest, for this character and this moment.
      let stoppedBy: Rule | null = null;
      for (const rule of activeRules(character)) {
        if (!triggerMatches(rule.when, event, character, rule)) continue;
        if (stoppedBy) {
          onSkip?.({ character, rule, why: `${stoppedBy.name.trim() ? `“${stoppedBy.name.trim()}”` : 'a rule above it'} fired first and stops the rest` });
          continue;
        }
        const key = this.key(character, rule);
        const last = this.lastFired.get(key);
        if (last !== undefined && rule.cooldownSec > 0 && ctx.now - last < rule.cooldownSec * 1000) {
          const left = Math.ceil((rule.cooldownSec * 1000 - (ctx.now - last)) / 1000);
          onSkip?.({ character, rule, why: `it waits ${left} s more before it may fire again` });
          continue;
        }
        // Every condition is checked — the dice too — before anything is spent; the first that fails is the reason.
        const failed = rule.if.find((condition) => !conditionPasses(condition, ctx, this.rng));
        if (failed) {
          onSkip?.({ character, rule, why: conditionFailure(failed, ctx) });
          continue;
        }
        this.lastFired.set(key, ctx.now);
        fired.push({ character, rule, slots: slotsFor(event, character, ctx.now, ctx.music?.() ?? null), hops: event.type === 'signal' ? (event.hops ?? 0) : 0 });
        if (rule.stop) stoppedBy = rule;
      }
    }
    if (onSkip) {
      for (const { character, why } of this.dormant) {
        // Switched off or hidden: its rules are not running at all, which is the one thing worth saying.
        for (const rule of character.rules) if (rule.enabled && triggerMatches(rule.when, event, character, rule)) onSkip({ character, rule, why });
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

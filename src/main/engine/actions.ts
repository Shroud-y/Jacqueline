/**
 * What a fired rule does. The engine decides that a rule fires; this carries
 * it out, through whatever the app hands it — so it is tested without one.
 */

import type { Character, Line } from '@shared/character';
import type { Rule, ShowPlace } from '@shared/rules';
import type { Fired } from './ruleEngine';
import { RecentHistory, selectPhrase, type Rng } from './selector';
import { fillSlots } from './slots';

export interface ActionDeps {
  /** Muted, or inside quiet hours: nothing is said or played. */
  isSilenced(): boolean;
  /** A line, with its slots filled, to put on screen. */
  say(character: Character, text: string, line: Line): void;
  /** False when there was nowhere to play it — the character is not on screen. */
  playSound(character: Character, file: string): boolean;
  show(character: Character, ms: number, place: ShowPlace): void;
  hide(character: Character, ms: number): void;
  /** False when it has no such state. */
  setState(character: Character, state: string | null, ms: number | null): boolean;
  setMood(character: Character, mood: string | null): void;
  /** A signal for every character's rules; `hops` is how deep it already is. False when it was not sent. */
  signal?(character: Character, name: string, text: string | null, hops: number): boolean;
  /** Stops what it is saying, and what waits to be said. */
  dismiss?(character: Character): void;
  log(message: string): void;
  /** Runs `fn` in `ms`; setTimeout when not given. Handed in so tests need no clock. */
  later?(ms: number, fn: () => void): void;
  /** Whether the character still acts — not switched off, hidden or gone — when a wait is over. */
  isActing?(character: Character): boolean;
  /** What came of a fired rule, for the Activity log: done, or held back and why. */
  report?(character: Character, rule: Rule, outcome: 'note' | 'problem', text: string): void;
  history: RecentHistory;
  rng: Rng;
}

/** Picks a line from a group: one whose slots can all be filled, not one said a moment ago. */
export function pickLine(character: Character, group: string, slots: Record<string, string | number>, deps: Pick<ActionDeps, 'history' | 'rng'>): { line: Line; text: string } | null {
  const lines = character.lines[group] ?? [];
  const key = `${character.id}/${group}`;
  const line = selectPhrase({
    phrases: lines,
    recentIds: deps.history.get(key),
    isEligible: (candidate) => fillSlots(candidate.text, slots) !== null,
    rng: deps.rng
  });
  if (!line) return null;
  const text = fillSlots(line.text, slots);
  if (text === null) return null;
  deps.history.push(key, line.id);
  return { line, text };
}

export function runActions(fired: Fired, deps: ActionDeps): void {
  const { character, rule, slots } = fired;
  const label = `"${character.name}" / ${rule.name || rule.id}`;
  const tell = (outcome: 'note' | 'problem', text: string): void => {
    deps.log(`${label}: ${text}`);
    deps.report?.(character, rule, outcome, text);
  };
  const later =
    deps.later ??
    ((ms: number, fn: () => void): void => {
      setTimeout(fn, ms).unref?.();
    });
  runFrom(0);

  // One action after another; a wait hands the rest to a timer, and they go on only if the character still acts by then.
  function runFrom(start: number): void {
    for (let index = start; index < rule.then.length; index += 1) {
      const action = rule.then[index];
      if (!action) break;
      switch (action.type) {
        case 'wait':
          later(action.seconds * 1000, () => {
            if (deps.isActing && !deps.isActing(character)) {
              tell('note', 'stopped after a wait: the character is off, hidden or gone now');
              return;
            }
            runFrom(index + 1);
          });
          return;
        case 'say': {
          if (deps.isSilenced()) {
            tell('note', `would say something from "${action.group}", but it is quiet (mute or quiet hours)`);
            break;
          }
          const picked = pickLine(character, action.group, slots, deps);
          if (!picked) {
            tell('problem', `nothing to say from "${action.group}" — it is empty, or every line has a {slot} this event cannot fill`);
            break;
          }
          deps.say(character, picked.text, picked.line);
          deps.report?.(character, rule, 'note', `said “${picked.text}”`);
          if (picked.line.audio) deps.playSound(character, picked.line.audio);
          break;
        }
        case 'sound':
          if (deps.isSilenced()) {
            tell('note', `${action.file} not played: it is quiet (mute or quiet hours)`);
            break;
          }
          if (!deps.playSound(character, action.file)) tell('problem', `${action.file} not played — the character is not on screen`);
          break;
        case 'show':
          deps.show(character, action.seconds * 1000, action.place);
          break;
        case 'hide':
          deps.hide(character, action.minutes * 60_000);
          break;
        case 'setState':
          if (!deps.setState(character, action.state, action.seconds === null ? null : action.seconds * 1000)) {
            tell('problem', `it has no state "${action.state}"`);
          }
          break;
        case 'sayText': {
          if (deps.isSilenced()) {
            tell('note', 'would say something, but it is quiet (mute or quiet hours)');
            break;
          }
          const text = fillSlots(action.text, slots);
          if (text === null) {
            tell('problem', `nothing said: “${action.text}” has a {slot} this event cannot fill`);
            break;
          }
          deps.say(character, text, { id: `${rule.id}-text`, text: action.text });
          deps.report?.(character, rule, 'note', `said “${text}”`);
          break;
        }
        case 'mood':
          deps.setMood(character, action.mood);
          break;
        case 'dismiss':
          deps.dismiss?.(character);
          break;
        case 'sendSignal': {
          const text = action.text ? fillSlots(action.text, slots) : null;
          if (action.text && text === null) {
            tell('problem', `signal ${action.name} not sent: its text has a {slot} this event cannot fill`);
            break;
          }
          if (deps.signal?.(character, action.name, text, fired.hops ?? 0)) deps.report?.(character, rule, 'note', `sent signal ${action.name}`);
          else tell('problem', `signal ${action.name} not sent: signals went round too many times — rules sending each other signals in a circle?`);
          break;
        }
      }
    }
  }
}

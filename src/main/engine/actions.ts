/**
 * What a fired rule does. The engine decides that a rule fires; this carries
 * it out, through whatever the app hands it — so it is tested without one.
 */

import type { Character, Line } from '@shared/character';
import type { Fired } from './ruleEngine';
import { RecentHistory, selectPhrase, type Rng } from './selector';
import { fillSlots } from './slots';

export interface ActionDeps {
  /** Muted, or inside quiet hours: nothing is said or played. */
  isSilenced(): boolean;
  /** A line, with its slots filled. Shown in 3.2; for now it is written to the log. */
  say(character: Character, text: string, line: Line): void;
  /** False when there was nowhere to play it — the character is not on screen. */
  playSound(character: Character, file: string): boolean;
  show(character: Character, ms: number): void;
  hide(character: Character, ms: number): void;
  log(message: string): void;
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
  for (const action of rule.then) {
    switch (action.type) {
      case 'say': {
        if (deps.isSilenced()) {
          deps.log(`${label}: would say something from "${action.group}", but it is quiet`);
          break;
        }
        const picked = pickLine(character, action.group, slots, deps);
        if (!picked) {
          deps.log(`${label}: nothing to say from "${action.group}"`);
          break;
        }
        deps.say(character, picked.text, picked.line);
        if (picked.line.audio) deps.playSound(character, picked.line.audio);
        break;
      }
      case 'sound':
        if (deps.isSilenced()) break;
        if (!deps.playSound(character, action.file)) deps.log(`${label}: ${action.file} not played — the character is not on screen`);
        break;
      case 'show':
        deps.show(character, action.seconds * 1000);
        break;
      case 'hide':
        deps.hide(character, action.minutes * 60_000);
        break;
    }
  }
}

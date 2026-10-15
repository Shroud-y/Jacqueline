/**
 * Groups of lines and the lines in them, as the editor changes them. Pure: a
 * character goes in, the character as it should now be comes out.
 *
 * A group's name is also its key in `character.lines` and what a rule's `say`
 * action points at, so renaming one rewrites those rules with it.
 */

import type { Character, Line } from './character';
import type { Rule } from './rules';

export const GROUP_NAME_MAX = 64;
export const LINE_TEXT_MAX = 2000;
export const LINES_PER_GROUP_MAX = 500;
export const NEW_GROUP_NAME = 'New group';

/** `{name}` or `{a.b}` — the same thing main fills a line's slots from. */
export const SLOT_PATTERN = /\{([A-Za-z][\w.]*)\}/g;

/** The slots the app fills, and when. A line with any other slot is never said. */
export const SLOTS: readonly { name: string; hint: string }[] = [
  { name: 'name', hint: "the character's name" },
  { name: 'time', hint: 'the time, like 14:05' },
  { name: 'program', hint: 'the program a rule is about' },
  { name: 'minutes', hint: 'how many minutes you were away' }
];

const KNOWN_SLOTS = new Set(SLOTS.map((slot) => slot.name));

export type TextPart = { text: string; slot: null } | { text: string; slot: string; known: boolean };

/** A line's text cut into plain runs and `{slots}`, for drawing the slots apart. */
export function splitSlots(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(SLOT_PATTERN)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), slot: null });
    const name = match[1] ?? '';
    parts.push({ text: match[0], slot: name, known: KNOWN_SLOTS.has(name) });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), slot: null });
  return parts;
}

/** The slots in `text` that nothing fills, each once. */
export function unknownSlots(text: string): string[] {
  const unknown = new Set<string>();
  for (const part of splitSlots(text)) if (part.slot !== null && !part.known) unknown.add(part.slot);
  return [...unknown];
}

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Why `name` cannot be a group's name, or null. `current` is the group being
 * renamed, which may keep its own name.
 */
export function groupNameProblem(character: Character, name: string, current?: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'A group needs a name.';
  if (trimmed.length > GROUP_NAME_MAX) return `A group name can be ${GROUP_NAME_MAX} characters at most.`;
  const taken = Object.keys(character.lines).some((existing) => existing !== current && sameName(existing, trimmed));
  return taken ? 'There is already a group with that name.' : null;
}

/** "New group", or "New group 2" and on when that is taken. */
export function freeGroupName(character: Character, base = NEW_GROUP_NAME): string {
  const names = Object.keys(character.lines);
  const free = (name: string): boolean => !names.some((existing) => sameName(existing, name));
  if (free(base)) return base;
  for (let n = 2; ; n += 1) if (free(`${base} ${n}`)) return `${base} ${n}`;
}

export function addGroup(character: Character, name: string): Character {
  return { ...character, lines: { ...character.lines, [name.trim()]: [] } };
}

/** Renamed in place — the list keeps its order — and every rule that said from it now says from the new name. */
export function renameGroup(character: Character, from: string, to: string): Character {
  const target = to.trim();
  if (from === target || !(from in character.lines)) return character;
  const lines: Character['lines'] = {};
  for (const [name, group] of Object.entries(character.lines)) lines[name === from ? target : name] = group;
  const rules = character.rules.map((rule) =>
    usesGroup(rule, from)
      ? { ...rule, then: rule.then.map((action) => (action.type === 'say' && action.group === from ? { ...action, group: target } : action)) }
      : rule
  );
  return { ...character, lines, rules };
}

/** The group goes with its lines. Rules that said from it are left as they are, with nothing to say. */
export function removeGroup(character: Character, name: string): Character {
  const lines = { ...character.lines };
  delete lines[name];
  return { ...character, lines };
}

function usesGroup(rule: Rule, group: string): boolean {
  return rule.then.some((action) => action.type === 'say' && action.group === group);
}

/** Rules that say something from this group. */
export function rulesUsing(character: Character, group: string): Rule[] {
  return character.rules.filter((rule) => usesGroup(rule, group));
}

/** An id no line in the group has: the selector remembers what was said by id. */
export function freeLineId(lines: readonly Line[]): string {
  const taken = new Set(lines.map((line) => line.id));
  for (let n = lines.length + 1; ; n += 1) if (!taken.has(`line-${n}`)) return `line-${n}`;
}

export function addLine(character: Character, group: string, text: string): Character {
  const lines = character.lines[group] ?? [];
  return { ...character, lines: { ...character.lines, [group]: [...lines, { id: freeLineId(lines), text }] } };
}

/** `weight: undefined` or `audio: undefined` in `patch` takes that off the line. */
export function updateLine(character: Character, group: string, id: string, patch: Partial<Omit<Line, 'id'>>): Character {
  const lines = character.lines[group];
  if (!lines) return character;
  const next = lines.map((line) => {
    if (line.id !== id) return line;
    const merged: Line = { ...line, ...patch };
    // Absent rather than undefined, so the file says nothing about it.
    if (merged.weight === undefined) delete merged.weight;
    if (merged.audio === undefined) delete merged.audio;
    return merged;
  });
  return { ...character, lines: { ...character.lines, [group]: next } };
}

export function removeLine(character: Character, group: string, id: string): Character {
  const lines = character.lines[group];
  if (!lines) return character;
  return { ...character, lines: { ...character.lines, [group]: lines.filter((line) => line.id !== id) } };
}

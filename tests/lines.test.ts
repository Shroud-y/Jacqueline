import { describe, expect, it } from 'vitest';
import { characterSchema, defaultCharacter, type Character } from '@shared/character';
import {
  addGroup,
  addLine,
  freeGroupName,
  freeLineId,
  groupNameProblem,
  removeGroup,
  removeLine,
  renameGroup,
  rulesUsing,
  splitSlots,
  unknownSlots,
  updateLine
} from '@shared/lines';
import type { Rule } from '@shared/rules';

const sayRule = (id: string, group: string): Rule => ({
  id,
  name: id,
  enabled: true,
  when: { type: 'startup' },
  if: [],
  then: [{ type: 'say', group }, { type: 'show', seconds: 5 }],
  cooldownSec: 0
});

function miku(): Character {
  return {
    ...defaultCharacter('miku', 'Miku'),
    lines: { greet: [{ id: 'line-1', text: 'Hi.' }], bye: [], idle: [] },
    rules: [sayRule('r1', 'greet'), sayRule('r2', 'bye'), sayRule('r3', 'greet')]
  };
}

describe('slots in a line', () => {
  it('cuts text into plain runs and slots, telling the ones the app fills from the rest', () => {
    expect(splitSlots('{name}, it is {time}. {mood}!')).toEqual([
      { text: '{name}', slot: 'name', known: true },
      { text: ', it is ', slot: null },
      { text: '{time}', slot: 'time', known: true },
      { text: '. ', slot: null },
      { text: '{mood}', slot: 'mood', known: false },
      { text: '!', slot: null }
    ]);
    expect(splitSlots('No slots.')).toEqual([{ text: 'No slots.', slot: null }]);
    expect(splitSlots('')).toEqual([]);
  });

  it('lists each slot nothing fills once; braces that are not a slot are just text', () => {
    expect(unknownSlots('{mood} {mood} {name} {a.b}')).toEqual(['mood', 'a.b']);
    expect(unknownSlots('{ name } {1x} {}')).toEqual([]);
  });
});

describe('groups', () => {
  it('names a new group with the first free name, case aside', () => {
    expect(freeGroupName(miku())).toBe('New group');
    const taken = addGroup(addGroup(miku(), 'new group'), 'New group 2');
    expect(freeGroupName(taken)).toBe('New group 3');
  });

  it('refuses an empty, too long or taken name, but lets a group keep its own', () => {
    const character = miku();
    expect(groupNameProblem(character, '  ')).not.toBeNull();
    expect(groupNameProblem(character, 'x'.repeat(65))).not.toBeNull();
    expect(groupNameProblem(character, 'GREET')).not.toBeNull();
    expect(groupNameProblem(character, 'Greet', 'greet')).toBeNull();
    expect(groupNameProblem(character, 'hello')).toBeNull();
  });

  it('renames in place and takes the rules that said from it along', () => {
    const renamed = renameGroup(miku(), 'greet', ' hello ');
    expect(Object.keys(renamed.lines)).toEqual(['hello', 'bye', 'idle']);
    expect(renamed.lines.hello).toEqual(miku().lines.greet);
    expect(renamed.rules.map((rule) => rule.then[0])).toEqual([
      { type: 'say', group: 'hello' },
      { type: 'say', group: 'bye' },
      { type: 'say', group: 'hello' }
    ]);
    expect(characterSchema.safeParse(renamed).success).toBe(true);
    expect(renameGroup(miku(), 'nope', 'x')).toEqual(miku());
  });

  it('removes a group and leaves the rules that used it as they are', () => {
    const character = miku();
    expect(rulesUsing(character, 'greet').map((rule) => rule.id)).toEqual(['r1', 'r3']);
    const removed = removeGroup(character, 'greet');
    expect(Object.keys(removed.lines)).toEqual(['bye', 'idle']);
    expect(removed.rules).toEqual(character.rules);
  });
});

describe('lines', () => {
  it('adds lines with ids nobody in the group has', () => {
    expect(freeLineId([])).toBe('line-1');
    expect(freeLineId([{ id: 'line-2', text: 'a' }])).toBe('line-3');
    const added = addLine(addLine(miku(), 'greet', 'Hello.'), 'greet', 'Hey.');
    expect(added.lines.greet?.map((line) => line.id)).toEqual(['line-1', 'line-2', 'line-3']);
  });

  it('changes and clears weight and sound without leaving undefined behind', () => {
    const weighted = updateLine(miku(), 'greet', 'line-1', { weight: 3, audio: 'hi.ogg' });
    expect(weighted.lines.greet?.[0]).toEqual({ id: 'line-1', text: 'Hi.', weight: 3, audio: 'hi.ogg' });
    const cleared = updateLine(weighted, 'greet', 'line-1', { weight: undefined, audio: undefined });
    expect(Object.keys(cleared.lines.greet?.[0] ?? {})).toEqual(['id', 'text']);
  });

  it('removes one line, and leaves an unknown group alone', () => {
    expect(removeLine(miku(), 'greet', 'line-1').lines.greet).toEqual([]);
    expect(removeLine(miku(), 'nope', 'line-1')).toEqual(miku());
  });
});

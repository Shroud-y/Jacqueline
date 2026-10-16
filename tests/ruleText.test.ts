import { describe, expect, it } from 'vitest';
import { defaultCharacter, type Character } from '@shared/character';
import type { Rule } from '@shared/rules';
import { ruleSchema } from '@shared/rules';
import {
  defaultAction,
  defaultCondition,
  defaultTrigger,
  formatDuration,
  freeRuleId,
  likelyProgram,
  newRule,
  ruleDetail,
  ruleProblems,
  ruleSentence,
  ruleTitle,
  TRIGGER_LABELS
} from '@shared/ruleText';

const text = (rule: Rule): string => ruleSentence(rule).map((part) => (part.strong ? `**${part.text}**` : part.text)).join('');

const base: Rule = { id: 'r', name: '', enabled: true, when: { type: 'clicked' }, if: [], then: [{ type: 'say', group: 'poke' }], cooldownSec: 0 };

function miku(patch: Partial<Character> = {}): Character {
  return { ...defaultCharacter('miku', 'Miku'), ...patch };
}

describe('rule sentences', () => {
  it('reads every trigger', () => {
    const when = (trigger: Rule['when']): string => text({ ...base, when: trigger }).split(' → ')[0] ?? '';
    expect(when({ type: 'programStarted', program: 'dota2.exe' })).toBe('When **dota2.exe** starts');
    expect(when({ type: 'programStopped', program: 'dota2.exe' })).toBe('When **dota2.exe** closes');
    expect(when({ type: 'programFocused', program: 'code' })).toBe('When **code** comes to the front');
    expect(when({ type: 'time', at: '09:00' })).toBe('Every day at **09:00**');
    expect(when({ type: 'every', minMinutes: 10, maxMinutes: 30 })).toBe('Every **10–30** minutes');
    expect(when({ type: 'every', minMinutes: 15, maxMinutes: 15 })).toBe('Every **15** minutes');
    expect(when({ type: 'returned', afterMinutes: 20 })).toBe('When you are back after **20 min** away');
    expect(when({ type: 'startup' })).toBe('When Jacqueline starts');
    expect(when({ type: 'clicked' })).toBe('When it is clicked');
  });

  it('joins actions with commas and a last "and"', () => {
    expect(text(base)).toBe('When it is clicked → say a line from **poke**');
    const many: Rule = {
      ...base,
      then: [
        { type: 'say', group: 'poke' },
        { type: 'sound', file: 'hi.ogg' },
        { type: 'show', seconds: 90 },
        { type: 'hide', minutes: 30 }
      ]
    };
    expect(text(many)).toBe('When it is clicked → say a line from **poke**, play **hi.ogg**, come out for **2 min** and hide for **30 min**');
  });

  it('puts conditions and the wait in the quiet line', () => {
    expect(ruleDetail(base)).toBe('');
    const limited: Rule = {
      ...base,
      if: [
        { type: 'chance', percent: 50 },
        { type: 'timeBetween', from: '09:00', to: '18:00' },
        { type: 'programRunning', program: 'dota2.exe', running: true },
        { type: 'programRunning', program: 'obs.exe', running: false }
      ],
      cooldownSec: 600
    };
    expect(ruleDetail(limited)).toBe('50 % · 09:00–18:00 · while dota2.exe runs · unless obs.exe runs · at most every 10 min');
  });

  it('formats waits in the unit a person would say', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(600)).toBe('10 min');
    expect(formatDuration(7200)).toBe('2 h');
    expect(formatDuration(5400)).toBe('1 h 30 min');
  });

  it('is called by its name, or else by what it does', () => {
    expect(ruleTitle({ ...base, name: '  Poke  ' })).toBe('Poke');
    expect(ruleTitle(base)).toBe('When it is clicked → say a line from poke');
  });
});

describe('rule problems', () => {
  it('names a group that is missing or empty, and a sound not in the folder', () => {
    const character = miku({ lines: { poke: [], greet: [{ id: 'a', text: 'Hi.' }] } });
    const rule: Rule = {
      ...base,
      then: [
        { type: 'say', group: 'poke' },
        { type: 'say', group: 'gone' },
        { type: 'say', group: 'greet' },
        { type: 'sound', file: 'hi.ogg' }
      ]
    };
    expect(ruleProblems(character, rule, new Set(['other.ogg']))).toEqual([
      '"poke" has no lines yet.',
      'There is no group of lines called "gone".',
      "hi.ogg is not in the character's folder."
    ]);
    // Without the folder's contents, sounds are not judged.
    expect(ruleProblems(character, rule)).toHaveLength(2);
  });
});

describe('starting values', () => {
  it('starts every part valid', () => {
    const character = miku({ lines: { greet: [] } });
    for (const type of Object.keys(TRIGGER_LABELS) as Rule['when']['type'][]) {
      const rule = { ...base, when: defaultTrigger(type, character) };
      expect(ruleSchema.safeParse(rule).success, type).toBe(true);
    }
    for (const type of ['chance', 'timeBetween', 'programRunning'] as const) {
      expect(ruleSchema.safeParse({ ...base, if: [defaultCondition(type, character)] }).success, type).toBe(true);
    }
    expect(defaultAction('say', character)).toEqual({ type: 'say', group: 'greet' });
    expect(defaultAction('say', miku())).toBeNull();
    expect(defaultAction('sound', character)).toBeNull();
    expect(defaultAction('show', character)).toEqual({ type: 'show', seconds: 10 });
    expect(defaultAction('hide', character)).toEqual({ type: 'hide', minutes: 30 });
  });

  it('suggests a program the character already knows', () => {
    expect(likelyProgram(miku())).toBe('notepad.exe');
    const present = miku({ presence: { ...miku().presence, apps: ['code.exe'] } });
    expect(likelyProgram(present)).toBe('code.exe');
    const ruled = { ...present, rules: [{ ...base, when: { type: 'programStarted' as const, program: 'dota2.exe' } }] };
    expect(likelyProgram(ruled)).toBe('dota2.exe');
  });

  it('makes a new rule that is valid: clicked, saying from the first group, or coming out with no groups', () => {
    const withLines = newRule(miku({ lines: { greet: [], poke: [] } }));
    expect(withLines).toMatchObject({ when: { type: 'clicked' }, then: [{ type: 'say', group: 'greet' }], enabled: true });
    expect(ruleSchema.safeParse(withLines).success).toBe(true);
    expect(newRule(miku()).then).toEqual([{ type: 'show', seconds: 10 }]);
    expect(freeRuleId([{ ...base, id: 'rule-2' }])).toBe('rule-3');
  });
});

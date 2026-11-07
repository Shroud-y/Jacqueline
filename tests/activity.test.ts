import { describe, expect, it } from 'vitest';
import { defaultCharacter, type Character } from '@shared/character';
import { daysText, ruleSchema, type Rule } from '@shared/rules';
import { Activity, ACTIVITY_MAX } from '@main/engine/activity';
import { checkRule, RuleEngine, type RuleContext, type Skipped } from '@main/engine/ruleEngine';

const at = (hh: number, mm: number): number => new Date(2026, 10, 7, hh, mm).getTime();

function rule(over: Partial<Rule> = {}): Rule {
  return { id: 'r1', name: '', enabled: true, when: { type: 'clicked' }, if: [], then: [{ type: 'say', group: 'g' }], cooldownSec: 0, ...over };
}

function character(rules: Rule[], over: Partial<Character> = {}): Character {
  return { ...defaultCharacter('c1', 'Teto'), rules, lines: { g: [{ id: 'l', text: 'Hi.' }] }, ...over };
}

const ctx = (now: number, running: Record<string, boolean | null> = {}): RuleContext => ({
  now,
  isRunning: (program) => (program in running ? (running[program] ?? null) : null),
  music: () => null
});

const click = { type: 'clicked' as const, characterId: 'c1' };

function skips(engine: RuleEngine, context: RuleContext): string[] {
  const out: Skipped[] = [];
  engine.handle(click, context, (skipped) => out.push(skipped));
  return out.map((skipped) => skipped.why);
}

describe('why a rule did not fire', () => {
  it('says how long its wait has left', () => {
    const engine = new RuleEngine(() => 0);
    engine.setCharacters([character([rule({ cooldownSec: 60 })])], 0);
    expect(engine.handle(click, ctx(at(9, 0)))).toHaveLength(1);
    expect(skips(engine, ctx(at(9, 0) + 18_000))).toEqual(['it waits 42 s more before it may fire again']);
  });

  it('names the first condition that held it back', () => {
    const engine = new RuleEngine(() => 0.99);
    engine.setCharacters(
      [
        character([
          rule({ id: 'a', if: [{ type: 'chance', percent: 50 }] }),
          rule({ id: 'b', if: [{ type: 'timeBetween', from: '22:00', to: '06:00' }] }),
          rule({ id: 'c', if: [{ type: 'programRunning', program: 'dota2.exe', running: true }] }),
          rule({ id: 'd', if: [{ type: 'programRunning', program: 'obs.exe', running: true }] }),
          rule({ id: 'e', if: [{ type: 'musicPlaying', playing: true }] })
        ])
      ],
      0
    );
    expect(skips(engine, ctx(at(12, 0), { dota2: false }))).toEqual([
      'its 50 % chance did not come up',
      'it is not between 22:00 and 06:00',
      'dota2.exe does not run',
      'it is not known yet whether obs.exe runs',
      'it is not known yet whether music plays'
    ]);
  });

  it('says a character that is off or hidden is why, for its rules that match only', () => {
    const engine = new RuleEngine();
    engine.setCharacters([], 0);
    const hidden = character([rule(), rule({ id: 'other', when: { type: 'startup' } })]);
    engine.setDormant([{ character: hidden, why: 'the character is hidden for now' }]);
    const out: Skipped[] = [];
    expect(engine.handle(click, ctx(0), (skipped) => out.push(skipped))).toEqual([]);
    expect(out.map((skipped) => [skipped.rule.id, skipped.why])).toEqual([['r1', 'the character is hidden for now']]);
  });

  it('keeps when each rule last fired', () => {
    const engine = new RuleEngine();
    engine.setCharacters([character([rule()])], 0);
    expect(engine.lastFiredAt('c1', 'r1')).toBeUndefined();
    engine.handle(click, ctx(5000));
    expect(engine.lastFiredAt('c1', 'r1')).toBe(5000);
  });
});

describe('checkRule', () => {
  it('lists the wait and each condition as it stands now, and never rolls the dice', () => {
    const items = checkRule(
      rule({
        cooldownSec: 60,
        if: [
          { type: 'chance', percent: 30 },
          { type: 'timeBetween', from: '09:00', to: '18:00' },
          { type: 'programRunning', program: 'dota2.exe', running: true }
        ]
      }),
      ctx(at(20, 0), { dota2: true }),
      at(20, 0) - 10_000
    );
    expect(items).toEqual([
      { ok: false, text: 'Waits 50 s more before it may fire again.' },
      { ok: null, text: '30 % chance — rolled when it fires.' },
      { ok: false, text: 'It is not between 09:00 and 18:00.' },
      { ok: true, text: 'dota2.exe runs.' }
    ]);
  });

  it('says the wait is over, and nothing at all for a rule with neither', () => {
    expect(checkRule(rule({ cooldownSec: 60 }), ctx(100_000), 0)).toEqual([{ ok: true, text: 'Its wait is over.' }]);
    expect(checkRule(rule(), ctx(0), undefined)).toEqual([]);
  });
});

describe('Activity', () => {
  it('keeps the last few hundred, and hands each character its own and those about nobody', () => {
    let now = 0;
    const activity = new Activity(() => now);
    const heard: number[] = [];
    activity.onAdd((entry) => heard.push(entry.id));
    for (let i = 0; i < ACTIVITY_MAX + 5; i += 1) {
      now = i;
      activity.add({ characterId: i % 2 === 0 ? 'a' : 'b', ruleId: null, event: null, outcome: 'note', text: `${i}` });
    }
    activity.add({ characterId: null, ruleId: null, event: 'signal x', outcome: 'note', text: 'no rule waits for it' });
    const forA = activity.for('a');
    expect(forA.every((entry) => entry.characterId === 'a' || entry.characterId === null)).toBe(true);
    expect(forA.at(-1)?.event).toBe('signal x');
    expect(activity.for('a').length + activity.for('b').length - 1).toBe(ACTIVITY_MAX);
    expect(heard).toHaveLength(ACTIVITY_MAX + 6);
  });
});

describe('days of the week', () => {
  // 2026-11-07 is a Saturday, 2026-11-09 a Monday.
  const saturday = new Date(2026, 10, 7, 12, 0).getTime();
  const monday = new Date(2026, 10, 9, 12, 0).getTime();

  it('lets a weekday rule through on a Monday and not on a Saturday, saying why', () => {
    const engine = new RuleEngine();
    engine.setCharacters([character([rule({ if: [{ type: 'days', days: [1, 2, 3, 4, 5] }] })])], 0);
    expect(engine.handle(click, ctx(monday))).toHaveLength(1);
    expect(skips(engine, ctx(saturday))).toEqual(['today is not a weekday']);
  });

  it('reads the days the way a person says them', () => {
    expect(daysText([1, 2, 3, 4, 5])).toBe('on weekdays');
    expect(daysText([0, 6])).toBe('at weekends');
    expect(daysText([0, 1, 2, 3, 4, 5, 6])).toBe('every day');
    expect(daysText([5, 1, 3])).toBe('on Mon, Wed, Fri');
  });

  it('refuses no days at all, or a day twice', () => {
    const base = rule();
    expect(ruleSchema.safeParse({ ...base, if: [{ type: 'days', days: [] }] }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, if: [{ type: 'days', days: [1, 1] }] }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, if: [{ type: 'days', days: [7] }] }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, if: [{ type: 'days', days: [0, 6] }] }).success).toBe(true);
  });
});

describe('stop here', () => {
  it('lets the rules below one that stops not fire on the same moment, and says why', () => {
    const engine = new RuleEngine(() => 0);
    engine.setCharacters(
      [character([rule({ id: 'first', name: 'Greet', stop: true }), rule({ id: 'second' }), rule({ id: 'other', when: { type: 'startup' } })])],
      0
    );
    const out: Skipped[] = [];
    const fired = engine.handle(click, ctx(0), (skipped) => out.push(skipped));
    expect(fired.map((one) => one.rule.id)).toEqual(['first']);
    expect(out.map((skipped) => [skipped.rule.id, skipped.why])).toEqual([['second', '“Greet” fired first and stops the rest']]);
  });

  it('stops nothing when the rule that would stop did not fire', () => {
    const engine = new RuleEngine(() => 0.99);
    engine.setCharacters([character([rule({ id: 'first', stop: true, if: [{ type: 'chance', percent: 10 }] }), rule({ id: 'second' })])], 0);
    expect(engine.handle(click, ctx(0)).map((one) => one.rule.id)).toEqual(['second']);
  });
});

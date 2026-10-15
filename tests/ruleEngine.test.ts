import { describe, expect, it } from 'vitest';
import { characterSchema, defaultCharacter, type Character, type Line } from '@shared/character';
import { ruleSchema, type Rule } from '@shared/rules';
import { pickLine, runActions, type ActionDeps } from '@main/engine/actions';
import { RuleEngine, ruleNeeds, type RuleContext } from '@main/engine/ruleEngine';
import { RecentHistory } from '@main/engine/selector';

const MINUTE = 60_000;
const at = (hh: number, mm: number): number => new Date(2026, 9, 14, hh, mm).getTime();

function rule(over: Partial<Rule> & Pick<Rule, 'when'>): Rule {
  return { id: 'r1', name: 'test', enabled: true, if: [], then: [{ type: 'say', group: 'greet' }], cooldownSec: 0, ...over };
}

function character(rules: Rule[], over: Partial<Character> = {}): Character {
  return { ...defaultCharacter('c1', 'Teto'), rules, lines: { greet: [{ id: 'l1', text: 'Hello.' }] }, ...over };
}

const ctx = (now: number, running: Record<string, boolean> | null = {}): RuleContext => ({
  now,
  isRunning: (program) => (running === null ? null : (running[program] ?? false))
});

describe('rule schema', () => {
  it('accepts every trigger, condition and action', () => {
    const full = rule({
      when: { type: 'every', minMinutes: 30, maxMinutes: 60 },
      if: [
        { type: 'chance', percent: 50 },
        { type: 'timeBetween', from: '22:00', to: '02:00' },
        { type: 'programRunning', program: 'dota2.exe', running: false }
      ],
      then: [{ type: 'say', group: 'idle' }, { type: 'sound', file: 'hi.ogg' }, { type: 'show', seconds: 10 }, { type: 'hide', minutes: 5 }]
    });
    expect(ruleSchema.safeParse(full).success).toBe(true);
  });

  it('refuses what the engine could not run', () => {
    const bad = [
      { when: { type: 'programStarted', program: '' } },
      { when: { type: 'every', minMinutes: 60, maxMinutes: 30 } },
      { when: { type: 'time', at: '25:00' } },
      { when: { type: 'teleport' } },
      { when: { type: 'startup' }, then: [] },
      { when: { type: 'startup' }, then: [{ type: 'sound', file: '../x.ogg' }] },
      { when: { type: 'startup' }, if: [{ type: 'chance', percent: 150 }] }
    ];
    for (const over of bad) expect(ruleSchema.safeParse({ ...rule({ when: { type: 'startup' } }), ...over }).success, JSON.stringify(over)).toBe(false);
  });

  it('makes a character with a broken rule unreadable, with the reason', () => {
    const base = defaultCharacter('c1', 'Teto');
    const parsed = characterSchema.safeParse({ ...base, rules: [{ ...rule({ when: { type: 'startup' } }), when: { type: 'nope' } }] });
    expect(parsed.success).toBe(false);
  });
});

describe('RuleEngine', () => {
  it('fires a program rule for that program only, however its name is written', () => {
    const engine = new RuleEngine(() => 0);
    engine.setCharacters([character([rule({ when: { type: 'programStarted', program: 'Dota2.EXE' } })])], 0);
    expect(engine.handle({ type: 'programStarted', program: 'cs2' }, ctx(0))).toEqual([]);
    expect(engine.handle({ type: 'programStopped', program: 'dota2' }, ctx(0))).toEqual([]);
    const fired = engine.handle({ type: 'programStarted', program: 'dota2' }, ctx(at(18, 5)));
    expect(fired).toHaveLength(1);
    expect(fired[0]?.slots).toMatchObject({ program: 'dota2', name: 'Teto', time: '18:05' });
  });

  it('ignores disabled rules and disabled characters', () => {
    const engine = new RuleEngine();
    engine.setCharacters(
      [
        character([rule({ when: { type: 'startup' }, enabled: false })]),
        character([rule({ when: { type: 'startup' } })], { id: 'c2', enabled: false })
      ],
      0
    );
    expect(engine.handle({ type: 'startup' }, ctx(0))).toEqual([]);
  });

  it('answers a click only for the character that was clicked', () => {
    const engine = new RuleEngine();
    engine.setCharacters([character([rule({ when: { type: 'clicked' } })]), character([rule({ when: { type: 'clicked' } })], { id: 'c2' })], 0);
    expect(engine.handle({ type: 'clicked', characterId: 'c2' }, ctx(0)).map((f) => f.character.id)).toEqual(['c2']);
  });

  it('fires a return only after long enough away, and offers the minutes', () => {
    const engine = new RuleEngine();
    engine.setCharacters([character([rule({ when: { type: 'returned', afterMinutes: 30 } })])], 0);
    expect(engine.handle({ type: 'returned', awayMinutes: 10 }, ctx(0))).toEqual([]);
    expect(engine.handle({ type: 'returned', awayMinutes: 45.4 }, ctx(0))[0]?.slots.minutes).toBe(45);
  });

  it('waits out the cooldown', () => {
    const engine = new RuleEngine();
    engine.setCharacters([character([rule({ when: { type: 'startup' }, cooldownSec: 600 })])], 0);
    expect(engine.handle({ type: 'startup' }, ctx(0))).toHaveLength(1);
    expect(engine.handle({ type: 'startup' }, ctx(9 * MINUTE))).toHaveLength(0);
    expect(engine.handle({ type: 'startup' }, ctx(10 * MINUTE))).toHaveLength(1);
  });

  it('does not spend the cooldown when a condition says no', () => {
    let roll = 0.9;
    const engine = new RuleEngine(() => roll);
    engine.setCharacters([character([rule({ when: { type: 'startup' }, cooldownSec: 600, if: [{ type: 'chance', percent: 50 }] })])], 0);
    expect(engine.handle({ type: 'startup' }, ctx(0))).toHaveLength(0);
    roll = 0.1;
    expect(engine.handle({ type: 'startup' }, ctx(MINUTE))).toHaveLength(1);
  });

  it('checks the time of day, across midnight too', () => {
    const engine = new RuleEngine();
    engine.setCharacters([character([rule({ when: { type: 'startup' }, if: [{ type: 'timeBetween', from: '22:00', to: '02:00' }] })])], 0);
    expect(engine.handle({ type: 'startup' }, ctx(at(23, 30)))).toHaveLength(1);
    expect(engine.handle({ type: 'startup' }, ctx(at(1, 0)))).toHaveLength(1);
    expect(engine.handle({ type: 'startup' }, ctx(at(12, 0)))).toHaveLength(0);
  });

  it('checks whether a program runs, and waits when that is not known', () => {
    const engine = new RuleEngine();
    engine.setCharacters([character([rule({ when: { type: 'startup' }, if: [{ type: 'programRunning', program: 'Steam.exe', running: true }] })])], 0);
    expect(engine.handle({ type: 'startup' }, ctx(0, { steam: true }))).toHaveLength(1);
    expect(engine.handle({ type: 'startup' }, ctx(0, { steam: false }))).toHaveLength(0);
    expect(engine.handle({ type: 'startup' }, ctx(0, null))).toHaveLength(0);
  });

  it('fires a daily rule at its minute', () => {
    const engine = new RuleEngine();
    engine.setCharacters([character([rule({ when: { type: 'time', at: '09:00' } })])], 0);
    expect(engine.handle({ type: 'time', at: '08:59' }, ctx(0))).toHaveLength(0);
    expect(engine.handle({ type: 'time', at: '09:00' }, ctx(0))).toHaveLength(1);
  });

  it('plans `every` rules between their bounds and plans them again once due', () => {
    const engine = new RuleEngine(() => 0.5);
    const every = rule({ when: { type: 'every', minMinutes: 10, maxMinutes: 30 } });
    engine.setCharacters([character([every])], 0);
    expect(engine.nextDue()).toBe(20 * MINUTE);
    expect(engine.due(19 * MINUTE)).toEqual([]);
    const due = engine.due(20 * MINUTE);
    expect(due).toEqual([{ type: 'every', characterId: 'c1', ruleId: 'r1' }]);
    expect(engine.nextDue()).toBe(40 * MINUTE);
    expect(engine.handle(due[0]!, ctx(20 * MINUTE))).toHaveLength(1);
  });

  it('keeps a planned turn when an unrelated edit comes in, and replans a changed one', () => {
    const engine = new RuleEngine(() => 0.5);
    const every = rule({ when: { type: 'every', minMinutes: 10, maxMinutes: 30 } });
    engine.setCharacters([character([every])], 0);
    engine.setCharacters([character([{ ...every, name: 'renamed' }])], 5 * MINUTE);
    expect(engine.nextDue()).toBe(20 * MINUTE);
    engine.setCharacters([character([{ ...every, when: { type: 'every', minMinutes: 60, maxMinutes: 60 } }])], 5 * MINUTE);
    expect(engine.nextDue()).toBe(65 * MINUTE);
    engine.setCharacters([character([])], 5 * MINUTE);
    expect(engine.nextDue()).toBeNull();
  });
});

describe('ruleNeeds', () => {
  it('asks only for what enabled rules use', () => {
    const needs = ruleNeeds([
      character([
        rule({ when: { type: 'programStarted', program: 'Dota2.exe' } }),
        rule({ id: 'r2', when: { type: 'time', at: '09:00' }, if: [{ type: 'programRunning', program: 'Steam', running: true }] }),
        rule({ id: 'r3', when: { type: 'programFocused', program: 'code' }, enabled: false })
      ])
    ]);
    expect(needs).toEqual({ startStop: new Set(['dota2']), running: new Set(['steam']), focus: false, time: true, every: false, returned: false });
  });
});

/* ------------------------------------------------------------------ */

function deps(over: Partial<ActionDeps> = {}): ActionDeps & { said: string[]; sounds: string[]; shown: number[]; hidden: number[]; logs: string[] } {
  const said: string[] = [];
  const sounds: string[] = [];
  const shown: number[] = [];
  const hidden: number[] = [];
  const logs: string[] = [];
  return {
    said,
    sounds,
    shown,
    hidden,
    logs,
    isSilenced: () => false,
    say: (_character, text) => said.push(text),
    playSound: (_character, file) => {
      sounds.push(file);
      return true;
    },
    show: (_character, ms) => shown.push(ms),
    hide: (_character, ms) => hidden.push(ms),
    log: (message) => logs.push(message),
    history: new RecentHistory(),
    rng: () => 0,
    ...over
  };
}

describe('actions', () => {
  const lines: Line[] = [
    { id: 'a', text: '{program} again?' },
    { id: 'b', text: 'Back after {minutes} minutes.' },
    { id: 'c', text: 'Hello, {name}.', audio: 'hello.ogg' }
  ];
  const withLines = character([], { lines: { greet: lines } });

  it('says a line whose slots can be filled, and plays its sound', () => {
    const d = deps({ rng: () => 0.99 });
    runActions({ character: withLines, rule: rule({ when: { type: 'startup' } }), slots: { name: 'Teto' } }, d);
    expect(d.said).toEqual(['Hello, Teto.']);
    expect(d.sounds).toEqual(['hello.ogg']);
  });

  it('does not say the same line twice running when there is another', () => {
    const d = deps();
    const once = (): string | undefined => pickLine(withLines, 'greet', { program: 'dota2', minutes: 5, name: 'Teto' }, d)?.text;
    const first = once();
    const second = once();
    expect(first).not.toBe(second);
  });

  it('says nothing when it is quiet, but still shows and hides', () => {
    const d = deps({ isSilenced: () => true });
    const all = rule({ when: { type: 'startup' }, then: [{ type: 'say', group: 'greet' }, { type: 'sound', file: 'x.ogg' }, { type: 'show', seconds: 5 }, { type: 'hide', minutes: 2 }] });
    runActions({ character: withLines, rule: all, slots: {} }, d);
    expect(d.said).toEqual([]);
    expect(d.sounds).toEqual([]);
    expect(d.shown).toEqual([5000]);
    expect(d.hidden).toEqual([120_000]);
  });

  it('says so in the log when a group has nothing it can say', () => {
    const d = deps();
    runActions({ character: withLines, rule: rule({ when: { type: 'startup' }, then: [{ type: 'say', group: 'missing' }] }), slots: {} }, d);
    expect(d.said).toEqual([]);
    expect(d.logs[0]).toMatch(/nothing to say/);
  });
});

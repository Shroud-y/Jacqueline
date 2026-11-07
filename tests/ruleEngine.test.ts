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
      then: [{ type: 'say', group: 'idle' }, { type: 'sound', file: 'hi.ogg' }, { type: 'show', seconds: 10, place: 'usual' }, { type: 'hide', minutes: 5 }]
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

  it('fires a signal rule for that signal only, with its text for {text} when one came', () => {
    const engine = new RuleEngine();
    engine.setCharacters([character([rule({ when: { type: 'signal', name: 'build-ok' } })])], 0);
    expect(engine.handle({ type: 'signal', name: 'build-failed', text: null }, ctx(0))).toEqual([]);
    const fired = engine.handle({ type: 'signal', name: 'build-ok', text: '3 tests' }, ctx(0));
    expect(fired[0]?.slots.text).toBe('3 tests');
    const bare = engine.handle({ type: 'signal', name: 'build-ok', text: null }, ctx(1));
    expect(bare).toHaveLength(1);
    expect('text' in (bare[0]?.slots ?? {})).toBe(false);
  });

  it('fires a game rule for its event, a streak rule on the kill that crosses its number, with game slots', () => {
    const engine = new RuleEngine();
    const won = rule({ id: 'won', when: { type: 'game', event: 'won', streak: 3 } });
    const spree = rule({ id: 'spree', when: { type: 'game', event: 'streak', streak: 3 } });
    engine.setCharacters([character([won, spree])], 0);
    expect(ruleNeeds([character([won])]).game).toBe(true);
    const game = { type: 'game' as const, hero: 'npc_dota_hero_shadow_shaman', kills: 3, deaths: 1 };
    const fired = engine.handle({ ...game, event: 'won', streak: 0, streakBefore: 0 }, ctx(0));
    expect(fired.map((one) => one.rule.id)).toEqual(['won']);
    expect(fired[0]?.slots).toMatchObject({ hero: 'Shadow Shaman', kills: 3, deaths: 1, streak: 0 });
    expect(engine.handle({ ...game, event: 'kill', streak: 2, streakBefore: 1 }, ctx(0))).toEqual([]);
    // A double kill straight from 2 to 4 still crosses 3; the next kill, at 5, does not again.
    expect(engine.handle({ ...game, event: 'kill', streak: 4, streakBefore: 2 }, ctx(0)).map((one) => one.rule.id)).toEqual(['spree']);
    expect(engine.handle({ ...game, event: 'kill', streak: 5, streakBefore: 4 }, ctx(0))).toEqual([]);
    expect(engine.handle({ ...game, event: 'death', streak: 0, streakBefore: 5 }, ctx(0))).toEqual([]);
  });

  it('reads a game rule saved without a streak as 3, and refuses an event it does not know', () => {
    expect(ruleSchema.parse(rule({ when: { type: 'game', event: 'kill' } as Rule['when'] })).when).toEqual({ type: 'game', event: 'kill', streak: 3 });
    expect(ruleSchema.safeParse(rule({ when: { type: 'game', event: 'rampage' } as unknown as Rule['when'] })).success).toBe(false);
    expect(ruleSchema.safeParse(rule({ when: { type: 'game', event: 'streak', streak: 1 } })).success).toBe(false);
  });

  it('reads a show action saved before it had a place as coming out where it usually is', () => {
    const parsed = ruleSchema.parse({ ...rule({ when: { type: 'startup' } }), then: [{ type: 'show', seconds: 5 }] });
    expect(parsed.then[0]).toEqual({ type: 'show', seconds: 5, place: 'usual' });
    expect(ruleSchema.safeParse({ ...rule({ when: { type: 'signal', name: 'no spaces' } }) }).success).toBe(false);
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
    expect(needs).toEqual({ startStop: new Set(['dota2']), running: new Set(['steam']), focus: false, time: true, every: false, returned: false, music: false, game: false });
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
    setState: () => true,
    setMood: () => undefined,
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
    const all = rule({ when: { type: 'startup' }, then: [{ type: 'say', group: 'greet' }, { type: 'sound', file: 'x.ogg' }, { type: 'show', seconds: 5, place: 'usual' }, { type: 'hide', minutes: 2 }] });
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

  it('says text written into the rule, slots filled, and nothing when a slot cannot be', () => {
    const d = deps();
    const reports: string[] = [];
    d.report = (_character, _rule, outcome, text) => reports.push(`${outcome}: ${text}`);
    const then = [
      { type: 'sayText' as const, text: 'Hi, {name}.' },
      { type: 'sayText' as const, text: 'Playing {track}.' }
    ];
    runActions({ character: withLines, rule: rule({ when: { type: 'startup' }, then }), slots: { name: 'Teto' } }, d);
    expect(d.said).toEqual(['Hi, Teto.']);
    expect(reports).toEqual(['note: said “Hi, Teto.”', 'problem: nothing said: “Playing {track}.” has a {slot} this event cannot fill']);
  });

  it('waits between actions, and goes no further once the character is gone by then', () => {
    const timers: { ms: number; fn: () => void }[] = [];
    let acting = true;
    const d = deps({ later: (ms, fn) => void timers.push({ ms, fn }), isActing: () => acting });
    const then = [
      { type: 'sayText' as const, text: 'One.' },
      { type: 'wait' as const, seconds: 3 },
      { type: 'sayText' as const, text: 'Two.' },
      { type: 'wait' as const, seconds: 1.5 },
      { type: 'sayText' as const, text: 'Three.' }
    ];
    runActions({ character: withLines, rule: rule({ when: { type: 'startup' }, then }), slots: {} }, d);
    expect(d.said).toEqual(['One.']);
    expect(timers.map((timer) => timer.ms)).toEqual([3000]);
    timers.shift()?.fn();
    expect(d.said).toEqual(['One.', 'Two.']);
    expect(timers.map((timer) => timer.ms)).toEqual([1500]);
    acting = false;
    timers.shift()?.fn();
    expect(d.said).toEqual(['One.', 'Two.']);
    expect(d.logs.at(-1)).toMatch(/stopped after a wait/);
  });

  it('sends a signal with its text filled, one deeper than the signal that set it off', () => {
    const sent: unknown[] = [];
    const reports: string[] = [];
    const d = deps({ signal: (_character, name, text, hops) => sent.push([name, text, hops]) > 0 && hops < 4 });
    d.report = (_character, _rule, outcome, text) => reports.push(`${outcome}: ${text}`);
    const then = [
      { type: 'sendSignal' as const, name: 'hello', text: 'from {name}' },
      { type: 'sendSignal' as const, name: 'bare' },
      { type: 'sendSignal' as const, name: 'broken', text: '{track}' }
    ];
    runActions({ character: withLines, rule: rule({ when: { type: 'startup' }, then }), slots: { name: 'Teto' }, hops: 2 }, d);
    expect(sent).toEqual([
      ['hello', 'from Teto', 2],
      ['bare', null, 2]
    ]);
    expect(reports).toEqual(['note: sent signal hello', 'note: sent signal bare', 'problem: signal broken not sent: its text has a {slot} this event cannot fill']);
  });

  it('says so when a signal goes round too many times', () => {
    const reports: string[] = [];
    const d = deps({ signal: () => false });
    d.report = (_character, _rule, outcome, text) => reports.push(`${outcome}: ${text}`);
    runActions({ character: withLines, rule: rule({ when: { type: 'startup' }, then: [{ type: 'sendSignal', name: 'loop' }] }), slots: {} }, d);
    expect(reports[0]).toMatch(/^problem: signal loop not sent: signals went round too many times/);
  });

  it('stops talking when told to', () => {
    const stopped: string[] = [];
    const d = deps({ dismiss: (character) => void stopped.push(character.id) });
    runActions({ character: withLines, rule: rule({ when: { type: 'startup' }, then: [{ type: 'dismiss' }] }), slots: {} }, d);
    expect(stopped).toEqual([withLines.id]);
  });

  it('hands a fired rule how deep the signal that set it off was', () => {
    const engine = new RuleEngine();
    engine.setCharacters([character([rule({ when: { type: 'signal', name: 'hello' } })])], 0);
    expect(engine.handle({ type: 'signal', name: 'hello', text: null, hops: 3 }, ctx(0))[0]?.hops).toBe(3);
    expect(engine.handle({ type: 'signal', name: 'hello', text: null }, ctx(0))[0]?.hops).toBe(0);
  });

  it('sets and clears its mood', () => {
    const moods: (string | null)[] = [];
    const d = deps({ setMood: (_character, mood) => void moods.push(mood) });
    const then = [
      { type: 'mood' as const, mood: 'sleepy' },
      { type: 'mood' as const, mood: null }
    ];
    runActions({ character: withLines, rule: rule({ when: { type: 'startup' }, then }), slots: {} }, d);
    expect(moods).toEqual(['sleepy', null]);
    expect(ruleSchema.safeParse({ ...rule({ when: { type: 'startup' } }), then: [{ type: 'mood', mood: 'Not A Mood' }] }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...rule({ when: { type: 'startup' } }), then: [{ type: 'sayText', text: '   ' }] }).success).toBe(false);
  });

  it('changes look, in milliseconds, and says so in the log when the state is gone', () => {
    const asked: unknown[] = [];
    const d = deps({
      setState: (_character, state, ms) => {
        asked.push([state, ms]);
        return state !== 'gone';
      }
    });
    const then = [
      { type: 'setState' as const, state: 'nap', seconds: 5 },
      { type: 'setState' as const, state: 'gone', seconds: null },
      { type: 'setState' as const, state: null, seconds: null }
    ];
    runActions({ character: withLines, rule: rule({ when: { type: 'startup' }, then }), slots: {} }, d);
    expect(asked).toEqual([['nap', 5000], ['gone', null], [null, null]]);
    expect(d.logs).toHaveLength(1);
    expect(d.logs[0]).toMatch(/no state "gone"/);
  });
});

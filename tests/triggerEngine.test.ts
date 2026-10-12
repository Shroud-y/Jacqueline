import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FOCUS_REMARK_IDS, TOPIC_IDS } from '@shared/types';
import { PhraseBankIndex, parsePhraseBank } from '@main/core/phraseBank';
import { TRIGGER_RULES, TriggerEngine, type TriggerRule } from '@main/core/triggerEngine';
import { createEvent, eventTypeMatches } from '@main/core/events';

const bank = new PhraseBankIndex(
  parsePhraseBank({
    version: 1,
    groups: [
      {
        id: 'g.system',
        category: 'system',
        phrases: [{ id: 's.one', segments: [{ text: 'Hot.', mode: 'normal' }] }]
      }
    ]
  })
);

const baseCtx = { uptimeMinutes: 120, firstRun: false };

describe('eventTypeMatches', () => {
  it('matches exact types, prefix wildcards and the catch-all', () => {
    expect(eventTypeMatches('system.cpu.high', 'system.cpu.high')).toBe(true);
    expect(eventTypeMatches('system.cpu.high', 'system.cpu.low')).toBe(false);
    expect(eventTypeMatches('system.*', 'system.cpu.high')).toBe(true);
    expect(eventTypeMatches('system.*', 'process.started')).toBe(false);
    expect(eventTypeMatches('*', 'anything.at.all')).toBe(true);
  });
});

describe('TriggerEngine', () => {
  const rule: TriggerRule = { id: 'r', topic: 'system', on: 'system.cpu.high', groupId: 'g.system' };

  it('resolves the group category onto the candidate', () => {
    const engine = new TriggerEngine(bank, { rules: [rule], rng: () => 0 });
    const candidates = engine.match(createEvent('system.cpu.high', 'ambient', {}, 1), baseCtx);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ ruleId: 'r', groupId: 'g.system', category: 'system' });
  });

  it('ignores events no rule listens for', () => {
    const engine = new TriggerEngine(bank, { rules: [rule], rng: () => 0 });
    expect(engine.match(createEvent('file.buildComplete', 'notable', {}, 1), baseCtx)).toEqual([]);
  });

  it('applies chance using the injected rng', () => {
    const chancy: TriggerRule = { ...rule, chance: 0.5 };
    const always = new TriggerEngine(bank, { rules: [chancy], rng: () => 0.1 });
    const never = new TriggerEngine(bank, { rules: [chancy], rng: () => 0.9 });
    expect(always.match(createEvent('system.cpu.high', 'ambient', {}, 1), baseCtx)).toHaveLength(1);
    expect(never.match(createEvent('system.cpu.high', 'ambient', {}, 1), baseCtx)).toHaveLength(0);
  });

  it('honours minIntervalMs per rule', () => {
    const engine = new TriggerEngine(bank, {
      rules: [{ ...rule, minIntervalMs: 60_000 }],
      rng: () => 0
    });
    expect(engine.match(createEvent('system.cpu.high', 'ambient', {}, 0), baseCtx)).toHaveLength(1);
    expect(engine.match(createEvent('system.cpu.high', 'ambient', {}, 30_000), baseCtx)).toHaveLength(
      0
    );
    expect(engine.match(createEvent('system.cpu.high', 'ambient', {}, 61_000), baseCtx)).toHaveLength(
      1
    );
  });

  it('gates on conditions against the event payload', () => {
    const engine = new TriggerEngine(bank, {
      rules: [{ ...rule, conditions: [{ kind: 'payloadNumber', path: 'load', gt: 90 }] }],
      rng: () => 0
    });
    expect(
      engine.match(createEvent('system.cpu.high', 'ambient', { load: 95 }, 1), baseCtx)
    ).toHaveLength(1);
    expect(
      engine.match(createEvent('system.cpu.high', 'ambient', { load: 50 }, 2), baseCtx)
    ).toHaveLength(0);
  });

  it('reports rules pointing at a missing group', () => {
    const engine = new TriggerEngine(bank, {
      rules: [{ id: 'broken', topic: 'system', on: 'x', groupId: 'nope' }],
      rng: () => 0
    });
    expect(engine.danglingRules()).toEqual([{ ruleId: 'broken', groupId: 'nope' }]);
  });

  it('does not fire a rule whose topic is switched off', () => {
    const engine = new TriggerEngine(bank, { rules: [rule], rng: () => 0, isEnabled: () => false });
    expect(engine.match(createEvent('system.cpu.high', 'ambient', {}, 1), baseCtx)).toEqual([]);
  });

  it('does not spend a switched-off rule\'s debounce, so switching it back on finds it fresh', () => {
    let enabled = false;
    const debounced: TriggerRule = { ...rule, minIntervalMs: 60_000 };
    const engine = new TriggerEngine(bank, { rules: [debounced], rng: () => 0, isEnabled: () => enabled });

    expect(engine.match(createEvent('system.cpu.high', 'ambient', {}, 1_000), baseCtx)).toHaveLength(0);
    enabled = true;
    // One second later, well inside the debounce it would have started.
    expect(engine.match(createEvent('system.cpu.high', 'ambient', {}, 2_000), baseCtx)).toHaveLength(1);
  });

  it('asks about the topic on every event, so a settings change needs no restart', () => {
    const seen: string[] = [];
    const engine = new TriggerEngine(bank, {
      rules: [rule],
      rng: () => 0,
      isEnabled: (candidate) => {
        seen.push(candidate.topic);
        return true;
      }
    });
    engine.match(createEvent('system.cpu.high', 'ambient', {}, 1), baseCtx);
    engine.match(createEvent('system.cpu.high', 'ambient', {}, 2), baseCtx);
    expect(seen).toEqual(['system', 'system']);
  });

  it('carries the event priority through to the candidate', () => {
    const engine = new TriggerEngine(bank, { rules: [rule], rng: () => 0 });
    const [candidate] = engine.match(createEvent('system.cpu.high', 'urgent', {}, 1), baseCtx);
    expect(candidate?.priority).toBe('urgent');
  });
});

describe('the shipped phrase bank', () => {
  it('gives the silence timer enough phrases to rotate through', () => {
    const raw = JSON.parse(readFileSync('resources/phrases/bank.json', 'utf8'));
    const realBank = new PhraseBankIndex(parsePhraseBank(raw));
    const group = realBank.group('chatter.idle');
    // Its own category, not `ambient`: sharing with the greetings would cap
    // the silence timer at the greeting rate.
    expect(group?.category).toBe('chatter');
    // At chatty the per-phrase cooldown is 2 h and the timer comes round every
    // 10 min, so fewer than 12 phrases and the group runs dry mid-session.
    expect(group?.phrases.length).toBeGreaterThanOrEqual(12);
  });
});

describe('the shipped rules', () => {
  const raw = JSON.parse(readFileSync('resources/phrases/bank.json', 'utf8'));
  const realBank = new PhraseBankIndex(parsePhraseBank(raw));
  const matchWith = (enabled: (rule: TriggerRule) => boolean, type: string, payload: unknown): string[] =>
    new TriggerEngine(realBank, { rng: () => 0, isEnabled: enabled })
      .match(createEvent(type, 'ambient', payload, 1), baseCtx)
      .map((candidate) => candidate.ruleId);

  it('files every rule under a topic the settings window offers', () => {
    for (const rule of TRIGGER_RULES) expect(TOPIC_IDS).toContain(rule.topic);
  });

  it('gives every active-window rule a kind, and nothing else one', () => {
    for (const rule of TRIGGER_RULES) {
      if (rule.topic === 'activeWindow') expect(FOCUS_REMARK_IDS).toContain(rule.focusRemark);
      else expect(rule.focusRemark).toBeUndefined();
    }
  });

  it('leaves no topic and no kind of active-window remark without a rule behind it', () => {
    // A switch in settings that controls nothing is worse than no switch.
    for (const topic of TOPIC_IDS) expect(TRIGGER_RULES.some((rule) => rule.topic === topic)).toBe(true);
    for (const kind of FOCUS_REMARK_IDS) {
      expect(TRIGGER_RULES.some((rule) => rule.focusRemark === kind)).toBe(true);
    }
  });

  it('picks the lines for an application from the kind on the event', () => {
    const all = (): boolean => true;
    expect(matchWith(all, 'process.started', { name: 'mygame.exe', kind: 'game' })).toEqual(['process.started.game']);
    expect(matchWith(all, 'process.started', { name: 'steam.exe', kind: 'launcher' })).toEqual([
      'process.started.gameLauncher'
    ]);
    expect(matchWith(all, 'process.stopped', { name: 'spotify.exe', kind: 'notable' })).toEqual([
      'process.stopped.notable'
    ]);
    expect(matchWith(all, 'process.started', { name: 'code.exe', kind: 'app' })).toEqual(['process.started']);
  });

  it('says nothing about an application event that carries no kind', () => {
    expect(matchWith(() => true, 'process.started', { name: 'code.exe' })).toEqual([]);
  });

  it('silences drift remarks alone when only that kind is switched off', () => {
    const noDrift = (rule: TriggerRule): boolean => rule.focusRemark !== 'drift';
    const payload = { activity: 'video', app: 'Chrome', site: 'YouTube', subject: 'YouTube', minutes: 60 };
    expect(matchWith(noDrift, 'focus.drift', payload)).toEqual([]);
    expect(matchWith(noDrift, 'focus.return', { ...payload, activity: 'coding' })).toEqual([]);
    expect(matchWith(noDrift, 'focus.enter', payload)).toEqual(['focus.enter.video']);
    expect(matchWith(noDrift, 'focus.tool', { ...payload, tool: 'taskmgr' })).toEqual(['focus.tool.taskmgr']);
  });
});

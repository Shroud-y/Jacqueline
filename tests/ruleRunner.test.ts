import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCharacter, type Character } from '@shared/character';
import type { Rule } from '@shared/rules';
import type { Fired } from '@main/engine/ruleEngine';
import { RuleRunner } from '@main/engine/ruleRunner';
import type { DesktopSensors } from '@main/sensors/win32';

function rule(when: Rule['when'], over: Partial<Rule> = {}): Rule {
  return { id: `r-${when.type}`, name: '', enabled: true, when, if: [], then: [{ type: 'say', group: 'g' }], cooldownSec: 0, ...over };
}

const character = (rules: Rule[]): Character => ({ ...defaultCharacter('c1', 'Teto'), rules });

interface Desk {
  running: Set<string>;
  focused: string | null;
  idle: number;
  switchTo(app: string): void;
  sensors: DesktopSensors;
  loads: number;
}

function desk(): Desk {
  let listener: (() => void) | null = null;
  const d: Desk = {
    running: new Set(),
    focused: null,
    idle: 0,
    loads: 0,
    switchTo(app) {
      d.focused = app;
      listener?.();
    },
    sensors: {
      runningApps: () => new Set(d.running),
      foregroundApp: () => d.focused,
      fullscreenDisplay: () => null,
      onForegroundChange: (callback) => {
        listener = callback;
        return () => (listener = null);
      }
    }
  };
  return d;
}

let fired: Fired[];
const runner = (d: Desk): RuleRunner =>
  new RuleRunner({
    loadSensors: async () => {
      d.loads += 1;
      return d.sensors;
    },
    idleSeconds: () => d.idle,
    onFired: (one) => fired.push(one),
    rng: () => 0.5,
    now: () => Date.now()
  });

const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 14, 8, 59, 30) });
  fired = [];
});
afterEach(() => vi.useRealTimers());

describe('RuleRunner', () => {
  it('loads no sensors and holds no timers for rules that need neither', async () => {
    const d = desk();
    const r = runner(d);
    r.setCharacters([character([rule({ type: 'startup' }), rule({ type: 'clicked' })])]);
    await settle();
    expect(d.loads).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    r.event({ type: 'startup' });
    expect(fired.map((f) => f.rule.when.type)).toEqual(['startup']);
    r.stop();
  });

  it('reports a program starting and stopping, but not one that was already running', async () => {
    const d = desk();
    d.running = new Set(['steam']);
    const r = runner(d);
    r.setCharacters([character([rule({ type: 'programStarted', program: 'Dota2.exe' }), rule({ type: 'programStopped', program: 'steam.exe' })])]);
    await settle();
    expect(fired).toEqual([]);

    d.running = new Set(['steam', 'dota2']);
    await vi.advanceTimersByTimeAsync(5_000);
    d.running = new Set(['dota2']);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fired.map((f) => `${f.rule.when.type}:${f.slots.program}`)).toEqual(['programStarted:dota2', 'programStopped:steam']);
    r.stop();
  });

  it('catches a program that opens and closes between two looks, once it comes to the front', async () => {
    const d = desk();
    const r = runner(d);
    r.setCharacters([character([rule({ type: 'programStarted', program: 'tool.exe' }), rule({ type: 'programStopped', program: 'tool.exe' })])]);
    await settle();

    // Never in any process list: only the window coming to the front shows it.
    d.switchTo('tool');
    expect(fired.map((f) => f.rule.when.type)).toEqual(['programStarted']);
    d.switchTo('chrome');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fired.map((f) => f.rule.when.type)).toEqual(['programStarted', 'programStopped']);
    r.stop();
  });

  it('does not report a start twice when the next look finds the program still running', async () => {
    const d = desk();
    const r = runner(d);
    r.setCharacters([character([rule({ type: 'programStarted', program: 'tool.exe' })])]);
    await settle();

    d.running = new Set(['tool']);
    d.switchTo('tool');
    d.switchTo('chrome');
    d.switchTo('tool');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fired).toHaveLength(1);
    r.stop();
  });

  it('takes a program already running at the first look for no start when it comes to the front', async () => {
    const d = desk();
    d.running = new Set(['tool']);
    const r = runner(d);
    r.setCharacters([character([rule({ type: 'programStarted', program: 'tool.exe' })])]);
    await settle();
    d.switchTo('tool');
    expect(fired).toEqual([]);
    r.stop();
  });

  it('stops listening to windows when no rule names a program any more', async () => {
    const d = desk();
    const r = runner(d);
    r.setCharacters([character([rule({ type: 'programStarted', program: 'tool.exe' })])]);
    await settle();
    r.setCharacters([character([])]);
    await settle();
    d.switchTo('tool');
    expect(fired).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    r.stop();
  });

  it('hears a window coming to the front as it happens, once per change', async () => {
    const d = desk();
    d.focused = 'chrome';
    const r = runner(d);
    r.setCharacters([character([rule({ type: 'programFocused', program: 'code' })])]);
    await settle();
    d.switchTo('chrome');
    d.switchTo('code');
    d.switchTo('code');
    expect(fired).toHaveLength(1);
    r.stop();
  });

  it('notices the user coming back after being away', async () => {
    const d = desk();
    const r = runner(d);
    r.setCharacters([character([rule({ type: 'returned', afterMinutes: 30 })])]);
    await settle();
    d.idle = 45 * 60;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fired).toEqual([]);
    d.idle = 2;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fired.map((f) => f.slots.minutes)).toEqual([45]);
    r.stop();
  });

  it('fires a daily rule on its minute', async () => {
    const d = desk();
    const r = runner(d);
    r.setCharacters([character([rule({ type: 'time', at: '09:00' })])]);
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fired).toEqual([]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fired).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fired).toHaveLength(1);
    r.stop();
  });

  it('fires an `every` rule on its turns', async () => {
    const d = desk();
    const r = runner(d);
    r.setCharacters([character([rule({ type: 'every', minMinutes: 10, maxMinutes: 30 })])]);
    await settle();
    await vi.advanceTimersByTimeAsync(19 * 60_000);
    expect(fired).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fired).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(fired).toHaveLength(2);
    r.stop();
  });

  it('lets everything go when the rules that needed it are gone', async () => {
    const d = desk();
    const r = runner(d);
    r.setCharacters([character([rule({ type: 'programFocused', program: 'code' }), rule({ type: 'time', at: '09:00' }), rule({ type: 'returned', afterMinutes: 5 })])]);
    await settle();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    r.setCharacters([character([])]);
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    d.switchTo('code');
    expect(fired).toEqual([]);
    r.stop();
  });

  describe('what is playing', () => {
    const watching = (d: Desk): { r: RuleRunner; report: (sessions: { app: string; playing: boolean; title: string; artist: string }[]) => Promise<void>; started: () => number; stopped: () => number } => {
      let listener: ((sessions: { app: string; playing: boolean; title: string; artist: string }[]) => void) | null = null;
      let started = 0;
      let stopped = 0;
      const r = new RuleRunner({
        loadSensors: async () => d.sensors,
        watchMedia: (onSessions) => {
          started += 1;
          listener = onSessions;
          return () => {
            stopped += 1;
          };
        },
        idleSeconds: () => d.idle,
        onFired: (one) => fired.push(one),
        rng: () => 0.5,
        now: () => Date.now()
      });
      return {
        r,
        report: async (sessions) => {
          listener?.(sessions);
          await vi.advanceTimersByTimeAsync(400);
        },
        started: () => started,
        stopped: () => stopped
      };
    };

    it('listens only while a rule asks, and fires with the track in its slots', async () => {
      const d = desk();
      const { r, report, started, stopped } = watching(d);
      r.setCharacters([character([rule({ type: 'startup' })])]);
      await settle();
      expect(started()).toBe(0);

      r.setCharacters([character([rule({ type: 'musicStarted' })])]);
      await settle();
      expect(started()).toBe(1);
      await report([]);
      await report([{ app: 'Spotify.exe', playing: true, title: 'One', artist: 'Band' }]);
      expect(fired.map((f) => [f.rule.when.type, f.slots.track, f.slots.artist])).toEqual([['musicStarted', 'One', 'Band']]);

      r.setCharacters([character([])]);
      await settle();
      expect(stopped()).toBe(1);
      r.stop();
    });

    it('fills the slots of a rule about something else, only while it plays', async () => {
      const d = desk();
      const { r, report } = watching(d);
      r.setCharacters([character([rule({ type: 'startup' }), rule({ type: 'musicStopped' })])]);
      await settle();
      await report([{ app: 'Spotify.exe', playing: true, title: 'One', artist: 'Band' }]);
      r.event({ type: 'startup' });
      expect(fired[0]?.slots.track).toBe('One');
      fired = [];

      await report([]);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fired.map((f) => f.slots.track)).toEqual(['One']);
      fired = [];
      r.event({ type: 'startup' });
      expect(fired[0]?.slots.track).toBeUndefined();
      r.stop();
    });

    it('watches for a script too', async () => {
      const d = desk();
      const { r, started } = watching(d);
      r.setExtraNeeds({ startStop: new Set(), running: new Set(), focus: false, time: false, returned: false, music: true });
      await settle();
      expect(started()).toBe(1);
      r.stop();
    });
  });

  it('does nothing once stopped', async () => {
    const d = desk();
    const r = runner(d);
    r.setCharacters([character([rule({ type: 'startup' })])]);
    r.stop();
    r.event({ type: 'startup' });
    expect(fired).toEqual([]);
  });
});

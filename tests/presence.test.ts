import { describe, expect, it } from 'vitest';
import { defaultCharacter, type Character, type Presence } from '@shared/character';
import type { Rect } from '@shared/layout';
import { appStem, isPresent, presenceNeeds, type DesktopFacts } from '@main/characters/presence';
import { PresenceWatcher, type UserActivity } from '@main/sensors/presenceWatcher';
import type { DesktopSensors } from '@main/sensors/win32';

const nothing: DesktopFacts = { running: null, focused: null, fullscreen: null };
const primary: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
const onPrimary: Rect = { x: 1600, y: 800, width: 240, height: 240 };
const onSecond: Rect = { x: 2200, y: 300, width: 240, height: 240 };

function character(presence: Partial<Presence> = {}, enabled = true): Character {
  const base = defaultCharacter('a1', 'Miku');
  return { ...base, enabled, presence: { ...base.presence, ...presence } };
}

describe('appStem', () => {
  it('treats a name with and without its extension, in any case, as one program', () => {
    expect(appStem('Dota2.EXE')).toBe('dota2');
    expect(appStem('  dota2 ')).toBe('dota2');
    expect(appStem('Risk of Rain 2.exe')).toBe('risk of rain 2');
  });
});

describe('isPresent', () => {
  it('shows an always-on character whatever is going on', () => {
    expect(isPresent(character(), nothing, onPrimary)).toBe(true);
  });

  it('never shows a disabled one', () => {
    expect(isPresent(character({}, false), nothing, onPrimary)).toBe(false);
  });

  it('shows a character tied to a program only while that program runs', () => {
    const tied = character({ mode: 'whileRunning', apps: ['Dota2.exe', 'cs2.exe'] });
    expect(isPresent(tied, { ...nothing, running: new Set(['chrome']) }, onPrimary)).toBe(false);
    expect(isPresent(tied, { ...nothing, running: new Set(['chrome', 'dota2']) }, onPrimary)).toBe(true);
  });

  it('hides it while the process list is unknown, rather than guessing', () => {
    expect(isPresent(character({ mode: 'whileRunning', apps: ['dota2.exe'] }), nothing, onPrimary)).toBe(false);
  });

  it('shows a character tied to the window in front only while that window is in front', () => {
    const tied = character({ mode: 'whileFocused', apps: ['Code.exe'] });
    expect(isPresent(tied, { ...nothing, focused: 'code' }, onPrimary)).toBe(true);
    expect(isPresent(tied, { ...nothing, focused: 'chrome' }, onPrimary)).toBe(false);
    expect(isPresent(tied, nothing, onPrimary)).toBe(false);
  });

  it('shows nobody for a program list that is empty', () => {
    expect(isPresent(character({ mode: 'whileRunning' }), { ...nothing, running: new Set(['dota2']) }, onPrimary)).toBe(false);
  });

  it('keeps a speak-only character away until it can speak', () => {
    expect(isPresent(character({ mode: 'onSpeech' }), nothing, onPrimary)).toBe(false);
  });

  it('steps aside for a fullscreen application on its own display, if asked to', () => {
    const facts = { ...nothing, fullscreen: primary };
    expect(isPresent(character({ hideOnFullscreen: true }), facts, onPrimary)).toBe(false);
    expect(isPresent(character({ hideOnFullscreen: true }), facts, onSecond)).toBe(true);
    expect(isPresent(character({ hideOnFullscreen: false }), facts, onPrimary)).toBe(true);
  });

  it('lets fullscreen win over the program being in front — that program usually is the fullscreen one', () => {
    const tied = character({ mode: 'whileFocused', apps: ['dota2.exe'], hideOnFullscreen: true });
    expect(isPresent(tied, { ...nothing, focused: 'dota2', fullscreen: primary }, onPrimary)).toBe(false);
  });
});

describe('presenceNeeds', () => {
  it('asks for nothing when everyone is simply always there', () => {
    expect(presenceNeeds([character(), character()])).toEqual({ running: false, focused: false, fullscreen: false });
  });

  it('asks only for what some enabled character depends on', () => {
    expect(presenceNeeds([character({ mode: 'whileRunning', apps: ['a'] })])).toMatchObject({ running: true, focused: false });
    expect(presenceNeeds([character({ mode: 'whileFocused', apps: ['a'] })])).toMatchObject({ running: false, focused: true });
    expect(presenceNeeds([character({ hideOnFullscreen: true })]).fullscreen).toBe(true);
    expect(presenceNeeds([character({ mode: 'whileRunning', apps: ['a'], hideOnFullscreen: true }, false)])).toEqual({
      running: false,
      focused: false,
      fullscreen: false
    });
  });
});

/* ------------------------------------------------------------------ */

interface Desk {
  sensors: DesktopSensors;
  activity: UserActivity;
  running: Set<string>;
  focused: string | null;
  fullscreen: Rect | null;
  idle: number;
  calls: { running: number; focused: number; fullscreen: number };
  hooked: () => boolean;
  switchTo(app: string): void;
  lock(locked: boolean): void;
  loads: number;
}

function desk(): Desk {
  let foreground: (() => void) | null = null;
  let lockListener: ((locked: boolean) => void) | null = null;
  const state: Desk = {
    running: new Set(),
    focused: null,
    fullscreen: null,
    idle: 0,
    calls: { running: 0, focused: 0, fullscreen: 0 },
    loads: 0,
    hooked: () => foreground !== null,
    switchTo(app) {
      state.focused = app;
      foreground?.();
    },
    lock(locked) {
      lockListener?.(locked);
    },
    sensors: {
      runningApps: () => {
        state.calls.running += 1;
        return new Set(state.running);
      },
      foregroundApp: () => {
        state.calls.focused += 1;
        return state.focused;
      },
      fullscreenDisplay: () => {
        state.calls.fullscreen += 1;
        return state.fullscreen;
      },
      onForegroundChange: (listener) => {
        foreground = listener;
        return () => (foreground = null);
      }
    },
    activity: {
      idleSeconds: () => state.idle,
      onLockChange: (listener) => {
        lockListener = listener;
        return () => (lockListener = null);
      }
    }
  };
  return state;
}

function watcher(d: Desk, toScreen: (rect: Rect) => Rect = (rect) => rect): PresenceWatcher {
  return new PresenceWatcher({
    loadSensors: async () => {
      d.loads += 1;
      return d.sensors;
    },
    activity: d.activity,
    toScreen
  });
}

/** Lets the sensors finish loading. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('PresenceWatcher', () => {
  it('loads no sensors and reads nothing for characters that are simply always there', async () => {
    const d = desk();
    const w = watcher(d);
    w.setCharacters([character()]);
    await settle();
    expect(d.loads).toBe(0);
    expect(d.calls).toEqual({ running: 0, focused: 0, fullscreen: 0 });
    expect(d.hooked()).toBe(false);
    w.stop();
  });

  it('keeps only the programs someone is tied to, and says so when one starts', async () => {
    const d = desk();
    d.running = new Set(['chrome', 'explorer']);
    const w = watcher(d);
    let changes = 0;
    w.onChange(() => (changes += 1));
    w.setCharacters([character({ mode: 'whileRunning', apps: ['Dota2.exe'] })]);
    await settle();
    expect(w.facts.running).toEqual(new Set());
    const before = changes;

    // Something unrelated starting is not news.
    d.running.add('notepad');
    w.refresh();
    expect(changes).toBe(before);

    d.running.add('dota2');
    w.refresh();
    expect(changes).toBe(before + 1);
    expect(w.facts.running).toEqual(new Set(['dota2']));
    expect(d.calls.focused).toBe(0);
    w.stop();
  });

  it('hears a change of window as an event', async () => {
    const d = desk();
    d.focused = 'chrome';
    const w = watcher(d);
    w.setCharacters([character({ mode: 'whileFocused', apps: ['code'] })]);
    await settle();
    expect(d.hooked()).toBe(true);
    expect(w.facts.focused).toBe('chrome');

    let changes = 0;
    w.onChange(() => (changes += 1));
    d.switchTo('code');
    expect(w.facts.focused).toBe('code');
    expect(changes).toBe(1);
    w.stop();
  });

  it('lets go of the hook when nobody needs it any more', async () => {
    const d = desk();
    const w = watcher(d);
    w.setCharacters([character({ mode: 'whileFocused', apps: ['code'] })]);
    await settle();
    expect(d.hooked()).toBe(true);
    w.setCharacters([character()]);
    await settle();
    expect(d.hooked()).toBe(false);
    expect(w.facts.focused).toBeNull();
    w.stop();
  });

  it('reports a fullscreen display in the coordinates the windows use', async () => {
    const d = desk();
    d.fullscreen = { x: 0, y: 0, width: 2400, height: 1350 };
    const w = watcher(d, (rect) => ({ x: rect.x / 1.25, y: rect.y / 1.25, width: rect.width / 1.25, height: rect.height / 1.25 }));
    w.setCharacters([character({ hideOnFullscreen: true })]);
    await settle();
    expect(w.facts.fullscreen).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    w.stop();
  });

  it('stops watching while the screen is locked or the user has been away', async () => {
    const d = desk();
    const w = watcher(d);
    w.setCharacters([character()]);
    await settle();
    expect(w.watching).toBe(true);

    let changes = 0;
    w.onChange(() => (changes += 1));
    d.lock(true);
    expect(w.watching).toBe(false);
    d.lock(false);
    expect(w.watching).toBe(true);
    expect(changes).toBe(2);

    d.idle = 10 * 60;
    w.refresh();
    expect(w.watching).toBe(false);
    d.idle = 1;
    w.refresh();
    expect(w.watching).toBe(true);
    expect(changes).toBe(4);
    w.stop();
  });

  it('survives having no sensors at all', async () => {
    const w = new PresenceWatcher({ loadSensors: async () => null, activity: desk().activity, toScreen: (rect) => rect });
    w.setCharacters([character({ mode: 'whileRunning', apps: ['dota2'] })]);
    await settle();
    expect(w.facts.running).toBeNull();
    w.stop();
  });
});

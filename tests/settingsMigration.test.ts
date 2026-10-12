import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FOCUS_REMARK_IDS, TOPIC_IDS, type Settings } from '@shared/types';
import {
  DEFAULT_WATCHED_APPS,
  SettingsStore,
  defaultSettings,
  migrate,
  reconcile
} from '@main/settings/settings';

/**
 * A settings file that cannot be read back is the user's quiet hours, watch
 * list, folders and characters gone. `migrate` runs the whole chain oldest →
 * newest in one call, so a v1 file lands on the current version directly, and
 * `reconcile` is what turns the result into settings without discarding the
 * parts of it that are fine.
 */

const CURRENT = 6;
const defaults = defaultSettings('C:\\Users\\someone\\Downloads');

describe('version 1 → current, through every reshaping since', () => {
  const v1 = {
    version: 1,
    skinId: 'ovoid',
    startWithSystem: false,
    quietHours: { enabled: true, from: '01:00', to: '07:30' },
    watchedFolders: ['D:\\work'],
    monitors: { system: false }
  };

  it('carries the skin into the built-in preset', () => {
    const out = migrate(v1);
    expect(out.presets).toEqual([{ id: 'codex', name: 'Ordis', skinId: 'eye' }]);
    expect(out.activePresetId).toBe('codex');
    expect(out.skinId).toBeUndefined();
  });

  it('rewrites the skin that no longer exists either', () => {
    const out = migrate({ ...v1, skinId: 'aperture' });
    expect((out.presets as { skinId: string }[])[0]!.skinId).toBe('eye');
  });

  it('stamps the new version, so it runs once and not again', () => {
    const once = migrate(v1);
    expect(once.version).toBe(CURRENT);
    expect(migrate(once)).toEqual(once);
  });

  it('keeps every other field the user set', () => {
    const out = migrate(v1);
    expect(out.startWithSystem).toBe(false);
    expect(out.quietHours).toEqual({ enabled: true, from: '01:00', to: '07:30' });
    expect(out.watchedFolders).toEqual(['D:\\work']);
  });

  it('ends up as valid settings with nothing reset', () => {
    const { settings, repaired } = reconcile(migrate(v1), defaults);
    expect(repaired).toEqual([]);
    expect(settings.version).toBe(CURRENT);
    expect(settings.quietHours.from).toBe('01:00');
    // The one monitor that was off stays off, as the topic it became.
    expect(settings.topics.system).toBe(false);
    expect(settings.topics.apps).toBe(true);
  });

  it('leaves an already-current file alone', () => {
    const current = { ...defaults, frequencyProfile: 'rare' };
    expect(migrate(current as unknown as Record<string, unknown>)).toEqual(current);
  });
});

describe('version 3 → 4, when cue volume and per-cue on/off were added', () => {
  const v3 = {
    version: 3,
    startWithSystem: true,
    presets: [{ id: 'codex', name: 'Ordis', skinId: 'eye' }],
    activePresetId: 'codex',
    quietHours: { enabled: false, from: '00:00', to: '00:00' },
    overlay: { scale: 1.2, offsetX: 5, offsetY: -3 }
  };

  it('adds the three fields with their defaults', () => {
    expect(migrate(v3).overlay).toMatchObject({ cueVolume: 1, appearSoundEnabled: true, disappearSoundEnabled: true });
  });

  it('does not stomp an overlay that already carries them', () => {
    const out = migrate({ ...v3, overlay: { ...v3.overlay, cueVolume: 0.3, appearSoundEnabled: false } });
    expect(out.overlay).toMatchObject({ cueVolume: 0.3, appearSoundEnabled: false, disappearSoundEnabled: true });
  });
});

describe('version 4 → 5, when the character could be pinned to the screen', () => {
  const v4 = {
    version: 4,
    presets: [{ id: 'codex', name: 'Ordis', skinId: 'eye' }],
    activePresetId: 'codex',
    overlay: { scale: 1, offsetX: 12, offsetY: 0, cueVolume: 0.4, appearSoundEnabled: true, disappearSoundEnabled: false }
  };

  it('leaves an existing install unpinned', () => {
    // A character that starts living on the screen after an update, unasked,
    // is the wrong surprise.
    expect(migrate(v4).overlay).toMatchObject({ pinned: false, pinnedPosition: null });
  });
});

describe('version 5 → 6, the settings window reorganisation', () => {
  const v5 = {
    version: 5,
    startWithSystem: true,
    presets: [
      { id: 'codex', name: 'Ordis', skinId: 'eye' },
      { id: 'mine', name: 'Mine', skinId: 'eye' }
    ],
    activePresetId: 'mine',
    frequencyProfile: 'reserved',
    quietHours: { enabled: true, from: '22:30', to: '07:00' },
    suppressOnFullscreen: false,
    suppressOnMicrophoneUse: true,
    watchedProcesses: ['Code.exe', 'steam.exe', 'dota2.exe', 'Spotify.exe', 'MyOwnGame.exe', '  '],
    watchedFolders: ['D:\\Downloads'],
    monitors: { system: true, process: true, idle: true, schedule: false, session: true, file: false, focus: true },
    overlay: {
      scale: 1.4,
      offsetX: 30,
      offsetY: -10,
      cueVolume: 0.5,
      appearSoundEnabled: true,
      disappearSoundEnabled: false,
      pinned: true,
      pinnedPosition: { x: 1200, y: 640 }
    }
  };
  const out = migrate(v5);
  const { settings, repaired } = reconcile(out, defaults);

  it('produces valid settings with nothing reset', () => {
    expect(repaired).toEqual([]);
    expect(settings.version).toBe(6);
  });

  it('gives each watched name the kind it had on the stock list, whatever its spelling', () => {
    expect(settings.watchedApps).toEqual([
      { name: 'Code.exe', kind: 'app' },
      { name: 'steam.exe', kind: 'launcher' },
      { name: 'dota2.exe', kind: 'game' },
      { name: 'Spotify.exe', kind: 'notable' },
      // Not on the stock list: a plain app, which is how it was treated before.
      { name: 'MyOwnGame.exe', kind: 'app' }
    ]);
  });

  it('drops the old list rather than keeping two', () => {
    expect(out.watchedProcesses).toBeUndefined();
    expect(out.monitors).toBeUndefined();
  });

  it('turns off every topic a switched-off monitor used to feed', () => {
    // Nobody should start hearing something they had silenced.
    expect(settings.topics).toEqual({
      greetings: true,
      system: true,
      apps: true,
      downloads: false,
      timeOfDay: false,
      breaks: false,
      chatter: false,
      activeWindow: true
    });
  });

  it('counts greetings off if either of the two monitors behind them was', () => {
    const idleOff = migrate({ ...v5, monitors: { ...v5.monitors, idle: false } });
    expect((idleOff.topics as Record<string, boolean>).greetings).toBe(false);
    const sessionOff = migrate({ ...v5, monitors: { ...v5.monitors, session: false } });
    expect((sessionOff.topics as Record<string, boolean>).greetings).toBe(false);
  });

  it('starts every kind of active-window remark on', () => {
    expect(settings.focusRemarks).toEqual(Object.fromEntries(FOCUS_REMARK_IDS.map((id) => [id, true])));
  });

  it('drops the dead size and the offsets, and keeps the rest of the overlay', () => {
    expect(settings.overlay).toEqual({
      placement: 'right',
      cueVolume: 0.5,
      appearSoundEnabled: true,
      disappearSoundEnabled: false,
      pinned: true,
      pinnedPosition: { x: 1200, y: 640 }
    });
  });

  it('leaves everything it had no reason to touch', () => {
    expect(settings.presets).toEqual(v5.presets);
    expect(settings.activePresetId).toBe('mine');
    expect(settings.frequencyProfile).toBe('reserved');
    expect(settings.quietHours).toEqual(v5.quietHours);
    expect(settings.suppressOnFullscreen).toBe(false);
    expect(settings.watchedFolders).toEqual(['D:\\Downloads']);
  });

  it('takes the stock watch list when there was never a custom one', () => {
    const { watchedProcesses: _dropped, ...bare } = v5;
    expect(reconcile(migrate(bare), defaults).settings.watchedApps).toEqual(DEFAULT_WATCHED_APPS);
  });
});

describe('reconcile — a file that is partly wrong', () => {
  const good = { ...defaults, frequencyProfile: 'chatty', watchedFolders: ['D:\\in'] } as unknown as Record<string, unknown>;

  it('resets only the field that is invalid and says which', () => {
    const { settings, repaired } = reconcile({ ...good, quietHours: { enabled: true, from: '25:99', to: '08:00' } }, defaults);
    expect(repaired).toEqual(['quietHours']);
    expect(settings.quietHours).toEqual(defaults.quietHours);
    // Everything else the user had survives.
    expect(settings.frequencyProfile).toBe('chatty');
    expect(settings.watchedFolders).toEqual(['D:\\in']);
  });

  it('keeps the characters when something unrelated is broken', () => {
    // Losing the preset list orphans every custom character's files on disk,
    // which is what resetting the whole file used to do.
    const presets = [
      { id: 'codex', name: 'Ordis', skinId: 'eye' },
      { id: 'mine', name: 'Mine', skinId: 'eye' }
    ];
    const { settings } = reconcile({ ...good, presets, activePresetId: 'mine', frequencyProfile: 'constantly' }, defaults);
    expect(settings.presets).toEqual(presets);
    expect(settings.activePresetId).toBe('mine');
    expect(settings.frequencyProfile).toBe(defaults.frequencyProfile);
  });

  it('fills in a switch added to a section after the file was written', () => {
    const topics = { ...defaults.topics, system: false } as Record<string, boolean>;
    delete topics.chatter;
    const { settings, repaired } = reconcile({ ...good, topics }, defaults);
    expect(repaired).toEqual([]);
    expect(settings.topics.chatter).toBe(true);
    expect(settings.topics.system).toBe(false);
  });

  it('falls back entirely only when nothing can be saved', () => {
    const { settings } = reconcile({ version: 6, presets: 'nonsense', topics: 4 } as Record<string, unknown>, defaults);
    expect(settings.presets).toEqual(defaults.presets);
    expect(settings.topics).toEqual(defaults.topics);
  });

  it('has a switch for every topic in the defaults', () => {
    expect(Object.keys(defaults.topics).sort()).toEqual([...TOPIC_IDS].sort());
  });
});

describe('SettingsStore', () => {
  let dir: string;
  let file: string;
  const open = (): SettingsStore => new SettingsStore(file, defaults);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shard-settings-'));
    file = join(dir, 'settings.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a good change, saves it and tells its listeners', () => {
    const store = open();
    const heard: Settings[] = [];
    store.onChange((settings) => heard.push(settings));

    const result = store.tryUpdate({ frequencyProfile: 'rare' });

    expect(result.ok).toBe(true);
    expect(result.settings.frequencyProfile).toBe('rare');
    expect(heard).toHaveLength(1);
    expect(JSON.parse(readFileSync(file, 'utf8')).frequencyProfile).toBe('rare');
  });

  it('refuses a bad change, keeps what it had, and says why in words', () => {
    const store = open();
    const heard: Settings[] = [];
    store.onChange((settings) => heard.push(settings));

    const result = store.tryUpdate({ quietHours: { enabled: true, from: '9pm', to: '08:00' } });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/time like 23:00/i);
    expect(result.settings.quietHours).toEqual(defaults.quietHours);
    expect(heard).toEqual([]);
  });

  it('refuses an empty character name', () => {
    const result = open().tryUpdate({ presets: [{ id: 'codex', name: '   ', skinId: 'eye' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/name cannot be empty/i);
  });

  it('resets everything to stock except the characters', () => {
    const store = open();
    const presets = [...defaults.presets, { id: 'mine', name: 'Mine', skinId: 'eye' as const }];
    store.update({
      presets,
      activePresetId: 'mine',
      frequencyProfile: 'rare',
      watchedApps: [{ name: 'only.exe', kind: 'game' }],
      topics: { ...defaults.topics, chatter: false }
    });

    const result = store.reset();

    expect(result.ok).toBe(true);
    expect(result.settings.frequencyProfile).toBe(defaults.frequencyProfile);
    expect(result.settings.watchedApps).toEqual(defaults.watchedApps);
    expect(result.settings.topics.chatter).toBe(true);
    // The characters are the user's own work, with files on disk behind them.
    expect(result.settings.presets).toEqual(presets);
    expect(result.settings.activePresetId).toBe('mine');
  });

  it('reads an old file through the migrations and keeps what the user chose', () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: 5,
        presets: [{ id: 'codex', name: 'Ordis', skinId: 'eye' }],
        activePresetId: 'codex',
        frequencyProfile: 'chatty',
        watchedProcesses: ['Terraria.exe'],
        monitors: { focus: false },
        overlay: { scale: 1, offsetX: 0, offsetY: 0, cueVolume: 0.2, appearSoundEnabled: true, disappearSoundEnabled: true, pinned: false, pinnedPosition: null }
      })
    );

    const { current } = open();

    expect(current.version).toBe(6);
    expect(current.frequencyProfile).toBe('chatty');
    expect(current.watchedApps).toEqual([{ name: 'Terraria.exe', kind: 'game' }]);
    expect(current.topics.activeWindow).toBe(false);
    expect(current.overlay.cueVolume).toBe(0.2);
  });
});

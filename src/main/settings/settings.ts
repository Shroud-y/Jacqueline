import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { z } from 'zod';
import {
  APP_KINDS,
  BUILTIN_PRESET_ID,
  FOCUS_REMARK_IDS,
  OVERLAY_PLACEMENTS,
  TOPIC_IDS,
  type AppKind,
  type FocusRemarkId,
  type Settings,
  type SettingsResult,
  type TopicId,
  type WatchedApp
} from '@shared/types';
import { createLogger } from '../log/logger';

const log = createLogger('settings');

const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a time like 23:00');

const presetSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, 'a name cannot be empty').max(40, 'a name can be 40 characters at most'),
  skinId: z.enum(['eye'])
});

const watchedAppSchema = z.object({
  name: z.string().trim().min(1, 'an app needs a name').max(260),
  kind: z.enum(APP_KINDS as readonly [AppKind, ...AppKind[]])
});

const switches = <K extends string>(ids: readonly K[]): z.ZodType<Record<K, boolean>> =>
  z.object(Object.fromEntries(ids.map((id) => [id, z.boolean()]))) as unknown as z.ZodType<Record<K, boolean>>;

const settingsSchema = z.object({
  version: z.literal(6),
  startWithSystem: z.boolean(),
  presets: z.array(presetSchema).min(1),
  activePresetId: z.string().min(1),
  frequencyProfile: z.enum(['chatty', 'balanced', 'reserved', 'rare']),
  quietHours: z.object({ enabled: z.boolean(), from: clockSchema, to: clockSchema }),
  suppressOnFullscreen: z.boolean(),
  suppressOnMicrophoneUse: z.boolean(),
  watchedApps: z.array(watchedAppSchema).max(500),
  watchedFolders: z.array(z.string().trim().min(1)).max(50),
  topics: switches<TopicId>(TOPIC_IDS),
  focusRemarks: switches<FocusRemarkId>(FOCUS_REMARK_IDS),
  overlay: z.object({
    placement: z.enum(OVERLAY_PLACEMENTS as readonly [Settings['overlay']['placement'], ...Settings['overlay']['placement'][]]),
    cueVolume: z.number().min(0).max(1),
    appearSoundEnabled: z.boolean(),
    disappearSoundEnabled: z.boolean(),
    pinned: z.boolean(),
    pinnedPosition: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable()
  })
});

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

const app = (name: string): WatchedApp => ({ name, kind: 'app' });
const game = (name: string): WatchedApp => ({ name, kind: 'game' });
const launcher = (name: string): WatchedApp => ({ name, kind: 'launcher' });
const notable = (name: string): WatchedApp => ({ name, kind: 'notable' });

/**
 * The stock watch list. The kind is what used to be three hardcoded name
 * lists in the trigger rules; it lives on the entry now, so a game the user
 * adds is a game and not just "a process".
 */
export const DEFAULT_WATCHED_APPS: readonly WatchedApp[] = [
  app('Code.exe'),
  app('devenv.exe'),
  app('idea64.exe'),
  app('pycharm64.exe'),
  app('WebStorm64.exe'),
  app('rider64.exe'),
  app('chrome.exe'),
  app('firefox.exe'),
  app('msedge.exe'),
  notable('Discord.exe'),
  launcher('Steam.exe'),
  launcher('EpicGamesLauncher.exe'),
  launcher('Battle.net.exe'),
  notable('obs64.exe'),
  notable('blender.exe'),
  notable('photoshop.exe'),
  launcher('RiotClientServices.exe'),
  launcher('GalaxyClient.exe'),
  launcher('EADesktop.exe'),
  notable('Spotify.exe'),
  notable('Docker Desktop.exe'),
  notable('ms-teams.exe'),
  notable('Zoom.exe'),
  game('dota2.exe'),
  game('cs2.exe'),
  game('VALORANT-Win64-Shipping.exe'),
  game('LeagueClientUx.exe'),
  game('GTA5.exe'),
  game('Mindustry.exe'),
  game('FactoryGameSteam.exe'),
  game('CivilizationVI.exe'),
  game('Risk of Rain 2.exe'),
  game('Terraria.exe')
];

/** 'Code.exe' and 'code' are the same executable. */
export function appStem(name: string): string {
  const lower = name.trim().toLowerCase();
  return lower.endsWith('.exe') ? lower.slice(0, -'.exe'.length) : lower;
}

const DEFAULT_KIND_BY_STEM = new Map(DEFAULT_WATCHED_APPS.map((entry) => [appStem(entry.name), entry.kind]));

const allOn = <K extends string>(ids: readonly K[]): Record<K, boolean> =>
  Object.fromEntries(ids.map((id) => [id, true])) as Record<K, boolean>;

export function defaultSettings(downloadsDir: string): Settings {
  return {
    version: 6,
    startWithSystem: true,
    presets: [{ id: BUILTIN_PRESET_ID, name: 'Ordis', skinId: 'eye' }],
    activePresetId: BUILTIN_PRESET_ID,
    frequencyProfile: 'balanced',
    quietHours: { enabled: true, from: '23:00', to: '08:00' },
    suppressOnFullscreen: true,
    suppressOnMicrophoneUse: true,
    watchedApps: DEFAULT_WATCHED_APPS.map((entry) => ({ ...entry })),
    watchedFolders: [downloadsDir],
    topics: allOn(TOPIC_IDS),
    focusRemarks: allOn(FOCUS_REMARK_IDS),
    overlay: {
      placement: 'right',
      cueVolume: 1,
      appearSoundEnabled: true,
      disappearSoundEnabled: true,
      pinned: false,
      pinnedPosition: null
    }
  };
}

/* ------------------------------------------------------------------ */
/* Migrations                                                          */
/* ------------------------------------------------------------------ */

/**
 * Migrations run oldest → newest.
 *
 * Version 2 drops the `ovoid` and `aperture` skins for a single `eye`. Without
 * this the stored `skinId` would fail validation — an appearance change would
 * take the user's quiet hours, watch lists and folders with it.
 *
 * Version 3 moves the single global `skinId` onto a preset — the built-in
 * Ordis one — since appearance is now per-preset. The old value is kept
 * rather than reset to `'eye'`, so an existing user's choice survives.
 *
 * Version 4 adds cue volume and per-cue on/off to `overlay`.
 *
 * Version 5 adds `pinned` and `pinnedPosition` to `overlay`. Pinning is off
 * for an existing install: a character that starts living on the screen after
 * an update, unasked, is the wrong surprise.
 *
 * Version 6 is the settings window's reorganisation, and the one migration
 * that changes shape rather than adding to it:
 *   - `watchedProcesses` (names) becomes `watchedApps` (name + kind). A name
 *     that was on the stock list keeps the kind it had there; anything the
 *     user added is a plain app, which is how it was treated before.
 *   - `monitors` (seven data sources) becomes `topics` (eight things it talks
 *     about). A source that was off turns off every topic it fed, so nobody
 *     starts hearing something they had silenced.
 *   - `focusRemarks` is new and starts all on.
 *   - `overlay.scale` never did anything and goes. `offsetX`/`offsetY` go
 *     too, replaced by a named `placement`; a nudge of a few pixels has no
 *     honest equivalent among three named positions, so it becomes the
 *     default one.
 */
type RawSettings = Record<string, unknown>;

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const MIGRATIONS: Record<number, (input: RawSettings) => RawSettings> = {
  1: (input) => ({ ...input, version: 2, skinId: 'eye' }),
  2: (input) => {
    const { skinId, ...rest } = input;
    return {
      ...rest,
      version: 3,
      presets: [{ id: BUILTIN_PRESET_ID, name: 'Ordis', skinId: skinId ?? 'eye' }],
      activePresetId: BUILTIN_PRESET_ID
    };
  },
  3: (input) => {
    const overlay = asRecord(input.overlay);
    return {
      ...input,
      version: 4,
      overlay: {
        ...overlay,
        cueVolume: overlay.cueVolume ?? 1,
        appearSoundEnabled: overlay.appearSoundEnabled ?? true,
        disappearSoundEnabled: overlay.disappearSoundEnabled ?? true
      }
    };
  },
  4: (input) => {
    const overlay = asRecord(input.overlay);
    return {
      ...input,
      version: 5,
      overlay: {
        ...overlay,
        pinned: overlay.pinned ?? false,
        pinnedPosition: overlay.pinnedPosition ?? null
      }
    };
  },
  5: (input) => {
    const { watchedProcesses, monitors, overlay, ...rest } = input;
    const out: RawSettings = { ...rest, version: 6 };

    // Absent means "never customised": leave it out and the defaults fill it.
    if (Array.isArray(watchedProcesses)) {
      out.watchedApps = watchedProcesses
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
        .map((name) => ({ name: name.trim(), kind: DEFAULT_KIND_BY_STEM.get(appStem(name)) ?? 'app' }));
    }

    const sources = asRecord(monitors);
    const on = (id: string): boolean => sources[id] !== false;
    out.topics = {
      // Idle only ever fed the greeting on return; session fed the rest.
      greetings: on('session') && on('idle'),
      system: on('system'),
      apps: on('process'),
      downloads: on('file'),
      timeOfDay: on('schedule'),
      breaks: on('schedule'),
      chatter: on('schedule'),
      activeWindow: on('focus')
    } satisfies Record<TopicId, boolean>;

    const { scale: _scale, offsetX: _offsetX, offsetY: _offsetY, ...keptOverlay } = asRecord(overlay);
    out.overlay = { ...keptOverlay, placement: keptOverlay.placement ?? 'right' };

    return out;
  }
};

export function migrate(raw: RawSettings): RawSettings {
  let current = raw;
  let version = typeof current.version === 'number' ? current.version : 1;
  while (MIGRATIONS[version]) {
    current = MIGRATIONS[version]!(current);
    version = typeof current.version === 'number' ? current.version : version + 1;
  }
  return current;
}

/* ------------------------------------------------------------------ */
/* Reading a file that may be partly wrong                             */
/* ------------------------------------------------------------------ */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Turns whatever was on disk into valid settings, keeping everything in it
 * that is usable.
 *
 * A stored object is laid over the default one key by key, one level deep, so
 * a field added to `overlay` or `topics` in a later version simply takes its
 * default instead of failing the whole section. Then, if the result still
 * does not validate, only the top-level fields that are actually wrong are
 * replaced with their defaults.
 *
 * This used to be all or nothing: one bad value and the whole file was
 * discarded — including the preset list, which orphans every custom
 * character's files on disk.
 */
export function reconcile(stored: RawSettings, fallback: Settings): { settings: Settings; repaired: string[] } {
  const base = fallback as unknown as RawSettings;
  const merged: RawSettings = { ...base };
  for (const [key, value] of Object.entries(stored)) {
    const standard = base[key];
    merged[key] = isPlainObject(standard) && isPlainObject(value) ? { ...standard, ...value } : value;
  }
  merged.version = fallback.version;

  const first = settingsSchema.safeParse(merged);
  if (first.success) return { settings: first.data as Settings, repaired: [] };

  const bad = [...new Set(first.error.issues.map((issue) => String(issue.path[0] ?? '')))].filter(
    (key) => key in base
  );
  const patched: RawSettings = { ...merged };
  for (const key of bad) patched[key] = base[key];

  const second = settingsSchema.safeParse(patched);
  if (second.success) return { settings: second.data as Settings, repaired: bad };
  return { settings: fallback, repaired: Object.keys(base) };
}

/** One line a person can act on, from whatever the schema objected to first. */
function describe(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'That value is not valid.';
  const message = issue.message.charAt(0).toUpperCase() + issue.message.slice(1);
  return message.endsWith('.') ? message : `${message}.`;
}

export class SettingsStore {
  private value: Settings;
  private readonly listeners = new Set<(settings: Settings) => void>();

  constructor(
    private readonly filePath: string,
    private readonly fallback: Settings
  ) {
    this.value = this.read();
  }

  get current(): Settings {
    return this.value;
  }

  /** The stock settings, for "restore defaults". */
  get defaults(): Settings {
    return this.fallback;
  }

  onChange(listener: (settings: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** For callers inside the app, whose patches are known good. */
  update(patch: Partial<Settings>): Settings {
    return this.tryUpdate(patch).settings;
  }

  /**
   * For the settings window, which needs to know when a value was refused —
   * and when it was accepted but could not be written, which leaves it in
   * force only until the app closes.
   */
  tryUpdate(patch: Partial<Settings>): SettingsResult {
    const merged = { ...this.value, ...patch, version: 6 as const };
    const parsed = settingsSchema.safeParse(merged);
    if (!parsed.success) {
      const error = describe(parsed.error);
      log.warn(`rejected settings update: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      return { ok: false, settings: this.value, error };
    }
    this.value = parsed.data as Settings;
    const written = this.write();
    for (const listener of this.listeners) listener(this.value);
    return written
      ? { ok: true, settings: this.value }
      : { ok: false, settings: this.value, error: 'Changed, but it could not be saved to disk — it will be lost when SHARD closes.' };
  }

  /**
   * Everything back to stock except the characters: the presets and which one
   * is active are the user's own work, with files on disk behind them.
   */
  reset(): SettingsResult {
    return this.tryUpdate({
      ...this.fallback,
      presets: this.value.presets,
      activePresetId: this.value.activePresetId
    });
  }

  private read(): Settings {
    if (!existsSync(this.filePath)) {
      this.value = this.fallback;
      this.write();
      return this.fallback;
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as RawSettings;
      const { settings, repaired } = reconcile(migrate(raw), this.fallback);
      if (repaired.length > 0) {
        log.warn(`settings file had invalid ${repaired.join(', ')} — reset to defaults, everything else kept`);
      }
      return settings;
    } catch (err) {
      log.warn(`cannot read settings (${(err as Error).message}) — using defaults`);
      return this.fallback;
    }
  }

  private write(): boolean {
    try {
      const tmp = `${this.filePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.value, null, 2), 'utf8');
      renameSync(tmp, this.filePath);
      return true;
    } catch (err) {
      log.error(`cannot write settings: ${(err as Error).message}`);
      return false;
    }
  }
}

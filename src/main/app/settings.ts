import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { Settings, SettingsResult } from '@shared/types';
import { createLogger } from './logger';
import { readJson, writeJsonAtomic } from './jsonFile';

const log = createLogger('settings');

const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a time like 23:00');

const settingsSchema = z.object({
  version: z.literal(1),
  startWithSystem: z.boolean(),
  muted: z.boolean(),
  quietHours: z.object({ enabled: z.boolean(), from: clockSchema, to: clockSchema })
});

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  startWithSystem: true,
  muted: false,
  quietHours: { enabled: false, from: '23:00', to: '08:00' }
};

type Raw = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Raw =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Turns whatever was on disk into valid settings, keeping everything in it
 * that is usable: a stored object is laid over the default one key by key,
 * and only the top-level fields that are actually wrong fall back.
 */
export function reconcile(stored: unknown, fallback: Settings): { settings: Settings; repaired: string[] } {
  const base = fallback as unknown as Raw;
  const merged: Raw = { ...base };
  if (isPlainObject(stored)) {
    for (const [key, value] of Object.entries(stored)) {
      const standard = base[key];
      merged[key] = isPlainObject(standard) && isPlainObject(value) ? { ...standard, ...value } : value;
    }
  }
  merged.version = fallback.version;

  const first = settingsSchema.safeParse(merged);
  if (first.success) return { settings: first.data, repaired: [] };

  const bad = [...new Set(first.error.issues.map((issue) => String(issue.path[0] ?? '')))].filter((key) => key in base);
  const patched: Raw = { ...merged };
  for (const key of bad) patched[key] = base[key];

  const second = settingsSchema.safeParse(patched);
  if (second.success) return { settings: second.data, repaired: bad };
  return { settings: fallback, repaired: Object.keys(base) };
}

/** What applies to the app as a whole. Everything about a character lives with the character. */
export class SettingsStore {
  private value: Settings;
  private readonly listeners = new Set<(settings: Settings) => void>();

  constructor(
    private readonly filePath: string,
    private readonly fallback: Settings = DEFAULT_SETTINGS
  ) {
    this.value = this.read();
  }

  get current(): Settings {
    return this.value;
  }

  onChange(listener: (settings: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(patch: Partial<Settings>): SettingsResult {
    const parsed = settingsSchema.safeParse({ ...this.value, ...patch, version: 1 });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      log.warn(`rejected settings update: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      return { ok: false, settings: this.value, error: issue ? `${issue.message}.` : 'That value is not valid.' };
    }
    this.value = parsed.data;
    const written = this.write();
    for (const listener of this.listeners) listener(this.value);
    return written
      ? { ok: true, settings: this.value }
      : { ok: false, settings: this.value, error: 'Changed, but it could not be saved to disk — it will be lost when SHARD closes.' };
  }

  private read(): Settings {
    if (!existsSync(this.filePath)) return this.fallback;
    try {
      const { settings, repaired } = reconcile(readJson(this.filePath), this.fallback);
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
      writeJsonAtomic(this.filePath, this.value);
      return true;
    } catch (err) {
      log.error(`cannot write settings: ${(err as Error).message}`);
      return false;
    }
  }
}

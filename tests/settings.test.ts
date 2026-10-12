import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SettingsStore, reconcile } from '@main/app/settings';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'shard-settings-'));
  file = join(dir, 'settings.json');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('reconcile', () => {
  it('keeps what is usable and fills in what is missing', () => {
    const { settings, repaired } = reconcile({ muted: true, quietHours: { enabled: true } }, DEFAULT_SETTINGS);
    expect(repaired).toEqual([]);
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, muted: true, quietHours: { ...DEFAULT_SETTINGS.quietHours, enabled: true } });
  });

  it('resets only the field that is wrong', () => {
    const { settings, repaired } = reconcile({ muted: true, quietHours: { from: '25:00' } }, DEFAULT_SETTINGS);
    expect(repaired).toEqual(['quietHours']);
    expect(settings.muted).toBe(true);
    expect(settings.quietHours).toEqual(DEFAULT_SETTINGS.quietHours);
  });

  it('falls back whole when the file is not an object at all', () => {
    expect(reconcile('nonsense', DEFAULT_SETTINGS).settings).toEqual(DEFAULT_SETTINGS);
    expect(reconcile(null, DEFAULT_SETTINGS).settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('SettingsStore', () => {
  it('uses the defaults when there is no file, without writing one', () => {
    expect(new SettingsStore(file).current).toEqual(DEFAULT_SETTINGS);
    expect(() => readFileSync(file)).toThrow();
  });

  it('survives a file that is not JSON', () => {
    writeFileSync(file, '{ nope');
    expect(new SettingsStore(file).current).toEqual(DEFAULT_SETTINGS);
  });

  it('saves a change and tells its listeners', () => {
    const store = new SettingsStore(file);
    const seen: boolean[] = [];
    store.onChange((settings) => seen.push(settings.muted));
    expect(store.update({ muted: true }).ok).toBe(true);
    expect(seen).toEqual([true]);
    expect(new SettingsStore(file).current.muted).toBe(true);
  });

  it('refuses a value that is not valid and keeps what it had', () => {
    const store = new SettingsStore(file);
    const result = store.update({ quietHours: { enabled: true, from: '9pm', to: '08:00' } });
    expect(result.ok).toBe(false);
    expect(store.current).toEqual(DEFAULT_SETTINGS);
  });
});

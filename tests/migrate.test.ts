import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateFromShard } from '@main/app/migrate';

let appData: string;
const jacqueline = (): string => join(appData, 'jacqueline');
const shard = (): string => join(appData, 'shard');

beforeEach(() => {
  appData = mkdtempSync(join(tmpdir(), 'jacqueline-migrate-'));
  mkdirSync(join(shard(), 'characters', 'teto'), { recursive: true });
  writeFileSync(join(shard(), 'characters', 'teto', 'character.json'), '{}');
  writeFileSync(join(shard(), 'settings.json'), '{"muted":true}');
});

afterEach(() => rmSync(appData, { recursive: true, force: true }));

describe('carrying SHARD over', () => {
  it('moves the characters and settings into the new folder, once', () => {
    expect(migrateFromShard(appData, jacqueline())).toEqual(['characters', 'settings.json']);
    expect(existsSync(join(jacqueline(), 'characters', 'teto', 'character.json'))).toBe(true);
    expect(readFileSync(join(jacqueline(), 'settings.json'), 'utf8')).toContain('muted');
    expect(existsSync(join(shard(), 'characters'))).toBe(false);
    expect(migrateFromShard(appData, jacqueline())).toEqual([]);
  });

  it('never overwrites what the new folder already has', () => {
    mkdirSync(join(jacqueline(), 'characters'), { recursive: true });
    expect(migrateFromShard(appData, jacqueline())).toEqual(['settings.json']);
    expect(existsSync(join(shard(), 'characters', 'teto'))).toBe(true);
  });

  it('leaves a run with a folder of its own alone', () => {
    expect(migrateFromShard(appData, join(appData, 'elsewhere'))).toEqual([]);
    expect(existsSync(join(shard(), 'characters'))).toBe(true);
  });

  it('does nothing when there was no SHARD', () => {
    rmSync(shard(), { recursive: true, force: true });
    expect(migrateFromShard(appData, jacqueline())).toEqual([]);
  });
});

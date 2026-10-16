/**
 * The app was called SHARD, and kept its things in `%APPDATA%\shard`. Moved
 * into Jacqueline's folder once, on the first start that finds them there and
 * nothing in the new place yet: the user's characters are their work.
 */

import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/** What was carried over; empty when there was nothing to do. */
export function migrateFromShard(appData: string, userData: string): string[] {
  // Only the app's own folder: a run with a folder of its own (`--user-data-dir`) is left alone.
  if (userData.toLowerCase() !== join(appData, 'jacqueline').toLowerCase()) return [];
  const old = join(appData, 'shard');
  const moved: string[] = [];
  for (const name of ['characters', 'settings.json']) {
    const from = join(old, name);
    const to = join(userData, name);
    if (!existsSync(from) || existsSync(to)) continue;
    mkdirSync(userData, { recursive: true });
    renameSync(from, to);
    moved.push(name);
  }
  return moved;
}

/** The name SHARD's start-with-Windows entry was written under. */
export const LEGACY_LOGIN_ITEM = 'dev.codex.companion';

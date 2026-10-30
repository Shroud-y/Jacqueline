/**
 * Which characters' scripts may run. A script written or chosen here is the
 * user's own and runs; one that arrived inside an imported character waits
 * until the user says yes. Kept in the app's folder, not the character's, so
 * the permission never travels with a character to someone else.
 */

import { existsSync } from 'node:fs';
import { createLogger } from '../app/logger';
import { readJson, writeJsonAtomic } from '../app/jsonFile';

const log = createLogger('scripts');

export class ScriptTrust {
  private readonly blocked = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly filePath: string) {
    if (!existsSync(filePath)) return;
    try {
      const raw = readJson(filePath) as { blocked?: unknown };
      if (Array.isArray(raw.blocked)) for (const id of raw.blocked) if (typeof id === 'string') this.blocked.add(id);
    } catch (err) {
      log.warn(`cannot read script permissions (${(err as Error).message}); imported scripts start blocked again from here on`);
    }
  }

  isAllowed(id: string): boolean {
    return !this.blocked.has(id);
  }

  /** A character whose script came from somewhere else. */
  block(id: string): void {
    if (this.blocked.has(id)) return;
    this.blocked.add(id);
    this.changed();
  }

  allow(id: string): void {
    if (!this.blocked.delete(id)) return;
    this.changed();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    try {
      writeJsonAtomic(this.filePath, { blocked: [...this.blocked].sort() });
    } catch (err) {
      log.error(`cannot save script permissions: ${(err as Error).message}`);
    }
    for (const listener of this.listeners) listener();
  }
}

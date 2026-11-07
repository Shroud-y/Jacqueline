/**
 * What happened lately and what came of it — the answer to "why did my rule
 * not fire?". A ring of the last few hundred entries for the whole app, kept
 * in memory only: always written (one push per event, nothing to speak of), so
 * the editor's Activity tab opens on recent history; sent to the editor only
 * while that tab is open.
 */

import type { ActivityEntry } from '@shared/types';

export const ACTIVITY_MAX = 300;

export class Activity {
  private readonly entries: ActivityEntry[] = [];
  private readonly listeners = new Set<(entry: ActivityEntry) => void>();
  private counter = 0;

  constructor(private readonly now: () => number = Date.now) {}

  add(entry: Omit<ActivityEntry, 'id' | 'at'>): void {
    this.counter += 1;
    const full: ActivityEntry = { id: this.counter, at: this.now(), ...entry, text: entry.text.slice(0, 500) };
    this.entries.push(full);
    if (this.entries.length > ACTIVITY_MAX) this.entries.shift();
    for (const listener of this.listeners) listener(full);
  }

  /** What concerns one character, oldest first: its own entries, and those about nobody in particular. */
  for(characterId: string): ActivityEntry[] {
    return this.entries.filter((entry) => entry.characterId === characterId || entry.characterId === null);
  }

  onAdd(listener: (entry: ActivityEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

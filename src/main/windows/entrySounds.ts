/**
 * When a character's appear or disappear sound may play. Pure: the clock is
 * passed in.
 *
 * A character that comes and goes with the window in front does so at every
 * alt-tab; its sounds would come with it. Each one plays at most once in
 * `GAP_MS` per character.
 */

export type EntryKind = 'appear' | 'disappear';

export const GAP_MS = 10_000;

export class EntrySounds {
  private readonly last = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** True, and remembered, when this sound may play now. */
  take(id: string, kind: EntryKind): boolean {
    const key = `${kind}:${id}`;
    const now = this.now();
    const before = this.last.get(key);
    if (before !== undefined && now - before < GAP_MS) return false;
    this.last.set(key, now);
    return true;
  }

  /** A character that is gone has no history worth keeping. */
  forget(id: string): void {
    this.last.delete(`appear:${id}`);
    this.last.delete(`disappear:${id}`);
  }
}

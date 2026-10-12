/**
 * §8.2 — the cooldown ledger. Pure: `now` is always injected, `Date.now()` is
 * never called in here, so tests drive it with a fake clock.
 */

export type CooldownDurationResolver = (key: string) => number;

export interface SerializedLedger {
  version: 1;
  stamps: Record<string, number>;
}

export class CooldownLedger {
  private stamps = new Map<string, number>();

  constructor(private readonly durationFor: CooldownDurationResolver) {}

  canFire(key: string, now: number): boolean {
    return this.remaining(key, now) <= 0;
  }

  /** Milliseconds left before `key` may fire again; 0 when it is ready. */
  remaining(key: string, now: number): number {
    const last = this.stamps.get(key);
    if (last === undefined) return 0;
    const duration = this.durationFor(key);
    if (duration <= 0) return 0;
    const elapsed = now - last;
    // A clock that jumped backwards must not lock the key out forever.
    if (elapsed < 0) return 0;
    return Math.max(0, duration - elapsed);
  }

  stamp(key: string, now: number): void {
    this.stamps.set(key, now);
  }

  lastFiredAt(key: string): number | undefined {
    return this.stamps.get(key);
  }

  clear(key: string): void {
    this.stamps.delete(key);
  }

  /** All keys still under cooldown, for the debug panel. */
  active(now: number): { key: string; remainingMs: number; totalMs: number }[] {
    const out: { key: string; remainingMs: number; totalMs: number }[] = [];
    for (const key of this.stamps.keys()) {
      const remainingMs = this.remaining(key, now);
      if (remainingMs > 0) out.push({ key, remainingMs, totalMs: this.durationFor(key) });
    }
    return out.sort((a, b) => b.remainingMs - a.remainingMs);
  }

  /** Drops stamps older than `maxAgeMs` so the file cannot grow forever. */
  prune(now: number, maxAgeMs: number): void {
    for (const [key, at] of this.stamps) {
      if (now - at > maxAgeMs) this.stamps.delete(key);
    }
  }

  serialize(): SerializedLedger {
    return { version: 1, stamps: Object.fromEntries(this.stamps) };
  }

  restore(data: unknown): void {
    this.stamps.clear();
    if (!data || typeof data !== 'object') return;
    const stamps = (data as SerializedLedger).stamps;
    if (!stamps || typeof stamps !== 'object') return;
    for (const [key, at] of Object.entries(stamps)) {
      if (typeof at === 'number' && Number.isFinite(at)) this.stamps.set(key, at);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Key construction — one place, so nothing can typo a namespace.      */
/* ------------------------------------------------------------------ */

export const CooldownKey = {
  global: () => 'global',
  category: (category: string) => `category:${category}`,
  phrase: (phraseId: string) => `phrase:${phraseId}`
} as const;

/** Defaults from §8.2, in milliseconds, before the frequency multiplier. */
export const DEFAULT_COOLDOWNS = {
  global: 8 * 60_000,
  perPhrase: 4 * 60 * 60_000,
  categories: {
    ambient: 45 * 60_000,
    /**
     * The silence timer's own category. It is deliberately shorter than
     * `ambient`: idle chatter is the only thing that fires with no external
     * event, so sharing a cooldown with the greetings would cap it at the
     * greeting rate and the timer could never come round.
     */
    chatter: 20 * 60_000,
    system: 20 * 60_000,
    process: 15 * 60_000,
    /** Remarks on what is in front of the user. Short: they are the ones that land. */
    focus: 10 * 60_000,
    /**
     * Answers to the user handling the pinned character. Those are asked for,
     * so in practice they bypass this; it is here so the category is a known
     * one rather than falling through to the default.
     */
    interaction: 2 * 60_000,
    schedule: 60 * 60_000,
    wellbeing: 90 * 60_000
  } as Record<string, number>,
  /** Fallback for a category not listed above. */
  categoryDefault: 30 * 60_000
} as const;

export const FREQUENCY_MULTIPLIER = {
  chatty: 0.5,
  balanced: 1,
  reserved: 2,
  rare: 4
} as const;

/**
 * Builds the resolver the ledger asks for a key's duration. The multiplier is
 * read through a getter so a settings change takes effect without rebuilding
 * the ledger (and without losing per-phrase history).
 */
export function createDurationResolver(getMultiplier: () => number): CooldownDurationResolver {
  return (key: string): number => {
    const multiplier = getMultiplier();
    if (key === 'global') return DEFAULT_COOLDOWNS.global * multiplier;
    if (key.startsWith('phrase:')) return DEFAULT_COOLDOWNS.perPhrase * multiplier;
    if (key.startsWith('category:')) {
      const category = key.slice('category:'.length);
      const base = DEFAULT_COOLDOWNS.categories[category] ?? DEFAULT_COOLDOWNS.categoryDefault;
      return base * multiplier;
    }
    // Unknown namespace: no cooldown. Rule debounces live in the trigger engine.
    return 0;
  };
}

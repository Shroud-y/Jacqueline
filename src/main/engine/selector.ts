/**
 * §8.3 — weighted selection with anti-repeat. Pure and unit-tested; the RNG is
 * injected so tests are deterministic.
 */

/** Anything that can be picked from a group: a line, today. */
export interface Pickable {
  id: string;
  /** Default 1. Zero or less means never picked. */
  weight?: number;
}

export type Rng = () => number;

export interface SelectInput<T extends Pickable> {
  phrases: T[];
  /** Ids most recently played in this group, most recent first. */
  recentIds: string[];
  /** Conditions + per-phrase cooldown, applied by the caller. */
  isEligible: (phrase: T) => boolean;
  rng: Rng;
}

/** How many recently-played ids a group of this size excludes outright. */
export function exclusionWindow(groupSize: number): number {
  // A lone line has to be allowed to repeat; any other group never says the
  // same line twice running — with two lines, that means taking turns.
  if (groupSize <= 1) return 0;
  return Math.max(1, Math.ceil(groupSize / 3));
}

export function selectPhrase<T extends Pickable>(input: SelectInput<T>): T | null {
  const { phrases, recentIds, isEligible, rng } = input;
  if (phrases.length === 0) return null;

  // 1. Condition + per-phrase cooldown filter.
  const eligible = phrases.filter(isEligible);
  if (eligible.length === 0) return null;

  // 2. Anti-repeat: exclude the most recent slice of the group's history.
  const window = exclusionWindow(phrases.length);
  const excluded = new Set(recentIds.slice(0, window));
  let survivors = eligible.filter((p) => !excluded.has(p.id));

  // If anti-repeat removed everything, prefer silence over an immediate repeat
  // unless the group is too small for a window to have applied at all.
  if (survivors.length === 0) {
    if (window === 0) survivors = eligible;
    else return null;
  }

  // 3. Weighted random pick.
  const total = survivors.reduce((sum, p) => sum + weightOf(p), 0);
  if (total <= 0) return null;

  let roll = rng() * total;
  for (const phrase of survivors) {
    roll -= weightOf(phrase);
    if (roll < 0) return phrase;
  }
  // Floating point tail: the last survivor is the correct answer.
  return survivors[survivors.length - 1] ?? null;
}

function weightOf(phrase: Pickable): number {
  const weight = phrase.weight ?? 1;
  return weight > 0 ? weight : 0;
}

/**
 * Fixed-length per-group history of played ids, most recent first.
 * Kept here so the ordering contract lives next to the code that reads it.
 */
export class RecentHistory {
  private readonly byGroup = new Map<string, string[]>();

  constructor(private readonly maxPerGroup = 32) {}

  get(groupId: string): string[] {
    return this.byGroup.get(groupId) ?? [];
  }

  push(groupId: string, phraseId: string): void {
    const list = this.byGroup.get(groupId) ?? [];
    const next = [phraseId, ...list.filter((id) => id !== phraseId)].slice(0, this.maxPerGroup);
    this.byGroup.set(groupId, next);
  }

  serialize(): Record<string, string[]> {
    return Object.fromEntries(this.byGroup);
  }

  restore(data: unknown): void {
    this.byGroup.clear();
    if (!data || typeof data !== 'object') return;
    for (const [groupId, ids] of Object.entries(data as Record<string, unknown>)) {
      if (Array.isArray(ids)) {
        this.byGroup.set(
          groupId,
          ids.filter((id): id is string => typeof id === 'string').slice(0, this.maxPerGroup)
        );
      }
    }
  }
}

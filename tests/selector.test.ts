import { describe, expect, it } from 'vitest';
import { RecentHistory, exclusionWindow, selectPhrase, type Pickable } from '@main/engine/selector';

function phrase(id: string, weight?: number): Pickable {
  return { id, ...(weight === undefined ? {} : { weight }) };
}

/** Deterministic RNG returning a fixed sequence, then its last value. */
function seeded(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

describe('exclusionWindow', () => {
  it('does not exclude anything in tiny groups', () => {
    expect(exclusionWindow(1)).toBe(0);
    expect(exclusionWindow(3)).toBe(0);
  });

  it('excludes a third of the group, rounded up', () => {
    expect(exclusionWindow(4)).toBe(2);
    expect(exclusionWindow(9)).toBe(3);
    expect(exclusionWindow(10)).toBe(4);
  });
});

describe('selectPhrase', () => {
  const all = () => true;

  it('returns null for an empty group', () => {
    expect(selectPhrase({ phrases: [], recentIds: [], isEligible: all, rng: seeded([0]) })).toBeNull();
  });

  it('returns null when nothing is eligible — silence is never a bug', () => {
    const result = selectPhrase({
      phrases: [phrase('a'), phrase('b')],
      recentIds: [],
      isEligible: () => false,
      rng: seeded([0])
    });
    expect(result).toBeNull();
  });

  it('picks deterministically with a seeded rng', () => {
    const phrases = [phrase('a'), phrase('b'), phrase('c'), phrase('d')];
    const first = selectPhrase({ phrases, recentIds: [], isEligible: all, rng: seeded([0]) });
    const last = selectPhrase({ phrases, recentIds: [], isEligible: all, rng: seeded([0.99]) });
    expect(first?.id).toBe('a');
    expect(last?.id).toBe('d');
  });

  it('honours weights', () => {
    const phrases = [phrase('light', 1), phrase('heavy', 9)];
    // Total weight 10; a roll of 0.5 lands 5.0 → past 'light', inside 'heavy'.
    expect(selectPhrase({ phrases, recentIds: [], isEligible: all, rng: seeded([0.5]) })?.id).toBe(
      'heavy'
    );
    expect(selectPhrase({ phrases, recentIds: [], isEligible: all, rng: seeded([0.05]) })?.id).toBe(
      'light'
    );
  });

  it('excludes recently played phrases', () => {
    const phrases = [phrase('a'), phrase('b'), phrase('c'), phrase('d'), phrase('e'), phrase('f')];
    for (let roll = 0; roll < 1; roll += 0.05) {
      const picked = selectPhrase({
        phrases,
        recentIds: ['a', 'b'],
        isEligible: all,
        rng: seeded([roll])
      });
      expect(['a', 'b']).not.toContain(picked?.id);
    }
  });

  it('prefers silence over an immediate repeat when anti-repeat empties the pool', () => {
    const phrases = [phrase('a'), phrase('b'), phrase('c'), phrase('d')];
    const result = selectPhrase({
      phrases,
      recentIds: ['a', 'b'],
      isEligible: (p) => p.id === 'a' || p.id === 'b',
      rng: seeded([0])
    });
    expect(result).toBeNull();
  });

  it('ignores anti-repeat in groups too small for a window', () => {
    const phrases = [phrase('a'), phrase('b')];
    const result = selectPhrase({
      phrases,
      recentIds: ['a', 'b'],
      isEligible: all,
      rng: seeded([0])
    });
    expect(result).not.toBeNull();
  });

  it('treats zero-weight phrases as unpickable', () => {
    const result = selectPhrase({
      phrases: [phrase('zero', 0)],
      recentIds: [],
      isEligible: all,
      rng: seeded([0.5])
    });
    expect(result).toBeNull();
  });
});

describe('RecentHistory', () => {
  it('keeps most-recent-first order without duplicates', () => {
    const history = new RecentHistory();
    history.push('g', 'a');
    history.push('g', 'b');
    history.push('g', 'a');
    expect(history.get('g')).toEqual(['a', 'b']);
  });

  it('round-trips through serialize/restore', () => {
    const history = new RecentHistory();
    history.push('g', 'a');
    history.push('h', 'z');

    const restored = new RecentHistory();
    restored.restore(history.serialize());
    expect(restored.get('g')).toEqual(['a']);
    expect(restored.get('h')).toEqual(['z']);
  });

  it('ignores malformed restore input', () => {
    const history = new RecentHistory();
    history.restore('nonsense');
    expect(history.get('g')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  CooldownKey,
  CooldownLedger,
  DEFAULT_COOLDOWNS,
  FREQUENCY_MULTIPLIER,
  createDurationResolver
} from '@main/engine/cooldown';

const MINUTE = 60_000;

describe('CooldownLedger', () => {
  it('allows an unstamped key', () => {
    const ledger = new CooldownLedger(() => 10 * MINUTE);
    expect(ledger.canFire('global', 0)).toBe(true);
  });

  it('blocks until the window elapses, on an injected clock', () => {
    const ledger = new CooldownLedger(() => 10 * MINUTE);
    ledger.stamp('global', 1_000);
    expect(ledger.canFire('global', 1_000)).toBe(false);
    expect(ledger.canFire('global', 1_000 + 9 * MINUTE)).toBe(false);
    expect(ledger.canFire('global', 1_000 + 10 * MINUTE)).toBe(true);
  });

  it('reports remaining time', () => {
    const ledger = new CooldownLedger(() => 10 * MINUTE);
    ledger.stamp('k', 0);
    expect(ledger.remaining('k', 4 * MINUTE)).toBe(6 * MINUTE);
    expect(ledger.remaining('k', 99 * MINUTE)).toBe(0);
  });

  it('does not lock out forever when the clock jumps backwards', () => {
    const ledger = new CooldownLedger(() => 10 * MINUTE);
    ledger.stamp('k', 10_000_000);
    expect(ledger.canFire('k', 5_000_000)).toBe(true);
  });

  it('lists active cooldowns for the debug panel', () => {
    const ledger = new CooldownLedger(() => 10 * MINUTE);
    ledger.stamp('a', 0);
    ledger.stamp('b', 5 * MINUTE);
    const active = ledger.active(6 * MINUTE);
    expect(active.map((entry) => entry.key)).toEqual(['b', 'a']);
    expect(active[0]?.totalMs).toBe(10 * MINUTE);
  });

  it('prunes stamps older than the given age', () => {
    const ledger = new CooldownLedger(() => 10 * MINUTE);
    ledger.stamp('old', 0);
    ledger.stamp('new', 100 * MINUTE);
    ledger.prune(100 * MINUTE, 50 * MINUTE);
    expect(ledger.lastFiredAt('old')).toBeUndefined();
    expect(ledger.lastFiredAt('new')).toBe(100 * MINUTE);
  });

  it('round-trips through serialize/restore', () => {
    const ledger = new CooldownLedger(() => 10 * MINUTE);
    ledger.stamp(CooldownKey.phrase('night.insist'), 42);

    const restored = new CooldownLedger(() => 10 * MINUTE);
    restored.restore(ledger.serialize());
    expect(restored.lastFiredAt(CooldownKey.phrase('night.insist'))).toBe(42);
    expect(restored.canFire(CooldownKey.phrase('night.insist'), 43)).toBe(false);
  });

  it('discards junk on restore', () => {
    const ledger = new CooldownLedger(() => 10 * MINUTE);
    ledger.restore({ version: 1, stamps: { good: 5, bad: 'nope' } });
    expect(ledger.lastFiredAt('good')).toBe(5);
    expect(ledger.lastFiredAt('bad')).toBeUndefined();
  });
});

describe('createDurationResolver', () => {
  it('applies the frequency multiplier to every bucket', () => {
    let profile: keyof typeof FREQUENCY_MULTIPLIER = 'balanced';
    const resolve = createDurationResolver(() => FREQUENCY_MULTIPLIER[profile]);

    expect(resolve(CooldownKey.global())).toBe(DEFAULT_COOLDOWNS.global);
    expect(resolve(CooldownKey.category('system'))).toBe(DEFAULT_COOLDOWNS.categories.system);
    expect(resolve(CooldownKey.phrase('x'))).toBe(DEFAULT_COOLDOWNS.perPhrase);

    profile = 'rare';
    expect(resolve(CooldownKey.global())).toBe(DEFAULT_COOLDOWNS.global * 4);
    profile = 'chatty';
    expect(resolve(CooldownKey.global())).toBe(DEFAULT_COOLDOWNS.global * 0.5);
  });

  it('falls back for an unknown category and unknown namespace', () => {
    const resolve = createDurationResolver(() => 1);
    expect(resolve(CooldownKey.category('invented'))).toBe(DEFAULT_COOLDOWNS.categoryDefault);
    expect(resolve('something:else')).toBe(0);
  });

  it('a changed profile takes effect without losing history', () => {
    let multiplier = 1;
    const ledger = new CooldownLedger(createDurationResolver(() => multiplier));
    ledger.stamp(CooldownKey.global(), 0);
    expect(ledger.canFire(CooldownKey.global(), 9 * MINUTE)).toBe(true);
    multiplier = 4;
    expect(ledger.canFire(CooldownKey.global(), 9 * MINUTE)).toBe(false);
  });
});

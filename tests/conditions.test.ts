import { describe, expect, it, vi } from 'vitest';
import {
  evaluateConditions,
  parseClock,
  type Condition,
  type ConditionContext
} from '@main/engine/conditions';

function ctx(overrides: Partial<ConditionContext> = {}): ConditionContext {
  return {
    now: new Date(2026, 0, 15, 14, 0, 0, 0).getTime(), // Thursday
    payload: {},
    uptimeMinutes: 30,
    firstRun: false,
    ...overrides
  };
}

describe('parseClock', () => {
  it('parses valid times and rejects the rest', () => {
    expect(parseClock('00:00')).toBe(0);
    expect(parseClock('23:59')).toBe(23 * 60 + 59);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('9:00')).toBeNull();
    expect(parseClock('nonsense')).toBeNull();
  });
});

describe('evaluateConditions', () => {
  it('passes with no conditions', () => {
    expect(evaluateConditions(undefined, ctx())).toBe(true);
    expect(evaluateConditions([], ctx())).toBe(true);
  });

  it('ANDs every condition together', () => {
    const conditions: Condition[] = [
      { kind: 'uptimeMinutes', gt: 10 },
      { kind: 'dayOfWeek', days: [4] }
    ];
    expect(evaluateConditions(conditions, ctx())).toBe(true);
    expect(evaluateConditions(conditions, ctx({ uptimeMinutes: 5 }))).toBe(false);
  });

  it('evaluates timeOfDay, including across midnight', () => {
    expect(evaluateConditions([{ kind: 'timeOfDay', from: '08:00', to: '17:00' }], ctx())).toBe(true);
    expect(evaluateConditions([{ kind: 'timeOfDay', from: '23:00', to: '05:00' }], ctx())).toBe(
      false
    );
    expect(
      evaluateConditions(
        [{ kind: 'timeOfDay', from: '23:00', to: '05:00' }],
        ctx({ now: new Date(2026, 0, 15, 2, 0).getTime() })
      )
    ).toBe(true);
  });

  it('evaluates dayOfWeek with Sunday as 0', () => {
    const sunday = new Date(2026, 0, 18, 12, 0).getTime();
    expect(evaluateConditions([{ kind: 'dayOfWeek', days: [0] }], ctx({ now: sunday }))).toBe(true);
    expect(evaluateConditions([{ kind: 'dayOfWeek', days: [1] }], ctx({ now: sunday }))).toBe(false);
  });

  it('evaluates payloadNumber including nested paths', () => {
    const payload = { awayMs: 3_600_000, nested: { load: 92 } };
    expect(
      evaluateConditions([{ kind: 'payloadNumber', path: 'awayMs', gt: 1_000 }], ctx({ payload }))
    ).toBe(true);
    expect(
      evaluateConditions([{ kind: 'payloadNumber', path: 'nested.load', gt: 95 }], ctx({ payload }))
    ).toBe(false);
    expect(
      evaluateConditions(
        [{ kind: 'payloadNumber', path: 'awayMs', gt: 1_000, lt: 10_000 }],
        ctx({ payload })
      )
    ).toBe(false);
  });

  it('fails a payloadNumber against a missing or non-numeric value', () => {
    expect(evaluateConditions([{ kind: 'payloadNumber', path: 'nope', gt: 0 }], ctx())).toBe(false);
    expect(
      evaluateConditions(
        [{ kind: 'payloadNumber', path: 'name', gt: 0 }],
        ctx({ payload: { name: 'Code.exe' } })
      )
    ).toBe(false);
  });

  it('evaluates payloadString with equals and oneOf', () => {
    const payload = { name: 'Code.exe' };
    expect(
      evaluateConditions(
        [{ kind: 'payloadString', path: 'name', equals: 'Code.exe' }],
        ctx({ payload })
      )
    ).toBe(true);
    expect(
      evaluateConditions(
        [{ kind: 'payloadString', path: 'name', oneOf: ['a.exe', 'Code.exe'] }],
        ctx({ payload })
      )
    ).toBe(true);
    expect(
      evaluateConditions([{ kind: 'payloadString', path: 'name', oneOf: ['a.exe'] }], ctx({ payload }))
    ).toBe(false);
  });

  it('evaluates uptimeMinutes and firstRun', () => {
    expect(evaluateConditions([{ kind: 'uptimeMinutes', lt: 60 }], ctx())).toBe(true);
    expect(evaluateConditions([{ kind: 'firstRun' }], ctx())).toBe(false);
    expect(evaluateConditions([{ kind: 'firstRun' }], ctx({ firstRun: true }))).toBe(true);
  });

  it('fails closed on an unknown kind and warns', () => {
    const warn = vi.fn();
    const unknown = { kind: 'telepathy' } as unknown as Condition;
    expect(evaluateConditions([unknown], ctx({ warn }))).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('telepathy');
  });
});

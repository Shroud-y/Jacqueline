import { describe, expect, it } from 'vitest';
import { evaluateSuppression, type SuppressionInput } from '@main/engine/suppression';
import { isWithinClockWindow } from '@main/engine/conditions';

/** Local time, so the tests match how quiet hours are actually evaluated. */
function at(hour: number, minute = 0): number {
  const d = new Date(2026, 0, 15, hour, minute, 0, 0);
  return d.getTime();
}

function input(overrides: Partial<SuppressionInput> = {}): SuppressionInput {
  return {
    now: at(14),
    muted: false,
    snoozedUntil: null,
    quietHours: { enabled: true, from: '23:00', to: '08:00' },
    suppressOnFullscreen: true,
    fullscreenActive: false,
    suppressOnMicrophoneUse: true,
    microphoneActive: false,
    bootAt: at(14) - 10 * 60_000,
    bootGraceMs: 60_000,
    ...overrides
  };
}

describe('isWithinClockWindow', () => {
  it('handles a normal same-day window', () => {
    expect(isWithinClockWindow(9 * 60, '08:00', '17:00')).toBe(true);
    expect(isWithinClockWindow(7 * 60, '08:00', '17:00')).toBe(false);
    expect(isWithinClockWindow(17 * 60, '08:00', '17:00')).toBe(false);
  });

  it('handles a window that wraps past midnight', () => {
    expect(isWithinClockWindow(23 * 60, '23:00', '08:00')).toBe(true);
    expect(isWithinClockWindow(0, '23:00', '08:00')).toBe(true);
    expect(isWithinClockWindow(7 * 60 + 59, '23:00', '08:00')).toBe(true);
    expect(isWithinClockWindow(8 * 60, '23:00', '08:00')).toBe(false);
    expect(isWithinClockWindow(22 * 60 + 59, '23:00', '08:00')).toBe(false);
  });

  it('rejects malformed and empty windows', () => {
    expect(isWithinClockWindow(600, '25:00', '08:00')).toBe(false);
    expect(isWithinClockWindow(600, '08:00', '08:00')).toBe(false);
  });
});

describe('evaluateSuppression', () => {
  it('is clear during working hours with nothing active', () => {
    const state = evaluateSuppression(input());
    expect(state.suppressed).toBe(false);
    expect(state.reason).toBeNull();
    expect(state.hardMute).toBe(false);
  });

  it('reports mute as a hard mute', () => {
    const state = evaluateSuppression(input({ muted: true }));
    expect(state.suppressed).toBe(true);
    expect(state.hardMute).toBe(true);
    expect(state.reason).toBe('muted');
  });

  it('suppresses inside quiet hours on both sides of midnight', () => {
    expect(evaluateSuppression(input({ now: at(23, 30), bootAt: 0 })).reason).toBe('quietHours');
    expect(evaluateSuppression(input({ now: at(3), bootAt: 0 })).reason).toBe('quietHours');
    expect(evaluateSuppression(input({ now: at(8, 1), bootAt: 0 })).suppressed).toBe(false);
  });

  it('respects the quiet-hours toggle', () => {
    const state = evaluateSuppression(
      input({ now: at(2), bootAt: 0, quietHours: { enabled: false, from: '23:00', to: '08:00' } })
    );
    expect(state.suppressed).toBe(false);
  });

  it('expires a snooze', () => {
    const now = at(14);
    expect(evaluateSuppression(input({ snoozedUntil: now + 1 })).reason).toBe('snoozed');
    expect(evaluateSuppression(input({ snoozedUntil: now })).suppressed).toBe(false);
    expect(evaluateSuppression(input({ snoozedUntil: now - 1 })).suppressed).toBe(false);
  });

  it('suppresses on fullscreen and microphone only when enabled', () => {
    expect(evaluateSuppression(input({ fullscreenActive: true })).reason).toBe('fullscreen');
    expect(
      evaluateSuppression(input({ fullscreenActive: true, suppressOnFullscreen: false })).suppressed
    ).toBe(false);

    expect(evaluateSuppression(input({ microphoneActive: true })).reason).toBe('microphone');
    expect(
      evaluateSuppression(input({ microphoneActive: true, suppressOnMicrophoneUse: false }))
        .suppressed
    ).toBe(false);
  });

  it('suppresses during the post-boot blackout', () => {
    const now = at(14);
    expect(evaluateSuppression(input({ now, bootAt: now - 30_000 })).reason).toBe('bootGrace');
    expect(evaluateSuppression(input({ now, bootAt: now - 61_000 })).suppressed).toBe(false);
  });

  it('collects every active reason in evaluation order', () => {
    const state = evaluateSuppression(
      input({ now: at(2), bootAt: at(2) - 1_000, muted: true, fullscreenActive: true })
    );
    expect(state.reasons).toEqual(['muted', 'quietHours', 'fullscreen', 'bootGrace']);
    expect(state.reason).toBe('muted');
  });
});

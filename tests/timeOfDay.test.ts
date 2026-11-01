import { describe, expect, it } from 'vitest';
import { isWithinClockWindow, parseClock, msUntilClockChange } from '@main/engine/timeOfDay';

describe('the next change of quiet hours', () => {
  const at = (hours: number, minutes: number): number => new Date(2026, 0, 15, hours, minutes).getTime();

  it('is whichever of the two times comes round first, today or tomorrow', () => {
    expect(msUntilClockChange(at(22, 0), '23:00', '08:00')).toBe(3_600_000 + 50);
    expect(msUntilClockChange(at(23, 30), '23:00', '08:00')).toBe(8.5 * 3_600_000 + 50);
    expect(msUntilClockChange(at(9, 0), '23:00', '08:00')).toBe(14 * 3_600_000 + 50);
  });

  it('never waits for nothing, and gives up on what is not a time', () => {
    expect(msUntilClockChange(at(8, 0), '08:00', '08:00')).toBe(24 * 3_600_000 + 50);
    expect(msUntilClockChange(at(8, 0), 'soon', 'later')).toBeNull();
  });
});

describe('parseClock', () => {
  it('reads HH:mm and refuses anything else', () => {
    expect(parseClock('00:00')).toBe(0);
    expect(parseClock('23:59')).toBe(23 * 60 + 59);
    for (const bad of ['24:00', '9:00', '12:60', '', 'noon']) expect(parseClock(bad)).toBeNull();
  });
});

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

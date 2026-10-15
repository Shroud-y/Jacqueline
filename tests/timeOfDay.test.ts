import { describe, expect, it } from 'vitest';
import { isWithinClockWindow, parseClock } from '@main/engine/timeOfDay';

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

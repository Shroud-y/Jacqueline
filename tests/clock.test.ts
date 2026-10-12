import { describe, expect, it } from 'vitest';
import { parseClock } from '@shared/clock';

describe('parseClock', () => {
  const ok = (text: string): string | null => {
    const result = parseClock(text);
    return result.ok ? result.value : null;
  };

  it('reads a time written the usual way', () => {
    expect(ok('23:00')).toBe('23:00');
    expect(ok('08:05')).toBe('08:05');
  });

  it('pads what was typed short', () => {
    expect(ok('8:05')).toBe('08:05');
    expect(ok('8:5')).toBe('08:05');
    expect(ok('  7:30 ')).toBe('07:30');
  });

  it('takes a bare hour as on the hour', () => {
    expect(ok('8')).toBe('08:00');
    expect(ok('23')).toBe('23:00');
  });

  it('takes digits run together, and other separators', () => {
    expect(ok('0800')).toBe('08:00');
    expect(ok('830')).toBe('08:30');
    expect(ok('8.30')).toBe('08:30');
    expect(ok('8 30')).toBe('08:30');
  });

  it('refuses what is not a time, with something to act on', () => {
    for (const text of ['', 'soon', '9pm', '12:5:1', '-1:00']) {
      const result = parseClock(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/23:00/);
    }
  });

  it('refuses an hour or a minute that does not exist', () => {
    for (const text of ['24:00', '25', '12:60', '2460']) {
      const result = parseClock(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/00:00 and 23:59/);
    }
  });
});

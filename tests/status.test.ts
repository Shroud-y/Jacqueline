import { describe, expect, it } from 'vitest';
import type { CompanionStatus } from '@shared/types';
import { describeOtherReasons, describeReason, describeStatus } from '@shared/status';

const free: CompanionStatus = {
  reasons: [],
  muted: false,
  snoozedUntil: null,
  snoozedUntilRestart: false,
  quietUntil: null
};

/** Today at the given local time, as epoch ms. */
const at = (hours: number, minutes: number): number => {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
};

describe('describeStatus', () => {
  it('says it is active when nothing is in the way', () => {
    expect(describeStatus(free)).toBe('Active');
    expect(describeOtherReasons(free)).toEqual([]);
  });

  it('names the time a snooze ends, zero-padded', () => {
    expect(describeStatus({ ...free, reasons: ['snoozed'], snoozedUntil: at(9, 5) })).toBe('Snoozed until 09:05');
  });

  it('says so when the snooze lasts until restart', () => {
    expect(describeStatus({ ...free, reasons: ['snoozed'], snoozedUntilRestart: true })).toBe('Snoozed until restart');
  });

  it('names the time quiet hours end', () => {
    expect(describeStatus({ ...free, reasons: ['quietHours'], quietUntil: '08:00' })).toBe('Quiet hours until 08:00');
  });

  it('leads with the first reason and lists the rest separately', () => {
    const status: CompanionStatus = { ...free, reasons: ['muted', 'quietHours', 'fullscreen'], muted: true, quietUntil: '08:00' };
    expect(describeStatus(status)).toBe('Muted');
    expect(describeOtherReasons(status)).toEqual(['Quiet hours until 08:00', 'Stepping aside for a fullscreen app']);
  });

  it('has words for every reason', () => {
    for (const reason of ['muted', 'snoozed', 'quietHours', 'fullscreen', 'microphone'] as const) {
      expect(describeReason(reason, free).length).toBeGreaterThan(0);
    }
  });
});

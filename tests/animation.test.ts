import { describe, expect, it } from 'vitest';
import { frameDelayMs, nextFrame } from '@shared/animation';

describe('frameDelayMs', () => {
  it('takes a duration in microseconds', () => {
    expect(frameDelayMs(40_000)).toBe(40);
  });

  it('reads a missing or too short delay as a tenth of a second, as browsers do', () => {
    expect(frameDelayMs(null)).toBe(100);
    expect(frameDelayMs(0)).toBe(100);
    expect(frameDelayMs(10_000)).toBe(100);
    expect(frameDelayMs(20_000)).toBe(20);
  });
});

describe('nextFrame', () => {
  it('goes through the frames in order', () => {
    expect(nextFrame(0, 3, 40, 5)).toEqual({ index: 1, waitMs: 40 });
    expect(nextFrame(1, 3, 40, 5)).toEqual({ index: 2, waitMs: 40 });
  });

  it('starts over after the last, resting on it first', () => {
    expect(nextFrame(2, 3, 40, 0)).toEqual({ index: 0, waitMs: 40 });
    expect(nextFrame(2, 3, 40, 5)).toEqual({ index: 0, waitMs: 5040 });
  });
});

import { describe, expect, it } from 'vitest';
import { showSecondsFor } from '../src/shared/rules';

describe('showSecondsFor', () => {
  it('rounds up, so the end of the video is not cut off', () => {
    expect(showSecondsFor(12.1)).toBe(13);
    expect(showSecondsFor(12)).toBe(12);
  });

  it('stays within what the action allows', () => {
    expect(showSecondsFor(0.2)).toBe(1);
    expect(showSecondsFor(7200)).toBe(3600);
  });
});

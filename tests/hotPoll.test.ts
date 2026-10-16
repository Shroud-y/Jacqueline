import { describe, expect, it } from 'vitest';
import { distanceToRect, HOT_POLL_MAX_MS, HOT_POLL_MIN_MS, nextPollMs } from '@main/windows/hotPoll';

const rect = { x: 100, y: 100, width: 50, height: 50 };

describe('watching the cursor', () => {
  it('measures how far the cursor is from a character, 0 inside it', () => {
    expect(distanceToRect({ x: 120, y: 120 }, rect)).toBe(0);
    expect(distanceToRect({ x: 40, y: 120 }, rect)).toBe(60);
    expect(distanceToRect({ x: 190, y: 120 }, rect)).toBe(40);
    expect(distanceToRect({ x: 153, y: 154 }, rect)).toBe(5);
  });

  it('looks often when near, rarely when far, never past the limits', () => {
    expect(nextPollMs(0)).toBe(HOT_POLL_MIN_MS);
    expect(nextPollMs(30)).toBe(HOT_POLL_MIN_MS);
    expect(nextPollMs(600)).toBe(200);
    expect(nextPollMs(5000)).toBe(HOT_POLL_MAX_MS);
    // Nobody on screen to be near.
    expect(nextPollMs(Infinity)).toBe(HOT_POLL_MAX_MS);
  });
});

import { describe, expect, it } from 'vitest';
import { EntrySounds, GAP_MS } from '@main/windows/entrySounds';

describe('appear and disappear sounds', () => {
  it('play at most once in a while per character and per kind', () => {
    let now = 0;
    const sounds = new EntrySounds(() => now);
    expect(sounds.take('miku', 'appear')).toBe(true);
    expect(sounds.take('miku', 'appear')).toBe(false);
    // Another kind, another character: their own clocks.
    expect(sounds.take('miku', 'disappear')).toBe(true);
    expect(sounds.take('rin', 'appear')).toBe(true);

    now = GAP_MS - 1;
    expect(sounds.take('miku', 'appear')).toBe(false);
    now = GAP_MS;
    expect(sounds.take('miku', 'appear')).toBe(true);
  });

  it('forgets a character that is gone', () => {
    const sounds = new EntrySounds(() => 0);
    sounds.take('miku', 'appear');
    sounds.forget('miku');
    expect(sounds.take('miku', 'appear')).toBe(true);
  });
});

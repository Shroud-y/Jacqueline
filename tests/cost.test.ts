import { describe, expect, it } from 'vitest';
import { defaultCharacter, type Character } from '@shared/character';
import { estimateCost } from '@shared/cost';

const still = (): Character => ({
  ...defaultCharacter('miku', 'Miku'),
  appearance: { states: { idle: { type: 'image', src: 'a.png' } }, opacity: 1, flip: false, restSec: 0, chroma: null, stylesheet: null, script: null }
});
const video = (restSec: number): Character => ({
  ...still(),
  appearance: { states: { idle: { type: 'video', src: 'a.mp4' } }, opacity: 1, flip: false, restSec, chroma: null, stylesheet: null, script: null }
});

describe('what knowing the music costs', () => {
  const says = (text: string): Character => ({ ...still(), lines: { greet: [{ id: 'a', text }] } });
  const mentionsMusic = (character: Character): boolean => estimateCost(character).items.some((item) => /what is playing/.test(item.text));

  it('comes up for a rule about it, or a line that names the track', () => {
    const base = still();
    const rule = { id: 'r', name: '', enabled: true, if: [], then: [{ type: 'show' as const, seconds: 5 }], cooldownSec: 0 };
    expect(mentionsMusic(base)).toBe(false);
    expect(mentionsMusic(says('Hello, {name}'))).toBe(false);
    expect(mentionsMusic(says('Nice, {track}'))).toBe(true);
    expect(mentionsMusic({ ...base, rules: [{ ...rule, when: { type: 'trackChanged' } }] })).toBe(true);
    expect(mentionsMusic({ ...base, rules: [{ ...rule, when: { type: 'clicked' }, if: [{ type: 'musicPlaying', playing: true }] }] })).toBe(true);
  });

  it('comes up for a look to wear while music plays', () => {
    const base = still();
    const states = { ...base.appearance.states, music: { type: 'image' as const, src: 'b.png' } };
    expect(mentionsMusic({ ...base, appearance: { ...base.appearance, states } })).toBe(true);
  });

  it('does not come up for a rule that is off', () => {
    const rule = { id: 'r', name: '', enabled: false, when: { type: 'musicStarted' as const }, if: [], then: [{ type: 'show' as const, seconds: 5 }], cooldownSec: 0 };
    expect(mentionsMusic({ ...still(), rules: [rule] })).toBe(false);
  });
});

describe('what an animated picture costs', () => {
  const animated = (restSec: number): Character => {
    const base = video(restSec);
    return { ...base, appearance: { ...base.appearance, states: { idle: { type: 'animation', src: 'a.gif' } } } };
  };

  it('counts as moving, and points a large one at a video', () => {
    const { level, items } = estimateCost(animated(0));
    expect(level).toBe('heavy');
    expect(items[0]?.text).toMatch(/on a loop/);
    expect(items[0]?.text).toMatch(/\.webm/);
  });

  it('is cheaper with a rest', () => {
    const { level, items } = estimateCost(animated(10));
    expect(level).toBe('moderate');
    expect(items[0]?.text).toMatch(/resting 10 s/);
  });
});

describe('what a character costs', () => {
  it('is light for a still picture always on screen', () => {
    const cost = estimateCost(still());
    expect(cost.level).toBe('light');
    expect(cost.items).toHaveLength(1);
  });

  it('is heavy for a looping video, moderate once it rests between plays', () => {
    expect(estimateCost(video(0)).level).toBe('heavy');
    expect(estimateCost(video(10)).level).toBe('moderate');
    expect(estimateCost(video(10)).items[0]?.text).toContain('rests 10 s');
  });

  it('says cutting the background out of a video costs extra, and of a picture nothing', () => {
    const chroma = { color: '#00ff00', tolerance: 12, softness: 8 };
    const keyedVideo = video(10);
    keyedVideo.appearance.chroma = chroma;
    expect(estimateCost(keyedVideo).items.some((item) => item.text.includes('Cutting the background'))).toBe(true);
    const keyedStill = still();
    keyedStill.appearance.chroma = chroma;
    expect(estimateCost(keyedStill).level).toBe('light');
  });

  it('says a big video costs more', () => {
    const big = video(10);
    big.layout.elements = big.layout.elements.map((element) => (element.type === 'character' ? { ...element, width: 800, height: 800 } : element));
    expect(estimateCost(big).items.some((item) => item.text.includes('800 × 800'))).toBe(true);
  });

  it('counts what has to be watched for it', () => {
    const tied: Character = { ...still(), presence: { ...still().presence, mode: 'whileRunning', apps: ['dota2.exe'] } };
    const texts = estimateCost(tied).items.map((item) => item.text);
    expect(texts.some((text) => text.includes('running programs'))).toBe(true);
    expect(texts.some((text) => text.includes('costs nothing'))).toBe(true);

    const ruled: Character = {
      ...still(),
      rules: [{ id: 'r', name: '', enabled: true, when: { type: 'programStarted', program: 'code.exe' }, if: [], then: [{ type: 'show', seconds: 5 }], cooldownSec: 0 }]
    };
    expect(estimateCost(ruled).items.some((item) => item.text.includes('running programs'))).toBe(true);
    // A rule that is off asks nothing to be watched.
    const off: Character = { ...ruled, rules: ruled.rules.map((rule) => ({ ...rule, enabled: false })) };
    expect(estimateCost(off).items.some((item) => item.text.includes('running programs'))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { defaultCharacter, type Character } from '@shared/character';
import { estimateCost } from '@shared/cost';

const still = (): Character => ({
  ...defaultCharacter('miku', 'Miku'),
  appearance: { states: { idle: { type: 'image', src: 'a.png' } }, opacity: 1, flip: false, restSec: 0 }
});
const video = (restSec: number): Character => ({
  ...still(),
  appearance: { states: { idle: { type: 'video', src: 'a.mp4' } }, opacity: 1, flip: false, restSec }
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

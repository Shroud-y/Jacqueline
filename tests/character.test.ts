import { describe, expect, it } from 'vitest';
import { assetKindOf, assetNameSchema, characterElement, characterIdSchema, characterSchema, defaultCharacter, referencedAssets } from '@shared/character';

describe('character schema', () => {
  it('accepts a freshly made character', () => {
    expect(characterSchema.safeParse(defaultCharacter('a1', 'Miku')).success).toBe(true);
  });

  it('accepts a character that uses every part of the format', () => {
    const base = defaultCharacter('a1', 'Miku');
    const full = {
      ...base,
      appearance: {
        ...base.appearance,
        states: { idle: { type: 'video', src: 'idle.webm' }, speaking: { type: 'image', src: 'talk.png' } }
      },
      presence: { mode: 'whileRunning', apps: ['dota2.exe'], position: { x: 1600, y: 800 }, hideOnFullscreen: true },
      rules: [
        {
          id: 'r1',
          name: 'Greets the game',
          enabled: true,
          when: { type: 'programStarted', program: 'dota2.exe' },
          if: [{ type: 'chance', percent: 50 }],
          then: [{ type: 'say', group: 'greet' }],
          cooldownSec: 600
        }
      ],
      lines: { greet: [{ id: 'l1', text: '{app} again?', weight: 2, audio: 'hi.ogg' }] },
      audio: { volume: 0.5, appear: 'in.ogg', disappear: null }
    };
    const parsed = characterSchema.safeParse(full);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.rules[0]?.when).toEqual({ type: 'programStarted', program: 'dota2.exe' });
  });

  it('refuses an empty name', () => {
    expect(characterSchema.safeParse(defaultCharacter('a1', '   ')).success).toBe(false);
  });

  it('refuses a file written by a newer version', () => {
    expect(characterSchema.safeParse({ ...defaultCharacter('a1', 'Miku'), schema: 2 }).success).toBe(false);
  });

  it('refuses a rule that does nothing', () => {
    const character = defaultCharacter('a1', 'Miku');
    const rule = { id: 'r1', name: '', enabled: true, when: { type: 'startup' }, if: [], then: [], cooldownSec: 0 };
    expect(characterSchema.safeParse({ ...character, rules: [rule] }).success).toBe(false);
  });

  it('refuses an asset that is a path rather than a name', () => {
    const character = defaultCharacter('a1', 'Miku');
    for (const src of ['../secret.png', 'a/b.png', 'a\\b.png', 'C:\\x.png', '..', '.hidden.png', '']) {
      const states = { idle: { type: 'image', src } };
      expect(characterSchema.safeParse({ ...character, appearance: { ...character.appearance, states } }).success).toBe(false);
    }
  });
});

describe('ids and asset names', () => {
  it('keeps an id usable as a folder name', () => {
    expect(characterIdSchema.safeParse('3f2c9a1e-0b7d-4c55-9a51-1d2e3f4a5b6c').success).toBe(true);
    for (const id of ['', '..', 'a/b', 'a\\b', 'A1', '-a', 'a b', 'a'.repeat(65)]) {
      expect(characterIdSchema.safeParse(id).success).toBe(false);
    }
  });

  it('allows ordinary file names', () => {
    for (const name of ['idle.webm', 'My idle loop-2.png', '_x.ogg']) {
      expect(assetNameSchema.safeParse(name).success).toBe(true);
    }
  });

  it('tells what a file is from its extension', () => {
    expect(assetKindOf('a.PNG')).toBe('image');
    expect(assetKindOf('C:\\clips\\loop.webm')).toBe('video');
    expect(assetKindOf('hi.ogg')).toBe('audio');
    expect(assetKindOf('Saira.woff2')).toBe('font');
    expect(assetKindOf('anim.gif')).toBeNull();
    expect(assetKindOf('run.exe')).toBeNull();
    expect(assetKindOf('noextension')).toBeNull();
  });
});

describe('referencedAssets', () => {
  it('collects every file the character points at, and nothing else', () => {
    const base = defaultCharacter('a1', 'Miku');
    const character = {
      ...base,
      appearance: { ...base.appearance, states: { idle: { type: 'video' as const, src: 'idle.webm' }, speaking: { type: 'image' as const, src: 'talk.png' } } },
      lines: { greet: [{ id: 'l1', text: 'hi', audio: 'hi.ogg' }, { id: 'l2', text: 'yo' }] },
      audio: { volume: 1, appear: 'in.ogg', disappear: null },
      layout: {
        elements: base.layout.elements.map((element) =>
          element.type === 'speech' ? { ...element, style: { ...element.style, font: 'Comic.ttf' } } : element
        )
      }
    };
    expect([...referencedAssets(character)].sort()).toEqual(['Comic.ttf', 'hi.ogg', 'idle.webm', 'in.ogg', 'talk.png']);
  });

  it('does not take a font family name for a file', () => {
    expect(referencedAssets(defaultCharacter('a1', 'Miku')).size).toBe(0);
  });
});

describe('characterElement', () => {
  it('finds the box the picture goes in, or says there is none', () => {
    const base = defaultCharacter('a1', 'Miku');
    expect(characterElement(base)).toMatchObject({ type: 'character', width: 240 });
    expect(characterElement({ ...base, layout: { elements: [] } })).toBeNull();
  });
});

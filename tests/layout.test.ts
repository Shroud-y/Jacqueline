import { describe, expect, it } from 'vitest';
import { defaultCharacter } from '@shared/character';
import {
  EMPTY_FRAME,
  anchorInWindow,
  anchorOnScreen,
  clampAnchor,
  defaultAnchorPosition,
  layoutAnchor,
  layoutFrame,
  placeWindow,
  type Rect
} from '@shared/layout';

const screen: Rect = { x: 0, y: 0, width: 1920, height: 1040 };

/** Text on the left, character on the right — what a new character starts with. */
const elements = defaultCharacter('a1', 'Miku').layout.elements;
const frame = layoutFrame(elements);
const anchor = layoutAnchor(elements);

describe('layoutFrame', () => {
  it('is the box around every element, with a pixel to spare on each side', () => {
    expect(frame).toEqual({ x: -1, y: -1, width: 502, height: 242 });
  });

  it('copes with elements left of and above the origin, and with fractions', () => {
    expect(
      layoutFrame([
        { x: -260.4, y: 40, width: 240, height: 100 },
        { x: 0, y: -10.5, width: 220.2, height: 300 }
      ])
    ).toEqual({ x: -262, y: -12, width: 484, height: 303 });
  });

  it('gives an empty layout something to be', () => {
    expect(layoutFrame([])).toEqual(EMPTY_FRAME);
  });
});

describe('the frame margin', () => {
  it('never lets an element span the window, which is what turns a video window black', () => {
    const alone = layoutFrame([{ x: 0, y: 0, width: 240, height: 240 }]);
    expect(alone.width).toBeGreaterThan(240);
    expect(alone.height).toBeGreaterThan(240);
  });
});

describe('layoutAnchor', () => {
  it('is the character element', () => {
    expect(anchor).toEqual({ x: 260, y: 0, width: 240, height: 240 });
  });

  it('falls back to the whole frame when there is no character element', () => {
    const textOnly = elements.filter((element) => element.type !== 'character');
    expect(layoutAnchor(textOnly)).toEqual(layoutFrame(textOnly));
  });
});

describe('placing the window', () => {
  it('puts the character, not the window, where it was asked to be', () => {
    const window = placeWindow(frame, anchor, { x: 1000, y: 500 });
    expect(window).toEqual({ x: 739, y: 499, width: 502, height: 242 });
    expect(anchorOnScreen(frame, anchor, window)).toEqual({ x: 1000, y: 500 });
  });

  it('keeps the character still when the text moves to its other side', () => {
    const flipped = elements.map((element) => (element.type === 'speech' ? { ...element, x: 520 } : element));
    const before = placeWindow(frame, anchor, { x: 1000, y: 500 });
    const after = placeWindow(layoutFrame(flipped), layoutAnchor(flipped), { x: 1000, y: 500 });
    expect(after).not.toEqual(before);
    expect(anchorOnScreen(layoutFrame(flipped), layoutAnchor(flipped), after)).toEqual({ x: 1000, y: 500 });
  });

  it('says where in the window the character can be grabbed', () => {
    expect(anchorInWindow(frame, anchor)).toEqual({ x: 261, y: 1, width: 240, height: 240 });
  });
});

describe('clampAnchor', () => {
  it('leaves a character that is on screen alone', () => {
    expect(clampAnchor({ x: 300, y: 300 }, anchor, screen)).toEqual({ x: 300, y: 300 });
  });

  it('pulls one back from past any edge', () => {
    expect(clampAnchor({ x: -50, y: -50 }, anchor, screen)).toEqual({ x: 0, y: 0 });
    expect(clampAnchor({ x: 5000, y: 5000 }, anchor, screen)).toEqual({ x: 1680, y: 800 });
  });

  it('works on a display that does not start at the origin', () => {
    const second: Rect = { x: -1280, y: 200, width: 1280, height: 984 };
    expect(clampAnchor({ x: 100, y: 0 }, anchor, second)).toEqual({ x: -240, y: 200 });
  });

  it('pins a character larger than the display to its top-left', () => {
    const tiny: Rect = { x: 10, y: 10, width: 100, height: 100 };
    expect(clampAnchor({ x: 50, y: 50 }, anchor, tiny)).toEqual({ x: 10, y: 10 });
  });
});

describe('defaultAnchorPosition', () => {
  it('is the bottom-right corner, with a margin', () => {
    expect(defaultAnchorPosition(anchor, screen)).toEqual({ x: 1656, y: 776 });
  });
});

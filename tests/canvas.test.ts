import { describe, expect, it } from 'vitest';
import { MIN_BOX, freeElementId, moveBox, placeBeside, resizeBox, snapBox } from '@shared/canvas';
import { DEFAULT_TEXT_STYLE } from '@shared/character';
import type { Rect } from '@shared/layout';
import { fontFamily, isFontFile, textStyleCss } from '@shared/textStyle';

const box: Rect = { x: 100, y: 100, width: 200, height: 100 };

describe('moveBox', () => {
  it('moves by whole pixels', () => {
    expect(moveBox(box, 10.4, -5.6)).toEqual({ x: 110, y: 94, width: 200, height: 100 });
  });
});

describe('resizeBox', () => {
  it('moves only the dragged edges, keeping the opposite ones in place', () => {
    expect(resizeBox(box, 'e', 50, 999)).toEqual({ x: 100, y: 100, width: 250, height: 100 });
    expect(resizeBox(box, 'w', -50, 0)).toEqual({ x: 50, y: 100, width: 250, height: 100 });
    expect(resizeBox(box, 'n', 0, 30)).toEqual({ x: 100, y: 130, width: 200, height: 70 });
    expect(resizeBox(box, 'se', 10, 20)).toEqual({ x: 100, y: 100, width: 210, height: 120 });
    expect(resizeBox(box, 'nw', -10, -20)).toEqual({ x: 90, y: 80, width: 210, height: 120 });
  });

  it('never goes below the smallest size, nor turns inside out', () => {
    const shrunk = resizeBox(box, 'se', -1000, -1000);
    expect(shrunk).toEqual({ x: 100, y: 100, width: MIN_BOX, height: MIN_BOX });
    const fromLeft = resizeBox(box, 'w', 1000, 0);
    expect(fromLeft.x + fromLeft.width).toBe(300);
    expect(fromLeft.width).toBe(MIN_BOX);
  });

  it('keeps proportions from a corner, following the larger change', () => {
    expect(resizeBox(box, 'se', 100, 0, true)).toEqual({ x: 100, y: 100, width: 300, height: 150 });
    expect(resizeBox(box, 'se', 0, 100, true)).toEqual({ x: 100, y: 100, width: 400, height: 200 });
    // The far corner stays put when dragging the near one.
    expect(resizeBox(box, 'nw', -100, 0, true)).toEqual({ x: 0, y: 50, width: 300, height: 150 });
  });

  it('keeps proportions from an edge by growing about the middle', () => {
    expect(resizeBox(box, 'e', 100, 0, true)).toEqual({ x: 100, y: 75, width: 300, height: 150 });
    expect(resizeBox(box, 's', 0, 100, true)).toEqual({ x: 0, y: 100, width: 400, height: 200 });
  });
});

describe('snapBox', () => {
  const other: Rect = { x: 400, y: 100, width: 100, height: 100 };

  it('lines an edge up with a nearby edge and says where the guide goes', () => {
    const moved = { ...box, x: 196 }; // right edge at 396, 4 px short of 400
    const snapped = snapBox(moved, [other], 6);
    expect(snapped.box.x).toBe(200);
    expect(snapped.guides.x).toEqual([400]);
  });

  it('lines middles up too', () => {
    const moved = { ...box, y: 103 }; // middle at 153 against 150
    expect(snapBox(moved, [other], 6).box.y).toBe(100);
  });

  it('leaves a box alone when nothing is close enough', () => {
    const moved = { ...box, x: 150, y: 330 };
    expect(snapBox(moved, [other], 6)).toEqual({ box: moved, guides: { x: [], y: [] } });
  });

  it('picks the nearest of several', () => {
    const near: Rect = { x: 0, y: 0, width: 302, height: 10 };
    const snapped = snapBox({ ...box, x: 103 }, [other, near], 6);
    // Right edge 303 is 1 from 302 and 97 from 400; left edge 103 is 3 from 100.
    expect(snapped.box.x + snapped.box.width).toBe(302);
  });
});

describe('freeElementId', () => {
  it('uses the name as it is, or numbers it', () => {
    expect(freeElementId('speech', ['character'])).toBe('speech');
    expect(freeElementId('speech', ['speech', 'speech-2'])).toBe('speech-3');
  });
});

describe('placeBeside', () => {
  const anchor: Rect = { x: 0, y: 0, width: 240, height: 240 };

  it('puts a new box to the left of the character, centred on it', () => {
    expect(placeBeside(anchor, { width: 200, height: 80 }, [anchor])).toEqual({ x: -216, y: 80, width: 200, height: 80 });
  });

  it('goes below when the left is taken, and below everything when that is too', () => {
    const leftTaken: Rect = { x: -300, y: 0, width: 280, height: 240 };
    expect(placeBeside(anchor, { width: 200, height: 40 }, [anchor, leftTaken])).toEqual({ x: 20, y: 256, width: 200, height: 40 });
    const belowTaken: Rect = { x: 0, y: 250, width: 240, height: 60 };
    expect(placeBeside(anchor, { width: 200, height: 40 }, [anchor, leftTaken, belowTaken]).y).toBe(326);
  });
});

describe('textStyleCss', () => {
  it('turns the default style into CSS', () => {
    expect(textStyleCss(DEFAULT_TEXT_STYLE)).toMatchObject({
      fontFamily: '"Saira", "Segoe UI", sans-serif',
      fontSize: '16px',
      fontWeight: 400,
      color: '#ffffff',
      textAlign: 'left',
      textShadow: '0px 1px 4px rgba(0, 0, 0, 0.85)'
    });
  });

  it('adds an outline under the letters and a background when asked', () => {
    const css = textStyleCss({
      ...DEFAULT_TEXT_STYLE,
      shadow: null,
      stroke: { color: '#000', width: 2 },
      background: { color: '#222', radius: 8, padding: 6 }
    });
    expect(css).toMatchObject({ WebkitTextStroke: '4px #000', paintOrder: 'stroke fill', backgroundColor: '#222', borderRadius: '8px', padding: '6px' });
    expect(css.textShadow).toBeUndefined();
  });

  it('tells a font file from a family name, and quotes either safely', () => {
    expect(isFontFile('Comic.TTF')).toBe(true);
    expect(isFontFile('Comic Sans MS')).toBe(false);
    expect(fontFamily('Bad"Name')).toBe('"BadName", "Segoe UI", sans-serif');
  });
});

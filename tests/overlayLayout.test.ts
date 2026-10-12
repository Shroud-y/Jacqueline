import { describe, expect, it } from 'vitest';
import {
  OVERLAY_HEIGHT,
  OVERLAY_WIDTH,
  UNIT_BOX,
  UNIT_INSET,
  clampUnit,
  defaultPinnedUnit,
  layoutFor,
  placeNamed,
  placePinned,
  pointInRect,
  unitOffset,
  type OverlayLayout,
  type Rect
} from '@shared/overlayLayout';
import { CANVAS } from '@renderer/skins/eye/geometry';

/** A 1080p display with a 40 px taskbar along the bottom. */
const screen: Rect = { x: 0, y: 0, width: 1920, height: 1040 };

const LAYOUTS: OverlayLayout[] = [
  { anchor: 'right', flow: 'down' },
  { anchor: 'left', flow: 'down' },
  { anchor: 'right', flow: 'up' },
  { anchor: 'left', flow: 'up' }
];

describe('overlay geometry', () => {
  it('agrees with the skin about how big the unit is', () => {
    // Main places the window from `UNIT_BOX`; the renderer draws the skin's
    // canvas. If they differ, the character is not where the window thinks.
    expect(UNIT_BOX).toEqual(CANVAS);
  });

  it('keeps the unit inside the window in every layout', () => {
    for (const layout of LAYOUTS) {
      const offset = unitOffset(layout);
      expect(offset.x).toBeGreaterThanOrEqual(0);
      expect(offset.y).toBeGreaterThanOrEqual(0);
      expect(offset.x + UNIT_BOX.width).toBeLessThanOrEqual(OVERLAY_WIDTH);
      expect(offset.y + UNIT_BOX.height).toBeLessThanOrEqual(OVERLAY_HEIGHT);
    }
  });

  it('puts the unit against the edge its layout names', () => {
    expect(unitOffset({ anchor: 'right', flow: 'down' })).toEqual({
      x: OVERLAY_WIDTH - UNIT_INSET.x - UNIT_BOX.width,
      y: UNIT_INSET.y
    });
    expect(unitOffset({ anchor: 'left', flow: 'up' })).toEqual({
      x: UNIT_INSET.x,
      y: OVERLAY_HEIGHT - UNIT_INSET.y - UNIT_BOX.height
    });
  });
});

describe('layoutFor', () => {
  it('runs the text toward the middle of the screen', () => {
    expect(layoutFor({ x: 1700, y: 100 }, screen).anchor).toBe('right');
    expect(layoutFor({ x: 40, y: 100 }, screen).anchor).toBe('left');
  });

  it('hangs the text below while there is room, and stacks it above when there is not', () => {
    expect(layoutFor({ x: 1700, y: 100 }, screen).flow).toBe('down');
    // The bottom-right corner, where everyone puts it.
    expect(layoutFor({ x: 1700, y: 850 }, screen).flow).toBe('up');
  });

  it('measures against the display the unit is on, not against the origin', () => {
    const second: Rect = { x: 1920, y: 0, width: 1920, height: 1040 };
    expect(layoutFor({ x: 1960, y: 100 }, second).anchor).toBe('left');
    expect(layoutFor({ x: 3600, y: 100 }, second).anchor).toBe('right');
  });
});

describe('placePinned', () => {
  const windowRect = (placement: ReturnType<typeof placePinned>): Rect => ({
    ...placement.window,
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT
  });

  it('puts the window so the unit lands exactly where it was dropped', () => {
    for (const unit of [
      { x: 1700, y: 100 },
      { x: 40, y: 100 },
      { x: 1700, y: 850 },
      { x: 40, y: 850 },
      { x: 900, y: 400 }
    ]) {
      const placement = placePinned(unit, screen);
      const offset = unitOffset(placement.layout);
      expect({ x: placement.window.x + offset.x, y: placement.window.y + offset.y }).toEqual(placement.unit);
      expect(placement.unit).toEqual(unit);
    }
  });

  it('never hangs more than its own empty margin off the display', () => {
    // The unit may sit flush against an edge, which puts the inset beyond it
    // off screen — and nothing else. The text grows away from that edge, so
    // everything that is ever drawn stays on the display.
    for (let x = 0; x <= screen.width - UNIT_BOX.width; x += 85) {
      for (let y = 0; y <= screen.height - UNIT_BOX.height; y += 85) {
        const rect = windowRect(placePinned({ x, y }, screen));
        expect(rect.x).toBeGreaterThanOrEqual(screen.x - UNIT_INSET.x);
        expect(rect.y).toBeGreaterThanOrEqual(screen.y - UNIT_INSET.y);
        expect(rect.x + rect.width).toBeLessThanOrEqual(screen.x + screen.width + UNIT_INSET.x);
        expect(rect.y + rect.height).toBeLessThanOrEqual(screen.y + screen.height + UNIT_INSET.y);
      }
    }
  });

  it('pulls a unit dropped past the edge back onto the display', () => {
    const placement = placePinned({ x: 5000, y: -300 }, screen);
    expect(placement.unit).toEqual({ x: screen.width - UNIT_BOX.width, y: 0 });
  });

  it('recovers a position saved on a display that is no longer there', () => {
    // Saved on a second monitor to the right; only the primary is left.
    const placement = placePinned({ x: 3200, y: 500 }, screen);
    expect(pointInRect(placement.unit, screen)).toBe(true);
  });
});

describe('clampUnit', () => {
  it('leaves a unit that already fits alone', () => {
    expect(clampUnit({ x: 300, y: 300 }, screen)).toEqual({ x: 300, y: 300 });
  });

  it('copes with an area smaller than the unit', () => {
    const tiny: Rect = { x: 10, y: 20, width: 100, height: 100 };
    expect(clampUnit({ x: 500, y: 500 }, tiny)).toEqual({ x: 10, y: 20 });
  });
});

describe('defaultPinnedUnit', () => {
  it('starts in the bottom-right corner, fully on screen', () => {
    const unit = defaultPinnedUnit(screen);
    expect(unit.x + UNIT_BOX.width).toBeLessThanOrEqual(screen.width);
    expect(unit.y + UNIT_BOX.height).toBeLessThanOrEqual(screen.height);
    expect(unit.x).toBeGreaterThan(screen.width / 2);
    expect(unit.y).toBeGreaterThan(screen.height / 2);
    expect(layoutFor(unit, screen)).toEqual({ anchor: 'right', flow: 'up' });
  });
});

describe('pointInRect', () => {
  const rect: Rect = { x: 10, y: 10, width: 20, height: 20 };

  it('includes the top-left edge and excludes the bottom-right one', () => {
    expect(pointInRect({ x: 10, y: 10 }, rect)).toBe(true);
    expect(pointInRect({ x: 29, y: 29 }, rect)).toBe(true);
    expect(pointInRect({ x: 30, y: 30 }, rect)).toBe(false);
    expect(pointInRect({ x: 9, y: 15 }, rect)).toBe(false);
  });
});

describe('placeNamed — where the unpinned companion turns up', () => {
  it('puts "right" exactly where it always appeared', () => {
    // The original placement: against the right edge, a little below the
    // middle. Reproduced to the pixel, so an install that never touches the
    // setting sees nothing move.
    const placement = placeNamed('right', screen);
    expect(placement.window).toEqual({
      x: screen.width - OVERLAY_WIDTH - 24,
      y: Math.round(screen.height / 2 - OVERLAY_HEIGHT / 2 + screen.height * 0.12)
    });
    expect(placement.layout).toEqual({ anchor: 'right', flow: 'down' });
  });

  it('stacks the text above the unit in the bottom corner, where it would otherwise run off', () => {
    const placement = placeNamed('bottomRight', screen);
    expect(placement.layout).toEqual({ anchor: 'right', flow: 'up' });
    expect(placement.unit.y + UNIT_BOX.height).toBeLessThanOrEqual(screen.height);
    expect(placement.unit.y).toBeGreaterThan(screen.height / 2);
  });

  it('hangs the text below the unit in the top corner', () => {
    const placement = placeNamed('topRight', screen);
    expect(placement.layout).toEqual({ anchor: 'right', flow: 'down' });
    expect(placement.unit.y).toBeLessThan(screen.height / 4);
  });

  it('keeps the unit on the display for every named place, on any display', () => {
    const second: Rect = { x: -1280, y: 200, width: 1280, height: 984 };
    for (const area of [screen, second]) {
      for (const name of ['right', 'bottomRight', 'topRight'] as const) {
        const { unit } = placeNamed(name, area);
        expect(unit.x).toBeGreaterThanOrEqual(area.x);
        expect(unit.y).toBeGreaterThanOrEqual(area.y);
        expect(unit.x + UNIT_BOX.width).toBeLessThanOrEqual(area.x + area.width);
        expect(unit.y + UNIT_BOX.height).toBeLessThanOrEqual(area.y + area.height);
      }
    }
  });
});

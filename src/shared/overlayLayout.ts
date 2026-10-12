/**
 * The overlay's geometry, shared by the two sides that both have to know it:
 * main, which places the window, and the renderer, which lays out inside it.
 * Dependency-free and pure, like everything in `shared`.
 *
 * Unpinned, the companion appears at the right edge of the screen with its
 * text hanging under it, and that is the only layout there is. Pinned, the
 * user drags it anywhere — so the text has to be able to hang on whichever
 * side has room, or dropping the eye in the bottom-right corner (where
 * everyone puts it) would write the line off the edge of the screen.
 */

/** §3 — the canvas the zones are laid out inside. Never changes at runtime. */
export const OVERLAY_WIDTH = 560;
export const OVERLAY_HEIGHT = 460;

/** The character unit's box. Matches the eye skin's canvas; a test holds them together. */
export const UNIT_BOX = { width: 150, height: 175 } as const;

/** Gap between the unit and the window edges it is anchored to. */
export const UNIT_INSET = { x: 28, y: 24 } as const;

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export interface OverlayLayout {
  /** Which side of the window the unit sits on. The text grows away from it. */
  anchor: 'left' | 'right';
  /** Whether the text hangs below the unit or stacks above it. */
  flow: 'down' | 'up';
}

/** The one layout the unpinned overlay uses. */
export const DEFAULT_LAYOUT: OverlayLayout = { anchor: 'right', flow: 'down' };

/** Where the unit's box sits inside the window, for a layout. */
export function unitOffset(layout: OverlayLayout): Point {
  return {
    x: layout.anchor === 'right' ? OVERLAY_WIDTH - UNIT_INSET.x - UNIT_BOX.width : UNIT_INSET.x,
    y: layout.flow === 'down' ? UNIT_INSET.y : OVERLAY_HEIGHT - UNIT_INSET.y - UNIT_BOX.height
  };
}

/** Keeps the whole unit inside `area`. */
export function clampUnit(unit: Point, area: Rect): Point {
  const maxX = area.x + Math.max(0, area.width - UNIT_BOX.width);
  const maxY = area.y + Math.max(0, area.height - UNIT_BOX.height);
  return {
    x: Math.round(Math.min(Math.max(unit.x, area.x), maxX)),
    y: Math.round(Math.min(Math.max(unit.y, area.y), maxY))
  };
}

/**
 * The text goes toward the middle of the screen horizontally, and below the
 * unit unless that would run it off the bottom.
 */
export function layoutFor(unit: Point, area: Rect): OverlayLayout {
  const centreX = unit.x + UNIT_BOX.width / 2;
  const windowBottomIfDown = unit.y - UNIT_INSET.y + OVERLAY_HEIGHT;
  return {
    anchor: centreX >= area.x + area.width / 2 ? 'right' : 'left',
    flow: windowBottomIfDown <= area.y + area.height ? 'down' : 'up'
  };
}

export interface PinnedPlacement {
  /** The unit's top-left on screen, after clamping into the area. */
  unit: Point;
  layout: OverlayLayout;
  /** The window's top-left on screen. */
  window: Point;
}

/** Everything needed to put the window down for a unit pinned at `unit`. */
export function placePinned(unit: Point, area: Rect): PinnedPlacement {
  const clamped = clampUnit(unit, area);
  const layout = layoutFor(clamped, area);
  const offset = unitOffset(layout);
  return { unit: clamped, layout, window: { x: clamped.x - offset.x, y: clamped.y - offset.y } };
}

/** Where a newly pinned companion goes: the bottom-right corner, clear of the taskbar. */
export function defaultPinnedUnit(area: Rect): Point {
  return clampUnit(
    { x: area.x + area.width - UNIT_BOX.width - 36, y: area.y + area.height - UNIT_BOX.height - 12 },
    area
  );
}

/** Gap between the window and the right edge of the work area, for the original placement. */
const RIGHT_INSET = 24;
/** How far below the vertical middle the original placement sits, as a fraction of the area's height. */
const VERTICAL_OFFSET_RATIO = 0.12;

/**
 * Where the unpinned companion turns up, by name.
 *
 * `right` is where it always appeared — against the right edge, a little
 * below the middle — and is reproduced to the pixel, so choosing nothing
 * changes nothing. The two corners are the same thing a pinned companion does
 * when dragged there: the text finds the side with room.
 */
export function placeNamed(placement: 'right' | 'bottomRight' | 'topRight', area: Rect): PinnedPlacement {
  if (placement === 'bottomRight') return placePinned(defaultPinnedUnit(area), area);
  if (placement === 'topRight') {
    return placePinned({ x: area.x + area.width - UNIT_BOX.width - 36, y: area.y + 12 }, area);
  }

  let x = area.x + area.width - OVERLAY_WIDTH - RIGHT_INSET;
  let y = area.y + Math.round(area.height / 2 - OVERLAY_HEIGHT / 2 + area.height * VERTICAL_OFFSET_RATIO);
  // Never land partly offscreen.
  x = Math.max(area.x, Math.min(x, area.x + area.width - OVERLAY_WIDTH));
  y = Math.max(area.y, Math.min(y, area.y + area.height - OVERLAY_HEIGHT));

  const offset = unitOffset(DEFAULT_LAYOUT);
  return { unit: { x: x + offset.x, y: y + offset.y }, layout: DEFAULT_LAYOUT, window: { x, y } };
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

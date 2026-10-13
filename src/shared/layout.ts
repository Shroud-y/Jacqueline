/**
 * Where a character's window goes and how big it is. Arithmetic only, so it
 * can be tested without Electron and shared with the editor's canvas.
 *
 * Three rectangles are in play:
 *   frame  — the box that holds every element, in the layout's own space.
 *            The window is exactly this big.
 *   anchor — the `character` element, in the same space. It is what the user
 *            places on screen and what they grab to move it.
 *   window — the frame, on screen.
 *
 * What is stored is where the *anchor* is on screen, not the window: moving
 * the text to the other side of the character in the editor changes the
 * frame, and must not make the character jump.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a character with no elements at all still occupies, so it can be seen and fixed. */
export const EMPTY_FRAME: Rect = { x: 0, y: 0, width: 240, height: 240 };

/**
 * The frame is this much larger than its elements on every side.
 *
 * Not for looks. When a playing video is exactly as wide (or as tall) as its
 * window, Chromium takes it for a fullscreen-style video and paints the rest
 * of the window opaque black — in a transparent window, black bars above and
 * below the character. Two pixels of window beside the video are enough to
 * stop it (measured: 240 px video in a 240 px window, black; in a 242 px
 * window, transparent). A margin on the frame means no element can ever span
 * the window, whatever the layout.
 */
export const FRAME_MARGIN = 1;

/** Gap left between a freshly made character and the corner of the screen. */
const DEFAULT_MARGIN = 24;

export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
  );
}

/** The smallest whole-pixel box around every element, plus `FRAME_MARGIN`. */
export function layoutFrame(elements: readonly Rect[]): Rect {
  if (elements.length === 0) return EMPTY_FRAME;
  const left = Math.floor(Math.min(...elements.map((el) => el.x))) - FRAME_MARGIN;
  const top = Math.floor(Math.min(...elements.map((el) => el.y))) - FRAME_MARGIN;
  const right = Math.ceil(Math.max(...elements.map((el) => el.x + el.width))) + FRAME_MARGIN;
  const bottom = Math.ceil(Math.max(...elements.map((el) => el.y + el.height))) + FRAME_MARGIN;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The `character` element, or the whole frame for a layout that has none. */
export function layoutAnchor(elements: readonly (Rect & { type: string })[]): Rect {
  const character = elements.find((el) => el.type === 'character');
  if (!character) return layoutFrame(elements);
  return { x: character.x, y: character.y, width: character.width, height: character.height };
}

/** The anchor inside the window, in window pixels. */
export function anchorInWindow(frame: Rect, anchor: Rect): Rect {
  return {
    x: Math.round(anchor.x - frame.x),
    y: Math.round(anchor.y - frame.y),
    width: Math.round(anchor.width),
    height: Math.round(anchor.height)
  };
}

/** Screen bounds of the window that puts the anchor's top-left at `position`. */
export function placeWindow(frame: Rect, anchor: Rect, position: Point): Rect {
  const inside = anchorInWindow(frame, anchor);
  return {
    x: Math.round(position.x) - inside.x,
    y: Math.round(position.y) - inside.y,
    width: frame.width,
    height: frame.height
  };
}

/** Where the anchor is on screen, given where the window is. The inverse of `placeWindow`. */
export function anchorOnScreen(frame: Rect, anchor: Rect, windowPosition: Point): Point {
  const inside = anchorInWindow(frame, anchor);
  return { x: windowPosition.x + inside.x, y: windowPosition.y + inside.y };
}

/**
 * Keeps the anchor wholly inside the work area, so the character can always
 * be seen and grabbed. The rest of the layout may hang off the edge.
 */
export function clampAnchor(position: Point, anchor: Rect, workArea: Rect): Point {
  const maxX = workArea.x + Math.max(0, workArea.width - anchor.width);
  const maxY = workArea.y + Math.max(0, workArea.height - anchor.height);
  return {
    x: Math.round(Math.min(Math.max(position.x, workArea.x), maxX)),
    y: Math.round(Math.min(Math.max(position.y, workArea.y), maxY))
  };
}

/** Bottom-right corner, for a character nobody has placed yet. */
export function defaultAnchorPosition(anchor: Rect, workArea: Rect): Point {
  return clampAnchor(
    {
      x: workArea.x + workArea.width - anchor.width - DEFAULT_MARGIN,
      y: workArea.y + workArea.height - anchor.height - DEFAULT_MARGIN
    },
    anchor,
    workArea
  );
}

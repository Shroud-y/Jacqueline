/**
 * The arithmetic of the layout canvas: moving and resizing boxes, snapping
 * them to each other, placing new ones. Pure, so it is tested without a page.
 * Every value is in layout pixels; the canvas divides by its zoom before it
 * gets here.
 */

import type { Rect } from './layout';

/** The eight grips on a selected box, by compass point. */
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** No box gets smaller than this, however it is dragged. */
export const MIN_BOX = 16;

export function moveBox(box: Rect, dx: number, dy: number): Rect {
  return { ...box, x: Math.round(box.x + dx), y: Math.round(box.y + dy) };
}

/**
 * The box after its `handle` has been dragged by (dx, dy). The opposite side
 * or corner stays where it was. With `keepRatio` a corner keeps the box's
 * proportions — following whichever way the pointer moved further — and an
 * edge grows the other side about the centre.
 */
export function resizeBox(box: Rect, handle: Handle, dx: number, dy: number, keepRatio = false): Rect {
  let left = box.x;
  let top = box.y;
  let right = box.x + box.width;
  let bottom = box.y + box.height;

  if (handle.includes('w')) left = Math.min(left + dx, right - MIN_BOX);
  if (handle.includes('e')) right = Math.max(right + dx, left + MIN_BOX);
  if (handle.includes('n')) top = Math.min(top + dy, bottom - MIN_BOX);
  if (handle.includes('s')) bottom = Math.max(bottom + dy, top + MIN_BOX);

  if (keepRatio && box.width > 0 && box.height > 0) {
    const ratio = box.width / box.height;
    let width = right - left;
    let height = bottom - top;
    const corner = handle.length === 2;
    if (corner) {
      // Whichever side changed more by proportion leads.
      if (Math.abs(width / box.width - 1) >= Math.abs(height / box.height - 1)) height = width / ratio;
      else width = height * ratio;
      width = Math.max(width, MIN_BOX);
      height = Math.max(height, MIN_BOX);
      if (handle.includes('w')) left = right - width;
      else right = left + width;
      if (handle.includes('n')) top = bottom - height;
      else bottom = top + height;
    } else if (handle === 'e' || handle === 'w') {
      height = Math.max(width / ratio, MIN_BOX);
      const centre = box.y + box.height / 2;
      top = centre - height / 2;
      bottom = centre + height / 2;
    } else {
      width = Math.max(height * ratio, MIN_BOX);
      const centre = box.x + box.width / 2;
      left = centre - width / 2;
      right = centre + width / 2;
    }
  }

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top)
  };
}

/** Lines a box can line up with: its edges and its middle, on each axis. */
function stops(box: Rect): { x: number[]; y: number[] } {
  return {
    x: [box.x, box.x + box.width / 2, box.x + box.width],
    y: [box.y, box.y + box.height / 2, box.y + box.height]
  };
}

export interface Snapped {
  box: Rect;
  /** Where to draw a guide: the x of vertical lines, the y of horizontal ones. */
  guides: { x: number[]; y: number[] };
}

/**
 * Nudges a box being moved so an edge or its middle lines up with an edge or
 * the middle of another box, when it is within `threshold` of one. Each axis
 * snaps on its own, to the nearest candidate.
 */
export function snapBox(box: Rect, others: readonly Rect[], threshold: number): Snapped {
  const own = stops(box);
  const targets = others.map(stops);

  const axis = (key: 'x' | 'y'): { shift: number; at: number | null } => {
    let best: { shift: number; at: number } | null = null;
    for (const target of targets) {
      for (const line of target[key]) {
        for (const mine of own[key]) {
          const shift = line - mine;
          if (Math.abs(shift) <= threshold && (best === null || Math.abs(shift) < Math.abs(best.shift))) {
            best = { shift, at: line };
          }
        }
      }
    }
    return best ?? { shift: 0, at: null };
  };

  const x = axis('x');
  const y = axis('y');
  return {
    box: { ...box, x: Math.round(box.x + x.shift), y: Math.round(box.y + y.shift) },
    guides: { x: x.at === null ? [] : [x.at], y: y.at === null ? [] : [y.at] }
  };
}

/** An id like `speech`, or `speech-2` when that one is taken. */
export function freeElementId(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/**
 * Where a new box goes: to the left of the character if there is nothing
 * there, otherwise below it — next to it either way, never on top.
 */
export function placeBeside(anchor: Rect, size: { width: number; height: number }, others: readonly Rect[]): Rect {
  const gap = 16;
  const left: Rect = { x: anchor.x - gap - size.width, y: anchor.y + Math.round((anchor.height - size.height) / 2), ...size };
  const below: Rect = { x: anchor.x + Math.round((anchor.width - size.width) / 2), y: anchor.y + anchor.height + gap, ...size };
  const overlaps = (a: Rect): boolean =>
    others.some((b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height);
  if (!overlaps(left)) return left;
  if (!overlaps(below)) return below;
  // Everything nearby is taken: below everything there is.
  const bottom = Math.max(anchor.y + anchor.height, ...others.map((other) => other.y + other.height));
  return { ...below, y: bottom + gap };
}

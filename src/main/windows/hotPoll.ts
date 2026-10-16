/**
 * How soon to look at the cursor again. Pure.
 *
 * Checking every 30 ms all day long cost more than everything else a still
 * character does put together (measured: ~1% of a core, in main). But the
 * cursor only needs watching closely when it is near a character: a hand
 * cannot cover 1500 px in less than half a second, so from that far away a
 * check twice a second sees it coming in plenty of time.
 */

import type { Point, Rect } from '@shared/layout';

/** The closest look: under the time a hand takes to stop moving and press. */
export const HOT_POLL_MIN_MS = 30;
/** The furthest apart two looks ever are. */
export const HOT_POLL_MAX_MS = 500;
/** Faster than a hand moves a mouse across a screen with any aim at all. */
const CURSOR_PX_PER_MS = 3;

/** 0 when `point` is inside `rect`. */
export function distanceToRect(point: Point, rect: Rect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/** Time until the cursor could first reach a character `distance` px away, within the limits. */
export function nextPollMs(distance: number): number {
  return Math.round(Math.min(HOT_POLL_MAX_MS, Math.max(HOT_POLL_MIN_MS, distance / CURSOR_PX_PER_MS)));
}

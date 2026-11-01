/** Timing of an animated picture: when each frame is due, and which one comes next. */

/** Below this, browsers have always taken a GIF's delay to mean "no delay given". */
const MIN_FRAME_DELAY_MS = 20;
const DEFAULT_FRAME_DELAY_MS = 100;

/** How long a frame stays up, from its duration in microseconds. */
export function frameDelayMs(durationUs: number | null): number {
  const ms = (durationUs ?? 0) / 1000;
  return ms < MIN_FRAME_DELAY_MS ? DEFAULT_FRAME_DELAY_MS : ms;
}

/** The frame after this one and how long to wait for it. After the last, the rest comes on top. */
export function nextFrame(index: number, count: number, delayMs: number, restSec: number): { index: number; waitMs: number } {
  if (index + 1 < count) return { index: index + 1, waitMs: delayMs };
  return { index: 0, waitMs: delayMs + restSec * 1000 };
}

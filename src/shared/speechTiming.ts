/**
 * How long a line stays up. Shared so that the duration main computes and the
 * reveal the renderer performs cannot drift apart.
 */
export const DEFAULT_MS_PER_CHAR = 28;

export const HOLD_MS = 1800;
export const MIN_DURATION_MS = 3000;
export const MAX_DURATION_MS = 12000;

export function revealMs(text: string, msPerChar = DEFAULT_MS_PER_CHAR): number {
  return text.length * msPerChar;
}

/** chars × msPerChar + hold, clamped. */
export function computeDurationMs(text: string, msPerChar = DEFAULT_MS_PER_CHAR): number {
  return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, revealMs(text, msPerChar) + HOLD_MS));
}

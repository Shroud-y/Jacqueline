/**
 * `{name}` placeholders in phrase text, filled from the payload of the event
 * that triggered the line: "{subject}. I will note the time." becomes
 * "YouTube. I will note the time."
 *
 * Pure, and deliberately dumb — a dotted path into the payload and nothing
 * else. No formatting language, no fallbacks, no expressions: a phrase whose
 * slots cannot all be filled is simply not eligible, so a line never reaches
 * the screen with a hole or a raw `{brace}` in it.
 */

import { SLOT_PATTERN } from '@shared/lines';

function readPath(source: unknown, path: string): unknown {
  let cursor: unknown = source;
  for (const key of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function render(value: unknown): string | null {
  if (typeof value === 'string') return value.trim().length > 0 ? value.trim() : null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.round(value));
  return null;
}

/** Null when any slot in `text` has no usable value in `payload`. */
export function fillSlots(text: string, payload: unknown): string | null {
  let missing = false;
  const filled = text.replace(SLOT_PATTERN, (_match, path: string) => {
    const value = render(readPath(payload, path));
    if (value === null) {
      missing = true;
      return '';
    }
    return value;
  });
  return missing ? null : filled;
}

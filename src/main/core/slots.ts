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

import type { PhraseSegment } from '@shared/types';

const SLOT = /\{([A-Za-z][\w.]*)\}/g;

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
export function fillSlots(text: string, payload: unknown, upperCase = false): string | null {
  let missing = false;
  const filled = text.replace(SLOT, (_match, path: string) => {
    const value = render(readPath(payload, path));
    if (value === null) {
      missing = true;
      return '';
    }
    return upperCase ? value.toUpperCase() : value;
  });
  return missing ? null : filled;
}

/**
 * Fills every segment, or returns null if any one of them cannot be. A rage
 * segment is written in capitals, so what goes into it is capitalised too.
 */
export function fillSegments(segments: PhraseSegment[], payload: unknown): PhraseSegment[] | null {
  const out: PhraseSegment[] = [];
  for (const segment of segments) {
    const text = fillSlots(segment.text, payload, segment.mode === 'rage');
    if (text === null) return null;
    out.push(text === segment.text ? segment : { ...segment, text });
  }
  return out;
}

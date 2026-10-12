/**
 * Reading a time of day as a person types it. Pure and dependency-free, so
 * the settings window and its tests share one definition of "a valid time".
 */

export type ClockResult = { ok: true; value: string } | { ok: false; error: string };

/** 'HH:mm', 24-hour. Forgiving about how it is typed: '8', '8:5', '0800' and '8.30' all mean something. */
export function parseClock(text: string): ClockResult {
  const trimmed = text.trim();
  const match =
    /^(\d{1,2})\s*[:.\-\s]\s*(\d{1,2})$/.exec(trimmed) ?? /^(\d{1,2})(\d{2})$/.exec(trimmed) ?? /^(\d{1,2})()$/.exec(trimmed);
  if (!match) return { ok: false, error: 'Enter a time like 23:00.' };
  const hours = Number(match[1]);
  const minutes = match[2] === '' ? 0 : Number(match[2]);
  if (hours > 23 || minutes > 59) return { ok: false, error: 'Enter a time between 00:00 and 23:59.' };
  return { ok: true, value: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` };
}

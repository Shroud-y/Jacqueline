/** Times of day as rules and quiet hours write them: 'HH:mm', 24-hour. Pure. */

/** Minutes since midnight, or null if malformed. */
export function parseClock(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Handles windows that wrap past midnight (23:00 → 08:00). */
export function isWithinClockWindow(minutesOfDay: number, from: string, to: string): boolean {
  const start = parseClock(from);
  const end = parseClock(to);
  if (start === null || end === null) return false;
  if (start === end) return false;
  if (start < end) return minutesOfDay >= start && minutesOfDay < end;
  return minutesOfDay >= start || minutesOfDay < end;
}

export function minutesOfDay(now: number): number {
  const d = new Date(now);
  return d.getHours() * 60 + d.getMinutes();
}

/** Until the next of two times of day comes round, just past it; null if neither is a time. */
export function msUntilClockChange(now: number, from: string, to: string): number | null {
  const date = new Date(now);
  const sinceMidnight = (date.getHours() * 60 + date.getMinutes()) * 60_000 + date.getSeconds() * 1000 + date.getMilliseconds();
  const waits = [parseClock(from), parseClock(to)].flatMap((clock) => {
    if (clock === null) return [];
    const wait = clock * 60_000 - sinceMidnight;
    return [wait > 0 ? wait : wait + 24 * 60 * 60_000];
  });
  return waits.length > 0 ? Math.min(...waits) + 50 : null;
}

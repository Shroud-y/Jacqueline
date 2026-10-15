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

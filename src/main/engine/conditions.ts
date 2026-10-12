/**
 * §6.3 — a tiny declarative expression system so phrase authors can gate lines
 * without code changes. Pure: no `eval`, no dynamic code, no clock access.
 */

export type Condition =
  | { kind: 'timeOfDay'; from: string; to: string }
  | { kind: 'dayOfWeek'; days: number[] }
  | { kind: 'payloadNumber'; path: string; gt?: number; lt?: number }
  | { kind: 'payloadString'; path: string; equals?: string; oneOf?: string[]; noneOf?: string[] }
  | { kind: 'uptimeMinutes'; gt?: number; lt?: number }
  | { kind: 'firstRun' };

export interface ConditionContext {
  /** Wall-clock instant the decision is being made at. */
  now: number;
  payload: unknown;
  uptimeMinutes: number;
  firstRun: boolean;
  /** Injected so tests do not depend on the host log implementation. */
  warn?: (message: string) => void;
}

/** Parses 'HH:mm' to minutes since midnight, or null if malformed. */
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

function readPath(source: unknown, path: string): unknown {
  if (!path) return undefined;
  let cursor: unknown = source;
  for (const key of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function evaluateOne(condition: Condition, ctx: ConditionContext): boolean {
  switch (condition.kind) {
    case 'timeOfDay':
      return isWithinClockWindow(minutesOfDay(ctx.now), condition.from, condition.to);

    case 'dayOfWeek':
      return condition.days.includes(new Date(ctx.now).getDay());

    case 'payloadNumber': {
      const value = readPath(ctx.payload, condition.path);
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      if (condition.gt !== undefined && !(value > condition.gt)) return false;
      if (condition.lt !== undefined && !(value < condition.lt)) return false;
      return true;
    }

    case 'payloadString': {
      const value = readPath(ctx.payload, condition.path);
      if (typeof value !== 'string') return false;
      if (condition.equals !== undefined && value !== condition.equals) return false;
      if (condition.oneOf !== undefined && !condition.oneOf.includes(value)) return false;
      if (condition.noneOf !== undefined && condition.noneOf.includes(value)) return false;
      return true;
    }

    case 'uptimeMinutes': {
      const value = ctx.uptimeMinutes;
      if (condition.gt !== undefined && !(value > condition.gt)) return false;
      if (condition.lt !== undefined && !(value < condition.lt)) return false;
      return true;
    }

    case 'firstRun':
      return ctx.firstRun;

    default: {
      // Unknown kind: fail closed and say so.
      const kind = (condition as { kind?: unknown }).kind;
      ctx.warn?.(`unknown condition kind "${String(kind)}" — phrase treated as ineligible`);
      return false;
    }
  }
}

export function evaluateConditions(
  conditions: Condition[] | undefined,
  ctx: ConditionContext
): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((c) => evaluateOne(c, ctx));
}

/**
 * Turns a stream of "this is in front now" readings into the few moments worth
 * a remark. Pure: every reading carries its own timestamp, nothing here reads
 * a clock, and nothing leaves but the event list.
 *
 * A window being in front is not news — people alt-tab constantly. What is
 * news is settling somewhere, staying a long time, sliding from work into
 * something else, thrashing between windows, or an application freezing.
 */

import { kindOf, type Activity, type ActivityKind, type Classified, type Tool } from './activity';
import { EventType } from './events';

export interface FocusPayload {
  activity: Activity;
  /** Display name of the application. */
  app: string;
  site?: string;
  /** The site if there is one, otherwise the app — what a line should name. */
  subject: string;
  tool?: Tool;
  /** What the user was settled in before this. */
  from?: Activity;
  /** Whole minutes: time in the activity, or in the stretch that just ended. */
  minutes?: number;
  /** Window switches inside the restless window. */
  count?: number;
}

export interface FocusEvent {
  type: string;
  payload: FocusPayload;
}

export interface FocusReading {
  now: number;
  /** Null for the desktop, the lock screen, or no window at all. */
  sample: Classified | null;
  hung: boolean;
  /** No input for long enough that the user has walked away. */
  idle: boolean;
}

/** In front this long, uninterrupted, counts as having settled there. */
export const SETTLE_MS = 20_000;
/** A different activity has to hold this long to end a long stretch; a glance at the docs does not. */
export const BREAK_MS = 3 * 60_000;
/** Minutes into one activity at which staying there is itself worth a word. */
export const LONG_FOCUS_MINUTES = [45, 90, 150, 240];
export const RESTLESS_WINDOW_MS = 2 * 60_000;
/** Switches inside the window that count as thrashing, and the level it must fall to before it can fire again. */
export const RESTLESS_SWITCHES = 10;
export const RESTLESS_REARM = 4;
/** A window has to stay hung this long: every busy app misses a message or two. */
export const HUNG_CONFIRM_MS = 8_000;
/** Work has to have gone on this long before leaving it reads as drifting off. */
export const DRIFT_MIN_WORK_MS = 25 * 60_000;
/** And leisure this long before coming back reads as a return. */
export const RETURN_MIN_LEISURE_MS = 10 * 60_000;
/** Readings further apart than this are two separate sittings — sleep, or a dead probe. */
export const GAP_MS = 60_000;

interface Run {
  key: string;
  since: number;
}

interface Settled extends Classified {
  since: number;
}

interface Block {
  activity: Activity;
  startedAt: number;
  /** When a different activity settled, if one has; the block survives until it has held for `BREAK_MS`. */
  awaySince: number | null;
  /** The last milestone already reported. */
  reported: number;
}

function subjectOf(sample: Classified): string {
  return sample.site ?? sample.app;
}

function payloadOf(sample: Classified, extra: Partial<FocusPayload> = {}): FocusPayload {
  return {
    activity: sample.activity,
    app: sample.app,
    ...(sample.site ? { site: sample.site } : {}),
    subject: subjectOf(sample),
    ...(sample.tool ? { tool: sample.tool } : {}),
    ...extra
  };
}

export class FocusTracker {
  private lastAt: number | null = null;
  private run: Run | null = null;
  private settled: Settled | null = null;
  private block: Block | null = null;
  private kindRun: { kind: Exclude<ActivityKind, 'neutral'>; since: number } | null = null;
  private switches: number[] = [];
  private restlessArmed = true;
  private lastTool: Tool | null = null;
  private hung: { key: string; since: number; reported: boolean } | null = null;

  update(reading: FocusReading): FocusEvent[] {
    const { now, sample, idle } = reading;
    const events: FocusEvent[] = [];

    if (this.lastAt !== null && now - this.lastAt > GAP_MS) this.forgetSitting();
    this.lastAt = now;

    if (!sample) {
      this.run = null;
      this.hung = null;
      this.lastTool = null;
      return events;
    }

    // Away from the keyboard. A video plays on without input and is still
    // being watched; anything else is a window nobody is looking at, and time
    // in front of it must not count as focus.
    if (idle && sample.activity !== 'video') {
      this.run = null;
      this.block = null;
      this.kindRun = null;
      this.hung = null;
      return events;
    }

    this.trackSwitches(sample, now, events);
    this.trackHung(sample, reading.hung, now, events);

    if (sample.tool) {
      // A tool is opened, used and closed. It gets its remark on sight, and
      // never counts as somewhere the user has settled.
      if (this.lastTool !== sample.tool) {
        this.lastTool = sample.tool;
        events.push({ type: EventType.focusTool, payload: payloadOf(sample) });
      }
      return events;
    }
    this.lastTool = null;

    const run = this.run;
    if (run && now - run.since >= SETTLE_MS && run.key !== this.settled?.key) {
      const previous = this.settled;
      this.settled = { ...sample, since: run.since };
      events.push(this.settleEvent(previous, this.settled));
    }

    if (run && this.settled && run.key === this.settled.key) {
      // The title can change the site's spelling of itself without changing
      // the key; keep what is reported current.
      this.settled = { ...sample, since: this.settled.since };

      // After idleness or a gap the user is back in the same window, so there
      // is no settle to restart these from — and both must count from the
      // return (`run.since`), not from when the window was first settled in.
      const kind = kindOf(sample.activity);
      if (!this.kindRun && kind !== 'neutral') this.kindRun = { kind, since: run.since };
      this.trackBlock(this.settled, run.since, now, events);
    }

    return events;
  }

  private forgetSitting(): void {
    this.run = null;
    this.block = null;
    this.kindRun = null;
    this.switches = [];
    this.restlessArmed = true;
    this.hung = null;
    this.lastTool = null;
  }

  private trackSwitches(sample: Classified, now: number, events: FocusEvent[]): void {
    if (!this.run || this.run.key !== sample.key) {
      if (this.run) this.switches.push(now);
      this.run = { key: sample.key, since: now };
    }
    this.switches = this.switches.filter((at) => now - at <= RESTLESS_WINDOW_MS);

    const count = this.switches.length;
    if (this.restlessArmed && count >= RESTLESS_SWITCHES) {
      this.restlessArmed = false;
      events.push({ type: EventType.focusRestless, payload: payloadOf(sample, { count }) });
    } else if (!this.restlessArmed && count <= RESTLESS_REARM) {
      this.restlessArmed = true;
    }
  }

  private trackHung(sample: Classified, hung: boolean, now: number, events: FocusEvent[]): void {
    if (!hung) {
      this.hung = null;
      return;
    }
    if (!this.hung || this.hung.key !== sample.key) {
      this.hung = { key: sample.key, since: now, reported: false };
      return;
    }
    if (!this.hung.reported && now - this.hung.since >= HUNG_CONFIRM_MS) {
      this.hung.reported = true;
      events.push({ type: EventType.focusHung, payload: payloadOf(sample) });
    }
  }

  /**
   * Settling somewhere new is an `enter` — unless it is also the end of a long
   * stretch of the opposite kind, which is the more interesting thing to say.
   */
  private settleEvent(previous: Settled | null, current: Settled): FocusEvent {
    const from = previous ? { from: previous.activity } : {};
    const kind = kindOf(current.activity);

    if (kind !== 'neutral') {
      const before = this.kindRun;
      if (!before) {
        this.kindRun = { kind, since: current.since };
      } else if (before.kind !== kind) {
        const lastedMs = current.since - before.since;
        this.kindRun = { kind, since: current.since };
        const minutes = Math.round(lastedMs / 60_000);

        if (kind === 'leisure' && lastedMs >= DRIFT_MIN_WORK_MS) {
          return { type: EventType.focusDrift, payload: payloadOf(current, { ...from, minutes }) };
        }
        if (kind === 'work' && lastedMs >= RETURN_MIN_LEISURE_MS) {
          return { type: EventType.focusReturn, payload: payloadOf(current, { ...from, minutes }) };
        }
      }
    }

    return { type: EventType.focusEnter, payload: payloadOf(current, from) };
  }

  private trackBlock(settled: Settled, runSince: number, now: number, events: FocusEvent[]): void {
    const activity = settled.activity;

    if (!this.block) {
      this.block = { activity, startedAt: runSince, awaySince: null, reported: 0 };
    } else if (this.block.activity === activity) {
      this.block.awaySince = null;
    } else {
      if (this.block.awaySince === null) this.block.awaySince = settled.since;
      if (now - this.block.awaySince >= BREAK_MS) {
        this.block = { activity, startedAt: this.block.awaySince, awaySince: null, reported: 0 };
      }
    }

    const block = this.block;
    if (block.activity !== activity) return;

    const minutes = (now - block.startedAt) / 60_000;
    let reached = 0;
    for (const milestone of LONG_FOCUS_MINUTES) {
      if (minutes >= milestone && milestone > block.reported) reached = milestone;
    }
    if (reached > 0) {
      block.reported = reached;
      events.push({ type: EventType.focusLong, payload: payloadOf(settled, { minutes: reached }) });
    }
  }
}

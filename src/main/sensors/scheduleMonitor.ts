import { uptime } from 'node:os';
import type { EventBus } from '../engine/eventBus';
import { EventType, createEvent } from '../engine/events';
import { createLogger } from '../app/logger';
import type { Monitor, SharedScheduler } from './scheduler';

const log = createLogger('monitor:schedule');

const POLL_MS = 60_000;
const WORK_BREAK_MS = 90 * 60_000;
const UPTIME_MILESTONES_HOURS = [24, 72];

/**
 * How long Codex goes unheard before it volunteers something. Nothing else in
 * the bank fires without an external event, so a quiet session in a steady set
 * of apps produces no events at all and the companion is silent for hours.
 * Scaled by the frequency multiplier like every other cooldown.
 */
const QUIET_BASE_MS = 20 * 60_000;
/**
 * A quiet attempt that gets dropped (suppressed, on cooldown, every phrase
 * spent) leaves `lastSpokeAt` untouched, so without a debounce of its own the
 * silence check would re-fire on every single poll.
 */
const QUIET_RETRY_BASE_MS = 10 * 60_000;

function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** §9.5 — wall-clock checks, once a minute. */
export class ScheduleMonitor implements Monitor {
  readonly id = 'schedule';

  private firedToday = new Map<string, string>();
  private lastHourFired = -1;
  private activeSince: number | null = null;
  private lastBreakAt = 0;
  private milestonesFired = new Set<number>();
  private lastQuietAttemptAt = 0;
  private quietRunLogged = false;
  private bootAt = Date.now();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly scheduler: SharedScheduler,
    private readonly isIdle: () => boolean,
    /**
     * When Codex last actually spoke — the `global` cooldown stamp, which
     * survives restarts. `undefined` on a first ever run.
     */
    private readonly lastSpokeAt: () => number | undefined = () => undefined,
    private readonly frequencyMultiplier: () => number = () => 1
  ) {}

  start(bus: EventBus): void {
    this.bootAt = Date.now();
    this.unsubscribe = this.scheduler.every(POLL_MS, (now) => this.poll(bus, now));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private checkQuiet(bus: EventBus, now: number): void {
    const multiplier = this.frequencyMultiplier();
    const quietMs = QUIET_BASE_MS * multiplier;
    const retryMs = QUIET_RETRY_BASE_MS * multiplier;
    if (quietMs <= 0) return;

    // A clock that jumped backwards must not lock the check out forever.
    const spokeAt = this.lastSpokeAt() ?? 0;
    const since = Math.max(spokeAt <= now ? spokeAt : 0, this.bootAt);
    if (now - since < quietMs) {
      // Codex spoke, so the next stretch of silence is a new run.
      this.quietRunLogged = false;
      return;
    }
    if (this.lastQuietAttemptAt !== 0 && now - this.lastQuietAttemptAt < retryMs) return;

    this.lastQuietAttemptAt = now;
    const silentForMs = now - since;
    // At info deliberately: the event is `ambient`, so a drop is only reported
    // at `debug`, which a packaged build discards — this line is the one piece
    // of evidence that the silence timer is alive at all. Only the first
    // attempt of a run is logged, or a long suppressed stretch (a game, a call)
    // would write a line every retry for hours.
    if (!this.quietRunLogged) {
      this.quietRunLogged = true;
      log.info(`silence timer fired after ${Math.round(silentForMs / 60_000)} min`);
    }
    bus.emit(createEvent(EventType.scheduleQuiet, 'ambient', { silentForMs }, now));
  }

  private oncePerDay(key: string, now: number): boolean {
    const today = dayKey(now);
    if (this.firedToday.get(key) === today) return false;
    this.firedToday.set(key, today);
    return true;
  }

  private poll(bus: EventBus, now: number): void {
    const date = new Date(now);
    const hour = date.getHours();
    const idle = this.isIdle();

    // Time of day — each fires at most once per calendar day, and only while
    // the user is actually at the machine.
    if (!idle) {
      if (hour >= 5 && hour < 12 && this.oncePerDay('morning', now)) {
        bus.emit(createEvent(EventType.scheduleMorning, 'ambient', { hour }, now));
      }
      if (hour >= 19 && hour < 23 && this.oncePerDay('evening', now)) {
        bus.emit(createEvent(EventType.scheduleEvening, 'ambient', { hour }, now));
      }
      if ((hour >= 1 && hour < 5) && this.oncePerDay('night', now)) {
        bus.emit(createEvent(EventType.scheduleNight, 'ambient', { hour }, now));
      }
      if (hour !== this.lastHourFired && date.getMinutes() === 0) {
        this.lastHourFired = hour;
        bus.emit(createEvent(EventType.scheduleHourly, 'ambient', { hour }, now));
      }
    }

    // Continuous non-idle activity → break reminder.
    if (idle) {
      this.activeSince = null;
    } else {
      this.activeSince ??= now;
      const activeFor = now - this.activeSince;
      if (activeFor >= WORK_BREAK_MS && now - this.lastBreakAt >= WORK_BREAK_MS) {
        this.lastBreakAt = now;
        bus.emit(
          createEvent(
            EventType.scheduleWorkBreak,
            'notable',
            { activeMs: activeFor, activeMinutes: Math.round(activeFor / 60_000) },
            now
          )
        );
      }
    }

    // Nothing has been said for a long time — volunteer something. Measured
    // from the later of boot and the last line, so a restart after a long
    // silence does not fire the moment the first poll lands.
    if (!idle) this.checkQuiet(bus, now);

    // Machine uptime milestones.
    const uptimeHours = uptime() / 3600;
    for (const milestone of UPTIME_MILESTONES_HOURS) {
      if (uptimeHours >= milestone && !this.milestonesFired.has(milestone)) {
        this.milestonesFired.add(milestone);
        bus.emit(
          createEvent(EventType.scheduleUptimeMilestone, 'ambient', { hours: milestone }, now)
        );
      }
    }
  }
}

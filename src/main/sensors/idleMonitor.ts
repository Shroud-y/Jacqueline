import { powerMonitor } from 'electron';
import type { EventBus } from '../engine/eventBus';
import { EventType, createEvent } from '../engine/events';
import type { Monitor, SharedScheduler } from './scheduler';

const POLL_MS = 30_000;
const IDLE_THRESHOLD_MS = 10 * 60_000;

/**
 * §9.3 — `session.idle.exit` carries `awayMs`, which is what lets the phrase
 * bank vary the greeting by absence length.
 */
export class IdleMonitor implements Monitor {
  readonly id = 'idle';

  private idle = false;
  private idleSince: number | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly scheduler: SharedScheduler) {}

  start(bus: EventBus): void {
    this.unsubscribe = this.scheduler.every(POLL_MS, (now) => this.poll(bus, now));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private poll(bus: EventBus, now: number): void {
    const idleMs = powerMonitor.getSystemIdleTime() * 1000;

    if (!this.idle && idleMs >= IDLE_THRESHOLD_MS) {
      this.idle = true;
      this.idleSince = now - idleMs;
      bus.emit(createEvent(EventType.sessionIdleEnter, 'ambient', { idleMs }, now));
      return;
    }

    if (this.idle && idleMs < IDLE_THRESHOLD_MS) {
      const awayMs = this.idleSince === null ? IDLE_THRESHOLD_MS : now - this.idleSince - idleMs;
      this.idle = false;
      this.idleSince = null;
      bus.emit(
        createEvent(
          EventType.sessionIdleExit,
          'notable',
          { awayMs: Math.max(IDLE_THRESHOLD_MS, awayMs) },
          now
        )
      );
    }
  }

  /** Used by the schedule monitor's work-break tracking. */
  get isIdle(): boolean {
    return this.idle;
  }
}

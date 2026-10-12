import type { EventBus } from '../engine/eventBus';

export interface Monitor {
  readonly id: string;
  start(bus: EventBus): void | Promise<void>;
  stop(): void | Promise<void>;
}

/**
 * §9 — all polling runs off one shared tick rather than a timer per monitor.
 * Monitors register the interval they want; the scheduler fires them on the
 * nearest multiple of the base tick.
 */
export class SharedScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticks = 0;
  private readonly jobs: { everyTicks: number; run: (now: number) => void | Promise<void> }[] = [];

  constructor(private readonly baseIntervalMs = 5_000) {}

  /** `intervalMs` is rounded up to a whole number of base ticks. */
  every(intervalMs: number, run: (now: number) => void | Promise<void>): () => void {
    const everyTicks = Math.max(1, Math.round(intervalMs / this.baseIntervalMs));
    const job = { everyTicks, run };
    this.jobs.push(job);
    return () => {
      const index = this.jobs.indexOf(job);
      if (index >= 0) this.jobs.splice(index, 1);
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.ticks += 1;
      const now = Date.now();
      for (const job of this.jobs) {
        if (this.ticks % job.everyTicks !== 0) continue;
        try {
          const result = job.run(now);
          if (result instanceof Promise) {
            result.catch((err) => console.error('[scheduler] job failed:', err));
          }
        } catch (err) {
          console.error('[scheduler] job threw:', err);
        }
      }
    }, this.baseIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/**
 * Edge trigger with hysteresis: fires when a value crosses `high`, and only
 * re-arms once it falls back below `low`. Level-triggered checks flood the bus.
 */
export class Hysteresis {
  private armed = true;

  constructor(
    private readonly high: number,
    private readonly low: number
  ) {}

  /** Returns true exactly on the rising edge. */
  update(value: number): boolean {
    if (this.armed && value > this.high) {
      this.armed = false;
      return true;
    }
    if (!this.armed && value < this.low) this.armed = true;
    return false;
  }

  get engaged(): boolean {
    return !this.armed;
  }
}

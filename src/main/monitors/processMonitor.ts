import type { EventBus } from '../core/eventBus';
import { EventType, createEvent } from '../core/events';
import { createLogger } from '../log/logger';
import type { Monitor, SharedScheduler } from './Monitor';

const log = createLogger('monitor:process');

const POLL_MS = 20_000;
const LONG_RUNNING_MS = 4 * 60 * 60_000;

/** Returns the running executables, or null when the reading is unavailable. */
export type ProcessLister = () => Promise<Set<string> | null>;

/**
 * The watchlist is written `chrome.exe` and the reading comes back `chrome`.
 * Comparing stems means neither spelling has to be the canonical one, and a
 * user who types the extension — or forgets it — matches either way.
 */
export function processStem(name: string): string {
  const lower = name.trim().toLowerCase();
  return lower.endsWith('.exe') ? lower.slice(0, -'.exe'.length) : lower;
}

/**
 * §9.2 — diff a set of running executables against the previous tick, but only
 * for watchlisted names. Emitting every process would bury the bus.
 */
export class ProcessMonitor implements Monitor {
  readonly id = 'process';

  /** Keyed by stem, so respelling a watchlist entry is not a stop and a start. */
  private running = new Map<string, { label: string; startedAt: number }>();
  private longRunningReported = new Set<string>();
  /**
   * Stems that were on the watchlist at the previous tick. A process that only
   * now became watched is baseline, not news — it may have been running for
   * hours. Empty before the first tick, which makes that tick the baseline.
   */
  private watched = new Set<string>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly scheduler: SharedScheduler,
    private readonly getWatchlist: () => string[],
    private readonly listProcesses: ProcessLister
  ) {}

  start(bus: EventBus): void {
    this.unsubscribe = this.scheduler.every(POLL_MS, (now) => this.poll(bus, now));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private async poll(bus: EventBus, now: number): Promise<void> {
    // Keyed by stem, valued by the spelling the user wrote — events carry the
    // watchlist's own wording rather than whatever the reading happened to use.
    const watchlist = new Map<string, string>();
    for (const entry of this.getWatchlist()) {
      const stem = processStem(entry);
      if (stem.length > 0) watchlist.set(stem, entry.trim().toLowerCase());
    }

    // An entry taken off the list is forgotten quietly: it did not stop, the
    // user just stopped asking about it.
    for (const stem of [...this.running.keys()]) {
      if (!watchlist.has(stem)) this.forget(stem);
    }
    if (watchlist.size === 0) {
      this.watched = new Set();
      return;
    }

    let running: Set<string> | null;
    try {
      running = await this.listProcesses();
    } catch (err) {
      log.debug(`process poll failed: ${String(err)}`);
      return;
    }
    // No reading is not the same as "nothing is running": treating it as an
    // empty set would fire a stopped event for everything on the watchlist.
    if (running === null) return;

    const present = new Set<string>();
    for (const entry of running) {
      const stem = processStem(entry);
      if (watchlist.has(stem)) present.add(stem);
    }

    const previouslyWatched = this.watched;
    this.watched = new Set(watchlist.keys());

    for (const stem of present) {
      const label = watchlist.get(stem)!;
      const known = this.running.get(stem);
      if (known) {
        known.label = label;
        continue;
      }
      this.running.set(stem, { label, startedAt: now });
      if (previouslyWatched.has(stem)) {
        bus.emit(createEvent(EventType.processStarted, 'ambient', { name: label }, now));
      }
    }

    for (const [stem, { label, startedAt }] of [...this.running]) {
      if (!present.has(stem)) {
        this.forget(stem);
        bus.emit(
          createEvent(EventType.processStopped, 'ambient', { name: label, ranForMs: now - startedAt }, now)
        );
        continue;
      }
      if (now - startedAt >= LONG_RUNNING_MS && !this.longRunningReported.has(stem)) {
        this.longRunningReported.add(stem);
        bus.emit(
          createEvent(
            EventType.processLongRunning,
            'ambient',
            { name: label, ranForMs: now - startedAt, hours: (now - startedAt) / 3_600_000 },
            now
          )
        );
      }
    }
  }

  private forget(stem: string): void {
    this.running.delete(stem);
    this.longRunningReported.delete(stem);
  }
}

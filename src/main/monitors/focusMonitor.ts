import { classify, type ForegroundSample } from '../core/activity';
import type { EventBus } from '../core/eventBus';
import { createEvent, defaultPriorityFor } from '../core/events';
import { FocusTracker } from '../core/focusTracker';
import { createLogger } from '../log/logger';
import type { Monitor, SharedScheduler } from './Monitor';

const log = createLogger('monitor:focus');

/**
 * Every base tick. The question costs about fifteen milliseconds in the
 * already-running probe host, and anything slower would miss the tools people
 * open for a few seconds — which are exactly the ones worth noticing.
 */
const POLL_MS = 5_000;

/**
 * The window in front; `'none'` when there is no such window (or it is
 * nobody's); null when there is no reading at all this tick, which is not the
 * same thing and must not be mistaken for it.
 */
export type ForegroundReader = () => Promise<ForegroundSample | 'none' | null>;

/**
 * What the user is doing, judged from the foreground window: which
 * application, which site, for how long. See `FocusTracker` for what counts
 * as worth saying and `activity.ts` for how a window is read.
 *
 * The window title is read here and goes no further. Events carry the
 * activity, the application's name and the site — never the title.
 */
export class FocusMonitor implements Monitor {
  readonly id = 'focus';

  private tracker = new FocusTracker();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly scheduler: SharedScheduler,
    private readonly readForeground: ForegroundReader,
    private readonly isIdle: () => boolean,
    /** This app's own main process, so its settings window is recognised. */
    private readonly selfPid: number
  ) {}

  start(bus: EventBus): void {
    this.tracker = new FocusTracker();
    this.unsubscribe = this.scheduler.every(POLL_MS, (now) => this.poll(bus, now));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private async poll(bus: EventBus, now: number): Promise<void> {
    let reading: ForegroundSample | 'none' | null;
    try {
      reading = await this.readForeground();
    } catch (err) {
      log.debug(`focus poll failed: ${String(err)}`);
      return;
    }
    // No reading is a gap, not an empty desktop: the tracker notices the
    // silence by itself and starts a fresh sitting when readings resume.
    if (reading === null) return;

    const sample = reading === 'none' ? null : classify(reading, this.selfPid);
    const events = this.tracker.update({
      now,
      sample,
      hung: reading !== 'none' && reading.hung,
      idle: this.isIdle()
    });
    for (const event of events) {
      // Type and activity only. The app and site are on the event for the
      // phrase to use; they have no business in a log.
      log.debug(`${event.type} (${event.payload.activity})`);
      bus.emit(createEvent(event.type, defaultPriorityFor(event.type), event.payload, now));
    }
  }
}

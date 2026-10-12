import { powerMonitor } from 'electron';
import type { EventBus } from '../engine/eventBus';
import { EventType, createEvent } from '../engine/events';
import { STARTUP_GREETING_DELAY_MS } from '../engine/suppression';
import type { Monitor } from './scheduler';

/**
 * §9.4 — `app` and `powerMonitor` lifecycle. The startup greeting fires at
 * +25 s, the one documented exception to the 30 s post-boot blackout (§8.5).
 */
export class SessionMonitor implements Monitor {
  readonly id = 'session';

  private handlers: { event: string; handler: () => void }[] = [];
  private startupTimer: NodeJS.Timeout | null = null;

  start(bus: EventBus): void {
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      bus.emit(createEvent(EventType.sessionStartup, 'notable', {}, Date.now()));
    }, STARTUP_GREETING_DELAY_MS);
    this.startupTimer.unref?.();

    this.bind('resume', () =>
      bus.emit(createEvent(EventType.sessionResume, 'notable', {}, Date.now()))
    );
    this.bind('lock-screen', () =>
      bus.emit(createEvent(EventType.sessionLock, 'ambient', {}, Date.now()))
    );
    this.bind('unlock-screen', () =>
      bus.emit(createEvent(EventType.sessionUnlock, 'notable', {}, Date.now()))
    );
  }

  stop(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    for (const { event, handler } of this.handlers) {
      powerMonitor.off(event as Parameters<typeof powerMonitor.off>[0], handler);
    }
    this.handlers = [];
  }

  private bind(event: string, handler: () => void): void {
    powerMonitor.on(event as Parameters<typeof powerMonitor.on>[0], handler);
    this.handlers.push({ event, handler });
  }
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@main/engine/eventBus';
import { EventType, type AppEvent } from '@main/engine/events';
import { ScheduleMonitor } from '@main/sensors/scheduleMonitor';
import { SharedScheduler } from '@main/sensors/scheduler';

const MINUTE = 60_000;

/** Drives the monitor's poll directly; the shared scheduler is not under test. */
function harness(options: {
  idle?: boolean;
  lastSpokeAt?: number | undefined;
  multiplier?: number;
}) {
  const bus = new EventBus();
  const quiet: AppEvent[] = [];
  bus.on(EventType.scheduleQuiet, (event: AppEvent) => quiet.push(event));

  let idle = options.idle ?? false;
  let lastSpokeAt = options.lastSpokeAt;

  const monitor = new ScheduleMonitor(
    new SharedScheduler(5_000),
    () => idle,
    () => lastSpokeAt,
    () => options.multiplier ?? 1
  );

  // `poll` is private; the monitor is only reachable through its tick.
  const poll = (now: number): void =>
    (monitor as unknown as { poll: (bus: EventBus, now: number) => void }).poll(bus, now);

  return {
    quiet,
    poll,
    setIdle: (value: boolean) => (idle = value),
    setLastSpokeAt: (value: number | undefined) => (lastSpokeAt = value),
    boot: (at: number) => {
      vi.setSystemTime(at);
      monitor.start(bus);
    }
  };
}

describe('ScheduleMonitor — silence timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('stays quiet until the threshold has passed', () => {
    const h = harness({ multiplier: 1 });
    h.boot(0);
    h.setLastSpokeAt(0);

    h.poll(19 * MINUTE);
    expect(h.quiet).toHaveLength(0);

    h.poll(20 * MINUTE);
    expect(h.quiet).toHaveLength(1);
    expect(h.quiet[0]!.payload).toMatchObject({ silentForMs: 20 * MINUTE });
  });

  it('scales the threshold by the frequency multiplier', () => {
    const chatty = harness({ multiplier: 0.5 });
    chatty.boot(0);
    chatty.setLastSpokeAt(0);
    chatty.poll(10 * MINUTE);
    expect(chatty.quiet).toHaveLength(1);

    const rare = harness({ multiplier: 4 });
    rare.boot(0);
    rare.setLastSpokeAt(0);
    rare.poll(10 * MINUTE);
    expect(rare.quiet).toHaveLength(0);
    rare.poll(81 * MINUTE);
    expect(rare.quiet).toHaveLength(1);
  });

  it('does not re-fire every poll when the line was dropped', () => {
    // A dropped line never stamps `global`, so lastSpokeAt stays put.
    const h = harness({ multiplier: 1 });
    h.boot(0);
    h.setLastSpokeAt(0);

    h.poll(20 * MINUTE);
    expect(h.quiet).toHaveLength(1);

    for (let m = 21; m <= 29; m++) h.poll(m * MINUTE);
    expect(h.quiet).toHaveLength(1);

    h.poll(30 * MINUTE);
    expect(h.quiet).toHaveLength(2);
  });

  it('resets once Codex actually speaks', () => {
    const h = harness({ multiplier: 1 });
    h.boot(0);
    h.setLastSpokeAt(0);

    h.poll(20 * MINUTE);
    expect(h.quiet).toHaveLength(1);

    h.setLastSpokeAt(20 * MINUTE);
    h.poll(35 * MINUTE);
    expect(h.quiet).toHaveLength(1);

    h.poll(41 * MINUTE);
    expect(h.quiet).toHaveLength(2);
  });

  it('keeps retrying a suppressed run, then resets once Codex speaks', () => {
    const h = harness({ multiplier: 1 });
    h.boot(0);
    h.setLastSpokeAt(0);

    // Three suppressed retries in a row emit three events...
    h.poll(20 * MINUTE);
    h.poll(30 * MINUTE);
    h.poll(40 * MINUTE);
    expect(h.quiet).toHaveLength(3);

    // ...and once Codex finally speaks, the run resets so the next stretch
    // starts fresh rather than counting as a continued retry.
    h.setLastSpokeAt(40 * MINUTE);
    h.poll(45 * MINUTE);
    expect(h.quiet).toHaveLength(3);
    h.poll(61 * MINUTE);
    expect(h.quiet).toHaveLength(4);
  });

  it('never talks to an empty room', () => {
    const h = harness({ multiplier: 1, idle: true });
    h.boot(0);
    h.setLastSpokeAt(0);

    h.poll(120 * MINUTE);
    expect(h.quiet).toHaveLength(0);

    h.setIdle(false);
    h.poll(121 * MINUTE);
    expect(h.quiet).toHaveLength(1);
  });

  it('measures from boot, not from a stale stamp restored off disk', () => {
    // Restarting after a long silence must not fire on the first poll.
    const h = harness({ multiplier: 1 });
    h.boot(10 * 60 * MINUTE);
    h.setLastSpokeAt(0);

    h.poll(10 * 60 * MINUTE + MINUTE);
    expect(h.quiet).toHaveLength(0);

    h.poll(10 * 60 * MINUTE + 20 * MINUTE);
    expect(h.quiet).toHaveLength(1);
  });

  it('survives a clock that jumped backwards', () => {
    const h = harness({ multiplier: 1 });
    h.boot(0);
    h.setLastSpokeAt(500 * MINUTE); // stamp in the future

    h.poll(20 * MINUTE);
    expect(h.quiet).toHaveLength(1);
  });

  it('handles a first ever run with no stamp at all', () => {
    const h = harness({ multiplier: 1 });
    h.boot(0);
    h.setLastSpokeAt(undefined);

    h.poll(19 * MINUTE);
    expect(h.quiet).toHaveLength(0);
    h.poll(20 * MINUTE);
    expect(h.quiet).toHaveLength(1);
  });
});

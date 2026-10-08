import { describe, expect, it } from 'vitest';
import { EventBus } from '@main/core/eventBus';
import { EventType, type AppEvent } from '@main/core/events';
import { SharedScheduler } from '@main/monitors/Monitor';
import { ProcessMonitor } from '@main/monitors/processMonitor';
import { SystemMonitor, type BatteryReading } from '@main/monitors/systemMonitor';

function collect(bus: EventBus, pattern: string): AppEvent[] {
  const events: AppEvent[] = [];
  bus.on(pattern, (event) => events.push(event));
  return events;
}

describe('SystemMonitor — battery', () => {
  function harness() {
    const bus = new EventBus();
    const low = collect(bus, EventType.systemBatteryLow);
    let reading: BatteryReading = { present: true, discharging: true, percent: 100 };
    const monitor = new SystemMonitor(new SharedScheduler(5_000), {
      temperature: async () => null,
      battery: async () => reading,
      drives: async () => null
    });
    // `pollBattery` is private; the monitor is only reachable through its tick.
    const poll = (percent: number, discharging: boolean): Promise<void> => {
      reading = { present: true, discharging, percent };
      return (
        monitor as unknown as { pollBattery: (bus: EventBus, now: number) => Promise<void> }
      ).pollBattery(bus, 0);
    };
    return { low, poll };
  }

  it('warns once when a discharging battery drops below 20 %', async () => {
    const h = harness();
    await h.poll(50, true);
    await h.poll(19, true);
    await h.poll(15, true);
    expect(h.low).toHaveLength(1);
  });

  it('still warns after the charger was plugged in briefly', async () => {
    const h = harness();
    await h.poll(25, true);
    await h.poll(26, false);
    await h.poll(26, true);
    await h.poll(19, true);
    expect(h.low).toHaveLength(1);
  });

  it('warns on unplugging when the battery is already low', async () => {
    const h = harness();
    await h.poll(15, false);
    await h.poll(16, true);
    expect(h.low).toHaveLength(1);
  });

  it('does not repeat while the cable is jiggled at a low charge', async () => {
    const h = harness();
    await h.poll(15, true);
    await h.poll(15, false);
    await h.poll(15, true);
    expect(h.low).toHaveLength(1);
  });
});

describe('ProcessMonitor — watchlist edits', () => {
  function harness(initialWatchlist: string[]) {
    const bus = new EventBus();
    const started = collect(bus, EventType.processStarted);
    const stopped = collect(bus, EventType.processStopped);
    let watchlist = initialWatchlist;
    let running = new Set<string>();
    const monitor = new ProcessMonitor(
      new SharedScheduler(5_000),
      () => watchlist,
      async () => running
    );
    let now = 0;
    const poll = (names: string[]): Promise<void> => {
      running = new Set(names);
      now += 20_000;
      return (monitor as unknown as { poll: (bus: EventBus, now: number) => Promise<void> }).poll(
        bus,
        now
      );
    };
    return { started, stopped, poll, setWatchlist: (next: string[]) => (watchlist = next) };
  }

  it('reports a watched process starting and stopping', async () => {
    const h = harness(['chrome.exe']);
    await h.poll([]);
    await h.poll(['chrome']);
    await h.poll([]);
    expect(h.started.map((e) => e.payload)).toEqual([{ name: 'chrome.exe' }]);
    expect(h.stopped).toHaveLength(1);
  });

  it('does not report a stop when a running process is removed from the watchlist', async () => {
    const h = harness(['chrome.exe']);
    await h.poll(['chrome']);
    h.setWatchlist(['steam.exe']);
    await h.poll(['chrome']);
    expect(h.stopped).toHaveLength(0);

    // Back on the list while still running: not a fresh start either.
    h.setWatchlist(['steam.exe', 'chrome.exe']);
    await h.poll(['chrome']);
    expect(h.started).toHaveLength(0);
  });

  it('does not report a start when an already running process is added to the watchlist', async () => {
    const h = harness(['chrome.exe']);
    await h.poll(['chrome', 'spotify']);
    h.setWatchlist(['chrome.exe', 'Spotify.exe']);
    await h.poll(['chrome', 'spotify']);
    expect(h.started).toHaveLength(0);

    // Once it is on the list, a real stop and restart are news again.
    await h.poll(['chrome']);
    await h.poll(['chrome', 'spotify']);
    expect(h.stopped).toHaveLength(1);
    expect(h.started.map((e) => e.payload)).toEqual([{ name: 'spotify.exe' }]);
  });

  it('treats a respelt entry as the same process', async () => {
    const h = harness(['chrome.exe']);
    await h.poll(['chrome']);
    h.setWatchlist(['Chrome']);
    await h.poll(['chrome']);
    expect(h.started).toHaveLength(0);
    expect(h.stopped).toHaveLength(0);
  });
});

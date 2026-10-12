import { describe, expect, it } from 'vitest';
import { EventBus } from '@main/core/eventBus';
import { EventType, type AppEvent } from '@main/core/events';
import type { AppKind } from '@shared/types';
import type { ForegroundSample } from '@main/core/activity';
import { FocusMonitor } from '@main/monitors/focusMonitor';
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
    const kinds: Record<string, AppKind> = {};
    let running = new Set<string>();
    const monitor = new ProcessMonitor(
      new SharedScheduler(5_000),
      () => watchlist.map((name) => ({ name, kind: kinds[name] ?? 'app' })),
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
    return {
      started,
      stopped,
      poll,
      setWatchlist: (next: string[]) => (watchlist = next),
      setKind: (name: string, kind: AppKind) => (kinds[name] = kind)
    };
  }

  it('reports a watched process starting and stopping', async () => {
    const h = harness(['chrome.exe']);
    await h.poll([]);
    await h.poll(['chrome']);
    await h.poll([]);
    expect(h.started.map((e) => e.payload)).toEqual([{ name: 'chrome.exe', kind: 'app' }]);
    expect(h.stopped).toHaveLength(1);
  });

  it('says what kind of application it is, as the watch list describes it', async () => {
    const h = harness(['MyGame.exe']);
    h.setKind('MyGame.exe', 'game');
    await h.poll([]);
    await h.poll(['mygame']);
    await h.poll([]);
    expect(h.started[0]?.payload).toMatchObject({ name: 'mygame.exe', kind: 'game' });
    expect(h.stopped[0]?.payload).toMatchObject({ name: 'mygame.exe', kind: 'game' });
  });

  it('reports the stop under the kind it has now, not the one it started with', async () => {
    const h = harness(['MyGame.exe']);
    await h.poll([]);
    await h.poll(['mygame']);
    // Re-classified in settings while it is still running.
    h.setKind('MyGame.exe', 'game');
    await h.poll(['mygame']);
    await h.poll([]);
    expect(h.stopped[0]?.payload).toMatchObject({ kind: 'game' });
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
    expect(h.started.map((e) => e.payload)).toEqual([{ name: 'spotify.exe', kind: 'app' }]);
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

describe('FocusMonitor', () => {
  const TICK = 5_000;

  const window = (process: string, title: string, hung = false): ForegroundSample => ({
    pid: 500,
    process,
    hung,
    windowClass: 'Window',
    title,
    description: ''
  });

  function harness(options: { selfPid?: number } = {}) {
    const bus = new EventBus();
    const events = collect(bus, 'focus.*');
    let reading: ForegroundSample | 'none' | null = null;
    let idle = false;
    let now = 1_000_000;
    const monitor = new FocusMonitor(
      new SharedScheduler(TICK),
      async () => reading,
      () => idle,
      options.selfPid ?? -1
    );
    // `poll` is private; the monitor is only reachable through its tick.
    const poll = monitor as unknown as { poll: (bus: EventBus, now: number) => Promise<void> };

    /** Holds one window in front for `ms`, a probe tick at a time. */
    const hold = async (next: ForegroundSample | 'none' | null, ms: number): Promise<void> => {
      reading = next;
      for (let elapsed = 0; elapsed <= ms; elapsed += TICK) {
        await poll.poll(bus, now);
        now += TICK;
      }
    };

    return { events, hold, setIdle: (value: boolean) => (idle = value) };
  }

  it('emits an enter for a window that stays in front, at the priority the event type declares', async () => {
    const h = harness();
    await h.hold(window('chrome', 'A long video - YouTube - Google Chrome'), 30_000);

    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({
      type: EventType.focusEnter,
      priority: 'ambient',
      payload: { activity: 'video', app: 'Chrome', site: 'YouTube', subject: 'YouTube' }
    });
  });

  it('keeps the window title off the bus', async () => {
    const h = harness();
    await h.hold(window('chrome', 'bank statement october - Gmail - Google Chrome'), 30_000);
    expect(JSON.stringify(h.events)).not.toContain('statement');
  });

  it('emits nothing while there is no reading at all', async () => {
    const h = harness();
    await h.hold(null, 60_000);
    expect(h.events).toEqual([]);
  });

  it('emits nothing for an empty desktop', async () => {
    const h = harness();
    await h.hold('none', 60_000);
    expect(h.events).toEqual([]);
  });

  it('does not count a window nobody is sitting at', async () => {
    const h = harness();
    h.setIdle(true);
    await h.hold(window('code', 'index.ts - shard - Visual Studio Code'), 60_000);
    expect(h.events).toEqual([]);
  });

  it('reports a frozen window as notable', async () => {
    const h = harness();
    await h.hold(window('blender', 'Blender', true), 20_000);
    expect(h.events.find((event) => event.type === EventType.focusHung)).toMatchObject({
      priority: 'notable',
      payload: { app: 'Blender' }
    });
  });

  it('recognises its own settings window', async () => {
    const h = harness({ selfPid: 500 });
    await h.hold(window('electron', 'SHARD — Settings'), 0);
    expect(h.events[0]).toMatchObject({ type: EventType.focusTool, payload: { tool: 'self' } });
  });
});

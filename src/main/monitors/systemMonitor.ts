import { cpus, freemem, totalmem } from 'node:os';
import type { EventBus } from '../core/eventBus';
import { EventType, createEvent } from '../core/events';
import { createLogger } from '../log/logger';
import { Hysteresis, type Monitor, type SharedScheduler } from './Monitor';

const log = createLogger('monitor:system');

const POLL_MS = 15_000;
const DISK_POLL_MS = 30 * 60_000;
/**
 * A percentage that only matters at the 20 % mark does not need fifteen-second
 * resolution, and this is the one reading that still costs a WMI query. At the
 * slowest plausible discharge the alert is late by well under a minute.
 */
const BATTERY_POLL_MS = 5 * 60_000;
/**
 * One early battery and disk reading, since both intervals are far too long to
 * wait out on a machine booted nearly flat. Later than the probe host's own
 * 90 s start delay, because it is asked through that host.
 */
const EARLY_PASS_MS = 120_000;

const CPU_HIGH = 85;
const CPU_REARM = 60;
const MEMORY_HIGH = 90;
const MEMORY_REARM = 75;
const TEMPERATURE_HIGH = 85;
const TEMPERATURE_REARM = 75;
const SUSTAINED_MS = 3 * 60_000;
const DISK_LOW_BYTES = 10 * 1024 ** 3;
const BATTERY_LOW_PERCENT = 20;

/** A drive as the probe reports it: bytes free, and the total it is free of. */
export interface DriveSpace {
  mount: string;
  free: number;
  size: number;
}

/**
 * A temperature in Celsius, or `'unsupported'` when the machine has told us it
 * has no thermal zone. Distinct from `null`, which only means "no reading this
 * tick" — the probe host does not start until 90 s in, and treating its
 * silence as "no sensor" would disable thermal checks for the whole session on
 * a machine that has one.
 */
export type TemperatureReading = number | 'unsupported';

/** `percent` is meaningless when `present` is false. */
export interface BatteryReading {
  present: boolean;
  discharging: boolean;
  percent: number;
}

/**
 * The readings this monitor cannot take itself. Each returns null when the
 * answer is unavailable, which is always treated as "no reading this tick"
 * rather than as a value — see `PresenceProbe`.
 */
export interface SystemQueries {
  temperature: () => Promise<TemperatureReading | null>;
  battery: () => Promise<BatteryReading | null>;
  drives: () => Promise<DriveSpace[] | null>;
}

export class SystemMonitor implements Monitor {
  readonly id = 'system';

  private readonly cpu = new Hysteresis(CPU_HIGH, CPU_REARM);
  private readonly memory = new Hysteresis(MEMORY_HIGH, MEMORY_REARM);
  private readonly temperature = new Hysteresis(TEMPERATURE_HIGH, TEMPERATURE_REARM);
  private readonly battery = new Hysteresis(-BATTERY_LOW_PERCENT, -(BATTERY_LOW_PERCENT + 10));

  private cpuHighSince: number | null = null;
  private sustainedFired = false;
  private temperatureSupported = true;
  private batterySupported = true;
  private diskLowDrives = new Set<string>();
  private unsubscribe: (() => void)[] = [];
  /** CPU load is a delta between two readings, so the first tick has no answer. */
  private lastTicks: { busy: number; total: number } | null = null;

  constructor(
    private readonly scheduler: SharedScheduler,
    private readonly queries: SystemQueries
  ) {}

  start(bus: EventBus): void {
    this.unsubscribe.push(this.scheduler.every(POLL_MS, (now) => this.poll(bus, now)));
    this.unsubscribe.push(this.scheduler.every(BATTERY_POLL_MS, (now) => this.pollBattery(bus, now)));
    this.unsubscribe.push(this.scheduler.every(DISK_POLL_MS, (now) => this.pollDisk(bus, now)));
    // Both of these have long intervals, so without an early pass a machine
    // booted on a nearly flat battery — or with a full disk — would say
    // nothing about it for minutes. This clears the boot grace first, and
    // must also clear `SPAWN_DELAY_MS`: at 90 s the probe host is only just
    // spawning, and a question asked before it exists answers null.
    setTimeout(() => {
      const now = Date.now();
      void this.pollDisk(bus, now);
      void this.pollBattery(bus, now);
    }, EARLY_PASS_MS).unref?.();
  }

  stop(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
  }

  private async poll(bus: EventBus, now: number): Promise<void> {
    this.pollCpu(bus, now);
    this.pollMemory(bus, now);
    await this.pollTemperature(bus, now);
  }

  /**
   * Load since the previous tick, from the kernel's own tick counters. This is
   * what `systeminformation` did on Windows too — it just charged a process
   * spawn for the privilege.
   */
  private readCpuLoad(): number | null {
    let busy = 0;
    let total = 0;
    for (const core of cpus()) {
      const { user, nice, sys, irq, idle } = core.times;
      busy += user + nice + sys + irq;
      total += user + nice + sys + irq + idle;
    }

    const previous = this.lastTicks;
    this.lastTicks = { busy, total };
    if (!previous) return null;

    const elapsed = total - previous.total;
    if (elapsed <= 0) return null;
    return ((busy - previous.busy) / elapsed) * 100;
  }

  private pollCpu(bus: EventBus, now: number): void {
    try {
      const value = this.readCpuLoad();
      if (value === null || !Number.isFinite(value)) return;

      if (this.cpu.update(value)) {
        bus.emit(createEvent(EventType.systemCpuHigh, 'ambient', { load: value }, now));
      }

      if (value > CPU_HIGH) {
        this.cpuHighSince ??= now;
        if (!this.sustainedFired && now - this.cpuHighSince >= SUSTAINED_MS) {
          this.sustainedFired = true;
          bus.emit(
            createEvent(
              EventType.systemCpuSustained,
              'notable',
              { load: value, forMs: now - this.cpuHighSince },
              now
            )
          );
        }
      } else if (value < CPU_REARM) {
        this.cpuHighSince = null;
        this.sustainedFired = false;
      }
    } catch (err) {
      log.debug(`cpu poll failed: ${String(err)}`);
    }
  }

  private pollMemory(bus: EventBus, now: number): void {
    try {
      const total = totalmem();
      const free = freemem();
      if (!total) return;
      // On Windows `freemem` is available physical memory, so what is left is
      // what a user would call "used" — cache is not counted against them.
      const usedPercent = ((total - free) / total) * 100;
      if (this.memory.update(usedPercent)) {
        bus.emit(
          createEvent(EventType.systemMemoryHigh, 'ambient', { usedPercent, freeBytes: free }, now)
        );
      }
    } catch (err) {
      log.debug(`memory poll failed: ${String(err)}`);
    }
  }

  private async pollTemperature(bus: EventBus, now: number): Promise<void> {
    if (!this.temperatureSupported) return;
    try {
      const value = await this.queries.temperature();
      // No reading is not an answer — ask again next tick.
      if (value === null) return;
      // Unavailable on many machines — disable permanently rather than log forever.
      if (value === 'unsupported' || !Number.isFinite(value) || value <= 0) {
        this.temperatureSupported = false;
        log.info('CPU temperature is unavailable on this machine — thermal checks disabled');
        return;
      }
      if (this.temperature.update(value)) {
        bus.emit(createEvent(EventType.systemTemperatureHigh, 'urgent', { celsius: value }, now));
      }
    } catch {
      this.temperatureSupported = false;
      log.info('CPU temperature could not be read — thermal checks disabled');
    }
  }

  private async pollBattery(bus: EventBus, now: number): Promise<void> {
    if (!this.batterySupported) return;
    try {
      const battery = await this.queries.battery();
      // Null is "ask again later"; a reading that says there is no battery is
      // final, and a desktop should not keep asking for the life of the app.
      if (battery === null) return;
      if (!battery.present) {
        this.batterySupported = false;
        log.info('no battery on this machine — battery checks disabled');
        return;
      }
      // On the charger the percentage says nothing about danger, and feeding
      // the hysteresis a stand-in would either spend the alert or re-arm it on
      // every jiggle of the cable — so the reading is skipped outright.
      if (!battery.discharging) return;
      // Hysteresis works on "rising" values, so feed it the negated percentage.
      if (this.battery.update(-battery.percent)) {
        bus.emit(
          createEvent(EventType.systemBatteryLow, 'urgent', { percent: battery.percent }, now)
        );
      }
    } catch (err) {
      log.debug(`battery poll failed: ${String(err)}`);
    }
  }

  private async pollDisk(bus: EventBus, now: number): Promise<void> {
    try {
      const drives = await this.queries.drives();
      if (drives === null) return;
      for (const drive of drives) {
        if (!drive.mount || !Number.isFinite(drive.free)) continue;
        const low = drive.free < DISK_LOW_BYTES && drive.size > DISK_LOW_BYTES;
        const known = this.diskLowDrives.has(drive.mount);
        if (low && !known) {
          this.diskLowDrives.add(drive.mount);
          bus.emit(
            createEvent(
              EventType.systemDiskLow,
              'urgent',
              { mount: drive.mount, freeBytes: drive.free, freeGb: drive.free / 1024 ** 3 },
              now
            )
          );
        } else if (!low && known) {
          this.diskLowDrives.delete(drive.mount);
        }
      }
    } catch (err) {
      log.debug(`disk poll failed: ${String(err)}`);
    }
  }
}

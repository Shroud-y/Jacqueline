import { parseForeground } from '../core/activity';
import type { ForegroundReader } from '../monitors/focusMonitor';
import type { ProcessLister } from '../monitors/processMonitor';
import type {
  BatteryReading,
  DriveSpace,
  SystemQueries,
  TemperatureReading
} from '../monitors/systemMonitor';
import type { PresenceProbe } from './presenceProbe';

/**
 * Adapts the probe host's line protocol to what the monitors want.
 *
 * These readings used to come from `systeminformation`, which spawns a cold
 * `powershell.exe` per call on Windows — nineteen a minute between the two
 * monitors, ~640 ms of CPU each. The probe host is already running and answers
 * the same questions in about fifteen milliseconds, so it does the asking now.
 *
 * Every parser returns null rather than a default on a malformed or missing
 * reply: a monitor that mistakes "no reading" for a value fires spurious
 * events, which is worse than skipping a tick.
 */

/** `1`/`4`/`5` are the discharging states of Win32_Battery's `BatteryStatus`. */
const DISCHARGING_STATUSES = new Set([1, 4, 5]);

export function parseProcessNames(reply: string | null): Set<string> | null {
  if (reply === null) return null;
  const names = reply.split('|').filter((name) => name.length > 0);
  // An empty list cannot be real — there is always at least this process — so
  // it means the query failed rather than that nothing is running.
  return names.length > 0 ? new Set(names) : null;
}

export function parseTemperature(reply: string | null): TemperatureReading | null {
  // No reply is "ask again later" — the host may not have started yet. An
  // empty reply is the host answering that this machine has no thermal zone,
  // which is final and stops the monitor asking.
  if (reply === null) return null;
  if (reply.trim().length === 0) return 'unsupported';
  const celsius = Number(reply.trim());
  return Number.isFinite(celsius) ? celsius : null;
}

export function parseBattery(reply: string | null): BatteryReading | null {
  if (reply === null) return null;
  const trimmed = reply.trim();
  if (trimmed === 'none') return { present: false, discharging: false, percent: 0 };

  const [rawStatus, rawPercent] = trimmed.split(':');
  const status = Number(rawStatus);
  const percent = Number(rawPercent);
  if (!Number.isFinite(status) || !Number.isFinite(percent)) return null;

  return { present: true, discharging: DISCHARGING_STATUSES.has(status), percent };
}

export function parseDrives(reply: string | null): DriveSpace[] | null {
  if (reply === null) return null;

  const drives: DriveSpace[] = [];
  for (const entry of reply.split('|')) {
    if (entry.length === 0) continue;
    const [mount, rawFree, rawSize] = entry.split(':');
    const free = Number(rawFree);
    const size = Number(rawSize);
    if (!mount || !Number.isFinite(free) || !Number.isFinite(size)) continue;
    drives.push({ mount: `${mount}:`, free, size });
  }
  return drives.length > 0 ? drives : null;
}

export function processListerFor(probe: PresenceProbe): ProcessLister {
  return async () => parseProcessNames(await probe.ask('procs', 'procs'));
}

export function foregroundReaderFor(probe: PresenceProbe): ForegroundReader {
  return async () => parseForeground(await probe.ask('fg', 'fg'));
}

export function systemQueriesFor(probe: PresenceProbe): SystemQueries {
  return {
    temperature: async () => parseTemperature(await probe.ask('temp', 'temp')),
    battery: async () => parseBattery(await probe.ask('bat', 'bat')),
    drives: async () => parseDrives(await probe.ask('disk', 'disk'))
  };
}

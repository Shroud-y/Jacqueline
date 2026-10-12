import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../log/logger';
import { PROBE_SCRIPT } from './probeScript';

const log = createLogger('probe');

const POLL_MS = 30_000;
/**
 * How long to wait after launch before starting the PowerShell host.
 *
 * Codex starts at login, and everything the host does on its first breath —
 * spawning a shell, loading the P/Invoke assembly, having Defender look at it
 * — competes with the rest of the boot storm for the same disk. Deferring it
 * costs nothing: `DEFAULT_BOOT_GRACE_MS` already keeps the companion quiet
 * over this window, so the fullscreen and microphone readings it would supply
 * have no one to suppress yet.
 */
const SPAWN_DELAY_MS = 90_000;
/** If a reply never comes, the cached answer must not go stale forever. */
const REPLY_TIMEOUT_MS = 10_000;
/** A one-off question is answered in ~15 ms; this only catches a wedged host. */
const ASK_TIMEOUT_MS = 8_000;

/** One outstanding `ask`, waiting for the line that answers it. */
interface Waiter {
  resolve: (value: string | null) => void;
  timer: NodeJS.Timeout;
}

/**
 * Fullscreen and microphone detection for the suppression rules (§8.5), and
 * the shared query host for the system and process monitors — see the note at
 * the top of `probeScript.ts` for why they do not use `systeminformation`.
 *
 * Everything is wrapped in try/catch: a probe that cannot run reports "not
 * active" rather than silencing the companion forever.
 */
export class PresenceProbe {
  private child: ChildProcessWithoutNullStreams | null = null;
  private scriptDir: string | null = null;
  private buffer = '';
  private timer: NodeJS.Timeout | null = null;
  private startTimer: NodeJS.Timeout | null = null;
  private lastAskedAt = 0;
  private failed = false;

  private fullscreen = false;
  private microphone = false;
  /**
   * Applications already holding the capture device when Codex started.
   * Discord and Teams keep it open for their whole lifetime, so a purely
   * level-triggered reading would silence the companion permanently. Only a
   * holder that appears *after* the baseline counts as a call.
   */
  private microphoneBaseline: Set<string> | null = null;

  /** Outstanding one-off questions, oldest first, keyed by reply prefix. */
  private readonly waiters = new Map<string, Waiter[]>();

  /** Directory holding `CodexProbe.dll` and the `.cs` it was built from. */
  constructor(private readonly probeDir: string) {}

  get fullscreenActive(): boolean {
    return this.fullscreen;
  }

  get microphoneActive(): boolean {
    return this.microphone;
  }

  get healthy(): boolean {
    return this.child !== null && !this.failed;
  }

  start(): void {
    if (process.platform !== 'win32') {
      log.info('presence probe is Windows-only — fullscreen/microphone suppression disabled');
      this.failed = true;
      return;
    }
    // Deferred rather than immediate — see `SPAWN_DELAY_MS`. Until it fires
    // there is no host, so `ask` answers null and both readings stay false,
    // which is the same shape as a probe that failed to start.
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      this.spawnHost();
      this.timer = setInterval(() => this.poll(), POLL_MS);
      this.timer.unref?.();
      this.poll();
    }, SPAWN_DELAY_MS);
    this.startTimer.unref?.();
    log.info(`presence probe host starts in ${Math.round(SPAWN_DELAY_MS / 1000)}s`);
  }

  /**
   * Ask the running host one question and wait for the line that answers it.
   *
   * Replies come back in the order they were asked, so waiters queue per
   * prefix rather than carrying a correlation id. `null` means the host is
   * unavailable or did not answer — every caller treats that as "no reading
   * this tick", never as a value.
   */
  ask(command: string, prefix: string): Promise<string | null> {
    if (this.failed || !this.child) return Promise.resolve(null);

    return new Promise((resolve) => {
      const queue = this.waiters.get(prefix) ?? [];
      const waiter: Waiter = {
        resolve,
        timer: setTimeout(() => {
          this.dropWaiter(prefix, waiter);
          log.debug(`probe question '${command}' timed out`);
          resolve(null);
        }, ASK_TIMEOUT_MS)
      };
      waiter.timer.unref?.();
      queue.push(waiter);
      this.waiters.set(prefix, queue);

      try {
        this.child?.stdin.write(`${command}\n`);
      } catch (err) {
        log.debug(`probe write failed: ${String(err)}`);
        this.dropWaiter(prefix, waiter);
        clearTimeout(waiter.timer);
        this.child = null;
        resolve(null);
      }
    });
  }

  stop(): void {
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.failWaiters();
    try {
      this.child?.stdin.write('quit\n');
      this.child?.kill();
    } catch {
      // Already gone.
    }
    this.child = null;
    if (this.scriptDir) {
      try {
        rmSync(this.scriptDir, { recursive: true, force: true });
      } catch {
        // Temp cleanup is best effort.
      }
      this.scriptDir = null;
    }
  }

  private spawnHost(): void {
    try {
      this.scriptDir = mkdtempSync(join(tmpdir(), 'codex-probe-'));
      const scriptPath = join(this.scriptDir, 'probe.ps1');
      writeFileSync(scriptPath, PROBE_SCRIPT, 'utf8');

      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath,
          '-ProbeDir',
          this.probeDir
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
      );

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => this.consume(chunk));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => log.debug(`probe stderr: ${chunk.trim()}`));
      child.on('exit', (code) => {
        log.debug(`probe host exited with code ${code ?? 'null'}`);
        this.child = null;
        // A dead probe must not mean permanent silence.
        this.fullscreen = false;
        this.microphone = false;
        // Nor a monitor hanging on a reply that can never arrive.
        this.failWaiters();
      });
      child.on('error', (err) => {
        this.failed = true;
        log.warn(`presence probe unavailable: ${err.message}`);
      });

      this.child = child;
      log.info(`presence probe host spawned (pid ${child.pid ?? 'unknown'})`);
    } catch (err) {
      this.failed = true;
      log.warn(`cannot start presence probe: ${(err as Error).message}`);
    }
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      this.handleLine(line);
      index = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    // The foreground reply carries the title of whatever the user has open.
    // It is classified and dropped; it does not belong in a log, even a debug one.
    log.debug(line.startsWith('fg=') ? 'probe line: fg=<redacted>' : `probe line: ${line}`);
    if (line === 'ready=1') {
      log.info('presence probe ready');
      return;
    }
    if (line.startsWith('fs=')) this.fullscreen = line.endsWith('1');
    else if (line.startsWith('mic=')) this.updateMicrophone(line.slice('mic='.length));

    // `fs` and `mic` are cached above *and* answerable on demand, so every
    // reply is offered to a waiter regardless.
    const separator = line.indexOf('=');
    if (separator < 0) return;
    const queue = this.waiters.get(line.slice(0, separator));
    const waiter = queue?.shift();
    if (!waiter) return;
    clearTimeout(waiter.timer);
    waiter.resolve(line.slice(separator + 1));
  }

  private dropWaiter(prefix: string, waiter: Waiter): void {
    const queue = this.waiters.get(prefix);
    if (!queue) return;
    const index = queue.indexOf(waiter);
    if (index >= 0) queue.splice(index, 1);
    if (queue.length === 0) this.waiters.delete(prefix);
  }

  /** Answer everything still outstanding with "no reading", never a hang. */
  private failWaiters(): void {
    for (const queue of this.waiters.values()) {
      for (const waiter of queue) {
        clearTimeout(waiter.timer);
        waiter.resolve(null);
      }
    }
    this.waiters.clear();
  }

  private updateMicrophone(payload: string): void {
    const holders = new Set(payload.split('|').filter((name) => name.length > 0));

    if (this.microphoneBaseline === null) {
      this.microphoneBaseline = holders;
      this.microphone = false;
      if (holders.size > 0) {
        log.info(
          `microphone held at startup by ${holders.size} app(s); ignoring those as a baseline`
        );
      }
      return;
    }

    // A baseline holder that has released the device must not be permanently
    // excused — drop it so a later re-open is detected as a new call.
    for (const name of [...this.microphoneBaseline]) {
      if (!holders.has(name)) this.microphoneBaseline.delete(name);
    }

    const baseline = this.microphoneBaseline;
    this.microphone = [...holders].some((name) => !baseline.has(name));
  }

  private poll(): void {
    if (this.failed) return;
    if (!this.child) {
      this.spawnHost();
      return;
    }
    const now = Date.now();
    if (this.lastAskedAt !== 0 && now - this.lastAskedAt > REPLY_TIMEOUT_MS + POLL_MS) {
      // No reply for a whole cycle: assume nothing is active rather than
      // keeping a stale "suppressed" forever.
      this.fullscreen = false;
      this.microphone = false;
      this.microphoneBaseline = null;
    }
    this.lastAskedAt = now;
    try {
      this.child.stdin.write('fs\nmic\n');
    } catch (err) {
      log.debug(`probe write failed: ${String(err)}`);
      this.child = null;
    }
  }
}

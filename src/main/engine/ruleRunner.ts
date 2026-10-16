import type { Character } from '@shared/character';
import { createLogger } from '../app/logger';
import type { DesktopSensors } from '../sensors/win32';
import { RuleEngine, type Fired, type RuleEvent, type RuleNeeds } from './ruleEngine';
import type { Rng } from './selector';

const log = createLogger('rules');

/** How often programs and the user's presence are looked at again. Neither has an event. */
const POLL_MS = 5_000;
/** Away at least this long before coming back counts as coming back. */
const AWAY_MIN_SECONDS = 60;

export interface RuleRunnerDeps {
  loadSensors: () => Promise<DesktopSensors | null>;
  /** Seconds since the last keyboard or mouse input anywhere. */
  idleSeconds: () => number;
  onFired: (fired: Fired) => void;
  rng?: Rng;
  now?: () => number;
}

/**
 * Turns what happens on the desktop into rule events and hands what fires to
 * `onFired`. Like presence, it watches only what the current rules need: no
 * rule about programs, no process list; no daily rule, no minute timer.
 */
export class RuleRunner {
  private readonly engine: RuleEngine;
  private readonly now: () => number;
  private needs: RuleNeeds = { startStop: new Set(), running: new Set(), focus: false, time: false, every: false, returned: false };

  private sensors: DesktopSensors | null = null;
  private sensorsLoading: Promise<void> | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private minuteTimer: NodeJS.Timeout | null = null;
  private everyTimer: NodeJS.Timeout | null = null;
  private unhookFocus: (() => void) | null = null;

  /** The programs being watched and whether each was running at the last look. */
  private running = new Map<string, boolean>();
  private focused: string | null = null;
  private lastIdle = 0;
  private stopped = false;

  constructor(private readonly deps: RuleRunnerDeps) {
    this.engine = new RuleEngine(deps.rng);
    this.now = deps.now ?? Date.now;
  }

  /** Whose rules run. Called again whenever any of them changes. */
  setCharacters(characters: readonly Character[]): void {
    this.engine.setCharacters(characters, this.now());
    this.needs = this.engine.needs;
    void this.reconfigure();
  }

  /** Something that happened outside: Jacqueline started, a character was clicked. */
  event(event: RuleEvent): void {
    if (this.stopped) return;
    const fired = this.engine.handle(event, { now: this.now(), isRunning: (program) => this.running.get(program) ?? null });
    for (const one of fired) {
      log.info(`"${one.character.name}" / ${one.rule.name || one.rule.id}: ${describe(event)}`);
      this.deps.onFired(one);
    }
  }

  stop(): void {
    this.stopped = true;
    for (const timer of [this.pollTimer, this.everyTimer]) if (timer) clearInterval(timer);
    if (this.minuteTimer) clearTimeout(this.minuteTimer);
    this.pollTimer = this.minuteTimer = this.everyTimer = null;
    this.unhookFocus?.();
    this.unhookFocus = null;
  }

  /* ------------------------------------------------------------------ */

  private async reconfigure(): Promise<void> {
    const programs = new Set([...this.needs.startStop, ...this.needs.running]);
    if ((programs.size > 0 || this.needs.focus) && !this.sensors) await this.loadSensors();
    if (this.stopped) return;

    // Programs no rule names any more are forgotten, so a later rule about
    // one starts from what is true then and not from a stale reading.
    for (const program of [...this.running.keys()]) if (!programs.has(program)) this.running.delete(program);

    const polling = programs.size > 0 || this.needs.returned;
    if (polling && !this.pollTimer) {
      this.pollTimer = setInterval(() => this.poll(), POLL_MS);
      this.pollTimer.unref?.();
      this.lastIdle = this.deps.idleSeconds();
    } else if (!polling && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (polling) this.pollPrograms();

    if (this.needs.focus && this.sensors && !this.unhookFocus) {
      this.focused = this.sensors.foregroundApp();
      this.unhookFocus = this.sensors.onForegroundChange(() => this.onFocus());
    } else if (!this.needs.focus && this.unhookFocus) {
      this.unhookFocus();
      this.unhookFocus = null;
    }

    if (this.needs.time && !this.minuteTimer) this.armMinute();
    else if (!this.needs.time && this.minuteTimer) {
      clearTimeout(this.minuteTimer);
      this.minuteTimer = null;
    }

    this.armEvery();
  }

  private loadSensors(): Promise<void> {
    this.sensorsLoading ??= this.deps.loadSensors().then((sensors) => {
      this.sensors = sensors;
      if (!sensors) log.warn('no desktop sensors: rules about programs will not fire');
    });
    return this.sensorsLoading;
  }

  private poll(): void {
    this.pollPrograms();
    if (this.needs.returned) this.pollReturn();
  }

  /** Starts and stops of the programs rules name. The first look at one is a baseline, never an event. */
  private pollPrograms(): void {
    const programs = new Set([...this.needs.startStop, ...this.needs.running]);
    if (programs.size === 0 || !this.sensors) return;
    const now = this.sensors.runningApps();
    for (const program of programs) {
      const isRunning = now.has(program);
      const was = this.running.get(program);
      this.running.set(program, isRunning);
      if (was === undefined || was === isRunning || !this.needs.startStop.has(program)) continue;
      this.event({ type: isRunning ? 'programStarted' : 'programStopped', program });
    }
  }

  /** Idle time falls back to nothing when the user touches anything: that is the moment they are back. */
  private pollReturn(): void {
    const idle = this.deps.idleSeconds();
    if (this.lastIdle >= AWAY_MIN_SECONDS && idle < this.lastIdle) {
      this.event({ type: 'returned', awayMinutes: this.lastIdle / 60 });
    }
    this.lastIdle = idle;
  }

  private onFocus(): void {
    const program = this.sensors?.foregroundApp() ?? null;
    if (program === this.focused) return;
    this.focused = program;
    if (program) this.event({ type: 'programFocused', program });
  }

  /** On the minute, every minute, for as long as some rule is daily. */
  private armMinute(): void {
    const now = this.now();
    this.minuteTimer = setTimeout(() => {
      this.minuteTimer = null;
      if (this.stopped || !this.needs.time) return;
      const date = new Date(this.now());
      this.event({ type: 'time', at: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` });
      this.armMinute();
    }, 60_000 - (now % 60_000) + 50);
    this.minuteTimer.unref?.();
  }

  /** One timer, for whichever `every` rule is due soonest. */
  private armEvery(): void {
    if (this.everyTimer) clearTimeout(this.everyTimer);
    this.everyTimer = null;
    const next = this.engine.nextDue();
    if (next === null || this.stopped) return;
    this.everyTimer = setTimeout(() => {
      this.everyTimer = null;
      for (const event of this.engine.due(this.now())) this.event(event);
      this.armEvery();
    }, Math.max(1_000, next - this.now()));
    this.everyTimer.unref?.();
  }
}

function describe(event: RuleEvent): string {
  switch (event.type) {
    case 'programStarted':
      return `${event.program} started`;
    case 'programStopped':
      return `${event.program} stopped`;
    case 'programFocused':
      return `${event.program} came to the front`;
    case 'time':
      return `it is ${event.at}`;
    case 'returned':
      return `back after ${Math.round(event.awayMinutes)} min`;
    case 'startup':
      return 'Jacqueline started';
    case 'clicked':
      return 'clicked';
    case 'every':
      return 'its turn came round';
  }
}

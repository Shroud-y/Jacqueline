/**
 * One character's behaviour script, in a QuickJS sandbox of its own.
 *
 * The script sees nothing of the app or the machine: only the functions put
 * on its global object here. Every call into it runs against a deadline and
 * inside a memory limit; a script that keeps running into either is stopped.
 * What it can do goes out through `ScriptActions`, which the app carries out
 * exactly as it would for a rule.
 */

import { shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime, type QuickJSWASMModule } from 'quickjs-emscripten-core';
import { STATE_NAME, type ShowPlace } from '@shared/rules';
import { SIGNAL_NAME } from '@shared/signal';
import { appStem } from '../characters/presence';

/** What a script can subscribe to. Program events take a program as the second argument; `signal` may take a name. */
export const SCRIPT_EVENTS = ['programStarted', 'programStopped', 'programFocused', 'clicked', 'startup', 'returned', 'speechEnd', 'minute', 'musicStarted', 'musicStopped', 'trackChanged', 'signal'] as const;
export type ScriptEventName = (typeof SCRIPT_EVENTS)[number];
const PROGRAM_EVENTS = new Set<ScriptEventName>(['programStarted', 'programStopped', 'programFocused']);
const MUSIC_EVENTS = new Set<ScriptEventName>(['musicStarted', 'musicStopped', 'trackChanged']);

export const LIMITS = {
  memoryBytes: 16 * 1024 * 1024,
  stackBytes: 512 * 1024,
  /** One event, one timer, or the script's first run. */
  callMs: 50,
  loadMs: 200,
  timers: 50,
  afterMinMs: 250,
  everyMinMs: 1_000,
  stateBytes: 64 * 1024,
  /** Running into a limit this many times in a row stops the script. */
  strikes: 3
} as const;

export interface ScriptActions {
  /** A group of lines, or a line of its own. */
  say(what: { group: string } | { text: string }): void;
  sound(file: string): void;
  show(seconds: number, place: ShowPlace): void;
  hide(minutes: number): void;
  setMood(mood: string | null): void;
  /** One of its own states, or null for its usual look; `seconds` null lasts until it is changed. */
  setState(state: string | null, seconds: number | null): void;
  log(message: string): void;
  /** By stem; null when it is not known (yet). */
  isRunning(stem: string): boolean | null;
  /** What is playing; null when it is not known (yet). */
  music(): { playing: boolean; track: string; artist: string; app: string } | null;
  now(): number;
}

export interface ScriptNeeds {
  startStop: Set<string>;
  running: Set<string>;
  focus: boolean;
  minute: boolean;
  returned: boolean;
  music: boolean;
}

export interface ScriptEvent {
  name: ScriptEventName;
  /** Program events: the program, by stem. */
  program?: string;
  /** `signal`: its name. */
  signal?: string;
  /** Anything else the handler is given. */
  detail?: Record<string, string | number>;
}

interface Handler {
  name: ScriptEventName;
  program: string | null;
  /** `signal` handlers for one name only; null hears every signal. */
  signal: string | null;
  fn: QuickJSHandle;
}

interface Timer {
  fn: QuickJSHandle;
  handle: NodeJS.Timeout;
  repeat: boolean;
}

const MOOD = /^[a-z][a-z0-9-]{0,31}$/;

export class BehaviourScript {
  private readonly runtime: QuickJSRuntime;
  private readonly context: QuickJSContext;
  private readonly handlers: Handler[] = [];
  private readonly timers = new Map<number, Timer>();
  private nextTimer = 1;
  private strikes = 0;
  private lastState: string;
  private disposed = false;
  readonly needs: ScriptNeeds = { startStop: new Set(), running: new Set(), focus: false, minute: false, returned: false, music: false };
  /** The last thing that went wrong, in words, with the line where it did. */
  error: string | null = null;
  /** False once it has been stopped for running into its limits. */
  running = true;

  constructor(
    module: QuickJSWASMModule,
    source: string,
    initialState: string | null,
    private readonly actions: ScriptActions,
    private readonly onChange: (change: { state?: string; needs?: true; status?: true }) => void
  ) {
    this.runtime = module.newRuntime();
    this.runtime.setMemoryLimit(LIMITS.memoryBytes);
    this.runtime.setMaxStackSize(LIMITS.stackBytes);
    this.context = this.runtime.newContext();
    this.lastState = initialState ?? '{}';
    this.installApi();
    this.run(() => this.context.evalCode(`globalThis.state = JSON.parse(${JSON.stringify(this.lastState)});`, 'state.js'), LIMITS.loadMs);
    this.run(() => this.context.evalCode(source, 'behaviour.js'), LIMITS.loadMs);
    this.saveState();
  }

  /** Something happened; every handler subscribed to it runs, each against its own deadline. */
  dispatch(event: ScriptEvent): void {
    if (!this.running || this.disposed) return;
    for (const handler of [...this.handlers]) {
      if (handler.name !== event.name) continue;
      if (handler.program !== null && handler.program !== event.program) continue;
      if (handler.signal !== null && handler.signal !== event.signal) continue;
      this.call(handler.fn, event);
      if (!this.running) return;
    }
    this.saveState();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.timers.values()) {
      clearTimeout(timer.handle);
      timer.fn.dispose();
    }
    this.timers.clear();
    for (const handler of this.handlers) handler.fn.dispose();
    this.handlers.length = 0;
    this.context.dispose();
    this.runtime.dispose();
  }

  /* ------------------------------------------------------------------ */

  private installApi(): void {
    const ctx = this.context;
    const define = (name: string, fn: (...args: QuickJSHandle[]) => QuickJSHandle | void): void => {
      // Only a handle may go back into the script; anything else an action happens to return stays out here.
      const handle = ctx.newFunction(name, (...args) => {
        const result: unknown = fn(...args);
        return result !== null && typeof result === 'object' && 'alive' in result ? (result as QuickJSHandle) : undefined;
      });
      ctx.setProp(ctx.global, name, handle);
      handle.dispose();
    };
    const fail = (message: string): never => {
      throw new Error(message);
    };
    const text = (handle: QuickJSHandle | undefined): string => (handle && ctx.typeof(handle) === 'string' ? ctx.getString(handle) : '');
    const number = (handle: QuickJSHandle | undefined): number => (handle && ctx.typeof(handle) === 'number' ? ctx.getNumber(handle) : NaN);

    define('on', (nameHandle, second, third) => {
      const name = text(nameHandle) as ScriptEventName;
      if (!SCRIPT_EVENTS.includes(name)) fail(`on(): there is no event called "${text(nameHandle)}"`);
      const isProgram = PROGRAM_EVENTS.has(name);
      const program = isProgram ? appStem(text(second)) : null;
      if (isProgram && !program) fail(`on('${name}', program, fn): which program?`);
      // A signal's name is optional: on('signal', fn) hears every one.
      const named = name === 'signal' && second !== undefined && ctx.typeof(second) === 'string';
      const signal = named ? text(second) : null;
      if (signal !== null && !SIGNAL_NAME.test(signal)) fail(`on('signal', name, fn): "${signal}" is not a signal name`);
      const fn = isProgram || named ? third : second;
      if (!fn || ctx.typeof(fn) !== 'function') fail(`on('${name}'): the last argument has to be a function`);
      this.handlers.push({ name, program, signal, fn: (fn as QuickJSHandle).dup() });
      if (name === 'programStarted' || name === 'programStopped') this.needs.startStop.add(program as string);
      if (name === 'programFocused') this.needs.focus = true;
      if (name === 'minute') this.needs.minute = true;
      if (name === 'returned') this.needs.returned = true;
      if (MUSIC_EVENTS.has(name)) this.needs.music = true;
      this.onChange({ needs: true });
    });

    const timer = (repeat: boolean) => (msHandle: QuickJSHandle | undefined, fnHandle: QuickJSHandle): QuickJSHandle => {
      if (!fnHandle || ctx.typeof(fnHandle) !== 'function') fail(`${repeat ? 'every' : 'after'}(ms, fn): the second argument has to be a function`);
      if (this.timers.size >= LIMITS.timers) fail(`no more than ${LIMITS.timers} timers at once`);
      const floor = repeat ? LIMITS.everyMinMs : LIMITS.afterMinMs;
      const ms = Math.max(floor, Number.isFinite(number(msHandle)) ? number(msHandle) : floor);
      const id = this.nextTimer++;
      const fn = fnHandle.dup();
      const fire = (): void => {
        const current = this.timers.get(id);
        if (!current || !this.running) return;
        if (!repeat) this.timers.delete(id);
        this.call(current.fn, null);
        if (!repeat) current.fn.dispose();
        else if (this.timers.has(id)) {
          current.handle = setTimeout(fire, ms);
          current.handle.unref?.();
        }
        this.saveState();
      };
      const handle = setTimeout(fire, ms);
      handle.unref?.();
      this.timers.set(id, { fn, handle, repeat });
      return ctx.newNumber(id);
    };
    define('after', (ms, fn) => timer(false)(ms, fn));
    define('every', (ms, fn) => timer(true)(ms, fn));
    define('cancel', (idHandle) => {
      const id = number(idHandle);
      const current = this.timers.get(id);
      if (!current) return;
      clearTimeout(current.handle);
      this.timers.delete(id);
      current.fn.dispose();
    });

    define('running', (programHandle) => {
      const stem = appStem(text(programHandle));
      if (!stem) fail('running(program): which program?');
      if (!this.needs.running.has(stem)) {
        // Asked for the first time: watched from now on, known at the next look.
        this.needs.running.add(stem);
        this.onChange({ needs: true });
      }
      const running = this.actions.isRunning(stem);
      return running === null ? ctx.null : running ? ctx.true : ctx.false;
    });
    define('music', () => {
      if (!this.needs.music) {
        // Asked for the first time: watched from now on, known a moment later.
        this.needs.music = true;
        this.onChange({ needs: true });
      }
      const music = this.actions.music();
      if (!music) return ctx.null;
      const result = ctx.newObject();
      ctx.setProp(result, 'playing', music.playing ? ctx.true : ctx.false);
      for (const key of ['track', 'artist', 'app'] as const) {
        const value = ctx.newString(music[key]);
        ctx.setProp(result, key, value);
        value.dispose();
      }
      return result;
    });
    define('now', () => ctx.newNumber(this.actions.now()));

    define('say', (what) => {
      if (what && ctx.typeof(what) === 'string') return void this.actions.say({ group: ctx.getString(what) });
      if (what && ctx.typeof(what) === 'object') {
        const line = ctx.getProp(what, 'text');
        const value = text(line);
        line.dispose();
        if (value.trim()) return void this.actions.say({ text: value.slice(0, 2000) });
      }
      fail("say(): a group's name, or { text: '…' }");
    });
    define('sound', (file) => this.actions.sound(text(file) || fail('sound(file): which file?')));
    define('show', (seconds, place) => {
      const value = number(seconds);
      const where = text(place);
      if (where !== '' && where !== 'usual' && where !== 'random') fail(`show(seconds, place): place is 'usual' or 'random', not "${where}"`);
      this.actions.show(Math.min(3600, Math.max(1, Number.isFinite(value) ? value : 10)), where === 'random' ? 'random' : 'usual');
    });
    define('hide', (minutes) => {
      const value = number(minutes);
      this.actions.hide(Math.min(1440, Math.max(1, Number.isFinite(value) ? value : 30)));
    });
    define('setMood', (mood) => {
      const raw: unknown = mood ? ctx.dump(mood) : null;
      if (raw === null || raw === undefined) return void this.actions.setMood(null);
      const value = text(mood);
      if (!MOOD.test(value)) fail('setMood(): lowercase letters, digits and dashes, starting with a letter');
      this.actions.setMood(value);
    });
    define('setState', (state, seconds) => {
      const raw: unknown = state ? ctx.dump(state) : null;
      if (raw === null || raw === undefined) return void this.actions.setState(null, null);
      const value = text(state);
      if (!STATE_NAME.test(value)) fail("setState(): the state's key, shown under its name in the Appearance tab");
      const length = number(seconds);
      this.actions.setState(value, Number.isFinite(length) ? Math.min(3600, Math.max(1, length)) : null);
    });
    define('log', (...args) => {
      this.actions.log(args.map((arg) => (ctx.typeof(arg) === 'string' ? ctx.getString(arg) : JSON.stringify(ctx.dump(arg)))).join(' ').slice(0, 1000));
    });
  }

  /** One way into the script: a deadline, then whatever went wrong recorded and counted. */
  private run(enter: () => { error?: QuickJSHandle; value?: QuickJSHandle }, ms: number): void {
    if (this.disposed) return;
    this.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + ms));
    let failed = false;
    try {
      const result = enter();
      if (result.error) {
        failed = true;
        this.fail(this.context.dump(result.error));
        result.error.dispose();
      } else {
        result.value?.dispose();
      }
      // Promises it started settle now, inside the same deadline.
      const jobs = this.runtime.executePendingJobs();
      if (jobs.error) {
        failed = true;
        this.fail(this.context.dump(jobs.error));
        jobs.error.dispose();
      }
    } catch (err) {
      failed = true;
      this.fail(err);
    } finally {
      this.runtime.removeInterruptHandler();
    }
    if (!failed && this.strikes > 0) this.strikes = 0;
  }

  private call(fn: QuickJSHandle, event: ScriptEvent | null): void {
    this.run(() => {
      if (!event) return this.context.callFunction(fn, this.context.undefined);
      const arg = this.context.newObject();
      if (event.program) {
        const program = this.context.newString(event.program);
        this.context.setProp(arg, 'program', program);
        program.dispose();
      }
      for (const [key, value] of Object.entries(event.detail ?? {})) {
        const handle = typeof value === 'number' ? this.context.newNumber(value) : this.context.newString(value);
        this.context.setProp(arg, key, handle);
        handle.dispose();
      }
      try {
        return this.context.callFunction(fn, this.context.undefined, arg);
      } finally {
        arg.dispose();
      }
    }, LIMITS.callMs);
  }

  private fail(raw: unknown): void {
    const error = raw as { name?: string; message?: string; stack?: string } | undefined;
    const message = typeof raw === 'string' ? raw : `${error?.name ?? 'Error'}: ${error?.message ?? String(raw)}`;
    const where = /behaviour\.js:(\d+)/.exec(error?.stack ?? '')?.[1];
    const limit = /interrupted|out of memory|stack overflow/i.test(message);
    const friendly = /interrupted/i.test(message)
      ? `took longer than ${LIMITS.callMs} ms and was stopped`
      : /out of memory/i.test(message)
        ? `used more than ${LIMITS.memoryBytes / (1024 * 1024)} MB`
        : message;
    this.error = where ? `Line ${where}: ${friendly}` : friendly;
    if (limit) {
      this.strikes += 1;
      if (this.strikes >= LIMITS.strikes) {
        this.running = false;
        this.error = `${this.error}. Stopped after ${LIMITS.strikes} times in a row.`;
        for (const timer of this.timers.values()) clearTimeout(timer.handle);
      }
    }
    this.actions.log(`script error: ${this.error}`);
    this.onChange({ status: true });
  }

  /** Its `state`, kept when it changes and is small enough to keep. */
  private saveState(): void {
    if (this.disposed || !this.running) return;
    this.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + LIMITS.callMs));
    try {
      const result = this.context.evalCode('JSON.stringify(globalThis.state === undefined ? {} : globalThis.state)', 'state.js');
      if (result.error) {
        result.error.dispose();
        return;
      }
      const json = this.context.dump(result.value) as unknown;
      result.value.dispose();
      if (typeof json !== 'string' || json === this.lastState) return;
      if (json.length > LIMITS.stateBytes) {
        this.error = `state is larger than ${LIMITS.stateBytes / 1024} KB and was not kept`;
        this.onChange({ status: true });
        return;
      }
      this.lastState = json;
      this.onChange({ state: json });
    } finally {
      this.runtime.removeInterruptHandler();
    }
  }
}

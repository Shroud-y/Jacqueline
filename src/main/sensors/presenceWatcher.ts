import type { Character } from '@shared/character';
import type { Rect } from '@shared/layout';
import { createLogger } from '../app/logger';
import { appStem, presenceNeeds, type DesktopFacts, type PresenceNeeds } from '../characters/presence';
import type { DesktopSensors } from './win32';

const log = createLogger('presence');

/** How often the things that have no event are looked at again. */
const POLL_MS = 5_000;

/** No input for this long and nobody is looking: animations stop until there is some. */
const AWAY_AFTER_SECONDS = 5 * 60;

/** The parts of Electron's `powerMonitor` this needs — passed in so tests can stand in for it. */
export interface UserActivity {
  idleSeconds(): number;
  onLockChange(listener: (locked: boolean) => void): () => void;
}

export interface PresenceWatcherDeps {
  loadSensors: () => Promise<DesktopSensors | null>;
  activity: UserActivity;
  /** A rectangle in physical pixels, as Windows gives it, in the coordinates the windows are placed in. */
  toScreen: (rect: Rect) => Rect;
}

/**
 * Keeps the facts presence is decided from, and watches only the ones the
 * current characters need: no character tied to a program, no process list;
 * none that steps aside for fullscreen, no fullscreen check. With nothing
 * needed and nobody on screen it holds no timer at all.
 */
export class PresenceWatcher {
  private needs: PresenceNeeds = { running: false, focused: false, fullscreen: false };
  /** Any character at all may be on screen, so whether the user is there matters. */
  private anyone = false;
  /**
   * The programs some character is tied to. Only these are kept from the
   * process list: three hundred processes come and go all day, and none of
   * the others starting is a change worth telling anyone about.
   */
  private watched = new Set<string>();

  private sensors: DesktopSensors | null = null;
  private sensorsLoading: Promise<void> | null = null;
  private unhookForeground: (() => void) | null = null;
  private unhookLock: (() => void) | null = null;
  private timer: NodeJS.Timeout | null = null;

  private current: DesktopFacts = { running: null, focused: null, fullscreen: null };
  private locked = false;
  private away = false;

  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: PresenceWatcherDeps) {}

  get facts(): DesktopFacts {
    return this.current;
  }

  /** False while the screen is locked or the user has been away a while: nothing needs to move. */
  get watching(): boolean {
    return !this.locked && !this.away;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Tells the watcher who there is; it works out what that means it has to watch. */
  setCharacters(characters: readonly Character[]): void {
    this.needs = presenceNeeds(characters);
    this.anyone = characters.some((character) => character.enabled);
    this.watched = new Set(
      characters
        .filter((character) => character.enabled && character.presence.mode === 'whileRunning')
        .flatMap((character) => character.presence.apps.map(appStem))
    );
    void this.reconfigure();
  }

  stop(): void {
    this.needs = { running: false, focused: false, fullscreen: false };
    this.anyone = false;
    this.watched = new Set();
    void this.reconfigure();
  }

  /** Looks at everything that is needed again, and says so if any of it changed. */
  refresh(): void {
    const sensors = this.sensors;
    const next: DesktopFacts = {
      running: this.needs.running && sensors ? this.runningWatched(sensors) : null,
      focused: this.needs.focused && sensors ? sensors.foregroundApp() : null,
      fullscreen: this.needs.fullscreen && sensors ? this.fullscreen(sensors) : null
    };
    const away = this.anyone && this.deps.activity.idleSeconds() >= AWAY_AFTER_SECONDS;

    const changed = !sameFacts(this.current, next) || away !== this.away;
    this.current = next;
    this.away = away;
    if (!changed) return;
    // Program names only — never a window title.
    log.debug(
      `in front: ${next.focused ?? '-'}; running: ${next.running ? [...next.running].join(', ') || 'none' : '-'}; ` +
        `fullscreen: ${next.fullscreen ? 'yes' : 'no'}; away: ${away}`
    );
    this.emit();
  }

  private runningWatched(sensors: DesktopSensors): Set<string> {
    const running = sensors.runningApps();
    return new Set([...this.watched].filter((stem) => running.has(stem)));
  }

  private fullscreen(sensors: DesktopSensors): Rect | null {
    const display = sensors.fullscreenDisplay();
    return display ? this.deps.toScreen(display) : null;
  }

  private async reconfigure(): Promise<void> {
    const wantsSensors = this.needs.running || this.needs.focused || this.needs.fullscreen;
    if (wantsSensors && !this.sensors) await this.loadSensors();

    // A change of window is the moment both of these can change, and it comes as an event.
    const wantsForeground = (this.needs.focused || this.needs.fullscreen) && this.sensors !== null;
    if (wantsForeground && !this.unhookForeground) {
      this.unhookForeground = this.sensors?.onForegroundChange(() => this.refresh()) ?? null;
    } else if (!wantsForeground && this.unhookForeground) {
      this.unhookForeground();
      this.unhookForeground = null;
    }

    if (this.anyone && !this.unhookLock) {
      this.unhookLock = this.deps.activity.onLockChange((locked) => {
        if (locked === this.locked) return;
        this.locked = locked;
        this.emit();
      });
    } else if (!this.anyone && this.unhookLock) {
      this.unhookLock();
      this.unhookLock = null;
      this.locked = false;
    }

    // Running programs and a window going fullscreen in place have no event;
    // neither does the user walking away.
    if (this.anyone && !this.timer) {
      this.timer = setInterval(() => this.refresh(), POLL_MS);
      this.timer.unref?.();
    } else if (!this.anyone && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.refresh();
  }

  private loadSensors(): Promise<void> {
    this.sensorsLoading ??= this.deps.loadSensors().then((sensors) => {
      this.sensors = sensors;
      if (!sensors) log.warn('no desktop sensors: characters tied to a program will stay hidden');
    });
    return this.sensorsLoading;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function sameFacts(a: DesktopFacts, b: DesktopFacts): boolean {
  return a.focused === b.focused && sameRect(a.fullscreen, b.fullscreen) && sameSet(a.running, b.running);
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function sameSet(a: ReadonlySet<string> | null, b: ReadonlySet<string> | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

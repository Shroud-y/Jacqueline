import {
  BrowserWindow,
  ipcMain,
  screen,
  type BrowserWindowConstructorOptions,
  type WebContents,
  type WebPreferences
} from 'electron';
import { statSync } from 'node:fs';
import type { Character } from '@shared/character';
import { IPC } from '@shared/ipc';
import {
  anchorInWindow,
  anchorOnScreen,
  clampAnchor,
  defaultAnchorPosition,
  layoutAnchor,
  layoutFrame,
  placeWindow,
  pointInRect,
  type Point,
  type Rect
} from '@shared/layout';
import type { StagePayload, StageSound, StageVisual } from '@shared/types';
import { createLogger } from '../app/logger';
import { assetUrl } from '../characters/assetProtocol';
import type { CharacterStore } from '../characters/store';
import { ClickThroughController } from './clickThrough';
import { loadPage } from './rendererUrl';

const log = createLogger('windows');

/** `window.open` target names look like this, so the handler can tell whose window is being asked for. */
const FRAME_PREFIX = 'character:';

/**
 * How often the cursor is checked against each character's rectangle.
 *
 * The windows ignore the mouse, so they cannot be told when the cursor
 * arrives over them. Electron's answer is `forward: true`, a global
 * `WH_MOUSE_LL` hook that routes every mouse move on the machine through
 * this process — not something to hold for as long as a character is on
 * screen, which is all day. A `GetCursorPos` is as near free as a system call
 * gets, so it is asked often.
 *
 * Often, because this interval is how long a character cannot be grabbed
 * after the cursor reaches it. At an eighth of a second a natural "move
 * there and press" landed inside the gap about as often as not. Thirty
 * milliseconds is under the time a hand takes to stop moving and press.
 */
const HOT_POLL_MS = 30;

/**
 * A window takes the mouse this far outside the character's own rectangle. A
 * cursor travelling toward it crosses the margin first, so by the time it is
 * over the character the window is already listening.
 */
const HOT_MARGIN_PX = 10;

/** One window move per frame while a character is being dragged. */
const DRAG_TICK_MS = 16;
/** A drag whose end never arrives (the renderer died mid-gesture) must not hold the window forever. */
const DRAG_LIMIT_MS = 30_000;

/** A page that never says it has painted still gets its window, eventually. */
const REVEAL_FALLBACK_MS = 2_000;

interface Geometry {
  frame: Rect;
  anchor: Rect;
  /** The anchor's top-left on screen, inside whichever display it is on. */
  position: Point;
  window: Rect;
}

interface Live {
  id: string;
  win: BrowserWindow;
  clickThrough: ClickThroughController;
  geometry: Geometry;
  shown: boolean;
  revealTimer: NodeJS.Timeout | null;
}

/** Who decides whether a character is on screen and whether it should be moving. */
export interface PresenceSource {
  /** `anchor` is where the character itself would sit, in screen coordinates. */
  isPresent(character: Character, anchor: Rect): boolean;
  /** False while nobody is there to watch. */
  isWatching(): boolean;
  /** A character was right-clicked. */
  onMenu(id: string): void;
  /** A character was clicked. */
  onClick(id: string): void;
  /** The line a character is saying now, if any. */
  speechFor(id: string): { id: string; text: string; durationMs: number } | null;
  /** Speaking, or only just finished: on screen whatever its presence rules say. */
  isOnStage(id: string): boolean;
}

interface Drag {
  id: string;
  timer: NodeJS.Timeout;
  limit: NodeJS.Timeout;
}

/**
 * One small transparent window per character that is on screen, and none at
 * all when nobody is.
 *
 * Every window is opened with `window.open` from one hidden host page, which
 * puts them all in a single renderer process: measured, three windows opened
 * that way cost 27 MB of private memory between them against 26 MB *each*
 * when created independently. The host goes with the last character, and the
 * renderer process with it.
 */
export class CharacterWindows {
  private host: BrowserWindow | null = null;
  private hostLoaded: Promise<void> | null = null;
  private readonly live = new Map<string, Live>();
  /** Asked for, not yet handed back by `did-create-window`. */
  private readonly opening = new Set<string>();
  private hotTimer: NodeJS.Timeout | null = null;
  private drag: Drag | null = null;
  private previewId: string | null = null;
  private readonly shownFor = new Map<string, { until: number; timer: NodeJS.Timeout }>();
  /** Sounds asked for before their character's window was up. */
  private readonly pendingSounds = new Map<string, StageSound[]>();

  constructor(
    private readonly store: CharacterStore,
    private readonly preloadPath: string,
    private readonly presence: PresenceSource
  ) {}

  start(): void {

    // A display changed size or went away: put everyone back inside what is left.
    screen.on('display-metrics-changed', this.onDisplaysChanged);
    screen.on('display-removed', this.onDisplaysChanged);

    ipcMain.handle(IPC.stageGet, (event) => {
      const live = this.bySender(event.sender);
      const character = live ? this.store.get(live.id) : null;
      return live && character ? this.payload(character, live.geometry) : null;
    });
    ipcMain.on(IPC.stagePainted, (event) => {
      const live = this.bySender(event.sender);
      if (live) this.reveal(live);
    });
    ipcMain.on(IPC.stageDragStart, (event) => {
      const live = this.bySender(event.sender);
      if (live) this.beginDrag(live);
    });
    ipcMain.on(IPC.stageClick, (event) => {
      const live = this.bySender(event.sender);
      if (live) this.presence.onClick(live.id);
    });
    ipcMain.on(IPC.stageMenu, (event) => {
      const live = this.bySender(event.sender);
      if (live) this.presence.onMenu(live.id);
    });
    ipcMain.on(IPC.stageDragEnd, (event) => {
      const live = this.bySender(event.sender);
      if (live && this.drag?.id === live.id) this.endDrag();
    });

    this.sync();
  }

  stop(): void {
    screen.off('display-metrics-changed', this.onDisplaysChanged);
    screen.off('display-removed', this.onDisplaysChanged);
    ipcMain.removeHandler(IPC.stageGet);
    ipcMain.removeAllListeners(IPC.stagePainted);
    ipcMain.removeAllListeners(IPC.stageDragStart);
    ipcMain.removeAllListeners(IPC.stageDragEnd);
    ipcMain.removeAllListeners(IPC.stageMenu);
    ipcMain.removeAllListeners(IPC.stageClick);
    for (const timer of this.shownFor.values()) clearTimeout(timer.timer);
    this.shownFor.clear();
    for (const live of [...this.live.values()]) this.close(live);
    this.destroyHost();
  }

  /** Something presence depends on has changed: look again at who should be on screen. */
  refresh(): void {
    this.sync();
  }

  /**
   * The character being laid out in the editor, or null. It is put on screen
   * whatever its presence rules say — the point is to see the layout where it
   * will be — and its text elements show sample text.
   */
  setPreview(id: string | null): void {
    if (id === this.previewId) return;
    const before = this.previewId;
    this.previewId = id;
    this.sync();
    // A character that stays on screen either way still has to drop or pick up its sample text.
    for (const changed of [before, id]) {
      const live = changed ? this.live.get(changed) : undefined;
      const character = changed ? this.store.get(changed) : null;
      if (live && character) this.update(live, character);
    }
  }

  /** How many characters have a window right now. */
  get count(): number {
    return this.live.size;
  }

  private readonly onDisplaysChanged = (): void => this.sync();

  /* ------------------------------------------------------------------ */
  /* Which windows exist                                                 */
  /* ------------------------------------------------------------------ */

  /** Brings the windows in line with the characters: opens, updates and closes as needed. */
  private sync(): void {
    const wanted = new Map<string, Character>();
    for (const entry of this.store.list()) {
      if (entry.ok && this.wants(entry.character)) wanted.set(entry.id, entry.character);
    }

    for (const live of [...this.live.values()]) {
      if (!wanted.has(live.id)) this.close(live);
    }
    for (const [id, character] of wanted) {
      const live = this.live.get(id);
      if (live) this.update(live, character);
      else if (!this.opening.has(id)) void this.open(id);
    }

    if (wanted.size === 0 && this.opening.size === 0) this.destroyHost();
  }

  /**
   * On screen for a while whatever its presence rules say — a rule asked it
   * to come out. Longer if it was already out for longer.
   */
  showFor(id: string, ms: number): void {
    const until = Date.now() + ms;
    const current = this.shownFor.get(id);
    if (current && current.until >= until) return;
    if (current) clearTimeout(current.timer);
    const timer = setTimeout(() => {
      this.shownFor.delete(id);
      this.sync();
    }, ms);
    timer.unref?.();
    this.shownFor.set(id, { until, timer });
    this.sync();
  }

  /**
   * Plays a sound from the character's own window. A window still on its way
   * — a character coming out to say the line this sound goes with — plays it
   * once it is up. False when there is no window and none coming.
   */
  playSound(id: string, file: string, volume: number): boolean {
    if (!this.store.assetPath(id, file)) return false;
    const sound: StageSound = { url: assetUrl(id, file), volume };
    const live = this.live.get(id);
    if (live?.shown && !live.win.isDestroyed()) {
      live.win.webContents.send(IPC.stageSound, sound);
      return true;
    }
    if (!live && !this.opening.has(id)) return false;
    const waiting = this.pendingSounds.get(id) ?? [];
    waiting.push(sound);
    this.pendingSounds.set(id, waiting);
    return true;
  }

  private wants(character: Character): boolean {
    if (!character.enabled) return false;
    if (character.id === this.previewId || this.shownFor.has(character.id) || this.presence.isOnStage(character.id)) return true;
    const { anchor, position } = this.geometry(character);
    return this.presence.isPresent(character, { x: position.x, y: position.y, width: anchor.width, height: anchor.height });
  }

  private async open(id: string): Promise<void> {
    this.opening.add(id);
    try {
      const host = await this.ensureHost();
      // It may have been disabled or deleted while the host was loading.
      const character = this.store.get(id);
      if (!character || !this.wants(character) || host.isDestroyed()) {
        this.opening.delete(id);
        this.sync();
        return;
      }
      // The id is a bare `[a-z0-9-]` name by schema, so it is safe inside the string.
      await host.webContents.executeJavaScript(
        `void window.open('stage.html?character=${id}', '${FRAME_PREFIX}${id}')`
      );
    } catch (err) {
      log.error(`cannot open a window for "${id}": ${String(err)}`);
      this.opening.delete(id);
    }
  }

  private ensureHost(): Promise<BrowserWindow> {
    if (this.host && !this.host.isDestroyed() && this.hostLoaded) {
      const host = this.host;
      return this.hostLoaded.then(() => host);
    }

    const host = new BrowserWindow({
      width: 1,
      height: 1,
      show: false,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: this.webPreferences()
    });
    this.host = host;

    host.webContents.setWindowOpenHandler(({ frameName }) => {
      const id = frameName.startsWith(FRAME_PREFIX) ? frameName.slice(FRAME_PREFIX.length) : '';
      const character = this.opening.has(id) ? this.store.get(id) : null;
      if (!character) return { action: 'deny' };
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          ...WINDOW_OPTIONS,
          ...this.geometry(character).window,
          // Stated, not inherited: a window made by `window.open` does not
          // get its opener's preload, and comes up with no bridge at all.
          webPreferences: this.webPreferences()
        }
      };
    });
    host.webContents.on('did-create-window', (win, details) => {
      this.adopt(details.frameName.slice(FRAME_PREFIX.length), win);
    });
    host.webContents.on('will-navigate', (event) => event.preventDefault());
    host.webContents.on('render-process-gone', (_event, details) => {
      log.error(`character renderer gone: ${details.reason}`);
    });
    host.on('closed', () => {
      if (this.host === host) {
        this.host = null;
        this.hostLoaded = null;
      }
    });

    this.hostLoaded = loadPage(host, 'host');
    return this.hostLoaded.then(() => host);
  }

  private webPreferences(): WebPreferences {
    return { preload: this.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true };
  }

  private destroyHost(): void {
    const host = this.host;
    this.host = null;
    this.hostLoaded = null;
    if (host && !host.isDestroyed()) host.destroy();
  }

  private adopt(id: string, win: BrowserWindow): void {
    this.opening.delete(id);
    const character = this.store.get(id);
    if (!character || !this.wants(character)) {
      win.destroy();
      this.sync();
      return;
    }

    const live: Live = {
      id,
      win,
      // Owns the window's click-through from here on; starts out ignoring the mouse.
      clickThrough: new ClickThroughController(win),
      geometry: this.geometry(character),
      shown: false,
      revealTimer: null
    };
    this.live.set(id, live);

    win.setMenuBarVisibility(false);
    // Nothing in a character window may navigate or open windows.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Only once its own page is in: a window made by `window.open` reaches
    // that page by a navigation, and refusing it leaves the window blank.
    win.webContents.once('did-finish-load', () => {
      win.webContents.on('will-navigate', (event) => event.preventDefault());
    });
    // A broken preload or page is otherwise completely silent: the window
    // exists and nothing ever appears in it.
    win.webContents.on('preload-error', (_event, preload, error) => {
      log.error(`stage preload failed (${preload}): ${error.message}`);
    });
    win.webContents.on('did-fail-load', (_event, code, description, url) => {
      log.error(`stage failed to load (${code} ${description}) ${url}`);
    });
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error' || event.level === 'warning') log.warn(`stage console (${id}): ${event.message}`);
    });
    win.on('closed', () => {
      if (this.live.get(id) !== live) return;
      this.forget(live);
    });

    live.revealTimer = setTimeout(() => this.reveal(live), REVEAL_FALLBACK_MS);
    live.revealTimer.unref?.();
  }

  /**
   * Shown only once the page has something on it: a transparent window shown
   * before its first frame flashes, and a character should arrive, not load.
   */
  private reveal(live: Live): void {
    if (live.revealTimer) {
      clearTimeout(live.revealTimer);
      live.revealTimer = null;
    }
    if (live.shown || live.win.isDestroyed()) return;
    live.shown = true;
    live.win.setBounds(live.geometry.window);
    // Never `show()` — that would take focus.
    live.win.showInactive();
    live.win.setAlwaysOnTop(true, 'screen-saver');
    live.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.startHotPolling();
    for (const sound of this.pendingSounds.get(live.id) ?? []) live.win.webContents.send(IPC.stageSound, sound);
    this.pendingSounds.delete(live.id);
    const { x, y, width, height } = live.geometry.window;
    log.debug(`"${live.id}" shown at ${x},${y} ${width}x${height}`);
  }

  private update(live: Live, character: Character): void {
    live.geometry = this.geometry(character);
    if (live.win.isDestroyed()) return;
    // Mid-drag the window is wherever the cursor has taken it.
    if (this.drag?.id !== live.id) live.win.setBounds(live.geometry.window);
    live.win.webContents.send(IPC.stageUpdate, this.payload(character, live.geometry));
  }

  private close(live: Live): void {
    log.debug(`"${live.id}" hidden`);
    this.forget(live);
    if (!live.win.isDestroyed()) live.win.destroy();
  }

  private forget(live: Live): void {
    if (live.revealTimer) clearTimeout(live.revealTimer);
    live.revealTimer = null;
    if (this.drag?.id === live.id) this.cancelDrag();
    this.pendingSounds.delete(live.id);
    this.live.delete(live.id);
    if (this.live.size === 0) this.stopHotPolling();
  }

  private bySender(sender: WebContents): Live | null {
    for (const live of this.live.values()) {
      if (!live.win.isDestroyed() && live.win.webContents.id === sender.id) return live;
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Where they are and what they show                                   */
  /* ------------------------------------------------------------------ */

  private geometry(character: Character): Geometry {
    const frame = layoutFrame(character.layout.elements);
    const anchor = layoutAnchor(character.layout.elements);
    const stored = character.presence.position;
    // The display the character is on — or, if that display has gone, the
    // nearest one, which is what makes an unplugged monitor a clamp and not a
    // character stranded off screen.
    const display = stored
      ? screen.getDisplayMatching({ x: Math.round(stored.x), y: Math.round(stored.y), width: Math.round(anchor.width), height: Math.round(anchor.height) })
      : screen.getPrimaryDisplay();
    const position = stored
      ? clampAnchor(stored, anchor, display.workArea)
      : defaultAnchorPosition(anchor, display.workArea);
    return { frame, anchor, position, window: placeWindow(frame, anchor, position) };
  }

  private payload(character: Character, geometry: Geometry): StagePayload {
    const states = character.appearance.states;
    const speech = this.presence.speechFor(character.id);
    // While a line is up it wears its speaking look, if it has one.
    const idle = (speech ? states.speaking : undefined) ?? states.idle ?? Object.values(states)[0] ?? null;
    return {
      id: character.id,
      name: character.name,
      frame: geometry.frame,
      elements: character.layout.elements,
      opacity: character.appearance.opacity,
      flip: character.appearance.flip,
      visual: idle ? this.visual(character.id, idle.type, idle.src) : null,
      playing: this.presence.isWatching(),
      restSec: character.appearance.restSec,
      preview: character.id === this.previewId,
      speech
    };
  }

  private visual(id: string, type: StageVisual['type'], file: string): StageVisual | null {
    const path = this.store.assetPath(id, file);
    if (!path) return null;
    // A replaced file keeps its name, so the address alone cannot tell the
    // page anything changed. Its modification time rides along as a query,
    // which the protocol handler ignores.
    try {
      return { type, url: `${assetUrl(id, file)}?v=${Math.round(statSync(path).mtimeMs)}` };
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* The mouse                                                           */
  /* ------------------------------------------------------------------ */

  private startHotPolling(): void {
    if (this.hotTimer) return;
    this.hotTimer = setInterval(() => this.pollHot(), HOT_POLL_MS);
    this.hotTimer.unref?.();
  }

  private stopHotPolling(): void {
    if (!this.hotTimer) return;
    clearInterval(this.hotTimer);
    this.hotTimer = null;
  }

  private pollHot(): void {
    // Mid-drag the window keeps the mouse whatever is under the cursor: the
    // window is what is moving.
    if (this.drag) return;
    const cursor = screen.getCursorScreenPoint();
    for (const live of this.live.values()) {
      if (!live.shown || live.win.isDestroyed()) continue;
      const inside = anchorInWindow(live.geometry.frame, live.geometry.anchor);
      const hot: Rect = {
        x: live.geometry.window.x + inside.x - HOT_MARGIN_PX,
        y: live.geometry.window.y + inside.y - HOT_MARGIN_PX,
        width: inside.width + HOT_MARGIN_PX * 2,
        height: inside.height + HOT_MARGIN_PX * 2
      };
      // Arriving is acted on at once; leaving can wait out the debounce.
      if (pointInRect(cursor, hot)) live.clickThrough.grab();
      else live.clickThrough.request(false);
    }
  }

  /**
   * Follows the cursor until `endDrag`. Driven from here rather than by the
   * renderer reporting deltas: it keeps working when the cursor outruns the
   * window, and it does not put an IPC message on every mouse move.
   */
  private beginDrag(live: Live): void {
    if (this.drag || live.win.isDestroyed()) return;

    const bounds = live.win.getBounds();
    const cursorStart = screen.getCursorScreenPoint();
    const { width, height } = live.geometry.window;

    const timer = setInterval(() => {
      if (live.win.isDestroyed()) return;
      const cursor = screen.getCursorScreenPoint();
      // `setBounds` with the size restated, not `setPosition`: crossing onto a
      // display with a different scale factor otherwise resizes the window.
      live.win.setBounds({
        x: bounds.x + cursor.x - cursorStart.x,
        y: bounds.y + cursor.y - cursorStart.y,
        width,
        height
      });
    }, DRAG_TICK_MS);
    const limit = setTimeout(() => this.endDrag(), DRAG_LIMIT_MS);
    limit.unref?.();

    this.drag = { id: live.id, timer, limit };
  }

  private cancelDrag(): void {
    if (!this.drag) return;
    clearInterval(this.drag.timer);
    clearTimeout(this.drag.limit);
    this.drag = null;
  }

  /** Puts the character down where it is, and remembers the place. */
  private endDrag(): void {
    const id = this.drag?.id;
    this.cancelDrag();
    const live = id ? this.live.get(id) : null;
    const character = id ? this.store.get(id) : null;
    if (!live || !character || live.win.isDestroyed()) return;

    const bounds = live.win.getBounds();
    const position = anchorOnScreen(live.geometry.frame, live.geometry.anchor, bounds);
    // Saving goes back round through `sync`, which clamps it to the display
    // it was dropped on and moves the window there.
    const result = this.store.save({ ...character, presence: { ...character.presence, position } });
    if (!result.ok) {
      log.warn(`could not save where "${id}" was put: ${result.error}`);
      this.update(live, character);
    }
  }
}

const WINDOW_OPTIONS: BrowserWindowConstructorOptions = {
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  movable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  // Without this a character steals focus from games and text fields.
  focusable: false,
  hasShadow: false,
  show: false
};

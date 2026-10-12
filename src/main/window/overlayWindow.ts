import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { IPC } from '@shared/ipc';
import {
  DEFAULT_LAYOUT,
  OVERLAY_HEIGHT,
  OVERLAY_WIDTH,
  defaultPinnedUnit,
  placeNamed,
  placePinned,
  pointInRect,
  unitOffset,
  type OverlayLayout,
  type PinnedPlacement,
  type Point,
  type Rect
} from '@shared/overlayLayout';
import type {
  CueSources,
  HotRect,
  OverlayPlacement,
  RuntimeStatePayload,
  SkinId,
  SpeechShowPayload,
  StatePayload
} from '@shared/types';
import type { OverlayPresenter } from '../core/speechDirector';
import { createLogger } from '../log/logger';
import { ClickThroughController } from './clickThrough';
import { displayUnderCursor } from './positioning';
import { loadPage } from './rendererUrl';

const log = createLogger('overlay');

/**
 * Long enough for the whole exit to finish before the window goes: the text
 * fades over 140 ms and only then does the unit slide out over 260 ms (§5).
 */
const EXIT_ANIMATION_MS = 420;

/**
 * How often the cursor is checked against the pinned character's hot area.
 *
 * The overlay ignores the mouse, so it cannot be told when the cursor arrives
 * over it. Electron's answer is `forward: true`, a global `WH_MOUSE_LL` hook —
 * fine for the few seconds a line is on screen, and not something to hold for
 * as long as the character is pinned, which is all day (see `clickThrough.ts`
 * for what that hook costs). A `GetCursorPos` is as near free as a system
 * call gets, so it is asked often.
 *
 * Often, because this interval is how long the character cannot be grabbed
 * after the cursor reaches it. At an eighth of a second, a natural "move
 * there and press" landed inside the gap about as often as not: the press
 * went to the desktop underneath and the character would not drag. Thirty
 * milliseconds is under the time a hand takes to stop moving and press.
 */
const HOT_POLL_MS = 30;

/**
 * The window takes the mouse this far outside the character's own rectangle.
 * A cursor travelling toward it crosses the margin first, so by the time it
 * is actually over the character the window is already listening. The cost is
 * a thin border around the eye that swallows clicks without doing anything.
 */
const HOT_MARGIN_PX = 10;

/** One window move per frame while the character is being dragged. */
const DRAG_TICK_MS = 16;
/** A drag whose end never arrives (the renderer died mid-gesture) must not hold the window forever. */
const DRAG_LIMIT_MS = 30_000;

interface Drag {
  timer: NodeJS.Timeout;
  limit: NodeJS.Timeout;
}

export class OverlayWindow implements OverlayPresenter {
  private win: BrowserWindow | null = null;
  private clickThrough: ClickThroughController | null = null;
  private hideTimer: NodeJS.Timeout | null = null;
  private namedPlacement: OverlayPlacement = 'right';
  private ready = false;
  private pending: SpeechShowPayload | null = null;
  private skinId: SkinId = 'eye';
  private cues: CueSources = { appear: null, disappear: null };
  private presetName = 'Ordis';
  private appearanceVideoUrl: string | null = null;
  private cueVolume = 1;
  private appearSoundEnabled = true;
  private disappearSoundEnabled = true;
  private runtimeState: RuntimeStatePayload = { muted: false, snoozedUntil: null };

  /* ---- pinned presence ---------------------------------------------- */
  private pinned = false;
  /** The unit's top-left on screen; null until the user has dragged it. */
  private pinnedPosition: Point | null = null;
  private layout: OverlayLayout = DEFAULT_LAYOUT;
  private dormant = false;
  /** A fullscreen application is in front; a pinned character steps aside for it. */
  private concealed = false;
  /** Between `show` and the `hide` or `interrupt` that ends the line. */
  private speaking = false;
  private hotRect: Rect | null = null;
  private hotTimer: NodeJS.Timeout | null = null;
  private drag: Drag | null = null;

  /** Called with the unit's new position when the user drops the character somewhere. */
  onPinnedMoved: ((position: Point) => void) | null = null;

  create(preloadPath: string): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;

    // Created once at startup and never destroyed — creating a transparent
    // window on demand causes a visible white flash on Windows (§10).
    const win = new BrowserWindow({
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      // Without this the overlay steals focus from games and text fields.
      focusable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    });

    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setMenuBarVisibility(false);

    win.webContents.on('did-finish-load', () => {
      this.ready = true;
      // The renderer defaults to the persona's skin until told otherwise, so
      // a non-default choice has to arrive without waiting for a state change.
      this.pushState();
      // A character pinned in settings is on screen from the first frame,
      // not from the first thing it happens to say.
      this.applyPresence();
      if (this.pending) {
        const payload = this.pending;
        this.pending = null;
        this.show(payload);
      }
    });

    // Nothing in the overlay may navigate or open windows.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());

    // A broken preload or renderer is otherwise completely silent: the
    // director keeps deciding to speak and nothing ever appears on screen.
    win.webContents.on('preload-error', (_event, preload, error) => {
      log.error(`preload failed (${preload}): ${error.message}`);
    });
    win.webContents.on('did-fail-load', (_event, code, description, url) => {
      log.error(`overlay failed to load (${code} ${description}) ${url}`);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      log.error(`overlay renderer gone: ${details.reason}`);
    });
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error' || event.level === 'warning') {
        log.warn(`overlay console: ${event.message}`);
      }
    });

    this.win = win;
    // Owns click-through, including when the mouse hook goes in — see there.
    this.clickThrough = new ClickThroughController(win);

    void loadPage(win, 'index').catch((err) => log.error(`failed to load overlay: ${String(err)}`));

    screen.on('display-metrics-changed', () => this.reposition());
    screen.on('display-removed', () => this.reposition());

    return win;
  }

  get browserWindow(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  /** Where the unpinned character turns up. A pinned one sits where it was dragged instead. */
  setPlacement(placement: OverlayPlacement): void {
    if (placement === this.namedPlacement) return;
    this.namedPlacement = placement;
    if (!this.pinned && this.browserWindow?.isVisible()) this.reposition();
  }

  /** Puts the unpinned window at its named place on the screen the cursor is on. */
  private placeUnpinned(win: BrowserWindow): void {
    const placement = placeNamed(this.namedPlacement, displayUnderCursor().workArea);
    // The layout goes first: the renderer must know which way the text runs
    // before the line that is about to be shown reaches it.
    this.layout = placement.layout;
    this.pushState();
    win.setBounds({ ...placement.window, width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT });
  }

  setInteractive(interactive: boolean): void {
    // Mid-drag the window has to keep the mouse whatever the renderer thinks
    // is under the cursor: the window is what is moving.
    if (this.drag) return;
    this.clickThrough?.request(interactive);
  }

  /* --------------------------- pinned presence ----------------------- */

  /**
   * Pinned, the character stays on screen between lines, where the user put
   * it. Unpinned, it arrives to speak and leaves — the original behaviour.
   */
  setPinned(options: { pinned: boolean; position: Point | null }): void {
    const samePosition =
      options.position?.x === this.pinnedPosition?.x && options.position?.y === this.pinnedPosition?.y;
    if (options.pinned === this.pinned && samePosition) return;
    this.pinned = options.pinned;
    this.pinnedPosition = options.position;
    this.applyPresence();
  }

  /** Muted, snoozed or in quiet hours. The pinned eye closes; nothing else changes. */
  setDormant(dormant: boolean): void {
    if (dormant === this.dormant) return;
    this.dormant = dormant;
    this.pushState();
  }

  /** A fullscreen application took the screen, or gave it back. */
  setConcealed(concealed: boolean): void {
    if (concealed === this.concealed) return;
    this.concealed = concealed;
    this.applyPresence();
  }

  /** Where the pinned character takes the mouse, in window coordinates. */
  setHotRect(rect: HotRect | null): void {
    this.hotRect = rect;
  }

  /** The character stays up with nothing to say. */
  private get lingers(): boolean {
    return this.pinned && !this.concealed;
  }

  private placement(): PinnedPlacement {
    const unit = this.pinnedPosition ?? defaultPinnedUnit(screen.getPrimaryDisplay().workArea);
    // The display the unit is on — or, if that display has gone, the nearest
    // one, which is what makes an unplugged monitor a clamp and not a
    // character stranded off screen.
    const display = screen.getDisplayMatching({ ...unit, width: 1, height: 1 });
    return placePinned(unit, display.workArea);
  }

  /** Brings the window in line with pinned / concealed / speaking. */
  private applyPresence(): void {
    const win = this.browserWindow;
    if (!win || !this.ready) return;

    if (!this.pinned) {
      this.stopHotPolling();
      // The layout is chosen when a line is shown, from the named placement.
      this.pushState();
      this.hideIfIdle(win);
      return;
    }

    const placement = this.placement();
    this.layout = placement.layout;
    this.pushState();
    win.setBounds({ ...placement.window, width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT });

    if (!this.lingers) {
      this.stopHotPolling();
      this.hideIfIdle(win);
      return;
    }
    if (!win.isVisible()) {
      // Never `show()` — that would take focus.
      win.showInactive();
      win.setAlwaysOnTop(true, 'screen-saver');
    }
    this.startHotPolling();
  }

  /** Hides the window unless a line is on screen or on its way out. */
  private hideIfIdle(win: BrowserWindow): void {
    if (this.speaking || this.hideTimer || !win.isVisible()) return;
    win.hide();
    this.clickThrough?.reset();
  }

  private startHotPolling(): void {
    if (this.hotTimer) return;
    this.hotTimer = setInterval(() => this.pollHotRect(), HOT_POLL_MS);
    this.hotTimer.unref?.();
  }

  private stopHotPolling(): void {
    if (!this.hotTimer) return;
    clearInterval(this.hotTimer);
    this.hotTimer = null;
  }

  private pollHotRect(): void {
    const win = this.browserWindow;
    // While a line is up the forwarding hook is in and the renderer does this
    // job itself, for the text as well as the eye; two voices on one switch
    // would have it flapping.
    if (!win || !win.isVisible() || this.drag || this.speaking || this.hideTimer) return;
    if (!this.hotRect) {
      this.clickThrough?.request(false);
      return;
    }
    const bounds = win.getBounds();
    const hot: Rect = {
      x: bounds.x + this.hotRect.x - HOT_MARGIN_PX,
      y: bounds.y + this.hotRect.y - HOT_MARGIN_PX,
      width: this.hotRect.width + HOT_MARGIN_PX * 2,
      height: this.hotRect.height + HOT_MARGIN_PX * 2
    };
    // Arriving is acted on at once; leaving can wait out the debounce.
    if (pointInRect(screen.getCursorScreenPoint(), hot)) this.clickThrough?.grab();
    else this.clickThrough?.request(false);
  }

  /* --------------------------- dragging ------------------------------ */

  /**
   * Follows the cursor until `endDrag`. Driven from here rather than by the
   * renderer reporting deltas: it keeps working when the cursor outruns the
   * window, and it does not put an IPC message on every mouse move.
   */
  beginDrag(): void {
    const win = this.browserWindow;
    if (!win || !this.pinned || this.drag) return;

    const bounds = win.getBounds();
    const cursorStart = screen.getCursorScreenPoint();

    const timer = setInterval(() => {
      const target = this.browserWindow;
      if (!target) return;
      const cursor = screen.getCursorScreenPoint();
      // `setBounds` with the size restated, not `setPosition`: crossing onto a
      // display with a different scale factor otherwise resizes the window.
      target.setBounds({
        x: bounds.x + cursor.x - cursorStart.x,
        y: bounds.y + cursor.y - cursorStart.y,
        width: OVERLAY_WIDTH,
        height: OVERLAY_HEIGHT
      });
    }, DRAG_TICK_MS);
    const limit = setTimeout(() => this.endDrag(), DRAG_LIMIT_MS);
    limit.unref?.();

    this.drag = { timer, limit };
  }

  /**
   * Drops the character where it is. The layout is only re-chosen now, not
   * during the drag — flipping the text to the other side mid-gesture would
   * jump the window out from under the cursor.
   */
  endDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    clearInterval(drag.timer);
    clearTimeout(drag.limit);
    this.drag = null;

    const win = this.browserWindow;
    if (!win) return;
    const bounds = win.getBounds();
    const offset = unitOffset(this.layout);
    const dropped = { x: bounds.x + offset.x, y: bounds.y + offset.y };
    const display = screen.getDisplayMatching({ ...dropped, width: 1, height: 1 });
    const placement = placePinned(dropped, display.workArea);

    this.pinnedPosition = placement.unit;
    this.applyPresence();
    this.onPinnedMoved?.(placement.unit);
  }

  /**
   * Everything the active preset determines: its skin (settings values, not
   * runtime ones, so merged in here rather than threaded through
   * `RuntimeState`), its cue sounds and its display name, plus a custom
   * appearance video if it has one — which replaces the skin entirely.
   * Resolved by main whenever the active preset changes (or on startup) and
   * pushed together, so the renderer never has to reconcile a partial update.
   */
  setPreset(preset: {
    name: string;
    skinId: SkinId;
    cues: CueSources;
    videoUrl: string | null;
  }): void {
    const unchanged =
      preset.name === this.presetName &&
      preset.skinId === this.skinId &&
      preset.videoUrl === this.appearanceVideoUrl &&
      preset.cues.appear === this.cues.appear &&
      preset.cues.disappear === this.cues.disappear;
    if (unchanged) return;

    this.presetName = preset.name;
    this.skinId = preset.skinId;
    this.cues = preset.cues;
    this.appearanceVideoUrl = preset.videoUrl;
    this.pushState();
  }

  /**
   * The user's cue volume and per-cue on/off, from `Settings.overlay`. Global
   * rather than per-preset, so it lives alongside the skin/cue push instead
   * of riding on `setPreset` — a preset switch must not reset it.
   */
  setAudioOptions(options: {
    volume: number;
    appearEnabled: boolean;
    disappearEnabled: boolean;
  }): void {
    const unchanged =
      options.volume === this.cueVolume &&
      options.appearEnabled === this.appearSoundEnabled &&
      options.disappearEnabled === this.disappearSoundEnabled;
    if (unchanged) return;

    this.cueVolume = options.volume;
    this.appearSoundEnabled = options.appearEnabled;
    this.disappearSoundEnabled = options.disappearEnabled;
    this.pushState();
  }

  sendState(state: RuntimeStatePayload): void {
    this.runtimeState = state;
    this.pushState();
  }

  private pushState(): void {
    this.browserWindow?.webContents.send(IPC.stateUpdate, {
      ...this.runtimeState,
      pinned: this.pinned,
      dormant: this.dormant,
      layout: this.layout,
      skinId: this.skinId,
      cues: this.cues,
      presetName: this.presetName,
      appearanceVideoUrl: this.appearanceVideoUrl,
      cueVolume: this.cueVolume,
      appearSoundEnabled: this.appearSoundEnabled,
      disappearSoundEnabled: this.disappearSoundEnabled
    } satisfies StatePayload);
  }

  /* --------------------------- OverlayPresenter --------------------- */

  show(payload: SpeechShowPayload): void {
    const win = this.browserWindow;
    if (!win) return;
    if (!this.ready) {
      this.pending = payload;
      return;
    }

    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    this.speaking = true;
    if (!win.isVisible()) {
      // A pinned character speaks from where it lives, including the rare
      // line that is urgent enough to be said over a fullscreen application.
      if (this.pinned) {
        win.setBounds({ ...this.placement().window, width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT });
      } else {
        this.placeUnpinned(win);
      }
      // Never `show()` — that would take focus.
      win.showInactive();
      win.setAlwaysOnTop(true, 'screen-saver');
    }
    // Only now does the overlay need to know where the pointer is, and the
    // hook that tells it is charged to every mouse move on the machine.
    this.clickThrough?.setForwarding(true);
    win.webContents.send(IPC.speechShow, payload);
  }

  hide(): void {
    const win = this.browserWindow;
    if (!win) return;
    this.speaking = false;
    win.webContents.send(IPC.speechHide);
    this.scheduleWindowHide(EXIT_ANIMATION_MS);
  }

  interrupt(): void {
    const win = this.browserWindow;
    if (!win) return;
    this.speaking = false;
    win.webContents.send(IPC.speechInterrupt);
    // An interrupt is usually followed at once by the line that caused it,
    // and `show` cancels this. When it is not — a mute, say — nothing else
    // would ever take the window down or the mouse hook out.
    this.scheduleWindowHide(EXIT_ANIMATION_MS);
  }

  /* ------------------------------------------------------------------ */

  private scheduleWindowHide(delayMs: number): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      const win = this.browserWindow;
      if (!win) return;
      // Either way the hook comes out and the window stops taking the mouse;
      // a pinned character just does not leave with them.
      this.clickThrough?.reset();
      if (!this.lingers) win.hide();
    }, delayMs);
    this.hideTimer.unref?.();
  }

  private reposition(): void {
    const win = this.browserWindow;
    if (!win) return;
    if (this.pinned) {
      // A display changed size or went away: put the character back inside
      // whatever is left.
      this.applyPresence();
      return;
    }
    this.placeUnpinned(win);
  }

  static preloadPath(): string {
    return join(__dirname, '../preload/index.js');
  }
}

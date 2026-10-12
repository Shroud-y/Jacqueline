import type { BrowserWindow } from 'electron';

/** §10.2 — rapid flipping produces input glitches in the app underneath. */
const DEBOUNCE_MS = 50;

export class ClickThroughController {
  private interactive = false;
  private forward = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly win: BrowserWindow) {
    this.apply(false);
  }

  /**
   * Mouse-move forwarding is charged to the whole machine, not to this window.
   * Electron implements it with a global `WH_MOUSE_LL` hook, so every mouse
   * move on the system is routed through this process's main thread before the
   * pointer moves. Held open for the app's lifetime — which is what passing
   * `forward` at window creation did — the pointer stutters system-wide
   * whenever that thread is busy, most visibly through the launch that builds
   * the window, loads the bank and starts the monitors.
   *
   * Measured with the overlay hidden: 0 ms of main-process CPU over five idle
   * seconds, 78 ms over five seconds of nothing but mouse movement.
   *
   * The forwarded moves are only read while a bubble is up (`App.tsx` uses
   * them to notice the cursor over the dismiss affordance), so the hook goes
   * in with the window and comes out again when it hides.
   */
  setForwarding(forward: boolean): void {
    if (forward === this.forward) return;
    this.forward = forward;
    // While interactive the window takes real mouse messages and Electron
    // disables forwarding regardless — the flag lands on the next apply.
    if (!this.interactive) this.apply(false);
  }

  /**
   * Takes the mouse now, with no debounce. For the pinned character, where
   * the request comes from a cursor poll rather than from a mouse move, and
   * every millisecond spent waiting is one in which a press on the character
   * falls through to whatever is underneath. Giving the mouse back still goes
   * through `request`, so the flipping the debounce exists to prevent cannot
   * happen: this only ever moves one way.
   */
  grab(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.interactive) return;
    this.interactive = true;
    this.apply(true);
  }

  request(interactive: boolean): void {
    if (interactive === this.interactive) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.interactive = interactive;
      this.apply(interactive);
    }, DEBOUNCE_MS);
    this.timer.unref?.();
  }

  /** Called on hide so the window never stays grabbing the mouse — or hooking it. */
  reset(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.interactive = false;
    this.forward = false;
    this.apply(false);
  }

  private apply(interactive: boolean): void {
    if (this.win.isDestroyed()) return;
    this.win.setIgnoreMouseEvents(!interactive, { forward: this.forward });
  }
}

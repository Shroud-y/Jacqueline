import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { ClickThroughController } from '@main/windows/clickThrough';

/**
 * The flag under test is not a per-window setting: Electron implements
 * `forward` with a global `WH_MOUSE_LL` hook, so while it is set every mouse
 * move on the machine goes through this process's main thread. It used to be
 * passed once at window creation and never withdrawn, which made the pointer
 * stutter system-wide whenever that thread was busy — launch, most of all.
 * These tests pin the lifetime: in with the bubble, out with it.
 */
function fakeWindow(): { win: BrowserWindow; calls: [boolean, boolean][] } {
  const calls: [boolean, boolean][] = [];
  const win = {
    isDestroyed: () => false,
    setIgnoreMouseEvents: (ignore: boolean, options?: { forward?: boolean }) => {
      calls.push([ignore, options?.forward === true]);
    }
  } as unknown as BrowserWindow;
  return { win, calls };
}

const forwarding = (calls: [boolean, boolean][]): boolean => calls[calls.length - 1][1];

describe('click-through', () => {
  it('does not hook the mouse before anything is on screen', () => {
    const { win, calls } = fakeWindow();
    new ClickThroughController(win);
    expect(calls).toEqual([[true, false]]);
  });

  it('hooks while a bubble is up and releases it on hide', () => {
    const { win, calls } = fakeWindow();
    const controller = new ClickThroughController(win);

    controller.setForwarding(true);
    expect(forwarding(calls)).toBe(true);

    controller.reset();
    expect(calls[calls.length - 1]).toEqual([true, false]);
  });

  it('re-hooks for a second phrase after the first has hidden', () => {
    const { win, calls } = fakeWindow();
    const controller = new ClickThroughController(win);
    controller.setForwarding(true);
    controller.reset();

    controller.setForwarding(true);
    expect(forwarding(calls)).toBe(true);
  });

  it('keeps forwarding across an interactive pass under the cursor', () => {
    vi.useFakeTimers();
    const { win, calls } = fakeWindow();
    const controller = new ClickThroughController(win);
    controller.setForwarding(true);

    controller.request(true);
    vi.advanceTimersByTime(50);
    // Interactive means real mouse messages — Electron drops forwarding itself.
    expect(calls[calls.length - 1][0]).toBe(false);

    controller.request(false);
    vi.advanceTimersByTime(50);
    // ...and the bubble is still up, so it has to come back.
    expect(calls[calls.length - 1]).toEqual([true, true]);
    vi.useRealTimers();
  });
});

describe('grab — the pinned character taking the mouse', () => {
  it('takes the mouse at once, with no debounce to wait out', () => {
    vi.useFakeTimers();
    try {
      const { win, calls } = fakeWindow();
      const controller = new ClickThroughController(win);

      controller.grab();
      // No timers advanced: a press that lands in the next millisecond must
      // already find the window listening.
      expect(calls[calls.length - 1]).toEqual([false, false]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing when the window already has the mouse', () => {
    const { win, calls } = fakeWindow();
    const controller = new ClickThroughController(win);
    controller.grab();
    const before = calls.length;

    controller.grab();
    controller.grab();
    expect(calls).toHaveLength(before);
  });

  it('cancels a release that was still waiting out its debounce', () => {
    vi.useFakeTimers();
    try {
      const { win, calls } = fakeWindow();
      const controller = new ClickThroughController(win);
      controller.grab();

      // The cursor slips off the character and comes straight back.
      controller.request(false);
      controller.grab();
      vi.advanceTimersByTime(500);

      expect(calls[calls.length - 1]).toEqual([false, false]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still gives the mouse back through the debounce', () => {
    vi.useFakeTimers();
    try {
      const { win, calls } = fakeWindow();
      const controller = new ClickThroughController(win);
      controller.grab();

      controller.request(false);
      expect(calls[calls.length - 1]).toEqual([false, false]);
      vi.advanceTimersByTime(60);
      expect(calls[calls.length - 1]).toEqual([true, false]);
    } finally {
      vi.useRealTimers();
    }
  });
});

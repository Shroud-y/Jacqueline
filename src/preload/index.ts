import { contextBridge, ipcRenderer } from 'electron';
import type { HotRect, SpeechShowPayload, StatePayload } from '@shared/types';

/**
 * §12 — the overlay's entire surface. Nothing else is exposed: no node, no
 * fs, no arbitrary ipc.
 *
 * The channel names are written out literally rather than imported from
 * `@shared/ipc`: a *value* import shared with the other preload makes Rollup
 * hoist it into a separate chunk, and a sandboxed preload cannot require a
 * second file — it fails with "module not found" and the whole bridge silently
 * never appears. `tests/preload.test.ts` fails if these drift from `IPC`.
 * Type-only imports are erased at build time and are safe.
 */
const CHANNEL = {
  speechShow: 'speech:show',
  speechHide: 'speech:hide',
  speechInterrupt: 'speech:interrupt',
  stateUpdate: 'state:update',
  overlaySetInteractive: 'overlay:setInteractive',
  overlaySetHotRect: 'overlay:setHotRect',
  overlayDragStart: 'overlay:dragStart',
  overlayDragEnd: 'overlay:dragEnd',
  overlayPoke: 'overlay:poke',
  overlayMenu: 'overlay:menu',
  speechFinished: 'speech:finished',
  speechDismissed: 'speech:dismissed'
} as const;

const api = {
  onSpeechShow(handler: (payload: SpeechShowPayload) => void): () => void {
    const listener = (_event: unknown, payload: SpeechShowPayload): void => handler(payload);
    ipcRenderer.on(CHANNEL.speechShow, listener);
    return () => ipcRenderer.off(CHANNEL.speechShow, listener);
  },

  onSpeechHide(handler: () => void): () => void {
    const listener = (): void => handler();
    ipcRenderer.on(CHANNEL.speechHide, listener);
    return () => ipcRenderer.off(CHANNEL.speechHide, listener);
  },

  onSpeechInterrupt(handler: () => void): () => void {
    const listener = (): void => handler();
    ipcRenderer.on(CHANNEL.speechInterrupt, listener);
    return () => ipcRenderer.off(CHANNEL.speechInterrupt, listener);
  },

  onStateUpdate(handler: (payload: StatePayload) => void): () => void {
    const listener = (_event: unknown, payload: StatePayload): void => handler(payload);
    ipcRenderer.on(CHANNEL.stateUpdate, listener);
    return () => ipcRenderer.off(CHANNEL.stateUpdate, listener);
  },

  setInteractive(interactive: boolean): void {
    ipcRenderer.send(CHANNEL.overlaySetInteractive, Boolean(interactive));
  },

  /** Where the pinned character takes the mouse, in window pixels; null for nowhere. */
  setHotRect(rect: HotRect | null): void {
    ipcRenderer.send(
      CHANNEL.overlaySetHotRect,
      rect
        ? { x: Number(rect.x), y: Number(rect.y), width: Number(rect.width), height: Number(rect.height) }
        : null
    );
  },

  /** The pinned character is being dragged; main moves the window until `dragEnd`. */
  dragStart(): void {
    ipcRenderer.send(CHANNEL.overlayDragStart);
  },

  dragEnd(): void {
    ipcRenderer.send(CHANNEL.overlayDragEnd);
  },

  /** The character was clicked while it had nothing to say. */
  poke(): void {
    ipcRenderer.send(CHANNEL.overlayPoke);
  },

  /** The character was right-clicked. */
  openMenu(): void {
    ipcRenderer.send(CHANNEL.overlayMenu);
  },

  speechFinished(speechId: string): void {
    ipcRenderer.send(CHANNEL.speechFinished, { speechId: String(speechId) });
  },

  speechDismissed(speechId: string): void {
    ipcRenderer.send(CHANNEL.speechDismissed, { speechId: String(speechId) });
  }
};

export type CodexOverlayApi = typeof api;

contextBridge.exposeInMainWorld('codex', api);

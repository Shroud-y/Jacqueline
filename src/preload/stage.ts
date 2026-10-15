import { contextBridge, ipcRenderer } from 'electron';
import type { StagePayload, StageSound } from '@shared/types';

/**
 * A character window's entire surface. Nothing else is exposed: no node, no
 * fs, no arbitrary ipc.
 *
 * The channel names are written out literally rather than imported from
 * `@shared/ipc`: a *value* import shared with another preload makes Rollup
 * hoist it into a separate chunk, and a sandboxed preload cannot require a
 * second file — it fails with "module not found" and the whole bridge silently
 * never appears. `tests/preload.test.ts` fails if these drift from `IPC`.
 * Type-only imports are erased at build time and are safe.
 */
const CHANNEL = {
  stageGet: 'stage:get',
  stageUpdate: 'stage:update',
  stagePainted: 'stage:painted',
  stageDragStart: 'stage:dragStart',
  stageDragEnd: 'stage:dragEnd',
  stageMenu: 'stage:menu',
  stageClick: 'stage:click',
  stageSound: 'stage:sound'
} as const;

const api = {
  getStage(): Promise<StagePayload | null> {
    return ipcRenderer.invoke(CHANNEL.stageGet) as Promise<StagePayload | null>;
  },

  onStageUpdate(handler: (payload: StagePayload) => void): () => void {
    const listener = (_event: unknown, payload: StagePayload): void => handler(payload);
    ipcRenderer.on(CHANNEL.stageUpdate, listener);
    return () => ipcRenderer.off(CHANNEL.stageUpdate, listener);
  },

  /** There is something on the page worth showing the window for. */
  painted(): void {
    ipcRenderer.send(CHANNEL.stagePainted);
  },

  dragStart(): void {
    ipcRenderer.send(CHANNEL.stageDragStart);
  },

  dragEnd(): void {
    ipcRenderer.send(CHANNEL.stageDragEnd);
  },

  /** The character was right-clicked. */
  menu(): void {
    ipcRenderer.send(CHANNEL.stageMenu);
  },

  /** The character was clicked. */
  click(): void {
    ipcRenderer.send(CHANNEL.stageClick);
  },

  onSound(handler: (sound: StageSound) => void): () => void {
    const listener = (_event: unknown, sound: StageSound): void => handler(sound);
    ipcRenderer.on(CHANNEL.stageSound, listener);
    return () => ipcRenderer.off(CHANNEL.stageSound, listener);
  }
};

export type StageApi = typeof api;

contextBridge.exposeInMainWorld('shard', api);

/// <reference types="vite/client" />

import type { StagePayload } from '@shared/types';

/**
 * Structural mirror of the preload surface. Declared rather than imported so
 * the renderer's TS project never pulls in Electron types.
 */
interface StageApi {
  getStage(): Promise<StagePayload | null>;
  onStageUpdate(handler: (payload: StagePayload) => void): () => void;
  painted(): void;
  dragStart(): void;
  dragEnd(): void;
}

declare global {
  interface Window {
    /** Absent when the page is opened outside Electron. */
    shard?: StageApi;
  }
}

/// <reference types="vite/client" />

import type {
  CompanionStatus,
  DebugSnapshot,
  HotRect,
  PresetAssetKind,
  PresetAssetResult,
  PresetAssetStatus,
  Settings,
  SettingsResult,
  SnoozeChoice,
  SpeechShowPayload,
  StatePayload
} from '@shared/types';

/**
 * Structural mirrors of the two preload surfaces. Declared rather than
 * imported so the renderer's TS project never pulls in Electron types.
 */
export interface CodexOverlayApi {
  onSpeechShow(handler: (payload: SpeechShowPayload) => void): () => void;
  onSpeechHide(handler: () => void): () => void;
  onSpeechInterrupt(handler: () => void): () => void;
  onStateUpdate(handler: (payload: StatePayload) => void): () => void;
  setInteractive(interactive: boolean): void;
  setHotRect(rect: HotRect | null): void;
  dragStart(): void;
  dragEnd(): void;
  poke(): void;
  openMenu(): void;
  speechFinished(speechId: string): void;
  speechDismissed(speechId: string): void;
}

export interface CodexPanelApi {
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<SettingsResult>;
  getDefaultSettings(): Promise<Settings>;
  resetSettings(): Promise<SettingsResult>;
  getStatus(): Promise<CompanionStatus>;
  onStatusUpdated(handler: (status: CompanionStatus) => void): () => void;
  setMuted(muted: boolean): void;
  setSnooze(choice: SnoozeChoice): void;
  sayNow(): Promise<boolean>;
  pickFolder(): Promise<string | null>;
  onSettingsUpdated(handler: (settings: Settings) => void): () => void;
  getDebugSnapshot(): Promise<DebugSnapshot>;
  onDebugSnapshot(handler: (snapshot: DebugSnapshot) => void): () => void;
  fireEvent(type: string): void;
  pickPresetAsset(presetId: string, kind: PresetAssetKind): Promise<PresetAssetResult>;
  clearPresetAsset(presetId: string, kind: PresetAssetKind): Promise<PresetAssetResult>;
  getPresetAssetStatus(presetId: string): Promise<PresetAssetStatus>;
  deletePreset(presetId: string): Promise<PresetAssetResult>;
  duplicatePreset(presetId: string): Promise<PresetAssetResult & { presetId?: string }>;
  openPresetFolder(presetId: string): Promise<PresetAssetResult>;
  saveBankTemplate(): Promise<PresetAssetResult>;
}

declare global {
  interface Window {
    codex?: CodexOverlayApi;
    codexPanel?: CodexPanelApi;
  }
}

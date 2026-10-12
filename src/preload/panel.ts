import { contextBridge, ipcRenderer } from 'electron';
import type {
  CompanionStatus,
  DebugSnapshot,
  PresetAssetKind,
  PresetAssetResult,
  PresetAssetStatus,
  Settings,
  SettingsResult,
  SnoozeChoice
} from '@shared/types';

/**
 * Surface for the two ordinary windows: settings and the debug panel.
 * Channel names are inlined for the same reason as in `index.ts` — a shared
 * value import becomes a separate chunk that a sandboxed preload cannot load.
 */
const CHANNEL = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsUpdated: 'settings:updated',
  settingsDefaults: 'settings:defaults',
  settingsReset: 'settings:reset',
  statusGet: 'status:get',
  statusUpdated: 'status:updated',
  statusSetMuted: 'status:setMuted',
  statusSetSnooze: 'status:setSnooze',
  sayNow: 'companion:sayNow',
  foldersPick: 'folders:pick',
  debugSnapshot: 'debug:snapshot',
  debugRequestSnapshot: 'debug:requestSnapshot',
  debugFireEvent: 'debug:fireEvent',
  presetsPickAsset: 'presets:pickAsset',
  presetsClearAsset: 'presets:clearAsset',
  presetsAssetStatus: 'presets:assetStatus',
  presetsDelete: 'presets:delete',
  presetsDuplicate: 'presets:duplicate',
  presetsOpenFolder: 'presets:openFolder',
  bankSaveTemplate: 'bank:saveTemplate'
} as const;

const api = {
  getSettings(): Promise<Settings> {
    return ipcRenderer.invoke(CHANNEL.settingsGet) as Promise<Settings>;
  },

  /** The settings as they now stand, and why not if the change was refused. */
  setSettings(patch: Partial<Settings>): Promise<SettingsResult> {
    return ipcRenderer.invoke(CHANNEL.settingsSet, patch) as Promise<SettingsResult>;
  },

  /** The stock settings, for "restore defaults" on a single list. */
  getDefaultSettings(): Promise<Settings> {
    return ipcRenderer.invoke(CHANNEL.settingsDefaults) as Promise<Settings>;
  },

  /** Everything back to stock except the characters. */
  resetSettings(): Promise<SettingsResult> {
    return ipcRenderer.invoke(CHANNEL.settingsReset) as Promise<SettingsResult>;
  },

  getStatus(): Promise<CompanionStatus> {
    return ipcRenderer.invoke(CHANNEL.statusGet) as Promise<CompanionStatus>;
  },

  onStatusUpdated(handler: (status: CompanionStatus) => void): () => void {
    const listener = (_event: unknown, payload: CompanionStatus): void => handler(payload);
    ipcRenderer.on(CHANNEL.statusUpdated, listener);
    return () => ipcRenderer.off(CHANNEL.statusUpdated, listener);
  },

  setMuted(muted: boolean): void {
    ipcRenderer.send(CHANNEL.statusSetMuted, Boolean(muted));
  },

  setSnooze(choice: SnoozeChoice): void {
    ipcRenderer.send(CHANNEL.statusSetSnooze, String(choice));
  },

  /** Speaks a line now. Resolves false when it could not — muted, or already speaking. */
  sayNow(): Promise<boolean> {
    return ipcRenderer.invoke(CHANNEL.sayNow) as Promise<boolean>;
  },

  /** Native folder picker; null when cancelled. */
  pickFolder(): Promise<string | null> {
    return ipcRenderer.invoke(CHANNEL.foldersPick) as Promise<string | null>;
  },

  onSettingsUpdated(handler: (settings: Settings) => void): () => void {
    const listener = (_event: unknown, payload: Settings): void => handler(payload);
    ipcRenderer.on(CHANNEL.settingsUpdated, listener);
    return () => ipcRenderer.off(CHANNEL.settingsUpdated, listener);
  },

  getDebugSnapshot(): Promise<DebugSnapshot> {
    return ipcRenderer.invoke(CHANNEL.debugRequestSnapshot) as Promise<DebugSnapshot>;
  },

  onDebugSnapshot(handler: (snapshot: DebugSnapshot) => void): () => void {
    const listener = (_event: unknown, payload: DebugSnapshot): void => handler(payload);
    ipcRenderer.on(CHANNEL.debugSnapshot, listener);
    return () => ipcRenderer.off(CHANNEL.debugSnapshot, listener);
  },

  fireEvent(type: string): void {
    ipcRenderer.send(CHANNEL.debugFireEvent, { type: String(type) });
  },

  pickPresetAsset(presetId: string, kind: PresetAssetKind): Promise<PresetAssetResult> {
    return ipcRenderer.invoke(CHANNEL.presetsPickAsset, { presetId, kind }) as Promise<PresetAssetResult>;
  },

  clearPresetAsset(presetId: string, kind: PresetAssetKind): Promise<PresetAssetResult> {
    return ipcRenderer.invoke(CHANNEL.presetsClearAsset, { presetId, kind }) as Promise<PresetAssetResult>;
  },

  getPresetAssetStatus(presetId: string): Promise<PresetAssetStatus> {
    return ipcRenderer.invoke(CHANNEL.presetsAssetStatus, { presetId }) as Promise<PresetAssetStatus>;
  },

  deletePreset(presetId: string): Promise<PresetAssetResult> {
    return ipcRenderer.invoke(CHANNEL.presetsDelete, { presetId }) as Promise<PresetAssetResult>;
  },

  /** Copies a character with its files; the new one's id comes back on success. */
  duplicatePreset(presetId: string): Promise<PresetAssetResult & { presetId?: string }> {
    return ipcRenderer.invoke(CHANNEL.presetsDuplicate, { presetId }) as Promise<
      PresetAssetResult & { presetId?: string }
    >;
  },

  openPresetFolder(presetId: string): Promise<PresetAssetResult> {
    return ipcRenderer.invoke(CHANNEL.presetsOpenFolder, { presetId }) as Promise<PresetAssetResult>;
  },

  /** Writes the stock phrase bank wherever the user picks. `error: 'cancelled'` when they back out. */
  saveBankTemplate(): Promise<PresetAssetResult> {
    return ipcRenderer.invoke(CHANNEL.bankSaveTemplate) as Promise<PresetAssetResult>;
  }
};

export type CodexPanelApi = typeof api;

contextBridge.exposeInMainWorld('codexPanel', api);

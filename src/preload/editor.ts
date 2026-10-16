import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { CharacterEntry } from '@shared/character';
import type { EditorApi, SettingsView } from '@shared/types';

/**
 * The editor window's entire surface. Channel names are written out
 * literally for the reason given in `stage.ts`; `tests/preload.test.ts` fails
 * if they drift from `IPC`.
 */
const CHANNEL = {
  editorList: 'editor:list',
  editorChanged: 'editor:changed',
  editorCreate: 'editor:create',
  editorSave: 'editor:save',
  editorDuplicate: 'editor:duplicate',
  editorRemove: 'editor:remove',
  editorImportAsset: 'editor:importAsset',
  editorOpenFolder: 'editor:openFolder',
  editorAssets: 'editor:assets',
  editorReleaseAsset: 'editor:releaseAsset',
  editorPreview: 'editor:preview',
  editorTestLine: 'editor:testLine',
  editorTestRule: 'editor:testRule',
  editorRunningPrograms: 'editor:runningPrograms',
  editorOpenRoot: 'editor:openRoot',
  editorExport: 'editor:export',
  editorImport: 'editor:import',
  editorSettingsGet: 'settings:get',
  editorSettingsUpdate: 'settings:update',
  editorSettingsChanged: 'settings:changed'
} as const;

const api: EditorApi = {
  list: () => ipcRenderer.invoke(CHANNEL.editorList),

  onChanged(handler) {
    const listener = (_event: unknown, entries: CharacterEntry[]): void => handler(entries);
    ipcRenderer.on(CHANNEL.editorChanged, listener);
    return () => ipcRenderer.off(CHANNEL.editorChanged, listener);
  },

  create: (payload) => ipcRenderer.invoke(CHANNEL.editorCreate, payload),
  save: (character) => ipcRenderer.invoke(CHANNEL.editorSave, character),
  duplicate: (payload) => ipcRenderer.invoke(CHANNEL.editorDuplicate, payload),
  remove: (payload) => ipcRenderer.invoke(CHANNEL.editorRemove, payload),
  importAsset: (payload) => ipcRenderer.invoke(CHANNEL.editorImportAsset, payload),
  openFolder: (payload) => ipcRenderer.invoke(CHANNEL.editorOpenFolder, payload),
  assets: (payload) => ipcRenderer.invoke(CHANNEL.editorAssets, payload),
  releaseAsset: (payload) => ipcRenderer.invoke(CHANNEL.editorReleaseAsset, payload),
  preview: (payload) => ipcRenderer.invoke(CHANNEL.editorPreview, payload),
  testLine: (payload) => ipcRenderer.invoke(CHANNEL.editorTestLine, payload),
  testRule: (payload) => ipcRenderer.invoke(CHANNEL.editorTestRule, payload),
  runningPrograms: () => ipcRenderer.invoke(CHANNEL.editorRunningPrograms),
  openRoot: () => ipcRenderer.invoke(CHANNEL.editorOpenRoot),
  exportCharacter: (payload) => ipcRenderer.invoke(CHANNEL.editorExport, payload),
  importCharacter: (payload) => ipcRenderer.invoke(CHANNEL.editorImport, payload),
  settings: () => ipcRenderer.invoke(CHANNEL.editorSettingsGet),
  updateSettings: (patch) => ipcRenderer.invoke(CHANNEL.editorSettingsUpdate, patch),

  onSettings(handler) {
    const listener = (_event: unknown, view: SettingsView): void => handler(view);
    ipcRenderer.on(CHANNEL.editorSettingsChanged, listener);
    return () => ipcRenderer.off(CHANNEL.editorSettingsChanged, listener);
  },

  pathForFile: (file) => webUtils.getPathForFile(file)
};

contextBridge.exposeInMainWorld('shardEditor', api);

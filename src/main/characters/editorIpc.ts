import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { ASSET_EXTENSIONS, assetKindOf, assetNameSchema, characterIdSchema, referencedAssets, type AssetKind, type Character, type Line } from '@shared/character';
import { IPC } from '@shared/ipc';
import { unknownSlots } from '@shared/lines';
import { BEHAVIOUR_NAME, BEHAVIOUR_STARTER, SCRIPT_NAME, SCRIPT_STARTER } from '@shared/scriptTemplate';
import { signalCommand, signalNameSchema } from '@shared/signal';
import { STYLE_STARTER, STYLESHEET_NAME } from '@shared/stylesheet';
import type { ActivityView, CheckItem, EditorApi, EditorResult, GameStatus, ScriptStatus, Settings, SettingsResult, SettingsView } from '@shared/types';
import { sampleSlots, type Fired } from '../engine/ruleEngine';
import { fillSlots } from '../engine/slots';
import type { CharacterStore } from './store';
import { exportCharacter, importCharacter, ZIP_MAX_BYTES } from './transfer';

/** What the handlers need from the outside world, so they can be tested without it. */
export interface EditorIpcDeps {
  /** Shows a file picker; null when the user backs out. */
  pickFile: (kinds: readonly AssetKind[]) => Promise<string | null>;
  openFolder: (id: string) => Promise<EditorResult>;
  /** Tells the character windows who is being laid out. */
  setPreview: (id: string | null) => void;
  /** Puts a line on screen now, with its sound. */
  sayNow: (character: Character, text: string, line: Line) => void;
  /** Carries out a rule's actions now, as if it had fired. */
  runNow: (fired: Fired) => void;
  runningPrograms: () => Promise<string[]>;
  activity: (id: string) => ActivityView;
  /** Which character's activity the editor wants as it happens; null for none. */
  watchActivity: (id: string | null) => void;
  checkRule: (character: Character, ruleId: string) => CheckItem[] | null;
  openRoot: () => Promise<EditorResult>;
  /** What starts this app on a command line: the exe, and in a development run the project too. */
  executable: () => string[];
  copyText: (text: string) => void;
  /** Switches game events on and writes Dota's cfg; with `pick`, into a folder the user chooses. */
  setUpDota: (pick: boolean) => Promise<EditorResult<{ path: string }>>;
  gameStatus: () => GameStatus;
  /** A zip to import; null when the user backs out. */
  pickZip: () => Promise<string | null>;
  /** Where to save an export; null when the user backs out. */
  pickSavePath: (suggestedName: string) => Promise<string | null>;
  /** Shows a file in its folder. */
  revealFile: (path: string) => void;
  /** Opens a file in the program the system opens it with. */
  openPath: (path: string) => Promise<EditorResult>;
  scriptAllowed: (id: string) => boolean;
  /** A script that came from somewhere else waits for the user's yes. */
  blockScript: (id: string) => void;
  allowScript: (id: string) => void;
  scriptStatus: (id: string) => ScriptStatus | null;
  restartScript: (id: string) => void;
  settings: () => SettingsView;
  /** Validated by the settings store, which refuses what it cannot use. */
  updateSettings: (patch: Partial<Settings>) => SettingsResult;
  /** False when it cannot look: a development run, or looking is off. */
  checkForUpdates: () => Promise<boolean>;
  /** The newer release's page, when there is one. */
  updateUrl: () => string | null;
  openExternal: (url: string) => Promise<void>;
  now?: () => number;
}

const idPayload = z.object({ id: characterIdSchema });
const namePayload = z.object({ name: z.string() });
const importPayload = z.object({
  id: characterIdSchema,
  kinds: z.array(z.enum(Object.keys(ASSET_EXTENSIONS) as [AssetKind, ...AssetKind[]])).min(1),
  path: z.string().min(1).max(4096).optional()
});
const assetPayload = z.object({ id: characterIdSchema, file: assetNameSchema });
const previewPayload = z.object({ id: characterIdSchema.nullable() });
const testLinePayload = z.object({ id: characterIdSchema, group: z.string().min(1).max(64), line: z.string().min(1).max(64) });
const testRulePayload = z.object({ id: characterIdSchema, rule: z.string().min(1).max(64) });
const newScriptPayload = z.object({ id: characterIdSchema, kind: z.enum(['visual', 'behaviour']).default('visual') });
const zipPayload = z.object({ path: z.string().min(1).max(4096).optional() });

/** 'Kasane Teto' → 'Kasane Teto.zip'; whatever a file name cannot hold is dropped. */
function zipName(name: string): string {
  const safe = [...name]
    .filter((char) => char.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(char))
    .join('')
    .trim()
    .replace(/[. ]+$/, '');
  return `${safe || 'character'}.zip`;
}

const refused = { ok: false as const, error: 'That request could not be read.' };

/**
 * Everything the editor can ask for. The editor's page is ours, but what
 * arrives over IPC is still checked: an id is what picks a folder on disk.
 * The character itself is validated by the store on save.
 */
export function editorHandlers(store: CharacterStore, deps: EditorIpcDeps): { [K in keyof EditorHandlers]: EditorHandlers[K] } {
  return {
    list: () => store.list(),

    create: (payload) => {
      const parsed = namePayload.safeParse(payload);
      return parsed.success ? store.create(parsed.data.name) : refused;
    },

    save: (payload) => store.save(payload),

    duplicate: (payload) => {
      const parsed = idPayload.safeParse(payload);
      return parsed.success ? store.duplicate(parsed.data.id) : refused;
    },

    remove: (payload) => {
      const parsed = idPayload.safeParse(payload);
      return parsed.success ? store.remove(parsed.data.id) : refused;
    },

    importAsset: async (payload) => {
      const parsed = importPayload.safeParse(payload);
      if (!parsed.success) return refused;
      if (!store.has(parsed.data.id)) return { ok: false, error: 'Unknown character.' };
      const { id, kinds, path } = parsed.data;
      if (path !== undefined) {
        // Dropped on the window: the same rule the file picker's filter enforces.
        const kind = assetKindOf(path);
        if (!kind || !kinds.includes(kind)) return { ok: false, error: `That kind of file cannot go here.` };
        return store.importAsset(id, path);
      }
      const picked = await deps.pickFile(kinds);
      // Backing out of the dialog is not a failure the editor should report.
      if (picked === null) return { ok: false, error: '' };
      return store.importAsset(id, picked);
    },

    assets: (payload) => {
      const parsed = idPayload.safeParse(payload);
      return parsed.success ? store.assetInfo(parsed.data.id) : [];
    },

    releaseAsset: (payload) => {
      const parsed = assetPayload.safeParse(payload);
      if (!parsed.success) return refused;
      const character = store.get(parsed.data.id);
      if (!character) return { ok: false, error: 'Unknown character.' };
      // Still used somewhere else in the character: it stays.
      if (referencedAssets(character).has(parsed.data.file)) return { ok: true };
      return store.removeAsset(parsed.data.id, parsed.data.file);
    },

    preview: (payload) => {
      const parsed = previewPayload.safeParse(payload);
      if (!parsed.success) return refused;
      const { id } = parsed.data;
      if (id !== null && !store.has(id)) return { ok: false, error: 'Unknown character.' };
      deps.setPreview(id);
      return { ok: true };
    },

    testLine: (payload) => {
      const parsed = testLinePayload.safeParse(payload);
      if (!parsed.success) return refused;
      const character = store.get(parsed.data.id);
      if (!character) return { ok: false, error: 'Unknown character.' };
      const line = character.lines[parsed.data.group]?.find((entry) => entry.id === parsed.data.line);
      if (!line) return { ok: false, error: 'That line is not there any more.' };
      // Switched off means not on screen: a test should not quietly override that.
      if (!character.enabled) return { ok: false, error: 'The character is off. Switch it on to try its lines.' };
      const text = fillSlots(line.text, sampleSlots(character, (deps.now ?? Date.now)()));
      if (text === null) {
        const unknown = unknownSlots(line.text).map((slot) => `{${slot}}`);
        return { ok: false, error: `Nothing fills ${unknown.join(', ') || 'a slot in it'}, so this line is never said.` };
      }
      deps.sayNow(character, text, line);
      return { ok: true };
    },

    testRule: (payload) => {
      const parsed = testRulePayload.safeParse(payload);
      if (!parsed.success) return refused;
      const character = store.get(parsed.data.id);
      if (!character) return { ok: false, error: 'Unknown character.' };
      const rule = character.rules.find((entry) => entry.id === parsed.data.rule);
      if (!rule) return { ok: false, error: 'That rule is not there any more.' };
      if (!character.enabled) return { ok: false, error: 'The character is off. Switch it on to try its rules.' };
      deps.runNow({ character, rule, slots: sampleSlots(character, (deps.now ?? Date.now)()) });
      return { ok: true };
    },

    runningPrograms: () => deps.runningPrograms(),

    activity: (payload) => {
      const parsed = idPayload.safeParse(payload);
      return parsed.success ? deps.activity(parsed.data.id) : { entries: [], rules: {} };
    },

    watchActivity: (payload) => {
      const parsed = previewPayload.safeParse(payload);
      if (!parsed.success) return refused;
      deps.watchActivity(parsed.data.id);
      return { ok: true };
    },

    checkRule: (payload) => {
      const parsed = testRulePayload.safeParse(payload);
      if (!parsed.success) return refused;
      const character = store.get(parsed.data.id);
      if (!character) return { ok: false, error: 'Unknown character.' };
      const items = deps.checkRule(character, parsed.data.rule);
      return items ? { ok: true, items } : { ok: false, error: 'That rule is not there any more.' };
    },

    openRoot: () => deps.openRoot(),

    copySignalCommand: (payload) => {
      const parsed = z.object({ name: signalNameSchema }).safeParse(payload);
      if (!parsed.success) return { ok: false, error: 'A signal name is letters, digits, - _ and . — like build-ok.' };
      const command = signalCommand(deps.executable(), parsed.data.name);
      deps.copyText(command);
      return { ok: true, command };
    },

    setUpDota: (payload) => {
      const parsed = z.object({ pick: z.boolean() }).safeParse(payload);
      return parsed.success ? deps.setUpDota(parsed.data.pick) : refused;
    },

    gameStatus: () => deps.gameStatus(),

    newStylesheet: (payload) => {
      const parsed = idPayload.safeParse(payload);
      if (!parsed.success) return refused;
      return store.writeAsset(parsed.data.id, STYLESHEET_NAME, STYLE_STARTER);
    },

    newScript: (payload) => {
      const parsed = newScriptPayload.safeParse(payload);
      if (!parsed.success) return refused;
      return parsed.data.kind === 'behaviour'
        ? store.writeAsset(parsed.data.id, BEHAVIOUR_NAME, BEHAVIOUR_STARTER)
        : store.writeAsset(parsed.data.id, SCRIPT_NAME, SCRIPT_STARTER);
    },

    scriptAllowed: (payload) => {
      const parsed = idPayload.safeParse(payload);
      return parsed.success ? deps.scriptAllowed(parsed.data.id) : false;
    },

    allowScript: (payload) => {
      const parsed = idPayload.safeParse(payload);
      if (!parsed.success) return refused;
      if (!store.has(parsed.data.id)) return { ok: false, error: 'Unknown character.' };
      deps.allowScript(parsed.data.id);
      return { ok: true };
    },

    scriptStatus: (payload) => {
      const parsed = idPayload.safeParse(payload);
      return parsed.success ? deps.scriptStatus(parsed.data.id) : null;
    },

    restartScript: (payload) => {
      const parsed = idPayload.safeParse(payload);
      if (!parsed.success) return refused;
      if (!store.has(parsed.data.id)) return { ok: false, error: 'Unknown character.' };
      deps.restartScript(parsed.data.id);
      return { ok: true };
    },

    openAsset: async (payload) => {
      const parsed = assetPayload.safeParse(payload);
      if (!parsed.success) return refused;
      const path = store.assetPath(parsed.data.id, parsed.data.file);
      if (!path || !existsSync(path)) return { ok: false, error: 'That file is not there.' };
      return deps.openPath(path);
    },

    exportCharacter: async (payload) => {
      const parsed = idPayload.safeParse(payload);
      if (!parsed.success) return refused;
      const character = store.get(parsed.data.id);
      if (!character) return { ok: false, error: 'Unknown character.' };
      const packed = exportCharacter(store, character.id);
      if (!packed.ok) return packed;
      const path = await deps.pickSavePath(zipName(character.name));
      if (path === null) return { ok: false, error: '' };
      try {
        writeFileSync(path, packed.zip);
      } catch (err) {
        return { ok: false, error: `Could not save the zip: ${(err as Error).message}` };
      }
      deps.revealFile(path);
      return { ok: true };
    },

    importCharacter: async (payload) => {
      const parsed = zipPayload.safeParse(payload ?? {});
      if (!parsed.success) return refused;
      const path = parsed.data.path ?? (await deps.pickZip());
      if (path === null) return { ok: false, error: '' };
      if (!path.toLowerCase().endsWith('.zip')) return { ok: false, error: 'A character comes as a .zip file.' };
      let zip: Buffer;
      try {
        if (statSync(path).size > ZIP_MAX_BYTES) return { ok: false, error: 'That zip is too big to be a character.' };
        zip = readFileSync(path);
      } catch (err) {
        return { ok: false, error: `Could not read the zip: ${(err as Error).message}` };
      }
      const imported = importCharacter(store, zip);
      // Someone else's code: it runs only once the user has looked and said yes.
      if (imported.ok && (imported.character.appearance.script || imported.character.behaviourScript)) deps.blockScript(imported.character.id);
      return imported;
    },

    settings: () => deps.settings(),

    updateSettings: (payload) => {
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, settings: deps.settings().settings, error: 'That request could not be read.' };
      }
      // The version is the store's to say.
      const { version: _version, ...patch } = payload as Partial<Settings>;
      return deps.updateSettings(patch);
    },

    openFolder: async (payload) => {
      const parsed = idPayload.safeParse(payload);
      if (!parsed.success) return refused;
      if (!store.has(parsed.data.id)) return { ok: false, error: 'Unknown character.' };
      return deps.openFolder(parsed.data.id);
    },

    checkForUpdates: async () =>
      (await deps.checkForUpdates()) ? { ok: true } : { ok: false, error: 'Looking for updates is off, or this is a development run.' },

    openUpdate: async () => {
      // Only ever the page the last look found — never a URL the editor hands over.
      const url = deps.updateUrl();
      if (!url) return { ok: false, error: 'There is no newer version to open.' };
      await deps.openExternal(url);
      return { ok: true };
    }
  };
}

/** The handlers take what came over the wire, not what the editor's types promise it sent. */
type EditorHandlers = {
  [K in Exclude<keyof EditorApi, 'onChanged' | 'onSettings' | 'onScriptStatus' | 'onGameStatus' | 'onActivity' | 'pathForFile'>]: (payload?: unknown) => ReturnType<EditorApi[K]> | Awaited<ReturnType<EditorApi[K]>>;
};

const CHANNELS: { [K in keyof EditorHandlers]: string } = {
  list: IPC.editorList,
  create: IPC.editorCreate,
  save: IPC.editorSave,
  duplicate: IPC.editorDuplicate,
  remove: IPC.editorRemove,
  importAsset: IPC.editorImportAsset,
  openFolder: IPC.editorOpenFolder,
  assets: IPC.editorAssets,
  releaseAsset: IPC.editorReleaseAsset,
  preview: IPC.editorPreview,
  testLine: IPC.editorTestLine,
  testRule: IPC.editorTestRule,
  runningPrograms: IPC.editorRunningPrograms,
  activity: IPC.editorActivity,
  watchActivity: IPC.editorWatchActivity,
  checkRule: IPC.editorCheckRule,
  openRoot: IPC.editorOpenRoot,
  copySignalCommand: IPC.editorCopySignalCommand,
  setUpDota: IPC.editorSetUpDota,
  gameStatus: IPC.editorGameStatus,
  newStylesheet: IPC.editorNewStylesheet,
  newScript: IPC.editorNewScript,
  scriptAllowed: IPC.editorScriptAllowed,
  allowScript: IPC.editorAllowScript,
  scriptStatus: IPC.editorScriptStatus,
  restartScript: IPC.editorRestartScript,
  openAsset: IPC.editorOpenAsset,
  exportCharacter: IPC.editorExport,
  importCharacter: IPC.editorImport,
  settings: IPC.editorSettingsGet,
  updateSettings: IPC.editorSettingsUpdate,
  checkForUpdates: IPC.editorSettingsCheckUpdates,
  openUpdate: IPC.editorSettingsOpenUpdate
};

export function registerEditorIpc(store: CharacterStore, deps: EditorIpcDeps): void {
  const handlers = editorHandlers(store, deps);
  for (const key of Object.keys(CHANNELS) as (keyof EditorHandlers)[]) {
    ipcMain.handle(CHANNELS[key], (_event: IpcMainInvokeEvent, payload: unknown) => handlers[key](payload));
  }
}

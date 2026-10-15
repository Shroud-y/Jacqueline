import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { ASSET_EXTENSIONS, assetKindOf, assetNameSchema, characterIdSchema, referencedAssets, type AssetKind, type Character, type Line } from '@shared/character';
import { IPC } from '@shared/ipc';
import { unknownSlots } from '@shared/lines';
import type { EditorApi, EditorResult } from '@shared/types';
import { sampleSlots, type Fired } from '../engine/ruleEngine';
import { fillSlots } from '../engine/slots';
import type { CharacterStore } from './store';

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

    openFolder: async (payload) => {
      const parsed = idPayload.safeParse(payload);
      if (!parsed.success) return refused;
      if (!store.has(parsed.data.id)) return { ok: false, error: 'Unknown character.' };
      return deps.openFolder(parsed.data.id);
    }
  };
}

/** The handlers take what came over the wire, not what the editor's types promise it sent. */
type EditorHandlers = {
  [K in Exclude<keyof EditorApi, 'onChanged' | 'pathForFile'>]: (payload?: unknown) => ReturnType<EditorApi[K]> | Awaited<ReturnType<EditorApi[K]>>;
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
  runningPrograms: IPC.editorRunningPrograms
};

export function registerEditorIpc(store: CharacterStore, deps: EditorIpcDeps): void {
  const handlers = editorHandlers(store, deps);
  for (const key of Object.keys(CHANNELS) as (keyof EditorHandlers)[]) {
    ipcMain.handle(CHANNELS[key], (_event: IpcMainInvokeEvent, payload: unknown) => handlers[key](payload));
  }
}

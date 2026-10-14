/** Types that cross the IPC boundary. Type-only imports only, so it costs a bundle nothing. */

import type { AssetKind, Character, CharacterEntry, LayoutElement } from './character';

export interface QuietHours {
  enabled: boolean;
  /** 'HH:mm' */
  from: string;
  /** 'HH:mm' */
  to: string;
}

/** What applies to the app as a whole, as it sits in `settings.json`. */
export interface Settings {
  version: 1;
  startWithSystem: boolean;
  /** Nothing is said by anyone. Characters stay where they are. */
  muted: boolean;
  quietHours: QuietHours;
}

/** What a settings change answers with: the settings as they now stand, and why not if it was refused. */
export type SettingsResult =
  | { ok: true; settings: Settings }
  | { ok: false; settings: Settings; error: string };

/** A rectangle, in whatever space the field that carries it says. */
export interface RectPayload {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a character looks like right now, as something the page can load. */
export interface StageVisual {
  type: 'image' | 'video';
  url: string;
}

/** main → a character's window: everything it needs to draw itself. */
export interface StagePayload {
  id: string;
  name: string;
  /** The box that holds every element, in layout space. The window is this big. */
  frame: RectPayload;
  /** The character's layout elements, as in `character.json`. */
  elements: LayoutElement[];
  opacity: number;
  flip: boolean;
  /** Null until the character has been given something to look like. */
  visual: StageVisual | null;
  /** False while nobody is there to see it move: a video holds its frame. */
  playing: boolean;
  /** Seconds a video holds still between plays; 0 loops it. */
  restSec: number;
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

/** What the editor is told after asking for something: done, or why not in words a person can act on. */
export type EditorResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Everything the editor window can ask of main. */
export interface EditorApi {
  list(): Promise<CharacterEntry[]>;
  onChanged(handler: (entries: CharacterEntry[]) => void): () => void;
  create(payload: { name: string }): Promise<EditorResult<{ character: Character }>>;
  /** The whole character, as it should now be. */
  save(character: Character): Promise<EditorResult<{ character: Character }>>;
  duplicate(payload: { id: string }): Promise<EditorResult<{ character: Character }>>;
  remove(payload: { id: string }): Promise<EditorResult>;
  /**
   * Copies a file into the character's assets: `path` when the file was
   * dropped on the window, otherwise one the user picks. An empty `error`
   * means the file picker was closed without choosing.
   */
  importAsset(payload: { id: string; kinds: AssetKind[]; path?: string }): Promise<EditorResult<{ file: string; kind: AssetKind }>>;
  /** What is in the character's assets folder. */
  assets(payload: { id: string }): Promise<AssetInfo[]>;
  /** A file the character no longer points at: removed, unless something in it still does. */
  releaseAsset(payload: { id: string; file: string }): Promise<EditorResult>;
  /** Where on disk a file dropped on the window is. Not IPC — answered by the preload itself. */
  pathForFile(file: File): string;
  openFolder(payload: { id: string }): Promise<EditorResult>;
}

/** One file in a character's assets folder. */
export interface AssetInfo {
  file: string;
  kind: AssetKind;
  bytes: number;
}

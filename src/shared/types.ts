/** Types that cross the IPC boundary. Type-only imports only, so it costs a bundle nothing. */

import type { AssetKind, Character, CharacterEntry, Chroma, LayoutElement } from './character';

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
  /** Asks GitHub once a day whether a newer Jacqueline is out. Never downloads anything. */
  checkForUpdates: boolean;
  gameEvents: GameEventsSettings;
}

/** Whether a newer Jacqueline is out, as far as the last look says. */
export interface UpdateView {
  /** This build's version. */
  current: string;
  /** False in a development run: there is no installed version to compare. */
  supported: boolean;
  checking: boolean;
  /** When GitHub last answered; null before it ever has. */
  checkedAt: number | null;
  /** Why the last look did not get an answer, in words; null when it did. */
  error: string | null;
  /** The newer release, with its page; null when this one is the latest. */
  newer: { version: string; url: string } | null;
}

/** Dota 2 telling Jacqueline about the match, over 127.0.0.1. Off until the user switches it on. */
export interface GameEventsSettings {
  enabled: boolean;
  /** Where on 127.0.0.1 Dota sends to; the cfg written for Dota has the same. */
  port: number;
  /** What Dota has to send back with every update. Made the first time this is switched on. */
  token: string;
}

/** Whether game events are coming in, as the Settings pane shows it. */
export interface GameStatus {
  /** off: switched off. idle: on, but no rule or script waits for one. listening. failed: could not open, see `error`. */
  state: 'off' | 'idle' | 'listening' | 'failed';
  error: string | null;
  /** When Dota last sent anything since listening began; null when it has not. */
  heardAt: number | null;
}

/** The settings as the editor shows them, with what this build can do about them. */
export interface SettingsView {
  settings: Settings;
  /** False in a development run: starting with Windows needs the installed app. */
  autostartAvailable: boolean;
  updates: UpdateView;
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

/** main → a character's window: a sound to play now. */
export interface StageSound {
  url: string;
  /** 0 to 1. */
  volume: number;
}

/** What a character looks like right now, as something the page can load. */
export interface StageVisual {
  type: 'image' | 'video' | 'animation';
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
  /** What its stylesheet's `[data-state]` says: idle, speaking, music, or one of its own. */
  state: string;
  /** False while nobody is there to see it move: a video holds its frame. */
  playing: boolean;
  /** Put away until it is called again: its video goes back to the start, so the next call plays it whole. */
  rewind: boolean;
  /** Seconds a video holds still between plays; 0 loops it. */
  restSec: number;
  /** A background colour to take out of what it looks like; null to show it as it is. */
  chroma: Chroma | null;
  /**
   * Being laid out in the editor right now: the text elements show sample
   * text, so the layout can be judged where it will actually be.
   */
  preview: boolean;
  /** The line it is saying now, or null. */
  speech: { id: string; text: string; durationMs: number } | null;
  /** The character's own stylesheet, as something the page can load; null without one. */
  stylesheet: string | null;
  /** The sealed page its script runs in; null without a script, or one not allowed to run. */
  script: string | null;
  /** Something is playing, as far as anything has asked to know. */
  music: boolean;
  /** Set by its behaviour script, for its stylesheet's `[data-mood]`; null for none. */
  mood: string | null;
  /** What keeps sounding while it is on screen: a video's own sound, and its ambient sound. */
  sound: {
    /**
     * False while nothing may be heard: muted, quiet hours, nobody at the
     * computer, put away, or out only to be laid out.
     */
    audible: boolean;
    /** 0 to 1. */
    volume: number;
    videoSound: boolean;
    ambient: string | null;
  };
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
  /**
   * The character being laid out, or null. While set, that character is on
   * screen whatever its presence rules say, with sample text in its text.
   */
  preview(payload: { id: string | null }): Promise<EditorResult>;
  /**
   * Says one of the character's lines now, sound and all, whatever its rules,
   * mute or quiet hours say. Slots only an event fills get a likely value.
   */
  testLine(payload: { id: string; group: string; line: string }): Promise<EditorResult>;
  /** Does what a rule does now — whatever its trigger, conditions and wait — with slots filled as for a line tried. */
  testRule(payload: { id: string; rule: string }): Promise<EditorResult>;
  /** Who is on screen and who is talking now; and a change of either, as it happens. */
  live(): Promise<LiveView>;
  onLive(handler: (view: LiveView) => void): () => void;
  /** Recent activity for one character, and when each of its rules fired. */
  activity(payload: { id: string }): Promise<ActivityView>;
  /** Which character's new activity to be told about as it happens; null for none. */
  watchActivity(payload: { id: string | null }): Promise<EditorResult>;
  onActivity(handler: (entry: ActivityEntry) => void): () => void;
  /** What would stop a rule from firing right now, without doing anything. */
  checkRule(payload: { id: string; rule: string }): Promise<EditorResult<{ items: CheckItem[] }>>;
  /** File names of the programs running now, 'dota2.exe', sorted. Asked once, not watched. */
  runningPrograms(): Promise<string[]>;
  /** Opens the folder every character lives in. */
  openRoot(): Promise<EditorResult>;
  /** Puts `Jacqueline.exe --signal <name>`, with this install's full path, on the clipboard, and answers with it. */
  copySignalCommand(payload: { name: string }): Promise<EditorResult<{ command: string }>>;
  /**
   * Switches game events on and writes Dota 2's cfg for them: into the Dota
   * found through Steam, or with `pick`, into a folder the user chooses. An
   * empty `error` means the folder picker was closed.
   */
  setUpDota(payload: { pick: boolean }): Promise<EditorResult<{ path: string }>>;
  gameStatus(): Promise<GameStatus>;
  onGameStatus(handler: (status: GameStatus) => void): () => void;
  /** Writes a starter stylesheet among the character's assets and answers with its file name. Not yet used by the character. */
  newStylesheet(payload: { id: string }): Promise<EditorResult<{ file: string }>>;
  /** Writes a starter script among the character's assets and answers with its file name. Not yet used by the character. */
  newScript(payload: { id: string; kind: 'visual' | 'behaviour' }): Promise<EditorResult<{ file: string }>>;
  /** False while a script that came with an imported character waits for the user's yes. */
  scriptAllowed(payload: { id: string }): Promise<boolean>;
  allowScript(payload: { id: string }): Promise<EditorResult>;
  /** The behaviour script's state: null when it is not running at all (none, off, or not allowed). */
  scriptStatus(payload: { id: string }): Promise<ScriptStatus | null>;
  /** Starts a behaviour script again from scratch — one stopped for its limits too. */
  restartScript(payload: { id: string }): Promise<EditorResult>;
  onScriptStatus(handler: (update: { id: string; status: ScriptStatus | null }) => void): () => void;
  /** Opens one of the character's files in the program the system opens it with. */
  openAsset(payload: { id: string; file: string }): Promise<EditorResult>;
  /** Saves the character and the files it uses as one zip, then shows it. An empty `error`: the save dialog was closed. */
  exportCharacter(payload: { id: string }): Promise<EditorResult>;
  /** A new character from a zip: `path` when one was dropped, otherwise one the user picks. */
  importCharacter(payload: { path?: string }): Promise<EditorResult<{ character: Character }>>;
  settings(): Promise<SettingsView>;
  updateSettings(patch: Partial<Omit<Settings, 'version'>>): Promise<SettingsResult>;
  /** Looks for a newer release now, whatever the day's look said; the answer comes with `onSettings`. */
  checkForUpdates(): Promise<EditorResult>;
  /** Opens the newer release's page in the browser. */
  openUpdate(): Promise<EditorResult>;
  onSettings(handler: (view: SettingsView) => void): () => void;
  /** Where on disk a file dropped on the window is. Not IPC — answered by the preload itself. */
  pathForFile(file: File): string;
  openFolder(payload: { id: string }): Promise<EditorResult>;
}

/** Who is on screen and who is talking, for the marks in the editor's list. */
export interface LiveView {
  visible: string[];
  speaking: string[];
}

/** One line of the Activity log. */
export interface ActivityEntry {
  id: number;
  at: number;
  /** null: about nobody in particular, like a signal no rule waits for. */
  characterId: string | null;
  ruleId: string | null;
  /** What happened, in a few words — 'dota2 started' — when the entry is about an event. */
  event: string | null;
  /** fired: a rule fired. skipped: it matched and did not, `text` says why. note: what came of it. problem: something went wrong. */
  outcome: 'fired' | 'skipped' | 'note' | 'problem';
  text: string;
}

/** One thing that would or would not let a rule through right now. */
export interface CheckItem {
  /** null: cannot be told before it fires, like a chance. */
  ok: boolean | null;
  text: string;
}

/** What the Activity tab opens on. */
export interface ActivityView {
  entries: ActivityEntry[];
  /** By rule id: when it last fired since Jacqueline started, and an `every` rule's next turn. */
  rules: Record<string, { lastFired: number | null; next: number | null }>;
}

/** A behaviour script as the editor shows it. */
export interface ScriptStatus {
  /** False once stopped for running into its limits. */
  running: boolean;
  /** The last thing that went wrong, with its line; null when nothing has. */
  error: string | null;
}

/** One file in a character's assets folder. */
export interface AssetInfo {
  file: string;
  kind: AssetKind;
  bytes: number;
}

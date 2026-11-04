/**
 * What a character is, as it sits on disk in `character.json`. Everything the
 * user builds in the editor ends up here; the app ships no characters of its
 * own.
 *
 * Shared, because the editor validates with the same schema main saves with.
 */

import { z } from 'zod';
import { ruleSchema, stateNameSchema, type Rule } from './rules';

export const CHARACTER_SCHEMA_VERSION = 1;

/** Also the character's folder name, so it has to be safe as one. */
export const characterIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'not a valid character id');

/**
 * A file in the character's `assets/` folder, by bare name. Never a path: a
 * character is a folder that can be copied to another machine as it is.
 */
export const assetNameSchema = z
  .string()
  .max(120)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9_ .-]*$/, 'not a valid asset file name')
  .refine((name) => !name.includes('..'), 'not a valid asset file name')
  // CON.png and the like are devices on Windows, not files.
  .refine((name) => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name), 'not a valid asset file name');

const colorSchema = z.string().trim().min(1).max(64);

/* ------------------------------------------------------------------ */
/* Appearance                                                          */
/* ------------------------------------------------------------------ */

const visualSchema = z.object({
  /** `animation` is a picture file that moves: a GIF, an animated PNG or WebP. */
  type: z.enum(['image', 'video', 'animation']),
  src: assetNameSchema,
  /** What the user calls one of their own states. */
  name: z.string().trim().min(1).max(40).optional()
});

/**
 * `idle` is what shows with nothing going on; `speaking` replaces it while a
 * line is up and `music` while something plays. Any other state is the user's
 * own, worn when a rule or a script asks for it.
 */
const BUILT_IN_STATES: readonly string[] = ['idle', 'speaking', 'music'];
export const MAX_CUSTOM_STATES = 20;

export const isCustomState = (key: string): boolean => !BUILT_IN_STATES.includes(key);

/** A colour taken out of the picture or video, for a file with a plain background and no transparency. */
const chromaSchema = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a colour like #00ff00'),
  /** How far from that colour still counts as background, 0 to 100. */
  tolerance: z.number().min(0).max(100),
  /** How gradually the edge fades, 0 to 100. */
  softness: z.number().min(0).max(100)
});

const appearanceSchema = z.object({
  /** Empty until the user has given the character something to look like. */
  states: z
    .record(stateNameSchema, visualSchema)
    .refine((states) => Object.keys(states).filter(isCustomState).length <= MAX_CUSTOM_STATES, `at most ${MAX_CUSTOM_STATES} states of its own`),
  opacity: z.number().min(0).max(1),
  /** Mirrored left to right. */
  flip: z.boolean(),
  /**
   * Seconds a video holds still after each time through, before it plays
   * again. 0 plays it on a loop. A moving character costs ten times a still
   * one for as long as it moves, so this is the cheapest way to have both.
   */
  restSec: z.number().min(0).max(3600).default(0),
  chroma: chromaSchema.nullable().default(null),
  /** A `.css` among the assets, applied to the character's window. */
  stylesheet: assetNameSchema.nullable().default(null),
  /** A `.js` among the assets, run in a sealed layer over the character (scriptHost.ts). */
  script: assetNameSchema.nullable().default(null)
});

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

const textStyleSchema = z.object({
  /** A font family name, or the name of a font file among the assets. */
  font: z.string().trim().min(1).max(120),
  size: z.number().min(6).max(200),
  weight: z.number().int().min(100).max(900),
  color: colorSchema,
  align: z.enum(['left', 'center', 'right']),
  lineHeight: z.number().min(0.8).max(3),
  stroke: z.object({ color: colorSchema, width: z.number().min(0).max(20) }).nullable(),
  shadow: z
    .object({ color: colorSchema, blur: z.number().min(0).max(100), x: z.number().min(-100).max(100), y: z.number().min(-100).max(100) })
    .nullable(),
  background: z
    .object({ color: colorSchema, radius: z.number().min(0).max(200), padding: z.number().min(0).max(200) })
    .nullable()
});

/** Pixels, in the layout's own space. The window is whatever box holds every element. */
const boxShape = {
  id: z.string().min(1).max(64),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().max(4000),
  height: z.number().positive().max(4000)
};

/** How much is cut off each side of the picture or video, as a fraction of it. The file is left whole. */
const cropSchema = z
  .object({ top: z.number().min(0).max(1), right: z.number().min(0).max(1), bottom: z.number().min(0).max(1), left: z.number().min(0).max(1) })
  .refine((crop) => crop.left + crop.right < 1 && crop.top + crop.bottom < 1, 'a crop has to leave something');

const layoutElementSchema = z.discriminatedUnion('type', [
  z.object({ ...boxShape, type: z.literal('character'), crop: cropSchema.optional() }),
  z.object({
    ...boxShape,
    type: z.literal('speech'),
    style: textStyleSchema,
    reveal: z.enum(['typewriter', 'fade', 'instant'])
  }),
  z.object({ ...boxShape, type: z.literal('name'), style: textStyleSchema })
]);

const layoutSchema = z.object({
  elements: z.array(layoutElementSchema).max(32)
});

/* ------------------------------------------------------------------ */
/* Presence                                                            */
/* ------------------------------------------------------------------ */

const presenceSchema = z.object({
  /**
   * When the character is on screen at all:
   *   always       — as long as it is enabled
   *   whileRunning — while any of `apps` is running
   *   whileFocused — while any of `apps` is the window in front
   *   onSpeech     — only while it has something to say
   */
  mode: z.enum(['always', 'whileRunning', 'whileFocused', 'onSpeech']),
  /** Executable names, 'dota2.exe'. Matched without case or extension. */
  apps: z.array(z.string().trim().min(1).max(260)).max(100),
  /**
   * Where the `character` element's top-left is on screen; null until the
   * user has placed it. The element rather than the whole layout, so moving
   * the text around in the editor never makes the character jump.
   */
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable(),
  hideOnFullscreen: z.boolean()
});

/* ------------------------------------------------------------------ */
/* Behaviour                                                           */
/* ------------------------------------------------------------------ */

const lineSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(2000),
  /** Default 1. */
  weight: z.number().min(0).max(100).optional(),
  /** Played alongside the text. */
  audio: assetNameSchema.optional()
});

const audioSchema = z.object({
  volume: z.number().min(0).max(1),
  appear: assetNameSchema.nullable(),
  disappear: assetNameSchema.nullable(),
  /** A video plays its own sound unless this is turned off. */
  videoSound: z.boolean().default(true),
  /** Plays on a loop for as long as the character is on screen. */
  ambient: assetNameSchema.nullable().default(null)
});

/* ------------------------------------------------------------------ */

export const characterSchema = z.object({
  schema: z.literal(CHARACTER_SCHEMA_VERSION),
  id: characterIdSchema,
  name: z.string().trim().min(1, 'a name cannot be empty').max(60, 'a name can be 60 characters at most'),
  enabled: z.boolean(),
  appearance: appearanceSchema,
  layout: layoutSchema,
  presence: presenceSchema,
  rules: z.array(ruleSchema).max(500),
  /** A `.js` among the assets, run alongside the rules in a sandbox (engine/behaviourScript.ts). */
  behaviourScript: assetNameSchema.nullable().default(null),
  /** Groups of lines, by group id. A `say` action names a group. */
  lines: z.record(z.string().min(1).max(64), z.array(lineSchema).max(500)),
  audio: audioSchema
});

export type Character = z.infer<typeof characterSchema>;
export type Visual = z.infer<typeof visualSchema>;
export type Chroma = z.infer<typeof chromaSchema>;
export type TextStyle = z.infer<typeof textStyleSchema>;
export type LayoutElement = z.infer<typeof layoutElementSchema>;
export type Presence = z.infer<typeof presenceSchema>;
export type { Rule };
export type Line = z.infer<typeof lineSchema>;

/**
 * What it looks like right now, and what its stylesheet is told about that. A
 * line goes before its own state, its own state before music, and a look it
 * does not have falls through to the next.
 */
export function currentLook(
  states: Character['appearance']['states'],
  now: { speaking: boolean; custom: string | null; music: boolean }
): { state: string; visual: Visual | null } {
  const custom = now.custom !== null && states[now.custom] ? now.custom : null;
  const visual =
    (now.speaking ? states.speaking : undefined) ??
    (custom !== null ? states[custom] : undefined) ??
    (now.music ? states.music : undefined) ??
    states.idle ??
    Object.values(states)[0] ??
    null;
  return { state: now.speaking ? 'speaking' : (custom ?? (now.music ? 'music' : 'idle')), visual };
}

/** The states that are the user's own, in the order they were added. */
export function customStates(states: Character['appearance']['states']): [string, Visual][] {
  return Object.entries(states).filter(([key]) => isCustomState(key));
}

/** What a new state is called at first: its file's name, numbered if that is taken. */
export function newStateName(file: string, states: Character['appearance']['states']): string {
  const stem = file.replace(/\.[^.]*$/, '').slice(0, 36).trim() || 'State';
  const taken = new Set(Object.values(states).map((visual) => visual.name));
  if (!taken.has(stem)) return stem;
  for (let n = 2; ; n += 1) if (!taken.has(`${stem} ${n}`)) return `${stem} ${n}`;
}

/** A key for a new state: from the Latin letters and digits of its name if it has any, or else `state1`. */
export function newStateKey(name: string, states: Character['appearance']['states']): string {
  const words = name.match(/[A-Za-z0-9]+/g) ?? [];
  const joined = words.map((word, index) => (index === 0 ? word.toLowerCase() : word[0]?.toUpperCase() + word.slice(1))).join('');
  const bare = joined.replace(/^[0-9]+/, '').slice(0, 28);
  const stem = bare.charAt(0).toLowerCase() + bare.slice(1);
  const free = (key: string): boolean => isCustomState(key) && !states[key];
  if (stem && free(stem)) return stem;
  const base = stem || 'state';
  for (let n = stem ? 2 : 1; ; n += 1) if (free(`${base}${n}`)) return `${base}${n}`;
}

/** A character as the list shows it: usable, or a folder whose file could not be read. */
export type CharacterEntry =
  | { id: string; ok: true; character: Character }
  | { id: string; ok: false; error: string };

export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: 'Saira',
  size: 16,
  weight: 400,
  color: '#ffffff',
  align: 'left',
  lineHeight: 1.35,
  stroke: null,
  shadow: { color: 'rgba(0, 0, 0, 0.85)', blur: 4, x: 0, y: 1 },
  background: null
};

/** A new character: a place for its picture, a place for its text, nothing else. */
export function defaultCharacter(id: string, name: string): Character {
  return {
    schema: CHARACTER_SCHEMA_VERSION,
    id,
    name,
    enabled: true,
    appearance: { states: {}, opacity: 1, flip: false, restSec: 0, chroma: null, stylesheet: null, script: null },
    layout: {
      elements: [
        { id: 'character', type: 'character', x: 260, y: 0, width: 240, height: 240 },
        { id: 'speech', type: 'speech', x: 0, y: 40, width: 240, height: 160, style: { ...DEFAULT_TEXT_STYLE, align: 'right' }, reveal: 'typewriter' }
      ]
    },
    presence: { mode: 'always', apps: [], position: null, hideOnFullscreen: false },
    rules: [],
    behaviourScript: null,
    lines: {},
    audio: { volume: 1, appear: null, disappear: null, videoSound: true, ambient: null }
  };
}

/** One line a person can act on, from whatever the schema objected to first. */
export function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'That value is not valid.';
  const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
  const message = `${where}${issue.message}`;
  return message.endsWith('.') ? message : `${message}.`;
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

export type AssetKind = 'image' | 'video' | 'audio' | 'font' | 'style' | 'script';

export const ASSET_EXTENSIONS: Record<AssetKind, readonly string[]> = {
  image: ['.png', '.webp', '.jpg', '.jpeg', '.gif'],
  video: ['.webm', '.mp4'],
  audio: ['.ogg', '.wav', '.mp3'],
  font: ['.ttf', '.otf', '.woff', '.woff2'],
  style: ['.css'],
  script: ['.js']
};

const MB = 1024 * 1024;

export const ASSET_MAX_BYTES: Record<AssetKind, number> = {
  image: 16 * MB,
  video: 64 * MB,
  audio: 16 * MB,
  font: 8 * MB,
  style: MB / 2,
  script: MB / 4
};

/** What a file is, from its extension; null when it is nothing a character can use. */
export function assetKindOf(fileName: string): AssetKind | null {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = fileName.slice(dot).toLowerCase();
  for (const kind of Object.keys(ASSET_EXTENSIONS) as AssetKind[]) {
    if (ASSET_EXTENSIONS[kind].includes(ext)) return kind;
  }
  return null;
}

/**
 * Every asset the character points at. A file in `assets/` that is not in
 * here is not used by anything — but only the editor, which knows a file was
 * just let go, should act on that: a file dropped into the folder by hand to
 * use later is the user's business.
 */
export function referencedAssets(character: Character): Set<string> {
  const used = new Set<string>();
  for (const visual of Object.values(character.appearance.states)) used.add(visual.src);
  if (character.appearance.stylesheet) used.add(character.appearance.stylesheet);
  if (character.appearance.script) used.add(character.appearance.script);
  if (character.behaviourScript) used.add(character.behaviourScript);
  for (const lines of Object.values(character.lines)) {
    for (const line of lines) if (line.audio) used.add(line.audio);
  }
  for (const rule of character.rules) {
    for (const action of rule.then) if (action.type === 'sound') used.add(action.file);
  }
  if (character.audio.appear) used.add(character.audio.appear);
  if (character.audio.disappear) used.add(character.audio.disappear);
  if (character.audio.ambient) used.add(character.audio.ambient);
  for (const element of character.layout.elements) {
    if ('style' in element && assetKindOf(element.style.font) === 'font') used.add(element.style.font);
  }
  return used;
}

/** The `character` element of the layout — the box the picture or video is fitted into. */
export function characterElement(character: Character): Extract<LayoutElement, { type: 'character' }> | null {
  return character.layout.elements.find((element) => element.type === 'character') ?? null;
}

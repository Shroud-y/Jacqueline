/**
 * What a character is, as it sits on disk in `character.json`. Everything the
 * user builds in the editor ends up here; the app ships no characters of its
 * own.
 *
 * Shared, because the editor validates with the same schema main saves with.
 */

import { z } from 'zod';

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
  .refine((name) => !name.includes('..'), 'not a valid asset file name');

const colorSchema = z.string().trim().min(1).max(64);

/* ------------------------------------------------------------------ */
/* Appearance                                                          */
/* ------------------------------------------------------------------ */

const visualSchema = z.object({
  type: z.enum(['image', 'video']),
  src: assetNameSchema
});

/** `idle` is what shows with nothing going on; `speaking` replaces it while a line is up. */
const stateNameSchema = z.string().regex(/^[a-z][a-zA-Z0-9]{0,31}$/, 'not a valid state name');

const appearanceSchema = z.object({
  /** Empty until the user has given the character something to look like. */
  states: z.record(stateNameSchema, visualSchema),
  opacity: z.number().min(0).max(1),
  /** Mirrored left to right. */
  flip: z.boolean()
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

const layoutElementSchema = z.discriminatedUnion('type', [
  z.object({ ...boxShape, type: z.literal('character') }),
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
  /** Top-left of the layout on screen; null until the user has placed it. */
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable(),
  hideOnFullscreen: z.boolean()
});

/* ------------------------------------------------------------------ */
/* Behaviour                                                           */
/* ------------------------------------------------------------------ */

/**
 * A trigger, a condition or an action: a `type` and whatever that type needs.
 * Deliberately loose for now — the engine that defines the types does not
 * exist yet, and it is the one that will say what each of them requires.
 */
const typedSchema = z.looseObject({ type: z.string().min(1).max(64) });

const ruleSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(80),
  enabled: z.boolean(),
  when: typedSchema,
  if: z.array(typedSchema).max(16),
  then: z.array(typedSchema).min(1).max(16),
  /** How long before this rule may fire again. 0 is no limit. */
  cooldownSec: z.number().min(0).max(7 * 24 * 3600)
});

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
  disappear: assetNameSchema.nullable()
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
  /** Groups of lines, by group id. A `say` action names a group. */
  lines: z.record(z.string().min(1).max(64), z.array(lineSchema).max(500)),
  audio: audioSchema
});

export type Character = z.infer<typeof characterSchema>;
export type Visual = z.infer<typeof visualSchema>;
export type TextStyle = z.infer<typeof textStyleSchema>;
export type LayoutElement = z.infer<typeof layoutElementSchema>;
export type Presence = z.infer<typeof presenceSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type Line = z.infer<typeof lineSchema>;

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
    appearance: { states: {}, opacity: 1, flip: false },
    layout: {
      elements: [
        { id: 'character', type: 'character', x: 260, y: 0, width: 240, height: 240 },
        { id: 'speech', type: 'speech', x: 0, y: 40, width: 240, height: 160, style: { ...DEFAULT_TEXT_STYLE, align: 'right' }, reveal: 'typewriter' }
      ]
    },
    presence: { mode: 'always', apps: [], position: null, hideOnFullscreen: false },
    rules: [],
    lines: {},
    audio: { volume: 1, appear: null, disappear: null }
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

export type AssetKind = 'image' | 'video' | 'audio' | 'font';

export const ASSET_EXTENSIONS: Record<AssetKind, readonly string[]> = {
  image: ['.png', '.webp', '.jpg', '.jpeg'],
  video: ['.webm', '.mp4'],
  audio: ['.ogg', '.wav', '.mp3'],
  font: ['.ttf', '.otf', '.woff', '.woff2']
};

const MB = 1024 * 1024;

export const ASSET_MAX_BYTES: Record<AssetKind, number> = {
  image: 16 * MB,
  video: 64 * MB,
  audio: 16 * MB,
  font: 8 * MB
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

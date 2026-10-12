/** Types that cross the IPC boundary. Keep this file dependency-free. */

export type SpeechMode = 'normal' | 'rage' | 'whisper';

export interface PhraseSegment {
  text: string;
  mode: SpeechMode;
}

/** Geometric glyph shown in the toast's left cell. Drawn in code (§1). */
export type ToastGlyph = 'build' | 'download' | 'disk' | 'clock' | 'alert';

/**
 * §6 — an event carrying a concrete fact, rendered as the only framed element
 * in the overlay.
 *
 * The renderer is ready for a toast that arrives *without* speech, so that a
 * `notable` event can surface during quiet hours or fullscreen suppression
 * without breaking silence. Making that happen needs the speech director to
 * resolve an event to `{ toast }`, `{ speech }` or both, which is a change to
 * working Phase 1 logic and is deliberately not part of this task — main never
 * populates this field yet.
 */
export interface ToastPayload {
  id: string;
  text: string;
  glyph: ToastGlyph;
  /** How long the toast holds before fading, independent of the speech. */
  durationMs: number;
}

/** main → renderer: 'speech:show' */
export interface SpeechShowPayload {
  speechId: string;
  segments: PhraseSegment[];
  durationMs: number;
  /** Present only when a voice engine has audio for this phrase. */
  audioUrl?: string;
  /** Which character is speaking. Absent means the default persona. */
  personaId?: string;
  /** Accompanying toast, if the event carried a concrete fact. */
  toast?: ToastPayload;
}

/**
 * Which body the character is wearing. A persona is *who* is speaking; a skin
 * is *what it looks like*. They are separate axes, so this crosses IPC on its
 * own rather than riding on the persona id.
 */
export type SkinId = 'eye';

export const SKIN_IDS: readonly SkinId[] = ['eye'];

/**
 * Where the overlay's two cue sounds come from. `null` means no file was
 * found and the renderer synthesises that cue itself.
 *
 * Resolved once at startup, like the voice engine: dropping a file in takes
 * effect on the next launch.
 */
export interface CueSources {
  appear: string | null;
  disappear: string | null;
}

/** The eye's bearing: speaking or attended to, on screen with nothing to say, or silenced. */
export type Presence = 'awake' | 'resting' | 'asleep';

/**
 * Which side of the window the unit sits on, and which way the text runs from
 * it. Structurally the same as `OverlayLayout` in `overlayLayout.ts`; declared
 * here so this file stays free of imports.
 */
export interface OverlayLayoutPayload {
  anchor: 'left' | 'right';
  flow: 'down' | 'up';
}

/** A rectangle inside the overlay window, in CSS pixels. */
export interface HotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** main → renderer: 'state:update' */
export interface StatePayload {
  muted: boolean;
  snoozedUntil: number | null;
  /** The character stays on screen between lines instead of leaving. */
  pinned: boolean;
  /**
   * Nothing will be said for now — muted, snoozed or inside quiet hours. A
   * pinned eye shows it by closing rather than by vanishing.
   */
  dormant: boolean;
  /** How the window is laid out around the unit. Only ever non-default when pinned. */
  layout: OverlayLayoutPayload;
  /** Switchable at runtime from settings; no restart. */
  skinId: SkinId;
  cues: CueSources;
  /** The active preset's display name, e.g. 'Ordis' or a user's rename. */
  presetName: string;
  /** Set when the active preset has a custom appearance video, which replaces the skin entirely. */
  appearanceVideoUrl: string | null;
  /** 0 (silent) to 1 (full), from `Settings.overlay.cueVolume`. */
  cueVolume: number;
  appearSoundEnabled: boolean;
  disappearSoundEnabled: boolean;
}

/** The half of `state:update` that `RuntimeState` owns; `OverlayWindow` merges in the rest. */
export type RuntimeStatePayload = Pick<StatePayload, 'muted' | 'snoozedUntil'>;

/** renderer → main: 'speech:finished' / 'speech:dismissed' */
export interface SpeechAckPayload {
  speechId: string;
}

export type FrequencyProfile = 'chatty' | 'balanced' | 'reserved' | 'rare';

export interface QuietHours {
  enabled: boolean;
  /** 'HH:mm' */
  from: string;
  /** 'HH:mm' */
  to: string;
}

/**
 * Where the character turns up when it is not pinned: against the right edge
 * of whichever screen the cursor is on, at one of three heights.
 */
export type OverlayPlacement = 'right' | 'bottomRight' | 'topRight';

export const OVERLAY_PLACEMENTS: readonly OverlayPlacement[] = ['right', 'bottomRight', 'topRight'];

export interface OverlaySettings {
  /** Used only while the character is not pinned; a pinned one sits where it was dragged. */
  placement: OverlayPlacement;
  /** 0 (silent) to 1 (full). Applies to both a file cue and the synthesised fallback. */
  cueVolume: number;
  appearSoundEnabled: boolean;
  disappearSoundEnabled: boolean;
  /** Keep the character on screen between lines. */
  pinned: boolean;
  /**
   * Where the pinned character was last dropped: the top-left of its unit, in
   * screen coordinates. Null until it has been dragged, which means the
   * bottom-right corner of the primary display.
   */
  pinnedPosition: { x: number; y: number } | null;
}

/**
 * A switchable character profile. `'codex'` is the built-in Ordis preset —
 * renamable but not deletable. Custom phrase bank, cue sounds and appearance
 * video are not stored here: their presence on disk under
 * `userData/presets/<id>/` is what decides whether they override the
 * defaults, the same bargain `resolveCueSources` already makes for the
 * shipped cue sounds.
 */
export interface Preset {
  id: string;
  name: string;
  /** Fallback shader skin, used only when the preset has no appearance video. */
  skinId: SkinId;
}

export const BUILTIN_PRESET_ID = 'codex';

/** Which of a preset's overridable assets an operation targets. */
export type PresetAssetKind = 'bank' | 'appearSound' | 'disappearSound' | 'video';

export type PresetAssetResult = { ok: true } | { ok: false; error: string };

/** Default-vs-custom status per asset, for the Settings panel to render. */
export interface PresetAssetStatus {
  hasBank: boolean;
  hasAppear: boolean;
  hasDisappear: boolean;
  hasVideo: boolean;
}

/**
 * What a watched application is, which decides the lines it gets: a game
 * starting is not remarked on the way an editor starting is.
 */
export type AppKind = 'app' | 'game' | 'launcher' | 'notable';

export const APP_KINDS: readonly AppKind[] = ['app', 'game', 'launcher', 'notable'];

export interface WatchedApp {
  /** Executable name as the user wrote it: 'Code.exe'. Matched without case or extension. */
  name: string;
  kind: AppKind;
}

/**
 * The things the character can be told not to talk about. A topic switched
 * off silences its lines and nothing else: whatever watches the machine keeps
 * watching, because the topics lean on each other's readings (break reminders
 * need to know the user is idle whether or not idleness is itself a topic).
 */
export type TopicId =
  | 'greetings'
  | 'system'
  | 'apps'
  | 'downloads'
  | 'timeOfDay'
  | 'breaks'
  | 'chatter'
  | 'activeWindow';

export const TOPIC_IDS: readonly TopicId[] = [
  'greetings',
  'system',
  'apps',
  'downloads',
  'timeOfDay',
  'breaks',
  'chatter',
  'activeWindow'
];

/** The kinds of remark inside the active-window topic, each switchable on its own. */
export type FocusRemarkId = 'settling' | 'drift' | 'long' | 'restless' | 'tools';

export const FOCUS_REMARK_IDS: readonly FocusRemarkId[] = ['settling', 'drift', 'long', 'restless', 'tools'];

export interface Settings {
  version: 6;
  startWithSystem: boolean;
  presets: Preset[];
  activePresetId: string;
  frequencyProfile: FrequencyProfile;
  quietHours: QuietHours;
  /** Silences the character while a fullscreen application is in front — and hides it, if pinned. */
  suppressOnFullscreen: boolean;
  suppressOnMicrophoneUse: boolean;
  watchedApps: WatchedApp[];
  watchedFolders: string[];
  topics: Record<TopicId, boolean>;
  /** Only consulted while the `activeWindow` topic is on. */
  focusRemarks: Record<FocusRemarkId, boolean>;
  overlay: OverlaySettings;
}

/* ------------------------------------------------------------------ */
/* Settings window                                                     */
/* ------------------------------------------------------------------ */

/** What `settings:set` answers with: the settings as they now stand, and why not if the change was refused. */
export type SettingsResult =
  | { ok: true; settings: Settings }
  | { ok: false; settings: Settings; error: string };

/** Why the character is not speaking right now. Several can hold at once. */
export type SilenceReason = 'muted' | 'snoozed' | 'quietHours' | 'fullscreen' | 'microphone';

export type SnoozeChoice = '30m' | '2h' | 'restart' | 'off';

/** Live state for the settings window and the tray: what the character is doing and why. */
export interface CompanionStatus {
  /** Empty means it is free to speak. In the order they should be reported. */
  reasons: SilenceReason[];
  muted: boolean;
  /** Epoch ms the snooze ends at; null when not snoozed or snoozed until restart. */
  snoozedUntil: number | null;
  snoozedUntilRestart: boolean;
  /** 'HH:mm' the current quiet hours end at; null outside them. */
  quietUntil: string | null;
}

/* ------------------------------------------------------------------ */
/* Debug panel                                                         */
/* ------------------------------------------------------------------ */

export interface DebugEvent {
  id: string;
  type: string;
  at: number;
  priority: 'ambient' | 'notable' | 'urgent';
  payload: unknown;
}

export interface DebugCooldown {
  key: string;
  remainingMs: number;
  totalMs: number;
}

export interface DebugSnapshot {
  events: DebugEvent[];
  cooldowns: DebugCooldown[];
  suppression: { suppressed: boolean; reason: string | null; hardMute: boolean };
  deferred: { speechId: string; expiresAt: number }[];
  knownEventTypes: string[];
  frequencyProfile: FrequencyProfile;
}

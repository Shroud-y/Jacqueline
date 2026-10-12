import type { FC } from 'react';
import type { Presence, SkinId, SpeechMode } from '@shared/types';
import type { PersonaPalette } from '@renderer/personas/types';

/**
 * §3.0 — a **persona** is who is speaking: name, phrase bank, voice, colours.
 * A **skin** is what that persona looks like: geometry and motion. Separate
 * axes, so the same character can wear a different body and the same body can
 * be reused by another character with its own palette.
 *
 * A skin never hardcodes a colour. Everything it paints comes from the
 * `palette` it is handed, which is why `paletteOverrides` exists — a skin that
 * genuinely needs a different value states it as data instead of baking it in.
 */

export type { SkinId };

/** What a group does when nothing is happening. */
export interface MotionSpec {
  /** The `data-motion` group this drives, e.g. 'frame', 'ring', 'eye'. */
  target: string;
  kind: 'bob' | 'spin' | 'oscillate' | 'breathe';
  /** Degrees for spin/oscillate, pixels for bob, unit scale for breathe. */
  amplitude: number;
  periodMs: number;
}

/** How a skin comes apart in `rage` (§3.1). */
export interface GlitchSpec {
  /** Degrees the frame jerks to, and holds. */
  frameDeg: number;
  /** Degrees the ring snaps to, opposite the frame, then stalls. */
  ringDeg: number;
  /** Vertical scale the optic compresses to. */
  eyeScaleY: number;
  /** Positional jitter at ~18 Hz. */
  jitterPx: number;
  /** Opacity the fractures jump to. */
  fractureOpacity: number;
  /** Chromatic split distance and how long it takes to decay to nothing. */
  splitPx: number;
  splitMs: number;
}

export interface SkinProps {
  /** Supplied by the persona; a skin must never invent one. */
  palette: PersonaPalette;
  mode: SpeechMode;
  speaking: boolean;
  reducedMotion: boolean;
  /** §4.1 review mode — hides every emissive, bloom, halo and spill layer. */
  unlit?: boolean;
  /**
   * How the character holds itself when it is on screen with nothing to say.
   * Only a pinned companion is ever anything but awake.
   */
  presence?: Presence;
}

export interface Skin {
  id: SkinId;
  /** Shown in the settings dropdown. */
  label: string;
  component: FC<SkinProps>;
  canvas: { width: number; height: number };
  /**
   * Centre of the optic in canvas coordinates. The name label is aligned to
   * this so speech appears to come from the character rather than from a box
   * floating beside it (§1.2) — which means every skin has to declare it.
   */
  opticCenter: { x: number; y: number };
  motion: { idle: MotionSpec[]; glitch: GlitchSpec };
  paletteOverrides?: Partial<PersonaPalette>;
}

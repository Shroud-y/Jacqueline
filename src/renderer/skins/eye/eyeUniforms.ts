import type { Presence, SpeechMode } from '@shared/types';
import { CANVAS, CENTRE, EYE } from './geometry';

/**
 * Everything about the eye that is arithmetic rather than GL, kept separate so
 * it can be tested without a canvas.
 */

/** One frame's worth of shader inputs. Names match the uniforms exactly. */
export interface EyeUniforms {
  uWarpAmp: number;
  uOctaves: number;
  uNoiseScale: number;
  uThickness: number;
  uThickVar: number;
  uCoreIntensity: number;
  uCoreRadius: number;
  uDispersion: number;
  uInterior: number;
  uOpenness: number;
  uRadiusA: number;
  uStrengthA: number;
  uRadiusB: number;
  uStrengthB: number;
  uExposure: number;
}

/**
 * The prototype was tuned against a lens of half-width 0.34 in units of half
 * the viewport height. This one is 0.31, so the values that carry a length
 * come with it — otherwise the noise reads at the wrong scale and the membrane
 * comes out too thick.
 *
 * Written as `PROTOTYPE_VALUE * SCALE` rather than as pre-multiplied constants,
 * so the numbers stay traceable to the look that was signed off.
 */
const PROTOTYPE_HALF_W = 0.34;

/** Half-extents at full openness, in units of half the canvas height. */
export const EYE_SHAPE: readonly [number, number] = [
  EYE.width / 2 / CANVAS.height,
  EYE.height / 2 / CANVAS.height
];

export const SCALE = EYE_SHAPE[0] / PROTOTYPE_HALF_W;

/**
 * Optic centre as an offset from the canvas centre. Y is negated because
 * `gl_FragCoord` counts up from the bottom and the skin's geometry counts down
 * from the top.
 */
export const EYE_CENTRE: readonly [number, number] = [
  (CENTRE.x - CANVAS.width / 2) / CANVAS.height,
  -(CENTRE.y - CANVAS.height / 2) / CANVAS.height
];

/*
 * Close to the prototype, because the eye is now close to the prototype's
 * proportions. The bloom strengths are the exception and stay below it: the
 * prototype had a whole 1080p screen to bloom into, and this canvas is 150 x
 * 175, where a glow that reaches the edge is clamped by the blur and leaves a
 * visible rectangle of haze.
 */
const BASE: EyeUniforms = {
  uWarpAmp: 0.034 * SCALE,
  uOctaves: 4,
  uNoiseScale: 6.4 / SCALE,
  uThickness: 0.006 * SCALE,
  uThickVar: 0.62,
  uCoreIntensity: 1.45,
  uCoreRadius: 0.2,
  uDispersion: 0.028,
  uInterior: 0.85,
  uOpenness: 1,
  uRadiusA: 1.15,
  uStrengthA: 0.5,
  uRadiusB: 1.35,
  uStrengthB: 0.42,
  uExposure: 1
};

/*
 * Rage is red, not fire. Three things were making it read as flame and all
 * three are held down here: dispersion, which paints a literal spectrum along
 * the contour; a wide core, whose blowout ramps red through orange and yellow
 * on its way to white; and a warm core hue. The damage comes from warp
 * amplitude and thickness variation instead, which is where it belongs.
 *
 * The colours themselves are not set here — they come from the palette, and
 * the skin states its colder red as `paletteOverrides` in the registry.
 */
const RAGE: EyeUniforms = {
  ...BASE,
  uOpenness: 0.14,
  uWarpAmp: 0.072 * SCALE,
  uOctaves: 5.4,
  uNoiseScale: 9.8 / SCALE,
  uThickness: 0.0085 * SCALE,
  uThickVar: 0.85,
  uCoreIntensity: 1.3,
  uCoreRadius: 0.07,
  uDispersion: 0.028
};

/** §3.1 — whisper dims rather than changes shape. */
const WHISPER: EyeUniforms = {
  ...BASE,
  uExposure: 0.72,
  uCoreIntensity: 1.2
};

export const MODE_UNIFORMS: Record<SpeechMode, EyeUniforms> = {
  normal: BASE,
  rage: RAGE,
  whisper: WHISPER
};

/**
 * Idle and speaking motion for the optic. Mirrors what the CSS did for the SVG
 * eye, and is re-exported into the skin registry so the two cannot drift.
 */
export const EYE_MOTION = {
  breatheAmplitude: 0.18,
  breathePeriodMs: 2400,
  /** Whisper breathes far slower — matched to the old animation-duration. */
  whisperPeriodMs: 6000,
  speakAmplitude: 0.08,
  speakPeriodMs: 900
} as const;

/**
 * How the eye carries itself when it is on screen with nothing to say.
 *
 * A pinned companion is visible all day, so what it does while idle is most of
 * what it ever does — and most of what it costs. Measured in Electron on this
 * machine over 30 s, summed across the app's processes: unpinned and hidden
 * 0.00 % of a core; pinned with one still frame 0.31 %; pinned and breathing
 * continuously at twelve frames a second 4.0 %. Every drawn frame costs about
 * three milliseconds, so the only cheap idle is one that mostly does not draw.
 *
 * So resting holds still — half lidded, dimmed — and blinks every few
 * seconds: a dozen frames, then nothing. It reads as more alive than a slow
 * breath did, for a fraction of the frames. Asleep (muted, snoozed, quiet
 * hours) is a dim closed slit that is drawn once and then not at all.
 *
 * `openness` and `exposure` are factors on whatever the mode asks for, and
 * the shader eases between them (`PRESENCE_EASE_MS`), so waking is the eye
 * opening rather than a cut.
 */
export interface PresenceSpec {
  openness: number;
  exposure: number;
  /** Continuous idle breathing; null holds still, and the loop stops drawing. */
  breathe: { amplitude: number; periodMs: number } | null;
  /** Occasional blinks out of an otherwise still frame; null never blinks. */
  blink: { durationMs: number; minGapMs: number; maxGapMs: number; depth: number } | null;
}

export const PRESENCE: Record<Presence, PresenceSpec> = {
  awake: {
    openness: 1,
    exposure: 1,
    breathe: { amplitude: EYE_MOTION.breatheAmplitude, periodMs: EYE_MOTION.breathePeriodMs },
    blink: null
  },
  resting: {
    openness: 0.6,
    exposure: 0.62,
    breathe: null,
    blink: { durationMs: 420, minGapMs: 4500, maxGapMs: 9500, depth: 0.88 }
  },
  asleep: {
    openness: 0.16,
    exposure: 0.36,
    breathe: null,
    blink: null
  }
};

/** Time constant of the ease between presences. */
export const PRESENCE_EASE_MS = 260;

/** Frame interval while anything is moving. The eye's fastest motion is a 420 ms blink. */
export const FRAME_MS = 1000 / 30;

/**
 * The factor a blink applies to the aperture, `progress` running 0 → 1 across
 * it. Lids drop faster than they lift: the close takes the first third.
 */
export function blinkOpenness(progress: number, depth: number): number {
  if (progress <= 0 || progress >= 1) return 1;
  const CLOSE = 0.34;
  const closed =
    progress < CLOSE
      ? (progress / CLOSE) ** 2
      : 1 - ((progress - CLOSE) / (1 - CLOSE)) ** 2;
  return 1 - depth * closed;
}

export interface OpennessInput {
  mode: SpeechMode;
  speaking: boolean;
  reducedMotion: boolean;
  elapsedMs: number;
  /** Defaults to awake, which is the only presence an unpinned companion has. */
  presence?: Presence;
}

/**
 * How far open the aperture is this frame.
 *
 * Rage holds its compressed slit rather than breathing — the mechanism has
 * lost synchronisation, and something still breathing calmly reads as fine.
 * With reduced motion the aperture sits still at its resting value.
 *
 * This is the *motion* only. A presence's `openness` factor is applied by the
 * caller, which eases it, so that it does not have to be re-derived here on
 * every frame of a transition.
 */
export function opennessAt({
  mode,
  speaking,
  reducedMotion,
  elapsedMs,
  presence = 'awake'
}: OpennessInput): number {
  const base = MODE_UNIFORMS[mode].uOpenness;
  if (mode === 'rage' || reducedMotion) return base;

  const idle = PRESENCE[presence].breathe;
  if (!speaking && !idle) return base;

  const { amplitude, periodMs } = speaking
    ? { amplitude: EYE_MOTION.speakAmplitude, periodMs: EYE_MOTION.speakPeriodMs }
    : presence !== 'awake' && idle
      ? idle
      : {
          amplitude: EYE_MOTION.breatheAmplitude,
          periodMs: mode === 'whisper' ? EYE_MOTION.whisperPeriodMs : EYE_MOTION.breathePeriodMs
        };

  // Cosine rather than sine so the cycle starts wide open, the way the CSS
  // keyframes did — a fade-in that begins mid-blink is noticeable.
  const phase = (elapsedMs % periodMs) / periodMs;
  const closed = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
  return base * (1 - amplitude * closed);
}

/** `#rrggbb` → linear-ish 0..1 triple. Malformed input yields black. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * How many half-resolution bloom levels are worth allocating.
 *
 * The prototype ran four at 1080p. Here the limit is not blockiness but reach:
 * each level doubles how far the glow spreads, and a glow wider than the
 * canvas gets cut off in a straight line no matter how it is faded. Two levels
 * put the widest bloom at roughly the margin the eye leaves around itself.
 */
export function bloomLevels(width: number, height: number, minSize = 48): number {
  let levels = 0;
  let w = width;
  let h = height;
  while (levels < 3 && Math.min(w >> 1, h >> 1) >= minSize) {
    w >>= 1;
    h >>= 1;
    levels++;
  }
  return Math.max(levels, 1);
}

import { describe, expect, it } from 'vitest';
import { CANVAS, CENTRE, EYE } from '@renderer/skins/eye/geometry';
import {
  EYE_CENTRE,
  EYE_MOTION,
  EYE_SHAPE,
  MODE_UNIFORMS,
  PRESENCE,
  blinkOpenness,
  bloomLevels,
  hexToRgb,
  opennessAt
} from '@renderer/skins/eye/eyeUniforms';

/**
 * The eye's arithmetic, which is the part that can be wrong without anyone
 * noticing on screen — a slightly wrong scale factor just looks like a tuning
 * choice, and the aperture holding still in rage looks deliberate.
 */

const at = (elapsedMs: number, over: Partial<Parameters<typeof opennessAt>[0]> = {}) =>
  opennessAt({ mode: 'normal', speaking: false, reducedMotion: false, elapsedMs, ...over });

describe('shape mapping', () => {
  it('places the lens where the skin geometry says it is', () => {
    expect(EYE_SHAPE[0]).toBeCloseTo(EYE.width / 2 / CANVAS.height, 10);
    expect(EYE_SHAPE[1]).toBeCloseTo(EYE.height / 2 / CANVAS.height, 10);
  });

  it('sits dead centre, now that the eye is the whole unit', () => {
    expect(EYE_CENTRE[0]).toBe(0);
    expect(EYE_CENTRE[1]).toBe(-0);
  });

  it('still derives the centre from the geometry rather than assuming zero', () => {
    // The offset happens to be zero; the mapping that produced it is what the
    // shader depends on, and it has to keep flipping y for gl_FragCoord.
    expect(EYE_CENTRE[0]).toBeCloseTo((CENTRE.x - CANVAS.width / 2) / CANVAS.height, 10);
    expect(EYE_CENTRE[1]).toBeCloseTo(-(CENTRE.y - CANVAS.height / 2) / CANVAS.height, 10);
  });

  it('keeps the whole lens inside the canvas', () => {
    expect(EYE_SHAPE[0]).toBeLessThan(CANVAS.width / 2 / CANVAS.height);
  });
});

describe('breathing', () => {
  it('starts wide open, so a fade-in never begins mid-blink', () => {
    expect(at(0)).toBe(1);
  });

  it('never opens past the resting value or closes past the amplitude', () => {
    for (let ms = 0; ms <= 2400; ms += 37) {
      expect(at(ms)).toBeLessThanOrEqual(1 + 1e-9);
      expect(at(ms)).toBeGreaterThanOrEqual(1 - EYE_MOTION.breatheAmplitude - 1e-9);
    }
  });

  it('reaches its tightest at the half cycle', () => {
    expect(at(EYE_MOTION.breathePeriodMs / 2)).toBeCloseTo(1 - EYE_MOTION.breatheAmplitude, 10);
  });

  it('modulates less while speaking than at rest', () => {
    const speakingSwing = 1 - at(EYE_MOTION.speakPeriodMs / 2, { speaking: true });
    const restingSwing = 1 - at(EYE_MOTION.breathePeriodMs / 2);
    expect(speakingSwing).toBeLessThan(restingSwing);
  });

  it('breathes slower in whisper — same swing, longer cycle', () => {
    expect(at(EYE_MOTION.breathePeriodMs / 2, { mode: 'whisper' })).not.toBeCloseTo(
      at(EYE_MOTION.breathePeriodMs / 2),
      3
    );
    expect(at(EYE_MOTION.whisperPeriodMs / 2, { mode: 'whisper' })).toBeCloseTo(
      MODE_UNIFORMS.whisper.uOpenness * (1 - EYE_MOTION.breatheAmplitude),
      10
    );
  });

  it('holds still in rage — a mechanism that has lost sync does not breathe calmly', () => {
    const held = MODE_UNIFORMS.rage.uOpenness;
    for (const ms of [0, 600, 1200, 5000]) {
      expect(at(ms, { mode: 'rage' })).toBe(held);
    }
  });

  it('holds still under reduced motion, in every mode', () => {
    for (const mode of ['normal', 'whisper', 'rage'] as const) {
      expect(at(1200, { mode, reducedMotion: true })).toBe(MODE_UNIFORMS[mode].uOpenness);
    }
  });
});

describe('rage is red rather than fire', () => {
  /* The three settings that made it read as flame, held down as a property
     rather than as a comment that can rot. */
  it('compresses the aperture to a slit', () => {
    expect(MODE_UNIFORMS.rage.uOpenness).toBeLessThan(0.25);
  });

  it('keeps the white core small, so the blowout cannot ramp through orange', () => {
    expect(MODE_UNIFORMS.rage.uCoreRadius).toBeLessThan(MODE_UNIFORMS.normal.uCoreRadius);
  });

  it('never disperses more than the calm eye — dispersion paints a spectrum', () => {
    expect(MODE_UNIFORMS.rage.uDispersion).toBeLessThanOrEqual(MODE_UNIFORMS.normal.uDispersion);
  });

  it('takes its damage from warp and thickness variation instead', () => {
    expect(MODE_UNIFORMS.rage.uWarpAmp).toBeGreaterThan(MODE_UNIFORMS.normal.uWarpAmp);
    expect(MODE_UNIFORMS.rage.uThickVar).toBeGreaterThan(MODE_UNIFORMS.normal.uThickVar);
  });
});

describe('hexToRgb', () => {
  it('parses with or without the hash', () => {
    expect(hexToRgb('#FF8000')).toEqual([1, 128 / 255, 0]);
    expect(hexToRgb('ff8000')).toEqual([1, 128 / 255, 0]);
  });

  it('yields black rather than NaN for junk — a NaN uniform blanks the eye', () => {
    for (const junk of ['', '#fff', 'var(--p-light)', '#gggggg']) {
      expect(hexToRgb(junk)).toEqual([0, 0, 0]);
    }
  });
});

describe('bloomLevels', () => {
  /* The skin always renders at twice the CSS size, so this is the call that
     decides what actually ships. Each level doubles how far the glow spreads,
     and a glow wider than the canvas is cut off in a straight line however it
     is faded — two levels put the widest bloom at about the margin the eye
     leaves around itself. */
  const RENDERED = [CANVAS.width * 2, CANVAS.height * 2] as const;

  it('stops at two levels for the size this skin renders at', () => {
    expect(bloomLevels(...RENDERED)).toBe(2);
  });

  it('keeps the widest level well clear of one texel per several pixels', () => {
    const widest = Math.min(RENDERED[0], RENDERED[1]) >> bloomLevels(...RENDERED);
    expect(widest).toBeGreaterThanOrEqual(48);
  });

  it('adds a level only when there is real room for one', () => {
    expect(bloomLevels(1920, 1080)).toBe(3);
  });

  it('always returns at least one level, however small the canvas', () => {
    expect(bloomLevels(8, 8)).toBe(1);
  });
});

describe('presence', () => {
  it('holds still at rest and asleep, so a pinned eye mostly does not draw', () => {
    // Every drawn frame costs about three milliseconds; the idle states are
    // cheap only because nothing in them moves continuously.
    expect(PRESENCE.resting.breathe).toBeNull();
    expect(PRESENCE.asleep.breathe).toBeNull();
    for (const elapsedMs of [0, 700, 2400, 9000]) {
      expect(at(elapsedMs, { presence: 'resting' })).toBe(1);
      expect(at(elapsedMs, { presence: 'asleep' })).toBe(1);
    }
  });

  it('blinks at rest, and only at rest', () => {
    expect(PRESENCE.resting.blink).not.toBeNull();
    expect(PRESENCE.awake.blink).toBeNull();
    expect(PRESENCE.asleep.blink).toBeNull();
  });

  it('spends far longer between blinks than blinking', () => {
    const blink = PRESENCE.resting.blink!;
    expect(blink.minGapMs).toBeLessThan(blink.maxGapMs);
    expect(blink.durationMs * 8).toBeLessThan(blink.minGapMs);
  });

  it('closes and dims in order: awake, resting, asleep', () => {
    expect(PRESENCE.awake.openness).toBe(1);
    expect(PRESENCE.awake.exposure).toBe(1);
    expect(PRESENCE.resting.openness).toBeLessThan(PRESENCE.awake.openness);
    expect(PRESENCE.asleep.openness).toBeLessThan(PRESENCE.resting.openness);
    expect(PRESENCE.resting.exposure).toBeLessThan(PRESENCE.awake.exposure);
    expect(PRESENCE.asleep.exposure).toBeLessThan(PRESENCE.resting.exposure);
  });

  it('leaves an unpinned companion exactly as it was', () => {
    // Awake is the default, and awake must be the old behaviour to the digit.
    for (const elapsedMs of [0, 600, 1200, 5000]) {
      expect(at(elapsedMs, { presence: 'awake' })).toBe(at(elapsedMs));
    }
  });

  it('speaks with the speaking motion whatever it was doing before', () => {
    expect(at(450, { presence: 'resting', speaking: true })).toBe(at(450, { speaking: true }));
    expect(at(450, { presence: 'asleep', speaking: true })).toBe(at(450, { speaking: true }));
  });
});

describe('blinkOpenness', () => {
  it('starts and ends fully open, so a blink leaves no seam', () => {
    expect(blinkOpenness(0, 0.9)).toBe(1);
    expect(blinkOpenness(1, 0.9)).toBe(1);
    expect(blinkOpenness(-0.2, 0.9)).toBe(1);
    expect(blinkOpenness(1.4, 0.9)).toBe(1);
  });

  it('closes to its depth and no further', () => {
    let lowest = 1;
    for (let p = 0; p <= 1; p += 0.01) lowest = Math.min(lowest, blinkOpenness(p, 0.9));
    expect(lowest).toBeCloseTo(0.1, 2);
    expect(lowest).toBeGreaterThan(0);
  });

  it('drops the lid faster than it lifts it', () => {
    let closedAt = 0;
    let lowest = 1;
    for (let p = 0; p <= 1; p += 0.005) {
      const value = blinkOpenness(p, 0.9);
      if (value < lowest) {
        lowest = value;
        closedAt = p;
      }
    }
    expect(closedAt).toBeLessThan(0.5);
  });
});

import type { SkinProps } from '../types';
import { effectivePalette, paletteVars } from '../palette';
import { CANVAS, CENTRE } from './geometry';
import ShaderEye from './ShaderEye';
import styles from './EyeSkin.module.css';

export const EYE_CANVAS = CANVAS;
export const EYE_OPTIC_CENTRE = CENTRE;

/**
 * §3 — the companion is an eye and nothing else. No shell, no frame, no ring:
 * one aperture of rendered light on a transparent ground.
 *
 * That makes this skin a single layer, which is unusual here — the other skins
 * were stacks of five, and the stack existed because each moving part had to
 * be its own composited element or Chromium re-rasterised a filter graph every
 * frame. None of that applies to a canvas: the motion happens inside the
 * shader, so there is nothing for the compositor to animate and nothing to
 * split apart.
 *
 * The eye needs no fallback path. It is the whole character, so a machine that
 * cannot run it has nothing to fall back *to* — see `ShaderEye`.
 */
export default function EyeSkin({
  palette,
  mode,
  speaking,
  reducedMotion,
  unlit = false,
  presence = 'awake'
}: SkinProps): JSX.Element {
  const p = effectivePalette(palette, mode);

  return (
    <div className={styles.skin} style={paletteVars(p, CANVAS)}>
      {/* Emissive, so §4.1's unlit review mode hides it — which leaves the
          unit empty, correctly: there is no unlit form here to judge. */}
      <div className={`${styles.eye} ${styles.emissive}`} data-motion="eye">
        <ShaderEye
          baseHue={p.light}
          coreHue={p.lightCore}
          mode={mode}
          speaking={speaking}
          reducedMotion={reducedMotion}
          unlit={unlit}
          presence={presence}
        />
      </div>
    </div>
  );
}

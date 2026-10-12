import { useEffect, useRef } from 'react';
import type { Presence, SpeechMode } from '@shared/types';
import { CANVAS } from './geometry';
import {
  EYE_CENTRE,
  EYE_SHAPE,
  FRAME_MS,
  MODE_UNIFORMS,
  PRESENCE,
  PRESENCE_EASE_MS,
  blinkOpenness,
  bloomLevels,
  hexToRgb,
  opennessAt,
  type EyeUniforms
} from './eyeUniforms';
import vertSrc from './shaders/fullscreen.vert.glsl?raw';
import eyeSrc from './shaders/eye.frag.glsl?raw';
import blurSrc from './shaders/blur.frag.glsl?raw';
import compositeSrc from './shaders/composite.frag.glsl?raw';

/**
 * The companion, rendered as light rather than drawn as a shape.
 *
 * §3.1 asks for a membrane of rendered light: a white core that is white
 * because of its intensity, colour only in the falloff, and a torn contour.
 * SVG cannot do the first of those — values clamp at 1.0, so a blowout has to
 * be painted white rather than produced — and the torn contour costs a
 * hand-authored anchor per notch. Both come out of a fragment shader for free.
 *
 * The chain is: eye into an RGBA16F target where radiance runs past 1.0, a
 * ladder of half-resolution blurs for the two bloom taps, then a composite
 * that tonemaps and writes premultiplied alpha so the canvas stays transparent
 * where the field is dark.
 *
 * **There is no fallback.** While this was one layer of a mechanism, a machine
 * without WebGL2 could keep an SVG lens and still show the rest. The eye is now
 * the entire character, so there is nothing to fall back to and no half-measure
 * worth carrying: if the context or the programs fail, the unit renders
 * nothing and the failure is logged.
 */

export interface ShaderEyeProps {
  /** Already resolved through `effectivePalette`, so rage colours are in. */
  baseHue: string;
  coreHue: string;
  mode: SpeechMode;
  speaking: boolean;
  reducedMotion: boolean;
  /** §4.1 review mode. CSS hides the layer; this stops it rendering as well. */
  unlit: boolean;
  /** How the eye holds itself with nothing to say. Absent means awake. */
  presence?: Presence;
}

/*
 * The backing store is always twice the CSS size, rather than the display's
 * current `devicePixelRatio`. The overlay is repositioned between monitors,
 * and a canvas sized once at mount would come out soft on a higher-DPI screen
 * with nothing to trigger a resize. Oversampling a 1x display instead costs
 * four times the pixels of a 150 x 175 canvas, which measurement says is free
 * here — the cost of this layer is GL call count, not fragments.
 */
const RENDER_SCALE = 2;

/**
 * The timer undershoots the frame interval by this much, so the rAF it
 * requests lands on the intended vsync rather than the one after.
 */
const FRAME_SLACK_MS = 1;

/** An eased factor this close to its target is there. */
const SETTLED = 0.004;

/**
 * The most one frame may advance the field's clock. The loop stops between
 * blinks, and a field that jumped by the seconds it was not being drawn for
 * would start every blink by snapping to a different contour.
 */
const MAX_FIELD_STEP_MS = 50;

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

interface Program {
  program: WebGLProgram;
  loc: (name: string) => WebGLUniformLocation | null;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[shader-eye]', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): Program | null {
  const vert = compile(gl, gl.VERTEX_SHADER, vs);
  const frag = compile(gl, gl.FRAGMENT_SHADER, fs);
  const program = vert && frag ? gl.createProgram() : null;
  if (!vert || !frag || !program) return null;

  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[shader-eye]', gl.getProgramInfoLog(program));
    return null;
  }

  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    loc(name) {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
      return cache.get(name) ?? null;
    }
  };
}

function makeTarget(gl: WebGL2RenderingContext, w: number, h: number): Target | null {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!complete) {
    // A driver can advertise the extension and still refuse the format.
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fbo);
    return null;
  }
  return { tex, fbo, w, h };
}

export default function ShaderEye(props: ShaderEyeProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // The render loop reads the latest props through this rather than closing
  // over them, so a mode change never restarts the GL context. Written in an
  // effect rather than during render, and before the effect that wakes the
  // loop, so the woken frame already sees the new state.
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  /* The loop stops itself when there is nothing to animate — reduced motion or
     unlit review mode. This is how it is woken again. */
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const fail = (why: string): void => console.error('[eye] ' + why);

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power'
    });
    if (!gl) {
      fail('no WebGL2 context');
      return;
    }
    /* Half-float render targets are not optional: they are what holds radiance
       above 1.0, and without that there is no reason to be in a shader. With no
       fallback left, the failure has to be named rather than silently produce
       an incomplete framebuffer and an empty canvas. */
    const floatTargets =
      gl.getExtension('EXT_color_buffer_float') ?? gl.getExtension('EXT_color_buffer_half_float');
    if (!floatTargets) {
      fail('no half-float render targets');
      return;
    }

    const eye = link(gl, vertSrc, eyeSrc);
    const blur = link(gl, vertSrc, blurSrc);
    const composite = link(gl, vertSrc, compositeSrc);
    const vao = gl.createVertexArray();
    if (!eye || !blur || !composite || !vao) {
      fail('shader programs failed to build');
      return;
    }

    const width = CANVAS.width * RENDER_SCALE;
    const height = CANVAS.height * RENDER_SCALE;
    canvas.width = width;
    canvas.height = height;

    const scene = makeTarget(gl, width, height);
    const levels: Target[][] = [];
    for (let i = 0; i < bloomLevels(width, height); i++) {
      const w = Math.max(1, width >> (i + 1));
      const h = Math.max(1, height >> (i + 1));
      const ping = makeTarget(gl, w, h);
      const pong = makeTarget(gl, w, h);
      if (ping && pong) levels.push([ping, pong]);
    }
    if (!scene || levels.length === 0) {
      fail('could not allocate render targets');
      return;
    }

    gl.bindVertexArray(vao);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);

    const draw = () => gl.drawArrays(gl.TRIANGLES, 0, 3);

    const bindPass = (target: Target | null, prog: Program): void => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
      gl.viewport(0, 0, target ? target.w : width, target ? target.h : height);
      gl.useProgram(prog.program);
    };

    const blurInto = (dst: Target, srcTex: WebGLTexture, dx: number, dy: number, radius: number) => {
      bindPass(dst, blur);
      gl.uniform2f(blur.loc('uDstSize'), dst.w, dst.h);
      gl.uniform2f(blur.loc('uDir'), dx, dy);
      gl.uniform1f(blur.loc('uRadius'), radius);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(blur.loc('uSrc'), 0);
      draw();
    };

    /* The field's own clock: it advances only while frames are being drawn,
       so a still eye picks up exactly where it stopped. Awake, that is real
       time to within a frame. */
    let fieldMs = 0;
    /* A blink in progress, and when the next one is due. Only a presence with
       a `blink` uses either. */
    let blinkStartedAt: number | null = null;
    let nextBlinkAt = 0;
    let frame = 0;
    let timer = 0;
    let running = false;
    let disposed = false;
    /* Everything except time and openness is constant until the mode or the
       palette changes, and a `gl.uniform*` call is not free at 60 Hz — the
       whole per-frame CPU cost of this layer is the call count. Re-uploaded
       only when this key changes. */
    let uploadedKey = '';
    let compositeKey = '';
    /* The presence factors as currently drawn, easing toward the presence
       asked for. Null until the first frame, which starts where it means to
       be instead of opening from nothing. */
    let shownOpen: number | null = null;
    let shownExposure: number | null = null;
    let lastFrameAt = 0;

    const render = (now: number): void => {
      if (disposed) return;
      const { baseHue, coreHue, mode, speaking, reducedMotion, unlit, presence = 'awake' } = latest.current;
      if (unlit) {
        running = false;
        return;
      }

      const u: EyeUniforms = MODE_UNIFORMS[mode];

      const target = PRESENCE[presence];
      const dt = lastFrameAt === 0 ? 0 : now - lastFrameAt;
      lastFrameAt = now;
      fieldMs += Math.min(dt, MAX_FIELD_STEP_MS);
      const elapsedMs = fieldMs;
      const ease = reducedMotion ? 1 : 1 - Math.exp(-dt / PRESENCE_EASE_MS);
      shownOpen = shownOpen === null ? target.openness : shownOpen + (target.openness - shownOpen) * ease;
      shownExposure =
        shownExposure === null ? target.exposure : shownExposure + (target.exposure - shownExposure) * ease;
      const settled =
        Math.abs(shownOpen - target.openness) < SETTLED && Math.abs(shownExposure - target.exposure) < SETTLED;

      // Blinks belong to a presence that has them and to an eye that has
      // finished arriving there; anything else cancels one in flight.
      let blink = 1;
      const blinks = !reducedMotion && settled ? target.blink : null;
      if (!blinks) {
        blinkStartedAt = null;
        nextBlinkAt = 0;
      } else {
        const gap = (): number => blinks.minGapMs + Math.random() * (blinks.maxGapMs - blinks.minGapMs);
        if (nextBlinkAt === 0) nextBlinkAt = now + gap();
        if (blinkStartedAt === null && now >= nextBlinkAt) blinkStartedAt = now;
        if (blinkStartedAt !== null) {
          const progress = (now - blinkStartedAt) / blinks.durationMs;
          if (progress >= 1) {
            blinkStartedAt = null;
            nextBlinkAt = now + gap();
          } else {
            blink = blinkOpenness(progress, blinks.depth);
          }
        }
      }

      // 1 — the eye, into HDR.
      bindPass(scene, eye);
      const key = `${mode}|${baseHue}|${coreHue}`;
      if (key !== uploadedKey) {
        uploadedKey = key;
        gl.uniform2f(eye.loc('uResolution'), width, height);
        gl.uniform2f(eye.loc('uShape'), EYE_SHAPE[0], EYE_SHAPE[1]);
        gl.uniform2f(eye.loc('uCentre'), EYE_CENTRE[0], EYE_CENTRE[1]);
        gl.uniform1f(eye.loc('uWarpAmp'), u.uWarpAmp);
        gl.uniform1f(eye.loc('uOctaves'), u.uOctaves);
        gl.uniform1f(eye.loc('uNoiseScale'), u.uNoiseScale);
        gl.uniform1f(eye.loc('uThickness'), u.uThickness);
        gl.uniform1f(eye.loc('uThickVar'), u.uThickVar);
        gl.uniform1f(eye.loc('uCoreIntensity'), u.uCoreIntensity);
        gl.uniform1f(eye.loc('uCoreRadius'), u.uCoreRadius);
        gl.uniform1f(eye.loc('uDispersion'), u.uDispersion);
        gl.uniform1f(eye.loc('uInterior'), u.uInterior);
        gl.uniform3fv(eye.loc('uBaseHue'), hexToRgb(baseHue));
        gl.uniform3fv(eye.loc('uCoreHue'), hexToRgb(coreHue));
      }
      // Reduced motion freezes the field: no drift, no breathing, one still
      // frame. §3 treats stillness as the accessible state, not slow motion.
      gl.uniform1f(eye.loc('uTime'), reducedMotion ? 0 : elapsedMs / 1000);
      gl.uniform1f(
        eye.loc('uOpenness'),
        opennessAt({ mode, speaking, reducedMotion, elapsedMs, presence }) * shownOpen * blink
      );
      draw();

      // 2 — two bloom taps off one ladder: the tightest level and the widest.
      // Width comes from downsampling, not from stretching the kernel.
      let tight: Target | null = null;
      let wide: Target = scene;
      for (let i = 0; i < levels.length; i++) {
        const [ping, pong] = levels[i];
        const last = i === levels.length - 1;
        const radius = i === 0 ? u.uRadiusA : last ? u.uRadiusB : 1;
        blurInto(ping, wide.tex, 1, 0, radius);
        blurInto(pong, ping.tex, 0, 1, radius);
        wide = pong;
        if (i === 0) tight = pong;
      }

      // 3 — tonemap and write premultiplied alpha to the canvas.
      bindPass(null, composite);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (key !== compositeKey) {
        compositeKey = key;
        gl.uniform2f(composite.loc('uResolution'), width, height);
        gl.uniform1f(composite.loc('uStrengthA'), u.uStrengthA);
        gl.uniform1f(composite.loc('uStrengthB'), u.uStrengthB);
      }
      // Per frame, unlike its neighbours: it is what dims the eye to rest.
      gl.uniform1f(composite.loc('uExposure'), u.uExposure * shownExposure);
      const bind = (tex: WebGLTexture, unit: number, name: string): void => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(composite.loc(name), unit);
      };
      bind(scene.tex, 0, 'uScene');
      bind((tight ?? wide).tex, 1, 'uBloomA');
      bind(wide.tex, 2, 'uBloomB');
      draw();

      // Reduced motion draws once and stops: an idle rAF loop on a permanently
      // visible overlay is exactly the cost §7 spends its budget avoiding.
      if (reducedMotion) {
        running = false;
        return;
      }

      // Nothing is moving: the eye has arrived at a presence that holds
      // still, it is not speaking, and no blink is in flight. One frame is all
      // there is to show, so the loop ends here and costs nothing — until a
      // prop change kicks it, or the next blink comes due.
      const moving = speaking || mode === 'rage' || target.breathe !== null || blinkStartedAt !== null;
      if (settled && !moving) {
        running = false;
        lastFrameAt = 0;
        if (blinks) {
          timer = window.setTimeout(() => kick.current(), Math.max(0, nextBlinkAt - now));
        }
        return;
      }

      /* The next frame is requested from a timer rather than straight from
         here, so the callback itself only runs 30 times a second.
         Re-requesting immediately and skipping the work under a deadline still
         wakes the renderer at the display's rate, and measurement says that
         wake — not the drawing — is what this layer actually costs: capping
         the drawn frames alone moved the CPU figure by hundredths, capping the
         callbacks moved it by tenths. rAF is still what presents, so the frame
         that is drawn stays aligned to vsync. */
      timer = window.setTimeout(() => {
        frame = requestAnimationFrame(render);
      }, FRAME_MS - FRAME_SLACK_MS);
    };

    kick.current = () => {
      if (disposed || running) return;
      running = true;
      window.clearTimeout(timer);
      frame = requestAnimationFrame(render);
    };
    kick.current();

    return () => {
      disposed = true;
      running = false;
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      kick.current = () => {};
      gl.deleteProgram(eye.program);
      gl.deleteProgram(blur.program);
      gl.deleteProgram(composite.program);
      gl.deleteVertexArray(vao);
      for (const target of [scene, ...levels.flat()]) {
        gl.deleteTexture(target.tex);
        gl.deleteFramebuffer(target.fbo);
      }
      /* Deliberately no `loseContext()` here. A canvas keeps its context for
         the life of the element, so losing it on cleanup poisons the element
         rather than freeing it — and StrictMode mounts, cleans up and mounts
         again on the same canvas, so the second mount would find a dead
         context and silently render nothing. Deleting the objects is enough;
         the context goes when the element does. */
    };
  }, []);

  /* Wake the loop after any prop change. When it is already running this is a
     no-op; when it stopped for reduced motion or unlit it draws the one frame
     the new state needs. Deliberately not dependency-gated — every render is a
     candidate, and `kick` is cheap enough that listing the props would only be
     a way to forget one. */
  useEffect(() => {
    kick.current();
  });

  return (
    <canvas
      ref={canvasRef}
      style={{ width: `${CANVAS.width}px`, height: `${CANVAS.height}px`, display: 'block' }}
      role="presentation"
    />
  );
}

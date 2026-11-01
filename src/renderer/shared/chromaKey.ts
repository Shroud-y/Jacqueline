import { useEffect, useRef, type RefObject } from 'react';
import type { Chroma } from '@shared/character';
import { ANIMATION_FRAME } from './animationPlayer';

type KeySource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

/*
 * Taking a background colour out of a picture or a video, on the graphics
 * card. The colours are compared in YCbCr rather than RGB: a shadow on a green
 * screen is still the same hue, so it goes with the rest, while brightness
 * still counts for a little, or a white background could not be told from grey.
 */

const VERTEX = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
varying vec2 uv;
uniform sampler2D frame;
uniform vec3 key;
uniform float tolerance;
uniform float softness;
vec3 ycc(vec3 c) {
  return vec3(
    0.299 * c.r + 0.587 * c.g + 0.114 * c.b,
    -0.169 * c.r - 0.331 * c.g + 0.5 * c.b,
    0.5 * c.r - 0.419 * c.g - 0.081 * c.b
  );
}
void main() {
  vec4 color = texture2D(frame, uv);
  vec3 difference = ycc(color.rgb) - ycc(key);
  difference.x *= 0.5;
  float alpha = color.a * smoothstep(tolerance, tolerance + softness, length(difference));
  gl_FragColor = vec4(color.rgb * alpha, alpha);
}`;

/** '#rrggbb' as 0 to 1. */
function rgb(color: string): [number, number, number] {
  const value = parseInt(color.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

export class ChromaRenderer {
  private readonly gl: WebGLRenderingContext | null;
  private uniforms: { key: WebGLUniformLocation | null; tolerance: WebGLUniformLocation | null; softness: WebGLUniformLocation | null } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (this.gl) this.setUp(this.gl);
  }

  private setUp(gl: WebGLRenderingContext): void {
    const compile = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram();
    const vertex = compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!program || !vertex || !fragment) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    this.uniforms = {
      key: gl.getUniformLocation(program, 'key'),
      tolerance: gl.getUniformLocation(program, 'tolerance'),
      softness: gl.getUniformLocation(program, 'softness')
    };
  }

  /** 0 to 100 from the editor, to what the shader measures. */
  setChroma({ color, tolerance, softness }: Chroma): void {
    const { gl, uniforms } = this;
    if (!gl || !uniforms) return;
    gl.uniform3fv(uniforms.key, rgb(color));
    gl.uniform1f(uniforms.tolerance, (tolerance / 100) * 0.6);
    gl.uniform1f(uniforms.softness, (softness / 100) * 0.3 + 0.001);
  }

  resize(width: number, height: number): void {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  draw(source: KeySource): void {
    const { gl } = this;
    if (!gl) return;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch (err) {
      // A frame that could not be read must not take the character's window down with it.
      console.warn(`cannot read a frame: ${String(err)}`);
      return;
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

const isReady = (source: KeySource): boolean => {
  if (source instanceof HTMLCanvasElement) return true;
  return source instanceof HTMLVideoElement ? source.readyState >= 2 : source.complete && source.naturalWidth > 0;
};

/**
 * Keeps `canvas` showing `source` without its background. A picture is drawn
 * once and costs nothing after; a video is drawn only when a new frame has
 * actually arrived, so a paused or resting one costs nothing either.
 */
export function useChromaKey(
  canvas: RefObject<HTMLCanvasElement | null>,
  source: RefObject<KeySource | null>,
  chroma: Chroma | null,
  /** Size of the canvas in pixels. */
  pixels: { width: number; height: number } | null,
  /** A different file: start listening to it again. */
  sourceKey: string
): void {
  const renderer = useRef<ChromaRenderer | null>(null);
  const active = chroma !== null;
  const width = pixels?.width ?? 0;
  const height = pixels?.height ?? 0;

  useEffect(() => {
    if (!active || !canvas.current) return;
    renderer.current = new ChromaRenderer(canvas.current);
    return () => {
      renderer.current = null;
    };
    // The canvas is there exactly while the chroma is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // New settings or a new size show at once, even on a video that is holding still.
  useEffect(() => {
    if (!chroma || !renderer.current || width === 0) return;
    renderer.current.resize(width, height);
    renderer.current.setChroma(chroma);
    const element = source.current;
    if (element && isReady(element)) renderer.current.draw(element);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chroma?.color, chroma?.tolerance, chroma?.softness, width, height, sourceKey]);

  useEffect(() => {
    const element = source.current;
    if (!active || !element) return;
    const draw = (): void => {
      if (isReady(element)) renderer.current?.draw(element);
    };
    if (element instanceof HTMLCanvasElement) {
      element.addEventListener(ANIMATION_FRAME, draw);
      return () => element.removeEventListener(ANIMATION_FRAME, draw);
    }
    if (element instanceof HTMLImageElement) {
      element.addEventListener('load', draw);
      return () => element.removeEventListener('load', draw);
    }
    let frame = 0;
    const onFrame = (): void => {
      draw();
      frame = element.requestVideoFrameCallback(onFrame);
    };
    frame = element.requestVideoFrameCallback(onFrame);
    // A frame it lands on without playing: the first one, or the start again after a rest.
    element.addEventListener('loadeddata', draw);
    element.addEventListener('seeked', draw);
    return () => {
      element.cancelVideoFrameCallback(frame);
      element.removeEventListener('loadeddata', draw);
      element.removeEventListener('seeked', draw);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sourceKey]);
}

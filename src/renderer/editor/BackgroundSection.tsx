import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { Character, Chroma, Visual } from '@shared/character';
import { assetUrl } from '@shared/assetUrl';
import { Checkbox, ColorField, Field, Group, Notice, Slider } from './fields';
import KeyedMedia from './KeyedMedia';
import type { Characters } from './useCharacters';

const PREVIEW_SIDE = 320;
const START: Omit<Chroma, 'color'> = { tolerance: 12, softness: 8 };
const FALLBACK_COLOR = '#00ff00';

const hex = (value: number): string => value.toString(16).padStart(2, '0');

/** The file's first frame on a canvas of its own, to read colours from. */
function useFrame(url: string, type: Visual['type']): { frame: HTMLCanvasElement | null; size: { width: number; height: number } | null } {
  const [state, setState] = useState<{ frame: HTMLCanvasElement | null; size: { width: number; height: number } | null }>({ frame: null, size: null });

  useEffect(() => {
    let cancelled = false;
    const take = (source: CanvasImageSource, width: number, height: number): void => {
      if (cancelled || width === 0 || height === 0) return;
      const scale = Math.min(1, PREVIEW_SIDE / Math.max(width, height));
      const frame = document.createElement('canvas');
      frame.width = Math.round(width * scale);
      frame.height = Math.round(height * scale);
      frame.getContext('2d', { willReadFrequently: true })?.drawImage(source, 0, 0, frame.width, frame.height);
      setState({ frame, size: { width: frame.width, height: frame.height } });
    };
    if (type !== 'video') {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => take(image, image.naturalWidth, image.naturalHeight);
      image.src = url;
      return () => {
        cancelled = true;
      };
    }
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';
    video.onloadeddata = () => take(video, video.videoWidth, video.videoHeight);
    video.src = url;
    return () => {
      cancelled = true;
      // Let go of the decoder: nothing here plays it.
      video.removeAttribute('src');
      video.load();
    };
  }, [url, type]);

  return state;
}

/** Taking a one-colour background out of the character's picture or video. */
export default function BackgroundSection({ character, characters, idle }: { character: Character; characters: Characters; idle: Visual }): JSX.Element {
  const { id, appearance } = character;
  const { chroma } = appearance;
  const url = assetUrl(id, idle.src);
  const { frame, size } = useFrame(url, idle.type);
  const preview = useRef<HTMLDivElement>(null);

  const set = (next: Chroma | null): void => characters.update({ ...character, appearance: { ...appearance, chroma: next } });

  /** What is at this spot of the frame, as a fraction of it. */
  const colorAt = (u: number, v: number): string | null => {
    if (!frame) return null;
    const x = Math.min(frame.width - 1, Math.max(0, Math.floor(u * frame.width)));
    const y = Math.min(frame.height - 1, Math.max(0, Math.floor(v * frame.height)));
    const pixel = frame.getContext('2d')?.getImageData(x, y, 1, 1).data;
    return pixel ? `#${hex(pixel[0] ?? 0)}${hex(pixel[1] ?? 0)}${hex(pixel[2] ?? 0)}` : null;
  };

  const pick = (event: MouseEvent<HTMLDivElement>): void => {
    if (!chroma || !preview.current) return;
    const box = preview.current.getBoundingClientRect();
    const color = colorAt((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
    if (color) set({ ...chroma, color });
  };

  return (
    <Group title="Background">
      <Checkbox
        label="Remove a background colour"
        hint="For a file with a plain background and no transparency of its own, such as an .mp4."
        checked={chroma !== null}
        // Starts from the top-left corner: on a plain background, that is the background.
        onChange={(on) => set(on ? { color: colorAt(0, 0) ?? FALLBACK_COLOR, ...START } : null)}
      />
      {chroma ? (
        <>
          {size ? (
            <Field hint="Click the background here to choose its colour.">
              <div ref={preview} className="chroma-preview" style={{ width: size.width, height: size.height }} onClick={pick}>
                <KeyedMedia url={url} type={idle.type === 'video' ? 'video' : 'image'} chroma={chroma} style={{ display: 'block', width: '100%', height: '100%' }} />
              </div>
            </Field>
          ) : null}
          <Field label="Colour">
            <ColorField label="Colour" value={chroma.color} onCommit={(color) => /^#[0-9a-fA-F]{6}$/.test(color) && set({ ...chroma, color })} />
          </Field>
          <Field label="Tolerance" hint="How far from that colour still counts as background.">
            <Slider label="Tolerance" value={chroma.tolerance} min={0} max={100} unit="%" onCommit={(tolerance) => set({ ...chroma, tolerance })} />
          </Field>
          <Field label="Edge softness" hint="How gradually the edge fades. A little hides the fringe video compression leaves.">
            <Slider label="Edge softness" value={chroma.softness} min={0} max={100} unit="%" onCommit={(softness) => set({ ...chroma, softness })} />
          </Field>
          {idle.type === 'video' ? <Notice kind="warn">Cutting the background out of a video costs about twice what the video does on its own, for as long as it plays. A .webm with transparency costs nothing extra.</Notice> : null}
        </>
      ) : null}
    </Group>
  );
}

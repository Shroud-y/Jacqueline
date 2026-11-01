import { useEffect, useRef, useState, type RefObject } from 'react';
import { frameDelayMs, nextFrame } from '@shared/animation';

/*
 * An <img> plays a GIF on its own and cannot be told to stop, even with nobody
 * at the computer. So the frames are decoded here, one at a time, and drawn on
 * a canvas: paused or resting, nothing is decoded or drawn at all.
 */

/** Fired on the canvas whenever it shows a new frame. */
export const ANIMATION_FRAME = 'animation-frame';

const MIME: Record<string, string> = { gif: 'image/gif', png: 'image/png', webp: 'image/webp' };

/** Ready to decode, or null for a file that cannot be read this way. */
async function openDecoder(url: string): Promise<ImageDecoder | null> {
  try {
    // The address can carry a version after the file name.
    const { pathname } = new URL(url);
    const type = MIME[pathname.slice(pathname.lastIndexOf('.') + 1).toLowerCase()];
    if (!type) return null;
    const response = await fetch(url);
    if (!response.ok) return null;
    const decoder = new ImageDecoder({ type, data: await response.arrayBuffer() });
    // Both: the tracks are known on their own schedule, and only `completed` makes the frame count final.
    await Promise.all([decoder.tracks.ready, decoder.completed]);
    return decoder;
  } catch (err) {
    console.warn(`cannot read ${url}: ${String(err)}`);
    return null;
  }
}

/** Whether a picture file actually moves: a .gif may be still, a .png or .webp may not be. */
export async function isAnimated(url: string): Promise<boolean> {
  const decoder = await openDecoder(url);
  const animated = decoder !== null && decoder.tracks.selectedTrack?.animated === true && decoder.tracks.selectedTrack.frameCount > 1;
  decoder?.close();
  return animated;
}

interface AnimationEvents {
  onMeasured: (width: number, height: number) => void;
  /** The first frame is up, or there will never be one. */
  onPainted: () => void;
}

/** Keeps `canvas` showing the animation at `url`, moving only while `playing`. */
export function useAnimation(canvas: RefObject<HTMLCanvasElement | null>, url: string | null, playing: boolean, restSec: number, events: AnimationEvents): void {
  const [opened, setOpened] = useState<{ url: string; decoder: ImageDecoder } | null>(null);
  const shown = useRef({ index: 0, delayMs: 0 });
  const latest = useRef(events);
  useEffect(() => {
    latest.current = events;
  });

  /** Puts a frame on the canvas. */
  const show = async (decoder: ImageDecoder, index: number): Promise<void> => {
    const { image } = await decoder.decode({ frameIndex: index });
    try {
      const element = canvas.current;
      // Drawn in ordinary memory: on the graphics card, every frame leaves a texture behind.
      const context = element?.getContext('2d', { willReadFrequently: true });
      if (!element || !context) return;
      if (element.width !== image.displayWidth) element.width = image.displayWidth;
      if (element.height !== image.displayHeight) element.height = image.displayHeight;
      context.clearRect(0, 0, element.width, element.height);
      context.drawImage(image, 0, 0);
      shown.current = { index, delayMs: frameDelayMs(image.duration) };
      element.dispatchEvent(new Event(ANIMATION_FRAME));
    } finally {
      image.close();
    }
  };

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let decoder: ImageDecoder | null = null;
    void (async () => {
      decoder = await openDecoder(url);
      if (cancelled) {
        decoder?.close();
        return;
      }
      try {
        if (decoder) {
          await show(decoder, 0);
          if (cancelled) return;
          const element = canvas.current;
          if (element) latest.current.onMeasured(element.width, element.height);
          setOpened({ url, decoder });
        }
      } catch (err) {
        console.warn(`cannot show ${url}: ${String(err)}`);
      }
      // Even a file that cannot be shown gets its window, or it could never be fixed.
      if (!cancelled) latest.current.onPainted();
    })();
    return () => {
      cancelled = true;
      decoder?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const decoder = opened?.url === url ? (opened?.decoder ?? null) : null;
  useEffect(() => {
    const count = decoder?.tracks.selectedTrack?.frameCount ?? 0;
    if (!decoder || !playing || count < 2) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (spent: number): void => {
      const next = nextFrame(shown.current.index, count, shown.current.delayMs, restSec);
      timer = setTimeout(() => {
        const started = performance.now();
        void show(decoder, next.index).then(
          () => {
            if (!cancelled) schedule(performance.now() - started);
          },
          (err: unknown) => {
            if (!cancelled) console.warn(`cannot go on playing: ${String(err)}`);
          }
        );
      }, Math.max(1, next.waitMs - spent));
    };
    schedule(0);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoder, playing, restSec]);
}

import { useRef, useState, type CSSProperties } from 'react';
import type { Chroma } from '@shared/character';
import { useChromaKey } from '../shared/chromaKey';

/** Plenty for a canvas in the editor, however big the file. */
const MAX_SIDE = 1024;

interface KeyedMediaProps {
  url: string;
  type: 'image' | 'video';
  chroma: Chroma;
  style: CSSProperties;
}

/** A picture or a video's first frame, without its background: how the editor shows a character whose background is cut out. */
export default function KeyedMedia({ url, type, chroma, style }: KeyedMediaProps): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  const [pixels, setPixels] = useState<{ width: number; height: number } | null>(null);

  useChromaKey(canvas, source, chroma, pixels, url);

  const measured = (width: number, height: number): void => {
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    setPixels({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) });
  };

  const hidden: CSSProperties = { position: 'absolute', width: 1, height: 1, opacity: 0 };
  return (
    <>
      {type === 'image' ? (
        <img
          ref={(element) => {
            source.current = element;
          }}
          src={url}
          alt=""
          crossOrigin="anonymous"
          draggable={false}
          style={hidden}
          onLoad={(event) => measured(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
        />
      ) : (
        <video
          ref={(element) => {
            source.current = element;
          }}
          src={url}
          crossOrigin="anonymous"
          muted
          preload="auto"
          style={hidden}
          onLoadedMetadata={(event) => measured(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
        />
      )}
      <canvas ref={canvas} style={style} />
    </>
  );
}

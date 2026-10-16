import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { SAMPLE_LINE } from '@shared/textStyle';
import type { StagePayload } from '@shared/types';
import TextElement from '../shared/TextElement';
import SpeechText from './SpeechText';

/** A press that travels less than this is a click, not a drag. */
const DRAG_THRESHOLD_PX = 4;

/** A character's window: draws its layout. */
export default function Stage(): JSX.Element | null {
  const [stage, setStage] = useState<StagePayload | null>(null);

  useEffect(() => {
    const api = window.jacqueline;
    if (!api) return;
    let cancelled = false;
    void api.getStage().then((payload) => {
      if (!cancelled && payload) setStage(payload);
    });
    const off = api.onStageUpdate(setStage);
    // A sound plays from here, where the character is: one element per sound, let go when it ends.
    const offSound = api.onSound(({ url, volume }) => {
      const audio = new Audio(url);
      audio.volume = Math.min(1, Math.max(0, volume));
      void audio.play().catch(() => undefined);
    });
    return () => {
      cancelled = true;
      off();
      offSound();
    };
  }, []);

  if (!stage) return null;

  return (
    <div className="stage">
      {stage.elements.map((element) => {
        const box = { left: element.x - stage.frame.x, top: element.y - stage.frame.y, width: element.width, height: element.height };
        if (element.type === 'character') return <CharacterElement key={element.id} stage={stage} {...box} />;
        const { speech } = stage;
        if (speech && element.type === 'speech') {
          // Keyed by the line, so every line arrives from the start.
          return <SpeechText key={speech.id} characterId={stage.id} text={speech.text} style={element.style} reveal={element.reveal} box={box} />;
        }
        if (speech && element.type === 'name') {
          return <TextElement key={element.id} className="text text-fade" characterId={stage.id} text={stage.name} style={element.style} box={box} />;
        }
        // With nothing being said, text shows only while it is being laid out.
        if (!stage.preview) return null;
        return (
          <TextElement
            key={element.id}
            className="text"
            characterId={stage.id}
            text={element.type === 'name' ? stage.name : SAMPLE_LINE}
            style={element.style}
            box={box}
          />
        );
      })}
    </div>
  );
}

interface CharacterElementProps {
  stage: StagePayload;
  left: number;
  top: number;
  width: number;
  height: number;
}

function CharacterElement({ stage, left, top, width, height }: CharacterElementProps): JSX.Element {
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [dragging, setDragging] = useState(false);
  // The picture's own proportions, once it has told us. Per address: a new
  // file is a new shape.
  const [natural, setNatural] = useState<{ url: string; width: number; height: number } | null>(null);
  const { visual } = stage;

  // The placeholder is on screen as soon as it is mounted; a picture or a
  // video says so itself, once it has a frame to show.
  useEffect(() => {
    if (!visual) window.jacqueline?.painted();
  }, [visual]);

  // A video moves only while someone is there to see it, and — if the
  // character asks for it — rests on its last frame between plays. Every
  // frame it does not draw is one the whole window does not composite.
  const { playing, restSec } = stage;
  const videoUrl = visual?.type === 'video' ? visual.url : null;
  useEffect(() => {
    const element = video.current;
    if (!element || !videoUrl) return;
    if (!playing) {
      element.pause();
      return;
    }

    let rest: ReturnType<typeof setTimeout> | null = null;
    const play = (): void => void element.play().catch(() => undefined);
    const onEnded = (): void => {
      rest = setTimeout(() => {
        element.currentTime = 0;
        play();
      }, restSec * 1000);
    };
    element.loop = restSec <= 0;
    element.addEventListener('ended', onEnded);
    // Stopped at its end is where a resting video is found again: start it over.
    if (element.ended) element.currentTime = 0;
    play();
    return () => {
      element.removeEventListener('ended', onEnded);
      if (rest) clearTimeout(rest);
    };
  }, [playing, restSec, videoUrl]);

  useEffect(
    () => () => {
      // Unmounted mid-drag: main must not be left following the cursor.
      if (press.current?.dragging) window.jacqueline?.dragEnd();
    },
    []
  );

  const finish = (clicked: boolean): void => {
    const current = press.current;
    press.current = null;
    if (!current) return;
    if (!current.dragging) {
      // Pressed and let go without going anywhere: a click.
      if (clicked) window.jacqueline?.click();
      return;
    }
    setDragging(false);
    window.jacqueline?.dragEnd();
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { x: event.screenX, y: event.screenY, dragging: false };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = press.current;
    if (!current || current.dragging) return;
    // Screen coordinates: once the window starts following the cursor, client
    // coordinates stop changing at all.
    if (Math.hypot(event.screenX - current.x, event.screenY - current.y) < DRAG_THRESHOLD_PX) return;
    current.dragging = true;
    setDragging(true);
    window.jacqueline?.dragStart();
  };

  // The element is made exactly the shape of what it shows. Left to fill the
  // box and letterbox itself, a video paints the leftover strips black, and a
  // transparent window shows them.
  const known = natural && natural.url === visual?.url && natural.width > 0 && natural.height > 0 ? natural : null;
  const scale = known ? Math.min(width / known.width, height / known.height) : 0;
  const look: CSSProperties = {
    width: known ? Math.round(known.width * scale) : 0,
    height: known ? Math.round(known.height * scale) : 0,
    visibility: known ? 'visible' : 'hidden',
    opacity: stage.opacity,
    transform: stage.flip ? 'scaleX(-1)' : undefined
  };
  const painted = (): void => window.jacqueline?.painted();
  const measured = (width: number, height: number): void => {
    if (visual) setNatural({ url: visual.url, width, height });
  };

  return (
    <div
      className="character"
      style={{ left, top, width, height }}
      data-dragging={dragging ? 'true' : 'false'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => finish(true)}
      onPointerCancel={() => finish(false)}
      onLostPointerCapture={() => finish(false)}
      onContextMenu={(event) => {
        event.preventDefault();
        window.jacqueline?.menu();
      }}
    >
      {visual?.type === 'image' ? (
        // An image that fails to load still gets its window, or it could never be fixed.
        <img
          className="visual"
          style={look}
          src={visual.url}
          alt=""
          draggable={false}
          onLoad={(event) => {
            measured(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
            painted();
          }}
          onError={painted}
        />
      ) : visual?.type === 'video' ? (
        <video
          ref={video}
          className="visual"
          style={look}
          src={visual.url}
          muted
          playsInline
          disablePictureInPicture
          preload="auto"
          onLoadedMetadata={(event) => measured(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
          onLoadedData={painted}
          onError={painted}
        />
      ) : (
        <div className="placeholder">{stage.name}</div>
      )}
    </div>
  );
}

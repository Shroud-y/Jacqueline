import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { cropGeometry, type Crop } from '@shared/crop';
import { SAMPLE_LINE } from '@shared/textStyle';
import type { StagePayload } from '@shared/types';
import { useAnimation } from '../shared/animationPlayer';
import { useChromaKey } from '../shared/chromaKey';
import TextElement from '../shared/TextElement';
import ScriptLayer from './ScriptLayer';
import SpeechText from './SpeechText';

/** A press that travels less than this is a click, not a drag. */
const DRAG_THRESHOLD_PX = 4;

/** A character's window: draws its layout. */
export default function Stage(): JSX.Element | null {
  const [stage, setStage] = useState<StagePayload | null>(null);
  // Set by the character's script, for its stylesheet.
  const [mood, setMood] = useState<string | null>(null);

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

  // Its ambient sound, on a loop. Held on to through a pause, so it picks up where it was.
  const ambientUrl = stage?.sound.ambient ?? null;
  const ambient = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!ambientUrl) return;
    const audio = new Audio(ambientUrl);
    audio.loop = true;
    ambient.current = audio;
    return () => {
      audio.pause();
      ambient.current = null;
    };
  }, [ambientUrl]);
  const audible = stage?.sound.audible ?? false;
  const volume = stage?.sound.volume ?? 1;
  useEffect(() => {
    const audio = ambient.current;
    if (!audio) return;
    audio.volume = Math.min(1, Math.max(0, volume));
    if (audible) void audio.play().catch(() => undefined);
    else audio.pause();
  }, [ambientUrl, audible, volume]);

  if (!stage) return null;

  // Hooks a character's own stylesheet can rely on: see `STYLE_STARTER` in shared/stylesheet.ts.
  return (
    <div
      className="stage"
      data-character={stage.id}
      data-speaking={stage.speech ? 'true' : 'false'}
      data-state={stage.state}
      data-music={stage.music ? 'true' : 'false'}
      data-preview={stage.preview ? 'true' : 'false'}
      // A visual script's own mood first; otherwise whatever the behaviour script set.
      data-mood={(stage.script && mood) || stage.mood || undefined}
    >
      {stage.stylesheet ? <link rel="stylesheet" href={stage.stylesheet} /> : null}
      {stage.elements.map((element) => {
        const box = { left: element.x - stage.frame.x, top: element.y - stage.frame.y, width: element.width, height: element.height };
        if (element.type === 'character') return <CharacterElement key={element.id} stage={stage} crop={element.crop} {...box} />;
        const { speech } = stage;
        if (speech && element.type === 'speech') {
          // Keyed by the line, so every line arrives from the start.
          return <SpeechText key={speech.id} characterId={stage.id} text={speech.text} style={element.style} reveal={element.reveal} box={box} />;
        }
        if (speech && element.type === 'name') {
          return <TextElement key={element.id} className="text text-name text-fade" characterId={stage.id} text={stage.name} style={element.style} box={box} />;
        }
        // With nothing being said, text shows only while it is being laid out.
        if (!stage.preview) return null;
        return (
          <TextElement
            key={element.id}
            className={element.type === 'name' ? 'text text-name' : 'text text-speech'}
            characterId={stage.id}
            text={element.type === 'name' ? stage.name : SAMPLE_LINE}
            style={element.style}
            box={box}
          />
        );
      })}
      {stage.script ? <ScriptLayer url={stage.script} speech={stage.speech} preview={stage.preview} playing={stage.playing} onMood={setMood} /> : null}
    </div>
  );
}

interface CharacterElementProps {
  stage: StagePayload;
  crop: Crop | undefined;
  left: number;
  top: number;
  width: number;
  height: number;
}

function CharacterElement({ stage, crop, left, top, width, height }: CharacterElementProps): JSX.Element {
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
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
  const { playing, rewind, restSec } = stage;
  const videoUrl = visual?.type === 'video' ? visual.url : null;
  // Turning the cut-out on or off makes a new element: it has to be set going again.
  const chromaOn = stage.chroma !== null;
  useEffect(() => {
    const element = video.current;
    if (!element || !videoUrl) return;
    if (!playing) {
      element.pause();
      // While it is hidden, so that coming back never shows where it had stopped.
      if (rewind) element.currentTime = 0;
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
  }, [playing, rewind, restSec, videoUrl, chromaOn]);

  // Its own sound, when it has one and it may be heard. `muted` as an attribute is
  // only read once, so it is set on the element.
  const heard = stage.sound.audible && stage.sound.videoSound;
  const soundVolume = stage.sound.volume;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.muted = !heard;
    element.volume = Math.min(1, Math.max(0, soundVolume));
  }, [heard, soundVolume, videoUrl, chromaOn]);

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
      // Pressed and let go without going anywhere: a click — for the rules, and for its script.
      if (clicked) {
        window.jacqueline?.click();
        dispatchEvent(new Event('jacqueline-click'));
      }
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
  const shown = known ? cropGeometry({ width, height }, known, crop) : null;
  // With its background taken out, the file plays unseen and a canvas shows the result.
  const { chroma } = stage;
  const keyed = useRef<HTMLCanvasElement>(null);
  const keyedSource = useRef<HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | null>(null);
  const animation = useRef<HTMLCanvasElement | null>(null);
  const ratio = window.devicePixelRatio || 1;
  useChromaKey(
    keyed,
    keyedSource,
    chroma,
    shown ? { width: Math.round(shown.file.width * ratio), height: Math.round(shown.file.height * ratio) } : null,
    visual?.url ?? ''
  );
  const unseen: CSSProperties = { position: 'absolute', width: 1, height: 1, opacity: 0 };
  const frame: CSSProperties = {
    width: shown?.width ?? 0,
    height: shown?.height ?? 0,
    visibility: known ? 'visible' : 'hidden',
    opacity: stage.opacity,
    transform: stage.flip ? 'scaleX(-1)' : undefined
  };
  // The whole file, slid so only what is left after cropping shows through the frame.
  const look: CSSProperties = shown ? { position: 'absolute', ...shown.file } : {};
  const painted = (): void => window.jacqueline?.painted();
  const measured = (width: number, height: number): void => {
    if (visual) setNatural({ url: visual.url, width, height });
  };
  useAnimation(animation, visual?.type === 'animation' ? visual.url : null, playing, restSec, { onMeasured: measured, onPainted: painted });

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
      {visual ? (
        <div className="visual-crop" style={frame}>
          {visual.type === 'image' ? (
            // An image that fails to load still gets its window, or it could never be fixed.
            <img
              // crossOrigin only counts when the file is loaded: turned on, it has to load again.
              key={chroma ? 'keyed' : 'plain'}
              ref={(element) => {
                keyedSource.current = element;
              }}
              className={chroma ? undefined : 'visual'}
              style={chroma ? unseen : look}
              crossOrigin={chroma ? 'anonymous' : undefined}
              src={visual.url}
              alt=""
              draggable={false}
              onLoad={(event) => {
                measured(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
                painted();
              }}
              onError={painted}
            />
          ) : visual.type === 'animation' ? (
            <canvas
              // Decoded here rather than loaded, so turning the cut-out on needs nothing new.
              ref={(element) => {
                animation.current = element;
                keyedSource.current = element;
              }}
              className={chroma ? undefined : 'visual'}
              style={chroma ? unseen : look}
            />
          ) : (
            <video
              // crossOrigin only counts when the file is loaded: turned on, it has to load again.
              key={chroma ? 'keyed' : 'plain'}
              // The same element serves its playing and its background.
              ref={(element) => {
                video.current = element;
                keyedSource.current = element;
              }}
              className={chroma ? undefined : 'visual'}
              style={chroma ? unseen : look}
              crossOrigin={chroma ? 'anonymous' : undefined}
              src={visual.url}
              muted
              playsInline
              disablePictureInPicture
              preload="auto"
              onLoadedMetadata={(event) => measured(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
              onLoadedData={painted}
              onError={painted}
            />
          )}
          {chroma ? <canvas ref={keyed} className="visual" style={look} /> : null}
        </div>
      ) : (
        <div className="placeholder">{stage.name}</div>
      )}
    </div>
  );
}

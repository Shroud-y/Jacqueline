import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { StagePayload } from '@shared/types';

/** A press that travels less than this is a click, not a drag. */
const DRAG_THRESHOLD_PX = 4;

/** A character's window: draws its layout. */
export default function Stage(): JSX.Element | null {
  const [stage, setStage] = useState<StagePayload | null>(null);

  useEffect(() => {
    const api = window.shard;
    if (!api) return;
    let cancelled = false;
    void api.getStage().then((payload) => {
      if (!cancelled && payload) setStage(payload);
    });
    const off = api.onStageUpdate(setStage);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  if (!stage) return null;

  return (
    <div className="stage">
      {stage.elements.map((element) =>
        element.type === 'character' ? (
          <CharacterElement
            key={element.id}
            stage={stage}
            left={element.x - stage.frame.x}
            top={element.y - stage.frame.y}
            width={element.width}
            height={element.height}
          />
        ) : null
      )}
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
  const [dragging, setDragging] = useState(false);
  // The picture's own proportions, once it has told us. Per address: a new
  // file is a new shape.
  const [natural, setNatural] = useState<{ url: string; width: number; height: number } | null>(null);
  const { visual } = stage;

  // The placeholder is on screen as soon as it is mounted; a picture or a
  // video says so itself, once it has a frame to show.
  useEffect(() => {
    if (!visual) window.shard?.painted();
  }, [visual]);

  useEffect(
    () => () => {
      // Unmounted mid-drag: main must not be left following the cursor.
      if (press.current?.dragging) window.shard?.dragEnd();
    },
    []
  );

  const finish = (): void => {
    const current = press.current;
    press.current = null;
    if (!current?.dragging) return;
    setDragging(false);
    window.shard?.dragEnd();
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
    window.shard?.dragStart();
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
  const painted = (): void => window.shard?.painted();
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
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onContextMenu={(event) => event.preventDefault()}
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
          className="visual"
          style={look}
          src={visual.url}
          autoPlay
          loop
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

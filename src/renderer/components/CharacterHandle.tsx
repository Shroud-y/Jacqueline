import { useEffect, useLayoutEffect, useRef, type PointerEvent } from 'react';
import styles from './CharacterHandle.module.css';

export interface CharacterHandleProps {
  /** Centre of the handle inside the unit, in unit pixels — the skin's optic. */
  centre: { x: number; y: number };
  /** Clicked without being dragged. */
  onActivate: () => void;
  /** Right-clicked. */
  onMenu: () => void;
  /** The cursor is over the handle, or it is being dragged. */
  onAttention: (attended: boolean) => void;
  /**
   * Changes whenever the handle may have moved inside the window, so that it
   * is measured again. The handle cannot see the layout it sits in.
   */
  layoutKey: string;
}

/** Bigger than the lens, which is 108 × 28: a 28 px strip is not a comfortable thing to grab. */
const SIZE = { width: 128, height: 68 };

/** A press that travels less than this is a click. */
const DRAG_THRESHOLD_PX = 5;

/**
 * The part of a pinned companion that takes the mouse: click it, drag it,
 * right-click it. The rest of the overlay stays click-through.
 *
 * It reports its own rectangle to main, because that is how the window finds
 * out the cursor has arrived at all — it ignores the mouse until it does (see
 * `HOT_POLL_MS` in `overlayWindow.ts`). The drag itself is carried out by main
 * as well; this only says when one starts and when it ends.
 */
export default function CharacterHandle({
  centre,
  onActivate,
  onMenu,
  onAttention,
  layoutKey
}: CharacterHandleProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    window.codex?.setHotRect({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  }, [layoutKey, centre.x, centre.y]);

  useEffect(
    () => () => {
      window.codex?.setHotRect(null);
      // Unmounted mid-drag (unpinned from the menu, say): main must not be
      // left following the cursor.
      if (press.current?.dragging) window.codex?.dragEnd();
    },
    []
  );

  const finish = (activate: boolean): void => {
    const current = press.current;
    press.current = null;
    if (!current) return;
    if (current.dragging) window.codex?.dragEnd();
    else if (activate) onActivate();
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
    window.codex?.dragStart();
  };

  return (
    <div
      ref={ref}
      className={styles.handle}
      style={{
        left: `${centre.x - SIZE.width / 2}px`,
        top: `${centre.y - SIZE.height / 2}px`,
        width: `${SIZE.width}px`,
        height: `${SIZE.height}px`
      }}
      // What `App` looks for under the cursor while a line is on screen.
      data-interactive="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => finish(true)}
      onPointerCancel={() => finish(false)}
      onLostPointerCapture={() => finish(false)}
      onPointerEnter={() => onAttention(true)}
      onPointerLeave={() => onAttention(false)}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu();
      }}
    />
  );
}

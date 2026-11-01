import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { assetUrl } from '@shared/assetUrl';
import { HANDLES, freeElementId, moveBox, placeBeside, resizeBox, snapBox, type Handle } from '@shared/canvas';
import { DEFAULT_TEXT_STYLE, type Character, type LayoutElement } from '@shared/character';
import { clampCropRect, cropFromRects, cropGeometry, fullRect, isCropped, mirrorCrop, moveCropRect, NO_CROP, visibleRect } from '@shared/crop';
import { layoutAnchor, layoutFrame, type Rect } from '@shared/layout';
import { SAMPLE_LINE, isFontFile } from '@shared/textStyle';
import type { AssetInfo } from '@shared/types';
import TextElement from '../../shared/TextElement';
import { probeMedia } from '../media';
import type { Characters } from '../useCharacters';
import Inspector from './Inspector';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
/** Room left around the layout when it is fitted into view. */
const FIT_MARGIN = 48;
/** Screen pixels within which edges line up. */
const SNAP_PX = 6;

interface Gesture {
  id: string;
  kind: 'move' | Handle;
  start: { x: number; y: number };
  from: Rect;
  shift: boolean;
}

interface Pan {
  start: { x: number; y: number };
  from: { x: number; y: number };
}

/** Keeps the pointer's moves coming here even when it leaves the canvas. A pointer already let go cannot be captured, and need not be. */
const capture = (element: HTMLElement | null, pointerId: number): void => {
  try {
    element?.setPointerCapture(pointerId);
  } catch {
    // Already released.
  }
};

/** Cropping under way: the whole file on the canvas, and the part being kept. In what the screen shows, mirrored if the character is. */
interface Cropping {
  full: Rect;
  visible: Rect;
  gesture: { kind: 'move' | Handle; start: { x: number; y: number }; from: Rect } | null;
}

const boxOf = (element: LayoutElement): Rect => ({ x: element.x, y: element.y, width: element.width, height: element.height });

/** Where things sit in the character's window: the canvas, and what is chosen on it. */
export default function LayoutTab({ character, characters }: { character: Character; characters: Characters }): JSX.Element {
  const { id } = character;
  const elements = character.layout.elements;
  const canvas = useRef<HTMLDivElement>(null);

  const [selectedId, setSelectedId] = useState<string | null>(() => elements.find((element) => element.type !== 'character')?.id ?? elements[0]?.id ?? null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [draft, setDraft] = useState<{ id: string; box: Rect; guides: { x: number[]; y: number[] } } | null>(null);
  const [panning, setPanning] = useState<Pan | null>(null);
  const [fontFiles, setFontFiles] = useState<string[]>([]);
  const [natural, setNatural] = useState<{ src: string; width: number; height: number } | null>(null);
  const [cropping, setCropping] = useState<Cropping | null>(null);

  // On the desktop, this character shows its layout with sample text for as long as this tab is open.
  useEffect(() => {
    void window.jacquelineEditor?.preview({ id });
    return () => void window.jacquelineEditor?.preview({ id: null });
  }, [id]);

  const loadFonts = useCallback((): void => {
    void window.jacquelineEditor?.assets({ id }).then((assets: AssetInfo[]) => setFontFiles(assets.filter((asset) => asset.kind === 'font').map((asset) => asset.file)));
  }, [id]);
  useEffect(loadFonts, [loadFonts]);

  /** Fits the whole layout in the middle of the canvas, at no more than 100%. */
  const fit = useCallback((): void => {
    const view = canvas.current?.getBoundingClientRect();
    if (!view || view.width === 0) return;
    const frame = layoutFrame(elements);
    const scale = Math.max(MIN_ZOOM, Math.min(1, (view.width - FIT_MARGIN * 2) / frame.width, (view.height - FIT_MARGIN * 2) / frame.height));
    const rounded = Math.floor(scale * 100) / 100;
    setZoom(rounded);
    setPan({
      x: Math.round(view.width / 2 - (frame.x + frame.width / 2) * rounded),
      y: Math.round(view.height / 2 - (frame.y + frame.height / 2) * rounded)
    });
  }, [elements]);
  useLayoutEffect(() => {
    if (pan === null) fit();
  }, [pan, fit]);

  const selected = elements.find((element) => element.id === selectedId) ?? null;
  const shown = (element: LayoutElement): Rect => (draft && draft.id === element.id ? draft.box : boxOf(element));

  const save = (next: LayoutElement[]): void => characters.update({ ...character, layout: { ...character.layout, elements: next } });
  const replace = (element: LayoutElement): void => save(elements.map((entry) => (entry.id === element.id ? element : entry)));

  /* ---- pointer --------------------------------------------------------- */

  const begin = (event: PointerEvent, element: LayoutElement, kind: Gesture['kind']): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    canvas.current?.focus();
    setSelectedId(element.id);
    capture(canvas.current, event.pointerId);
    setGesture({ id: element.id, kind, start: { x: event.clientX, y: event.clientY }, from: boxOf(element), shift: event.shiftKey });
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1) return;
    // A press outside what is being kept: cropping is over, and it stands.
    if (cropping && event.button === 0) finishCrop(cropping);
    // On the empty canvas: let go of the selection, and drag the view about.
    if (event.button === 0) setSelectedId(null);
    capture(canvas.current, event.pointerId);
    setPanning({ start: { x: event.clientX, y: event.clientY }, from: pan ?? { x: 0, y: 0 } });
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (cropping?.gesture) {
      const { gesture: drag, full } = cropping;
      const dx = (event.clientX - drag.start.x) / zoom;
      const dy = (event.clientY - drag.start.y) / zoom;
      const visible = drag.kind === 'move' ? moveCropRect(drag.from, dx, dy, full) : clampCropRect(resizeBox(drag.from, drag.kind, dx, dy), full);
      setCropping({ ...cropping, visible });
      return;
    }
    if (panning) {
      setPan({ x: panning.from.x + event.clientX - panning.start.x, y: panning.from.y + event.clientY - panning.start.y });
      return;
    }
    if (!gesture) return;
    const dx = (event.clientX - gesture.start.x) / zoom;
    const dy = (event.clientY - gesture.start.y) / zoom;
    const element = elements.find((entry) => entry.id === gesture.id);
    if (!element) return;

    if (gesture.kind === 'move') {
      const others = elements.filter((entry) => entry.id !== gesture.id).map(boxOf);
      // Alt moves freely, without lining up.
      const snapped = event.altKey ? { box: moveBox(gesture.from, dx, dy), guides: { x: [], y: [] } } : snapBox(moveBox(gesture.from, dx, dy), others, SNAP_PX / zoom);
      setDraft({ id: gesture.id, box: snapped.box, guides: snapped.guides });
    } else {
      // The character keeps its proportions unless Shift says otherwise; text is the other way round.
      const keepRatio = (element.type === 'character') !== event.shiftKey;
      setDraft({ id: gesture.id, box: resizeBox(gesture.from, gesture.kind, dx, dy, keepRatio), guides: { x: [], y: [] } });
    }
  };

  const onPointerUp = (): void => {
    if (cropping?.gesture) setCropping({ ...cropping, gesture: null });
    if (panning) setPanning(null);
    if (gesture && draft && draft.id === gesture.id) {
      const element = elements.find((entry) => entry.id === gesture.id);
      const { box } = draft;
      const from = gesture.from;
      // One save for the whole gesture, not one per pixel.
      if (element && (box.x !== from.x || box.y !== from.y || box.width !== from.width || box.height !== from.height)) {
        replace({ ...element, ...box });
      }
    }
    setGesture(null);
    setDraft(null);
  };

  const onWheel = (event: WheelEvent): void => {
    const view = canvas.current?.getBoundingClientRect();
    if (!view || pan === null) return;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1) * 100) / 100));
    // Zoom about the pointer: the point under it stays under it.
    const px = event.clientX - view.left;
    const py = event.clientY - view.top;
    setPan({ x: px - ((px - pan.x) * next) / zoom, y: py - ((py - pan.y) * next) / zoom });
    setZoom(next);
  };

  /* ---- keyboard ------------------------------------------------------- */

  const remove = (element: LayoutElement): void => {
    if (element.type === 'character') return;
    save(elements.filter((entry) => entry.id !== element.id));
    setSelectedId(null);
    const font = element.style.font;
    // Its own font file, now perhaps used by nothing.
    if (isFontFile(font)) void window.jacquelineEditor?.releaseAsset({ id, file: font }).then(loadFonts);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (cropping) {
      if (event.key === 'Escape') setCropping(null);
      else if (event.key === 'Enter') finishCrop(cropping);
      return;
    }
    if (!selected) return;
    const step = event.shiftKey ? 10 : 1;
    const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const by = nudge[event.key];
    if (by) {
      event.preventDefault();
      replace({ ...selected, ...moveBox(boxOf(selected), by[0], by[1]) });
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove(selected);
    } else if (event.key === 'Escape') {
      setSelectedId(null);
    }
  };

  /* ---- adding --------------------------------------------------------- */

  const add = (type: 'speech' | 'name'): void => {
    const anchor = layoutAnchor(elements);
    const size = type === 'speech' ? { width: 240, height: 120 } : { width: 180, height: 28 };
    const place = placeBeside(anchor, size, elements.map(boxOf));
    const element: LayoutElement =
      type === 'speech'
        ? { id: freeElementId('speech', elements.map((entry) => entry.id)), type, ...place, style: { ...DEFAULT_TEXT_STYLE, align: place.x < anchor.x ? 'right' : 'left' }, reveal: 'typewriter' }
        : { id: freeElementId('name', elements.map((entry) => entry.id)), type, ...place, style: { ...DEFAULT_TEXT_STYLE, size: 14, weight: 600 } };
    save([...elements, element]);
    setSelectedId(element.id);
  };

  const chooseFont = async (element: Extract<LayoutElement, { type: 'speech' | 'name' }>): Promise<void> => {
    const api = window.jacquelineEditor;
    if (!api) return;
    const imported = await api.importAsset({ id, kinds: ['font'] });
    if (!imported.ok) {
      if (imported.error) characters.report(imported.error);
      return;
    }
    const old = element.style.font;
    const next = elements.map((entry) => (entry.id === element.id ? { ...element, style: { ...element.style, font: imported.file } } : entry));
    if (await characters.save({ ...character, layout: { ...character.layout, elements: next } })) {
      if (isFontFile(old) && old !== imported.file) await api.releaseAsset({ id, file: old });
    }
    loadFonts();
  };

  /* ---- cropping ------------------------------------------------------- */

  const idle = character.appearance.states.idle ?? Object.values(character.appearance.states)[0] ?? null;
  const idleSrc = idle?.src ?? null;
  const idleType = idle?.type ?? null;
  // The file's own proportions: a crop is a fraction of them.
  useEffect(() => {
    if (!idleSrc || !idleType) return;
    let cancelled = false;
    void probeMedia(assetUrl(id, idleSrc), idleType).then((size) => {
      if (!cancelled && size) setNatural({ src: idleSrc, ...size });
    });
    return () => {
      cancelled = true;
    };
  }, [id, idleSrc, idleType]);
  const fileSize = natural && natural.src === idleSrc ? natural : null;
  const { flip } = character.appearance;
  const characterBox = elements.find((element) => element.type === 'character');
  const fileCrop = characterBox?.type === 'character' ? (characterBox.crop ?? NO_CROP) : NO_CROP;

  const startCrop = (): void => {
    if (!characterBox || !fileSize) return;
    const onScreen = flip ? mirrorCrop(fileCrop) : fileCrop;
    setCropping({ full: fullRect(boxOf(characterBox), fileSize, onScreen), visible: visibleRect(boxOf(characterBox), fileSize, onScreen), gesture: null });
    setSelectedId(characterBox.id);
    canvas.current?.focus();
  };

  /**
   * The box becomes what is kept, so nothing cut off takes the mouse. Whatever
   * stays stays exactly where it was, on the canvas and on the desktop: the
   * character's place on screen is its box's corner, and that corner has moved.
   */
  const finishCrop = ({ full, visible }: Cropping): void => {
    setCropping(null);
    if (characterBox?.type !== 'character') return;
    const onScreen = cropFromRects(full, visible);
    const crop = flip ? mirrorCrop(onScreen) : onScreen;
    const { crop: _before, ...rest } = characterBox;
    const next: LayoutElement = isCropped(crop) ? { ...rest, ...visible, crop } : { ...rest, ...visible };
    const { position } = character.presence;
    characters.update({
      ...character,
      layout: { ...character.layout, elements: elements.map((entry) => (entry.id === next.id ? next : entry)) },
      presence: {
        ...character.presence,
        position: position ? { x: position.x + visible.x - characterBox.x, y: position.y + visible.y - characterBox.y } : null
      }
    });
  };

  const resetCrop = (): void => {
    if (!characterBox || !fileSize) return;
    const full = fullRect(boxOf(characterBox), fileSize, flip ? mirrorCrop(fileCrop) : fileCrop);
    finishCrop({ full, visible: full, gesture: null });
  };

  const beginCropDrag = (event: PointerEvent, kind: 'move' | Handle): void => {
    if (event.button !== 0 || !cropping) return;
    event.stopPropagation();
    capture(canvas.current, event.pointerId);
    setCropping({ ...cropping, gesture: { kind, start: { x: event.clientX, y: event.clientY }, from: cropping.visible } });
  };

  /** The character's file, muted and never played: a picture of it to arrange things around. */
  const media = (style: CSSProperties): JSX.Element | null =>
    idle ? (
      idle.type === 'image' ? (
        <img src={assetUrl(id, idle.src)} alt="" draggable={false} style={style} />
      ) : (
        <video src={assetUrl(id, idle.src)} muted preload="metadata" style={style} />
      )
    ) : null;

  /* ---- drawing -------------------------------------------------------- */

  const has = (type: LayoutElement['type']): boolean => elements.some((element) => element.type === type);
  const selectedBox = selected ? shown(selected) : null;

  return (
    <div className="layout">
      <div
        ref={canvas}
        className="canvas"
        tabIndex={0}
        aria-label="Layout canvas"
        data-panning={panning !== null}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <div className="canvas-bar" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" className="button quiet" disabled={has('speech')} title={has('speech') ? 'It already has one.' : undefined} onClick={() => add('speech')}>
            Add text
          </button>
          <button type="button" className="button quiet" disabled={has('name')} title={has('name') ? 'It already has one.' : undefined} onClick={() => add('name')}>
            Add name
          </button>
          <span className="grow" />
          <button
            type="button"
            className="button quiet"
            title="Fit the whole layout in view"
            onClick={fit}
          >
            {Math.round(zoom * 100)}%
          </button>
        </div>

        {pan ? (
          <div className="world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            {elements.map((element) => {
              const box = shown(element);
              const style = { left: box.x, top: box.y, width: box.width, height: box.height };
              return (
                <div
                  key={element.id}
                  className={`el el-${element.type}`}
                  style={style}
                  data-selected={element.id === selectedId}
                  onPointerDown={(event) => begin(event, element, 'move')}
                >
                  {element.type === 'character' ? (
                    idle && cropping ? null : idle ? (
                      fileSize ? (
                        (() => {
                          const shownFile = cropGeometry(box, fileSize, element.crop);
                          return (
                            <div
                              className="el-crop"
                              style={{
                                width: shownFile.width,
                                height: shownFile.height,
                                opacity: character.appearance.opacity,
                                transform: flip ? 'scaleX(-1)' : undefined
                              }}
                            >
                              {media({ position: 'absolute', maxWidth: 'none', maxHeight: 'none', ...shownFile.file })}
                            </div>
                          );
                        })()
                      ) : (
                        media({ opacity: character.appearance.opacity, transform: flip ? 'scaleX(-1)' : undefined })
                      )
                    ) : (
                      <div className="el-placeholder">{character.name}</div>
                    )
                  ) : (
                    <TextElement
                      className="el-text"
                      characterId={id}
                      text={element.type === 'name' ? character.name : SAMPLE_LINE}
                      style={element.style}
                      box={{ left: 0, top: 0, width: box.width, height: box.height }}
                    />
                  )}
                  <div className="el-hit" />
                </div>
              );
            })}

            {cropping ? (
              <>
                {/* The whole file, dimmed, and the part being kept, clear, over it. */}
                <div className="crop-full" style={{ left: cropping.full.x, top: cropping.full.y, width: cropping.full.width, height: cropping.full.height }}>
                  {media({ width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none', transform: flip ? 'scaleX(-1)' : undefined })}
                </div>
                <div
                  className="crop-kept"
                  style={{ left: cropping.visible.x, top: cropping.visible.y, width: cropping.visible.width, height: cropping.visible.height }}
                  onPointerDown={(event) => beginCropDrag(event, 'move')}
                >
                  {media({
                    position: 'absolute',
                    left: cropping.full.x - cropping.visible.x,
                    top: cropping.full.y - cropping.visible.y,
                    width: cropping.full.width,
                    height: cropping.full.height,
                    maxWidth: 'none',
                    maxHeight: 'none',
                    transform: flip ? 'scaleX(-1)' : undefined
                  })}
                </div>
                <div className="selection" style={{ left: cropping.visible.x, top: cropping.visible.y, width: cropping.visible.width, height: cropping.visible.height }}>
                  {HANDLES.map((handle) => (
                    <span
                      key={handle}
                      className="grip"
                      aria-hidden="true"
                      style={{
                        left: handle.includes('w') ? 0 : handle.includes('e') ? '100%' : '50%',
                        top: handle.includes('n') ? 0 : handle.includes('s') ? '100%' : '50%',
                        transform: `scale(${1 / zoom})`,
                        cursor: `${handle}-resize`
                      }}
                      onPointerDown={(event) => beginCropDrag(event, handle)}
                    />
                  ))}
                </div>
              </>
            ) : selected && selectedBox ? (
              <div className="selection" style={{ left: selectedBox.x, top: selectedBox.y, width: selectedBox.width, height: selectedBox.height }}>
                {HANDLES.map((handle) => (
                  <span
                    key={handle}
                    className="grip"
                    aria-hidden="true"
                    style={{
                      left: handle.includes('w') ? 0 : handle.includes('e') ? '100%' : '50%',
                      top: handle.includes('n') ? 0 : handle.includes('s') ? '100%' : '50%',
                      transform: `scale(${1 / zoom})`,
                      cursor: `${handle}-resize`
                    }}
                    onPointerDown={(event) => begin(event, selected, handle)}
                  />
                ))}
              </div>
            ) : null}

            {draft?.guides.x.map((x) => <div key={`x${x}`} className="guide" style={{ left: x, top: -5000, width: 1 / zoom, height: 10000 }} />)}
            {draft?.guides.y.map((y) => <div key={`y${y}`} className="guide" style={{ top: y, left: -5000, height: 1 / zoom, width: 10000 }} />)}
          </div>
        ) : null}

        <div className="canvas-hint">
          {cropping
            ? 'Drag the edges to crop · drag inside to choose which part · Enter keeps it · Esc cancels'
            : 'Drag to move · corners to resize · Shift changes proportions · Alt skips lining up · wheel zooms'}
        </div>
      </div>

      <Inspector
        element={selected}
        fontFiles={fontFiles}
        onChange={replace}
        onRemove={remove}
        onChooseFont={(element) => void chooseFont(element)}
        crop={{
          available: fileSize !== null,
          cropping: cropping !== null,
          cropped: isCropped(fileCrop),
          onStart: startCrop,
          onDone: () => cropping && finishCrop(cropping),
          onCancel: () => setCropping(null),
          onReset: resetCrop
        }}
      />
    </div>
  );
}

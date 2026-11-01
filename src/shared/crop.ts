/**
 * Cropping a character's picture or video: the arithmetic. Pure. A crop is how
 * much is cut off each side of the file, as a fraction of it, so the file
 * itself is never touched and a crop still fits a replaced file of another size.
 */

import type { Rect } from './layout';

export interface Crop {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Size {
  width: number;
  height: number;
}

export const NO_CROP: Crop = { top: 0, right: 0, bottom: 0, left: 0 };

/** No side of what is left gets smaller than this, however it is dragged. */
export const MIN_CROP_PX = 16;

export function isCropped(crop: Crop | undefined): boolean {
  return !!crop && (crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0);
}

/** The part of the file left after cropping, in the file's own pixels. */
export function croppedSize(natural: Size, crop: Crop = NO_CROP): Size {
  return { width: natural.width * (1 - crop.left - crop.right), height: natural.height * (1 - crop.top - crop.bottom) };
}

export interface CropGeometry {
  /** What shows, as large as fits the box. */
  width: number;
  height: number;
  /** The whole file, placed so only that part shows. Relative to what shows. */
  file: { left: number; top: number; width: number; height: number };
}

/** How to draw a cropped file in a box of this size: never stretched, never letterboxed. */
export function cropGeometry(box: Size, natural: Size, crop: Crop = NO_CROP): CropGeometry {
  const left = croppedSize(natural, crop);
  const scale = Math.min(box.width / left.width, box.height / left.height);
  return {
    width: Math.round(left.width * scale),
    height: Math.round(left.height * scale),
    file: {
      left: -Math.round(natural.width * crop.left * scale),
      top: -Math.round(natural.height * crop.top * scale),
      width: Math.round(natural.width * scale),
      height: Math.round(natural.height * scale)
    }
  };
}

/** Left and right swapped: what a mirrored character's crop looks like on screen. */
export function mirrorCrop(crop: Crop): Crop {
  return { ...crop, left: crop.right, right: crop.left };
}

/** Where what shows sits on the canvas: centred in the box, as the character's window draws it. */
export function visibleRect(box: Rect, natural: Size, crop: Crop = NO_CROP): Rect {
  const shown = cropGeometry(box, natural, crop);
  return {
    x: box.x + Math.round((box.width - shown.width) / 2),
    y: box.y + Math.round((box.height - shown.height) / 2),
    width: shown.width,
    height: shown.height
  };
}

/** Where the whole file sits on the canvas, cut-off parts included. */
export function fullRect(box: Rect, natural: Size, crop: Crop = NO_CROP): Rect {
  const shown = cropGeometry(box, natural, crop);
  const visible = visibleRect(box, natural, crop);
  return { x: visible.x + shown.file.left, y: visible.y + shown.file.top, width: shown.file.width, height: shown.file.height };
}

/** A dragged rectangle, kept inside the whole file and no smaller than the smallest. */
export function clampCropRect(rect: Rect, full: Rect): Rect {
  const left = Math.max(full.x, Math.min(rect.x, full.x + full.width - MIN_CROP_PX));
  const top = Math.max(full.y, Math.min(rect.y, full.y + full.height - MIN_CROP_PX));
  const right = Math.min(full.x + full.width, Math.max(rect.x + rect.width, left + MIN_CROP_PX));
  const bottom = Math.min(full.y + full.height, Math.max(rect.y + rect.height, top + MIN_CROP_PX));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** A rectangle moved as a whole: it keeps its size and stays inside the whole file. */
export function moveCropRect(rect: Rect, dx: number, dy: number, full: Rect): Rect {
  return {
    ...rect,
    x: Math.round(Math.max(full.x, Math.min(rect.x + dx, full.x + full.width - rect.width))),
    y: Math.round(Math.max(full.y, Math.min(rect.y + dy, full.y + full.height - rect.height)))
  };
}

/** The crop that a rectangle over the whole file means. */
export function cropFromRects(full: Rect, visible: Rect): Crop {
  const part = (cut: number, whole: number): number => Math.max(0, Math.round((cut / whole) * 10_000) / 10_000);
  return {
    left: part(visible.x - full.x, full.width),
    top: part(visible.y - full.y, full.height),
    right: part(full.x + full.width - visible.x - visible.width, full.width),
    bottom: part(full.y + full.height - visible.y - visible.height, full.height)
  };
}

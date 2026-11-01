import { describe, expect, it } from 'vitest';
import { clampCropRect, cropFromRects, cropGeometry, croppedSize, fullRect, isCropped, mirrorCrop, moveCropRect, NO_CROP, visibleRect } from '@shared/crop';

const natural = { width: 1000, height: 500 };

describe('cropping', () => {
  it('knows what is left of the file', () => {
    const left = croppedSize(natural, { top: 0.1, right: 0.2, bottom: 0.1, left: 0.3 });
    expect(left.width).toBeCloseTo(500);
    expect(left.height).toBeCloseTo(400);
    expect(isCropped(undefined)).toBe(false);
    expect(isCropped(NO_CROP)).toBe(false);
    expect(isCropped({ ...NO_CROP, left: 0.01 })).toBe(true);
  });

  it('fits what is left into the box, without stretching, with the file placed behind it', () => {
    expect(cropGeometry({ width: 200, height: 200 }, natural)).toEqual({ width: 200, height: 100, file: { left: -0, top: -0, width: 200, height: 100 } });
    // The left half of a 2:1 file is square: it fills a square box.
    expect(cropGeometry({ width: 200, height: 200 }, natural, { ...NO_CROP, right: 0.5 })).toEqual({ width: 200, height: 200, file: { left: -0, top: -0, width: 400, height: 200 } });
    // The right half: the same, with the file slid left.
    expect(cropGeometry({ width: 200, height: 200 }, natural, { ...NO_CROP, left: 0.5 }).file.left).toBe(-200);
  });

  it('finds what shows and the whole file on the canvas', () => {
    const box = { x: 10, y: 20, width: 200, height: 200 };
    expect(visibleRect(box, natural)).toEqual({ x: 10, y: 70, width: 200, height: 100 });
    expect(fullRect(box, natural)).toEqual({ x: 10, y: 70, width: 200, height: 100 });
    expect(fullRect(box, natural, { ...NO_CROP, left: 0.5 })).toEqual({ x: -190, y: 20, width: 400, height: 200 });
  });

  it('turns a rectangle back into the crop it means', () => {
    const full = { x: 0, y: 0, width: 400, height: 200 };
    expect(cropFromRects(full, { x: 100, y: 20, width: 200, height: 160 })).toEqual({ left: 0.25, top: 0.1, right: 0.25, bottom: 0.1 });
    expect(cropFromRects(full, full)).toEqual(NO_CROP);
  });

  it('survives the round trip: what shows stays where it was and the same size', () => {
    const box = { x: 0, y: 0, width: 400, height: 200 };
    const full = fullRect(box, natural);
    const visible = { x: 100, y: 50, width: 200, height: 100 };
    const crop = cropFromRects(full, visible);
    // The box becomes what shows; drawn again, it fills it and lines up with the file as before.
    expect(visibleRect(visible, natural, crop)).toEqual(visible);
    expect(fullRect(visible, natural, crop)).toEqual(full);
  });

  it('keeps a dragged rectangle inside the file and no smaller than the smallest', () => {
    const full = { x: 0, y: 0, width: 400, height: 200 };
    expect(clampCropRect({ x: -50, y: -50, width: 600, height: 400 }, full)).toEqual(full);
    expect(clampCropRect({ x: 100, y: 100, width: 2, height: 2 }, full)).toEqual({ x: 100, y: 100, width: 16, height: 16 });
    expect(clampCropRect({ x: 399, y: 199, width: 1, height: 1 }, full)).toEqual({ x: 384, y: 184, width: 16, height: 16 });
    expect(moveCropRect({ x: 10, y: 10, width: 100, height: 100 }, 1000, -1000, full)).toEqual({ x: 300, y: 0, width: 100, height: 100 });
  });

  it('swaps sides for a mirrored character', () => {
    expect(mirrorCrop({ top: 0.1, right: 0.2, bottom: 0.3, left: 0.4 })).toEqual({ top: 0.1, right: 0.4, bottom: 0.3, left: 0.2 });
  });
});

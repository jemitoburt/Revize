/**
 * Geometry of the photo editor: a crop rectangle in fractions (0–1) of the image as shown,
 * i.e. after the chosen rotation.
 */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Clockwise quarter turns: 0, 90, 180 or 270 degrees. */
export type Rotation = 0 | 90 | 180 | 270;

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

/** The crop cannot shrink below this fraction of a side (a crop must stay usable). */
export const MIN_CROP = 0.1;

export type CropHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The rectangle after dragging `handle` by `dx`, `dy` (fractions of the shown image). */
export function dragCrop(crop: CropRect, handle: CropHandle, dx: number, dy: number): CropRect {
  if (handle === 'move') {
    return {
      ...crop,
      x: clamp(crop.x + dx, 0, 1 - crop.w),
      y: clamp(crop.y + dy, 0, 1 - crop.h),
    };
  }
  let left = crop.x;
  let top = crop.y;
  let right = crop.x + crop.w;
  let bottom = crop.y + crop.h;
  if (handle === 'nw' || handle === 'sw') left = clamp(left + dx, 0, right - MIN_CROP);
  else right = clamp(right + dx, left + MIN_CROP, 1);
  if (handle === 'nw' || handle === 'ne') top = clamp(top + dy, 0, bottom - MIN_CROP);
  else bottom = clamp(bottom + dy, top + MIN_CROP, 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** The same part of the photo after turning it by 90° clockwise (or counter-clockwise). */
export function rotateCrop(crop: CropRect, clockwise: boolean): CropRect {
  return clockwise
    ? { x: 1 - crop.y - crop.h, y: crop.x, w: crop.h, h: crop.w }
    : { x: crop.y, y: 1 - crop.x - crop.w, w: crop.h, h: crop.w };
}

export function turn(rotation: Rotation, clockwise: boolean): Rotation {
  return ((rotation + (clockwise ? 90 : 270)) % 360) as Rotation;
}

export function isFullCrop(crop: CropRect): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.001;
  return near(crop.x, 0) && near(crop.y, 0) && near(crop.w, 1) && near(crop.h, 1);
}

/** Size of the image after the rotation. */
export function rotatedSize(width: number, height: number, rotation: Rotation) {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

import { describe, expect, it } from 'vitest';
import {
  FULL_CROP,
  MIN_CROP,
  dragCrop,
  isFullCrop,
  rotateCrop,
  rotatedSize,
  turn,
} from './crop.js';

describe('photo crop', () => {
  it('moves the rectangle within the image', () => {
    const crop = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    const moved = dragCrop(crop, 'move', 0.1, -0.1);
    expect(moved.x).toBeCloseTo(0.3);
    expect(moved.y).toBeCloseTo(0.1);
    expect(dragCrop(crop, 'move', 1, 1)).toMatchObject({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });

  it('resizes by a corner without leaving the image or getting too small', () => {
    expect(dragCrop(FULL_CROP, 'nw', 0.25, 0.5)).toEqual({ x: 0.25, y: 0.5, w: 0.75, h: 0.5 });
    expect(dragCrop(FULL_CROP, 'se', 0.5, 0.5)).toEqual(FULL_CROP);
    const tiny = dragCrop(FULL_CROP, 'se', -2, -2);
    expect(tiny.w).toBeCloseTo(MIN_CROP);
    expect(tiny.h).toBeCloseTo(MIN_CROP);
    expect(dragCrop(FULL_CROP, 'ne', -0.3, 0.2)).toEqual({ x: 0, y: 0.2, w: 0.7, h: 0.8 });
  });

  it('keeps the same part of the photo when turning it', () => {
    // Top-left quarter, wide: after a clockwise turn it is the top-right, tall.
    const crop = { x: 0, y: 0, w: 0.5, h: 0.25 };
    expect(rotateCrop(crop, true)).toEqual({ x: 0.75, y: 0, w: 0.25, h: 0.5 });
    expect(rotateCrop(rotateCrop(crop, true), false)).toEqual(crop);
    let rotation = turn(0, true);
    expect(rotation).toBe(90);
    rotation = turn(turn(turn(rotation, true), true), true);
    expect(rotation).toBe(0);
    expect(turn(0, false)).toBe(270);
  });

  it('knows the full photo and rotated sizes', () => {
    expect(isFullCrop(FULL_CROP)).toBe(true);
    expect(isFullCrop({ x: 0, y: 0, w: 0.9, h: 1 })).toBe(false);
    expect(rotatedSize(4, 3, 90)).toEqual({ width: 3, height: 4 });
    expect(rotatedSize(4, 3, 180)).toEqual({ width: 4, height: 3 });
  });
});

import { rotatedSize, type CropRect, type Rotation } from './crop.js';

export interface ResizedImage {
  blob: Blob;
  /** Size of the source image (after EXIF orientation). */
  width: number;
  height: number;
}

/**
 * Re-encodes an image as JPEG whose longer side is at most `maxSize` px. The browser applies
 * the EXIF orientation when decoding and the canvas drops the metadata (ADR-0007: photos are
 * resized on the device before upload). Throws when the file is not a readable image.
 */
export async function resizeToJpeg(
  source: Blob,
  maxSize: number,
  quality: number,
): Promise<ResizedImage> {
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D není k dispozici');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!blob) throw new Error('Fotku se nepodařilo zakódovat');
    return { blob, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/** The image cropped to fill exactly `width` × `height` pixels (centre crop), as JPEG. */
export async function coverJpeg(
  source: Blob,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.max(width / bitmap.width, height / bitmap.height);
    const sw = width / scale;
    const sh = height / scale;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D není k dispozici');
    context.drawImage(
      bitmap,
      (bitmap.width - sw) / 2,
      (bitmap.height - sh) / 2,
      sw,
      sh,
      0,
      0,
      width,
      height,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!blob) throw new Error('Fotku se nepodařilo zakódovat');
    return blob;
  } finally {
    bitmap.close();
  }
}

/**
 * Turns the image by `rotation` (clockwise), cuts out `crop` (fractions of the turned image) and
 * re-encodes it as JPEG with the longer side at most `maxSize` px. Used by the photo editor.
 */
export async function editToJpeg(
  source: Blob,
  edit: { rotation: Rotation; crop: CropRect },
  maxSize: number,
  quality: number,
): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const turned = rotatedSize(bitmap.width, bitmap.height, edit.rotation);
    const cropWidth = edit.crop.w * turned.width;
    const cropHeight = edit.crop.h * turned.height;
    const scale = Math.min(1, maxSize / Math.max(cropWidth, cropHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(cropWidth * scale));
    canvas.height = Math.max(1, Math.round(cropHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D není k dispozici');
    context.imageSmoothingQuality = 'high';
    context.scale(scale, scale);
    context.translate(-edit.crop.x * turned.width, -edit.crop.y * turned.height);
    context.translate(turned.width / 2, turned.height / 2);
    context.rotate((edit.rotation * Math.PI) / 180);
    context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!blob) throw new Error('Fotku se nepodařilo zakódovat');
    return blob;
  } finally {
    bitmap.close();
  }
}

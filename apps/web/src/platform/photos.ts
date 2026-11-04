import { PHOTO_LIMITS } from '@revize/shared';
import { FULL_CROP, isFullCrop, type CropRect, type Rotation } from '../lib/crop.js';
import { editToJpeg, resizeToJpeg } from '../lib/images.js';

/**
 * Photos leave the device as JPEG with the longer side at most this size (ADR-0007): the size
 * the server keeps (`PHOTO_LIMITS.storedMaxSide`), so a phone photo is ~200–400 kB.
 */
const MAX_SIDE = PHOTO_LIMITS.storedMaxSide;
const QUALITY = 0.8;

/**
 * Opens the camera (or the photo library) and resolves with the chosen photo, or null when
 * the technician cancels. Must be called from a tap handler (iOS only opens pickers then).
 */
export function pickPhoto(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.hidden = true;
    const done = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.onchange = () => done(input.files?.[0] ?? null);
    input.oncancel = () => done(null);
    // Attached to the page: some browsers ignore clicks on detached file inputs.
    document.body.append(input);
    input.click();
  });
}

/** Turn and cut-out chosen in the photo editor. */
export interface PhotoEdit {
  rotation: Rotation;
  crop: CropRect;
}

export const NO_EDIT: PhotoEdit = { rotation: 0, crop: FULL_CROP };

/**
 * Resizes and re-encodes a photo for upload (after the technician's turn and cut-out, done on
 * the original so the photo is encoded only once); the original stays untouched on the device.
 */
export async function preparePhoto(file: Blob, edit: PhotoEdit = NO_EDIT): Promise<Blob> {
  if (edit.rotation === 0 && isFullCrop(edit.crop)) {
    return (await resizeToJpeg(file, MAX_SIDE, QUALITY)).blob;
  }
  return editToJpeg(file, edit, MAX_SIDE, QUALITY);
}

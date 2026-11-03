import { resizeToJpeg } from '../lib/images.js';

/** Photos leave the device as JPEG with the longer side at most this size (ADR-0007). */
const MAX_SIDE = 2048;
const QUALITY = 0.82;

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

/** Resizes and re-encodes a photo for upload; the original stays untouched on the device. */
export async function preparePhoto(file: Blob): Promise<Blob> {
  return (await resizeToJpeg(file, MAX_SIDE, QUALITY)).blob;
}

/** Size of an image and a JPEG thumbnail of it. */
export interface ProcessedImage {
  width: number;
  height: number;
  thumbnail: Uint8Array;
}

/**
 * Image work for photos (ADR-0007): dimensions and a thumbnail whose longer side is at most
 * `thumbnailSize`. Server: sharp; browser demo: canvas (ADR-0015). `null` = not a readable image.
 */
export interface ImageProcessor {
  process(data: Uint8Array, thumbnailSize: number): Promise<ProcessedImage | null>;
}

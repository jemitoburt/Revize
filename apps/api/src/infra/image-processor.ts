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
  /**
   * The image cropped to fill exactly `width` × `height` pixels (JPEG): photos in the protocol
   * at 300 dpi of their printed size. `null` = not a readable image.
   */
  fit(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null>;
}

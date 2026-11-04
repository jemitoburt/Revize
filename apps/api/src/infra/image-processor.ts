/** Size of an image and a JPEG thumbnail of it. */
export interface ProcessedImage {
  width: number;
  height: number;
  thumbnail: Uint8Array;
  /** The photo to store instead of the upload when it was larger than the limit (JPEG). */
  resized?: Uint8Array;
}

/** Largest photo kept as uploaded; a bigger one is stored re-encoded. */
export interface StoredLimit {
  maxSide: number;
  maxBytes: number;
}

/**
 * Image work for photos (ADR-0007): dimensions and a thumbnail whose longer side is at most
 * `thumbnailSize`. Server: sharp; browser demo: canvas (ADR-0015). `null` = not a readable image.
 */
export interface ImageProcessor {
  process(
    data: Uint8Array,
    thumbnailSize: number,
    limit?: StoredLimit,
  ): Promise<ProcessedImage | null>;
  /**
   * The image cropped to fill exactly `width` × `height` pixels (JPEG): photos in the protocol
   * at 300 dpi of their printed size. `null` = not a readable image.
   */
  fit(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null>;
}

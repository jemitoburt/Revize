import sharp from 'sharp';
import type { ImageProcessor, ProcessedImage, StoredLimit } from './image-processor.js';

export class SharpImageProcessor implements ImageProcessor {
  async process(
    data: Uint8Array,
    thumbnailSize: number,
    limit?: StoredLimit,
  ): Promise<ProcessedImage | null> {
    try {
      // rotate() applies the EXIF orientation, so width/height are as the photo is shown.
      const image = sharp(data, { failOn: 'error' }).rotate();
      let { width, height } = await image
        .clone()
        .toBuffer({ resolveWithObject: true })
        .then((r) => r.info);
      let resized: Uint8Array | undefined;
      if (limit && (Math.max(width, height) > limit.maxSide || data.byteLength > limit.maxBytes)) {
        // Too big (e.g. a 12 MPx phone photo): stored as JPEG within the limit, without the
        // camera metadata (GPS); orientation is already applied.
        const out = await image
          .clone()
          .resize(limit.maxSide, limit.maxSide, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80, mozjpeg: true })
          .toBuffer({ resolveWithObject: true });
        resized = new Uint8Array(out.data);
        width = out.info.width;
        height = out.info.height;
      }
      const thumbnail = await image
        .resize(thumbnailSize, thumbnailSize, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75, mozjpeg: true })
        .toBuffer();
      return { width, height, thumbnail, ...(resized ? { resized } : {}) };
    } catch {
      return null;
    }
  }

  async fit(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null> {
    try {
      const out = await sharp(data, { failOn: 'error' })
        .rotate()
        .resize(width, height, { fit: 'cover', withoutEnlargement: false })
        .jpeg({ quality: 82, mozjpeg: true })
        .withMetadata({ density: 300 })
        .toBuffer();
      return new Uint8Array(out);
    } catch {
      return null;
    }
  }
}

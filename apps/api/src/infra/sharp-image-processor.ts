import sharp from 'sharp';
import type { ImageProcessor, ProcessedImage } from './image-processor.js';

export class SharpImageProcessor implements ImageProcessor {
  async process(data: Uint8Array, thumbnailSize: number): Promise<ProcessedImage | null> {
    try {
      // rotate() applies the EXIF orientation, so width/height are as the photo is shown.
      const image = sharp(data, { failOn: 'error' }).rotate();
      const { width, height } = await image
        .clone()
        .toBuffer({ resolveWithObject: true })
        .then((r) => r.info);
      const thumbnail = await image
        .resize(thumbnailSize, thumbnailSize, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75, mozjpeg: true })
        .toBuffer();
      return { width, height, thumbnail };
    } catch {
      return null;
    }
  }
}

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExifDateTime, ExifTool, type WriteTags } from 'exiftool-vendored';
import type { MetadataWriter, PhotoMetadata } from './metadata-writer.js';

/**
 * Metadata via ExifTool (exiftool-vendored runs the bundled Perl script; the API image has
 * Perl). The ExifTool process is started on first use and kept for the next photos.
 */
export class ExifToolMetadataWriter implements MetadataWriter {
  private exiftool: ExifTool | null = null;

  async write(file: Uint8Array, mimeType: string, meta: PhotoMetadata): Promise<Uint8Array> {
    if (mimeType !== 'image/jpeg') return file;
    this.exiftool ??= new ExifTool({ maxProcs: 1 });
    const dir = await mkdtemp(join(tmpdir(), 'revize-exif-'));
    const path = join(dir, 'photo.jpg');
    try {
      await writeFile(path, file);
      const tags = {
        // EXIF
        ImageDescription: meta.description,
        Artist: meta.author ?? '',
        Copyright: meta.copyright,
        ...(meta.takenAt
          ? { DateTimeOriginal: ExifDateTime.fromMillis(meta.takenAt.getTime()) }
          : {}),
        // IPTC (UTF-8)
        ObjectName: meta.title,
        'Caption-Abstract': meta.description,
        Keywords: meta.keywords,
        'By-line': meta.author ?? '',
        CopyrightNotice: meta.copyright,
        'Sub-location': meta.location,
        // XMP
        Title: meta.title,
        Description: meta.description,
        Subject: meta.keywords,
        Creator: meta.author ?? '',
        Rights: meta.copyright,
      } as WriteTags;
      await this.exiftool.write(path, tags, {
        writeArgs: ['-overwrite_original', '-codedcharacterset=utf8', '-charset', 'iptc=utf8'],
      });
      return new Uint8Array(await readFile(path));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async close(): Promise<void> {
    await this.exiftool?.end();
    this.exiftool = null;
  }
}

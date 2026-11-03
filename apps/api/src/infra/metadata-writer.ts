/** Description of a photo written into the exported file (EXIF, IPTC and XMP). */
export interface PhotoMetadata {
  /** Short title, e.g. the item number ("10001"). */
  title: string;
  /** Caption: item, type, location, result and defect. */
  description: string;
  keywords: string[];
  /** Technician who took the photo. */
  author: string | null;
  /** Inspection company. */
  copyright: string;
  /** Location of the item ("Hala A › Řada 1"). */
  location: string;
  takenAt: Date | null;
}

/**
 * Writes metadata into exported JPEG photos (ADR-0007). Server: ExifTool; the browser demo
 * exports the photos unchanged.
 */
export interface MetadataWriter {
  /** Returns the JPEG with the metadata; other formats come back unchanged. */
  write(file: Uint8Array, mimeType: string, metadata: PhotoMetadata): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** Keeps the files as they are (browser demo, where ExifTool cannot run). */
export const noMetadataWriter: MetadataWriter = {
  write: async (file) => file,
  close: async () => undefined,
};

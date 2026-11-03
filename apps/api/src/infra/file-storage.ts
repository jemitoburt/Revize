/**
 * Where photos and generated files live (ADR-0007). Keys are relative paths such as
 * `photos/2026/10/<photoId>/original.jpg`. Implementations: the local disk on the server and a
 * PGlite table in the browser demo (ADR-0015); an S3-compatible self-hosted store (MinIO,
 * Garage) can be added later. Photos are a few hundred kB, so whole files are passed as bytes.
 */
export interface FileStorage {
  put(key: string, data: Uint8Array): Promise<{ size: number }>;
  read(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

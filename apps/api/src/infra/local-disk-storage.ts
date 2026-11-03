import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { newId } from '@revize/shared';
import type { FileStorage } from './file-storage.js';

export class LocalDiskStorage implements FileStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Writes to a temp file first and renames it, so readers never see a half-written file. */
  async put(key: string, data: Uint8Array): Promise<{ size: number }> {
    const target = this.pathOf(key);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${newId()}.tmp`;
    try {
      await writeFile(temp, data);
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    return { size: (await stat(target)).size };
  }

  async read(key: string): Promise<Uint8Array> {
    return readFile(this.pathOf(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathOf(key))).isFile();
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  /** Resolves a key inside the root; rejects absolute keys and `..` escapes. */
  private pathOf(key: string): string {
    if (key === '' || key.startsWith('/') || key.includes('\\'))
      throw new Error(`Invalid key: ${key}`);
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error(`Invalid key: ${key}`);
    return path;
  }
}

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { newId } from '@revize/shared';
import { AppError } from '../errors.js';
import type { FileStorage } from './file-storage.js';

export class LocalDiskStorage implements FileStorage {
  private readonly root: string;
  private readonly maxBytes?: number;

  constructor(root: string, maxBytes?: number) {
    this.root = resolve(root);
    this.maxBytes = maxBytes;
  }

  /** Calculates total size of all stored files under root directory. */
  async getTotalSize(): Promise<number> {
    let total = 0;
    const walk = async (dir: string) => {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = resolve(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile()) {
            const s = await stat(fullPath);
            total += s.size;
          }
        }
      } catch {
        // directory might not exist yet
      }
    };
    await walk(this.root);
    return total;
  }

  /** Writes to a temp file first and renames it, so readers never see a half-written file. */
  async put(key: string, data: Uint8Array): Promise<{ size: number }> {
    if (this.maxBytes !== undefined) {
      const currentSize = await this.getTotalSize();
      if (currentSize + data.byteLength > this.maxBytes) {
        throw new AppError(
          507,
          'insufficient_storage',
          `Limit úložiště pro soubory byl vyčerpán (využito: ${Math.round(currentSize / 1024 / 1024)} MB, limit: ${Math.round(this.maxBytes / 1024 / 1024)} MB).`,
        );
      }
    }
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

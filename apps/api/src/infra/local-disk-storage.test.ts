import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalDiskStorage } from './local-disk-storage.js';

describe('LocalDiskStorage', () => {
  let root: string;
  let storage: LocalDiskStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'revize-storage-'));
    storage = new LocalDiskStorage(root);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('stores, reads and deletes files by key', async () => {
    const { size } = await storage.put('photos/2026/10/a/original.jpg', Buffer.from('jpeg-data'));
    expect(size).toBe(9);
    expect(await storage.exists('photos/2026/10/a/original.jpg')).toBe(true);
    expect(Buffer.from(await storage.read('photos/2026/10/a/original.jpg')).toString()).toBe(
      'jpeg-data',
    );
    await storage.delete('photos/2026/10/a/original.jpg');
    expect(await storage.exists('photos/2026/10/a/original.jpg')).toBe(false);
  });

  it('leaves no temp files behind', async () => {
    await storage.put('x/file.bin', new Uint8Array([1, 2, 3]));
    expect(await readdir(join(root, 'x'))).toEqual(['file.bin']);
  });

  it('rejects keys escaping the root', async () => {
    await expect(storage.put('../evil', Buffer.from(''))).rejects.toThrow('Invalid key');
    await expect(storage.put('/etc/passwd', Buffer.from(''))).rejects.toThrow('Invalid key');
    await expect(storage.read('a/../../b')).rejects.toThrow('Invalid key');
  });
});

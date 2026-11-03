import type { PGlite } from '@electric-sql/pglite';
import type { FileStorage } from '../infra/file-storage.js';
import type { ImageProcessor } from '../infra/image-processor.js';

/** Photos of the browser demo live next to its data, in a table of the same PGlite database. */
export class PgliteFileStorage implements FileStorage {
  constructor(private readonly client: PGlite) {}

  async init(): Promise<void> {
    await this.client.exec(
      'create table if not exists demo_file (key text primary key, data bytea not null)',
    );
  }

  async put(key: string, data: Uint8Array): Promise<{ size: number }> {
    await this.client.query(
      'insert into demo_file (key, data) values ($1, $2) on conflict (key) do update set data = excluded.data',
      [key, data],
    );
    return { size: data.byteLength };
  }

  async read(key: string): Promise<Uint8Array> {
    const { rows } = await this.client.query<{ data: Uint8Array }>(
      'select data from demo_file where key = $1',
      [key],
    );
    if (!rows[0]) throw new Error(`File not found: ${key}`);
    return rows[0].data;
  }

  async exists(key: string): Promise<boolean> {
    const { rows } = await this.client.query('select 1 from demo_file where key = $1', [key]);
    return rows.length > 0;
  }

  async delete(key: string): Promise<void> {
    await this.client.query('delete from demo_file where key = $1', [key]);
  }
}

/** Without a browser canvas (Node tests): no real decoding, the original is its own thumbnail. */
export const passThroughImages: ImageProcessor = {
  process: async (data) => (data.byteLength > 0 ? { width: 0, height: 0, thumbnail: data } : null),
  fit: async (data) => (data.byteLength > 0 ? data : null),
};

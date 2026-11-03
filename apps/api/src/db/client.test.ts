import { describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';

describe('createDatabase', () => {
  it('passes a raw password separately from the connection URL', async () => {
    const password = 'p@ss:word/with%reserved#chars';
    const database = createDatabase('postgres://revize@db:5432/revize', password);

    expect(database.pool.options.password).toBe(password);

    await database.close();
  });
});

import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';

describe('createDatabase', () => {
  it('passes a raw password separately from the connection URL without getting overwritten', async () => {
    const password = 'p@ss:word/with%reserved#chars';
    const database = createDatabase('postgres://revize@db:5432/revize', password);

    expect(database.pool.options.password).toBe(password);
    const client = new pg.Client(database.pool.options);
    expect(client.password).toBe(password);

    await database.close();
  });

  it('preserves embedded password from connection URL when no separate password is provided', async () => {
    const database = createDatabase('postgres://revize:embedded%20pass@db:5432/revize');
    expect(database.pool.options.password).toBe('embedded pass');
    const client = new pg.Client(database.pool.options);
    expect(client.password).toBe('embedded pass');

    await database.close();
  });
});

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Repositories accept either the database or a running transaction. */
export type DbOrTx = Db | Tx;

export interface Database {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function parsePostgresConfig(url: string, password?: string): pg.PoolConfig {
  const parsed = new URL(url);
  const config: pg.PoolConfig = {
    host: parsed.hostname || undefined,
    port: parsed.port ? Number(parsed.port) : undefined,
    user: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password:
      password !== undefined
        ? password
        : parsed.password
          ? decodeURIComponent(parsed.password)
          : undefined,
    database: parsed.pathname ? parsed.pathname.replace(/^\//, '') : undefined,
    max: 10,
  };
  if (parsed.searchParams.get('sslmode') === 'disable') {
    config.ssl = false;
  } else if (parsed.searchParams.get('sslmode') === 'require') {
    config.ssl = true;
  }
  return config;
}

export function createDatabase(url: string, password?: string): Database {
  const pool = new pg.Pool(parsePostgresConfig(url, password));
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool, close: () => pool.end() };
}

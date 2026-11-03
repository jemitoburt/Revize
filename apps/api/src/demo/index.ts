import type { PGlite } from '@electric-sql/pglite';
import { useCzechValidationMessages } from '@revize/shared';
import { drizzle } from 'drizzle-orm/pglite';
import { authPlugin } from '../auth/plugin.js';
import { bootstrap } from '../bootstrap.js';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import * as schema from '../db/schema.js';
import type { ImageProcessor } from '../infra/image-processor.js';
import { registerApiRoutes } from '../routes.js';
import { PgliteFileStorage, passThroughImages } from './files.js';
import { DemoRouter } from './router.js';

export type { ImageProcessor, ProcessedImage } from '../infra/image-processor.js';
export type { DemoMultipart, DemoRequest, DemoResponse } from './router.js';

export const DEMO_ADMIN = { email: 'admin@revize.local', password: 'demo-heslo' };

/** One migration of `apps/api/drizzle` (file name without `.sql`, and its text). */
export interface Migration {
  tag: string;
  sql: string;
}

const demoConfig: Config = {
  DATABASE_URL: 'pglite://demo',
  HOST: 'localhost',
  PORT: 0,
  LOG_LEVEL: 'warn',
  COOKIE_SECURE: false,
  SESSION_TTL_DAYS: 365,
  LOGIN_RATE_LIMIT: 10,
  TRUSTED_ORIGINS: [],
  FILES_DIR: '',
  MIGRATIONS_DIR: '',
  MIGRATE_ON_START: true,
  CHROMIUM_PATH: undefined,
  ORG_NAME: 'Ukázková revizní firma',
  ADMIN_EMAIL: DEMO_ADMIN.email,
  ADMIN_PASSWORD: DEMO_ADMIN.password,
  SEED_DEMO: true,
};

/** Applies the server's SQL migrations that the database does not have yet, in order. */
export async function applyMigrations(client: PGlite, migrations: Migration[]): Promise<void> {
  await client.exec('create table if not exists demo_migration (tag text primary key)');
  const done = new Set(
    (await client.query<{ tag: string }>('select tag from demo_migration')).rows.map((r) => r.tag),
  );
  for (const migration of [...migrations].sort((a, b) => a.tag.localeCompare(b.tag))) {
    if (done.has(migration.tag)) continue;
    await client.transaction(async (tx) => {
      await tx.exec(migration.sql.replaceAll('--> statement-breakpoint', ''));
      await tx.query('insert into demo_migration (tag) values ($1)', [migration.tag]);
    });
  }
}

export interface DemoApi {
  handle: DemoRouter['handle'];
}

/**
 * The whole API running on PGlite (PostgreSQL in WebAssembly) for the GitHub Pages demo
 * (ADR-0015): same migrations, services, validation and errors as the server. A fresh
 * database gets the demo organization, administrator and data.
 */
export async function createDemoApi(
  client: PGlite,
  migrations: Migration[],
  images: ImageProcessor = passThroughImages,
): Promise<DemoApi> {
  useCzechValidationMessages();
  await applyMigrations(client, migrations);
  const files = new PgliteFileStorage(client);
  await files.init();
  const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  const silent = { info: () => {}, warn: () => {} };
  await bootstrap(db, demoConfig, silent as never);

  const router = new DemoRouter();
  const root = router.instance();
  await root.register(authPlugin, { db, config: demoConfig });
  await root.register(
    (api) => registerApiRoutes(api, { db, config: demoConfig, files, images, pdf: null }),
    {
      prefix: '/api',
    },
  );
  return { handle: (request) => router.handle(request) };
}

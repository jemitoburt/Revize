import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { inject } from 'vitest';
import { buildApp, type App } from '../src/app.js';
import { bootstrap } from '../src/bootstrap.js';
import { loadConfig, type Config } from '../src/config.js';
import { createDatabase, type Database } from '../src/db/client.js';
import { ChromiumPdfRenderer } from '../src/infra/chromium-pdf-renderer.js';
import { LocalDiskStorage } from '../src/infra/local-disk-storage.js';
import { SharpImageProcessor } from '../src/infra/sharp-image-processor.js';

export const ADMIN = { email: 'admin@test.cz', password: 'admin-heslo-123' };

let loginCounter = 0;

export interface TestContext {
  app: App;
  database: Database;
  config: Config;
  /** Empties all tables and creates the organization with the administrator again. */
  reset(options?: { seedDemo?: boolean }): Promise<void>;
  login(email: string, password: string): Promise<{ token: string; cookie: string }>;
}

export async function createTestContext(env: Record<string, string> = {}): Promise<TestContext> {
  const config = loadConfig({
    DATABASE_URL: inject('databaseUrl'),
    COOKIE_SECURE: 'false',
    ADMIN_EMAIL: ADMIN.email,
    ADMIN_PASSWORD: ADMIN.password,
    ORG_NAME: 'Testovací revize s.r.o.',
    ...env,
  });
  const database = createDatabase(config.DATABASE_URL);
  const filesDir = await mkdtemp(join(tmpdir(), 'revize-files-'));
  const app = await buildApp({
    config,
    db: database.db,
    files: new LocalDiskStorage(filesDir),
    images: new SharpImageProcessor(),
    pdf: new ChromiumPdfRenderer(),
    logger: false,
  });

  return {
    app,
    database,
    config,
    async reset(options = {}) {
      const { rows } = await database.pool.query<{ tablename: string }>(
        `select tablename from pg_tables where schemaname = 'public'`,
      );
      const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
      await database.db.execute(sql.raw(`truncate ${tables} cascade`));
      await bootstrap(database.db, { ...config, SEED_DEMO: options.seedDemo ?? false }, app.log);
    },
    async login(email, password) {
      // Every test login comes from its own address so that the login rate limit
      // (10 per minute and IP) is not hit by the suite itself.
      loginCounter += 1;
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: `10.0.${Math.floor(loginCounter / 250)}.${loginCounter % 250}`,
        payload: { email, password },
      });
      if (response.statusCode !== 200) throw new Error(`login failed: ${response.body}`);
      const cookie = response.cookies.find((c) => c.name === 'revize_session')!;
      return {
        token: response.json<{ token: string }>().token,
        cookie: `revize_session=${cookie.value}`,
      };
    },
  };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export function errorCode(response: LightMyRequestResponse): string {
  return response.json<{ error: string }>().error;
}

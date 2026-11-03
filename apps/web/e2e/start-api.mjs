// Starts the API for the web e2e tests on a freshly created database.
// Needs a PostgreSQL server (TEST_DATABASE_URL, e.g. `pnpm db:test`).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const server =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const name = 'revize_web_e2e';
const admin = new pg.Client({ connectionString: server });
await admin.connect();
await admin.query(`drop database if exists ${name} with (force)`);
await admin.query(`create database ${name}`);
await admin.end();

const url = new URL(server);
url.pathname = `/${name}`;
const apiDir = fileURLToPath(new URL('../../api', import.meta.url));
const child = spawn('pnpm', ['exec', 'tsx', 'src/main.ts'], {
  cwd: apiDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: url.toString(),
    PORT: '3100',
    COOKIE_SECURE: 'false',
    ADMIN_EMAIL: 'admin@revize.local',
    ADMIN_PASSWORD: 'admin-heslo-123',
    SEED_DEMO: 'false',
    LOG_LEVEL: 'warn',
    // The suite signs in many times a minute from one address.
    LOGIN_RATE_LIMIT: '1000',
    FILES_DIR: mkdtempSync(join(tmpdir(), 'revize-e2e-files-')),
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));

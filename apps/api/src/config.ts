import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /** Optional raw database password, passed separately to avoid URL-encoding issues. */
  DATABASE_PASSWORD: z.string().optional(),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Send the session cookie only over HTTPS. Disable only for local development over http. */
  COOKIE_SECURE: bool.default(true),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Extra origins allowed to send cookie-authenticated writes (comma separated). */
  TRUSTED_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  FILES_DIR: z.string().default('./data/files'),
  MIGRATIONS_DIR: z.string().default(fileURLToPath(new URL('../drizzle', import.meta.url))),
  /** Run pending migrations when the server starts. */
  MIGRATE_ON_START: bool.default(true),
  /** First start on an empty database: organization and first administrator. */
  ORG_NAME: z.string().default('Revizní firma'),
  ADMIN_EMAIL: z.string().default('admin@revize.local'),
  ADMIN_PASSWORD: z.string().optional(),
  /** Fill an empty database with demo data (customer, equipment types, items). */
  SEED_DEMO: bool.default(false),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return parsed.data;
}

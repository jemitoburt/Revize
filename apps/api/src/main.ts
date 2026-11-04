import { readFile } from 'node:fs/promises';
import { buildApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { ChromiumPdfRenderer } from './infra/chromium-pdf-renderer.js';
import { ExifToolMetadataWriter } from './infra/exiftool-metadata-writer.js';
import { LocalDiskStorage } from './infra/local-disk-storage.js';
import { SharpImageProcessor } from './infra/sharp-image-processor.js';
import { checkPhotoFiles } from './infra/check-photo-files.js';

// Build time of the image (apps/api/Dockerfile), shown in the office under Nastavení.
try {
  process.env.REVIZE_BUILT_AT = (
    await readFile(new URL('./build-time.txt', import.meta.url), 'utf8')
  ).trim();
} catch {
  // not built by the image (development)
}

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL, config.DATABASE_PASSWORD);
const storageMaxBytes =
  config.STORAGE_MAX_GB !== undefined ? config.STORAGE_MAX_GB * 1024 * 1024 * 1024 : undefined;
const files = new LocalDiskStorage(config.FILES_DIR, storageMaxBytes);
const app = await buildApp({
  config,
  db: database.db,
  files,
  images: new SharpImageProcessor(),
  pdf: new ChromiumPdfRenderer(config.CHROMIUM_PATH || undefined),
  metadata: new ExifToolMetadataWriter(),
});

try {
  if (config.MIGRATE_ON_START) {
    await runMigrations(database.db, config.MIGRATIONS_DIR);
    app.log.info('Databázové migrace jsou aktuální.');
  }
  await bootstrap(database.db, config, app.log);
  await checkPhotoFiles(database.db, files, config.FILES_DIR, app.log);
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal(error);
  await database.close();
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal}: ukončuji server`);
    await app.close();
    await database.close();
    process.exit(0);
  });
}

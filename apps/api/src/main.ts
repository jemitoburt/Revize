import { buildApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { LocalDiskStorage } from './infra/local-disk-storage.js';
import { SharpImageProcessor } from './infra/sharp-image-processor.js';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL, config.DATABASE_PASSWORD);
const app = await buildApp({
  config,
  db: database.db,
  files: new LocalDiskStorage(config.FILES_DIR),
  images: new SharpImageProcessor(),
});

try {
  if (config.MIGRATE_ON_START) {
    await runMigrations(database.db, config.MIGRATIONS_DIR);
    app.log.info('Databázové migrace jsou aktuální.');
  }
  await bootstrap(database.db, config, app.log);
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

import { loadConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL, config.DATABASE_PASSWORD);
await runMigrations(database.db, config.MIGRATIONS_DIR);
await database.close();
console.log('Migrace hotové.');

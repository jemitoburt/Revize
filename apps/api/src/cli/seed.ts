import { loadConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { organization } from '../db/schema.js';
import { DEMO_INSPECTOR, seedDemo } from '../seed/demo.js';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL, config.DATABASE_PASSWORD);
const [org] = await database.db.select().from(organization).limit(1);
if (!org) {
  console.error(
    'Databáze je prázdná – nejdřív spusťte server (vytvoří organizaci a administrátora).',
  );
  process.exitCode = 1;
} else if (await seedDemo(database.db, org.id)) {
  console.log(
    `Ukázková data vložena. Technik: ${DEMO_INSPECTOR.email} / ${DEMO_INSPECTOR.password}`,
  );
} else {
  console.log('Organizace už má zákazníky – ukázková data se nevkládají.');
}
await database.close();

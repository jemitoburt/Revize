import { parseArgs } from 'node:util';
import { createUserRequestSchema, newId } from '@revize/shared';
import { hashPassword } from '../auth/passwords.js';
import { loadConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { appUser, organization } from '../db/schema.js';

// Usage: create-user --email a@b.cz --name "Jméno" --role admin|inspector --password "..."
// Also a recovery path when every administrator lost access.
const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'inspector' },
    password: { type: 'string' },
  },
});
const input = createUserRequestSchema.parse({
  email: values.email,
  displayName: values.name,
  role: values.role,
  password: values.password,
});

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL, config.DATABASE_PASSWORD);
const [org] = await database.db.select().from(organization).limit(1);
if (!org) throw new Error('Databáze je prázdná – nejdřív spusťte server.');
await database.db
  .insert(appUser)
  .values({
    id: newId(),
    organizationId: org.id,
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    passwordHash: await hashPassword(input.password),
  })
  .onConflictDoUpdate({
    target: appUser.email,
    set: { passwordHash: await hashPassword(input.password), role: input.role, active: true },
  });
await database.close();
console.log(`Uživatel ${input.email} (${input.role}) je připravený.`);

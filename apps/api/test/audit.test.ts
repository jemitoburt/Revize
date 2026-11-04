import { auditActionLabel, auditChanges } from '@revize/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DEMO_INSPECTOR } from '../src/seed/demo.js';
import { ADMIN, bearer, createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: string;

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.reset({ seedDemo: true });
  admin = (await ctx.login(ADMIN.email, ADMIN.password)).token;
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.database.close();
});

it('filters the audit by area, user and date for Historie změn', async () => {
  const technik = (await ctx.login(DEMO_INSPECTOR.email, DEMO_INSPECTOR.password)).token;
  const get = (url: string, token = admin) =>
    ctx.app.inject({ method: 'GET', url, headers: bearer(token) });
  // Inspectors have no access to the audit.
  expect((await get('/api/audit', technik)).statusCode).toBe(403);

  const customers = (await get('/api/customers')).json<{ id: string; version: number }[]>();
  await ctx.app.inject({
    method: 'PATCH',
    url: `/api/customers/${customers[0]!.id}`,
    headers: bearer(admin),
    payload: { version: customers[0]!.version, note: 'Nová poznámka' },
  });
  const me = (await get('/api/auth/me')).json<{ id: string }>();

  const customerEntries = (await get('/api/audit?entityType=customer')).json<
    { action: string; before: unknown; after: unknown; actor: { id: string } }[]
  >();
  expect(customerEntries[0]).toMatchObject({ action: 'customer.update', actor: { id: me.id } });
  expect(auditActionLabel(customerEntries[0]!.action)).toBe('Úprava zákazníka');
  expect(auditChanges(customerEntries[0]!)).toContainEqual({
    field: 'Poznámka',
    from: expect.any(String),
    to: 'Nová poznámka',
  });

  const today = new Date().toISOString().slice(0, 10);
  const byActor = (await get(`/api/audit?actorId=${me.id}&from=${today}&to=${today}`)).json<
    { actor: { id: string } | null }[]
  >();
  expect(byActor.length).toBeGreaterThan(0);
  expect(byActor.every((e) => e.actor?.id === me.id)).toBe(true);
  expect((await get('/api/audit?to=2000-01-01')).json()).toEqual([]);
});

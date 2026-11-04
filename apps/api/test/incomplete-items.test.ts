import { afterAll, beforeAll, expect, it } from 'vitest';
import { ADMIN, bearer, createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
let token: string;
const api = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  ctx.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.reset({ seedDemo: true });
  token = (await ctx.login(ADMIN.email, ADMIN.password)).token;
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.database.close();
});

it('saves an item without required values and lists it as incomplete', async () => {
  const customers = (await api('GET', '/api/customers')).json<{ id: string }[]>();
  const siteId = (await api('GET', `/api/customers/${customers[0]!.id}/sites`)).json<
    { id: string }[]
  >()[0]!.id;
  const types = (await api('GET', '/api/equipment-types')).json<{ id: string; name: string }[]>();
  const ladder = types.find((t) => t.name === 'Žebřík')!.id;
  // Manufacturer, ladder type and rungs are required for ladders; none given.
  const created = await api('POST', '/api/items', {
    siteId,
    locationId: null,
    equipmentTypeId: ladder,
    itemNumber: '8801',
    fieldValues: {},
  });
  expect(created.statusCode, created.body).toBe(201);
  expect(created.json().missingFields).toEqual(expect.arrayContaining(['Výrobce', 'Typ žebříku']));
  // Wrong values are still refused.
  const wrong = await api('POST', '/api/items', {
    siteId,
    locationId: null,
    equipmentTypeId: ladder,
    itemNumber: '8802',
    fieldValues: { rungs: 'hodně' },
  });
  expect(wrong.statusCode).toBe(400);

  const incomplete = (await api('GET', '/api/items?incomplete=true')).json<{
    items: { itemNumber: string }[];
  }>().items;
  expect(incomplete.map((i) => i.itemNumber)).toEqual(['8801']);
  // Completed later: no longer incomplete.
  await api('PATCH', `/api/items/${created.json().id}`, {
    version: created.json().version,
    fieldValues: { manufacturer: 'Alve', ladder_type: 'Opěrný', rungs: 8 },
  });
  expect((await api('GET', '/api/items?incomplete=true')).json().items).toEqual([]);
});

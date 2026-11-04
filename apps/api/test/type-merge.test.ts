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

it('merges the old rack types into one, keeping the edited settings', async () => {
  const customers = (await api('GET', '/api/customers')).json<{ id: string }[]>();
  const siteId = (await api('GET', `/api/customers/${customers[0]!.id}/sites`)).json<
    { id: string }[]
  >()[0]!.id;
  const make = async (name: string, fields: unknown[]) =>
    (
      await api('POST', '/api/equipment-types', {
        name,
        defaultIntervalMonths: 12,
        protocolTemplate: `# ${name}`,
        fieldDefinitions: fields,
      })
    ).json<{ id: string; version: number }>();
  // "Regál paletový" was edited by the user: own interval, text and field label.
  const pallet = await make('Regál paletový', [
    { key: 'manufacturer', label: 'Výrobce regálu', kind: 'text', order: 0 },
  ]);
  await api('PATCH', `/api/equipment-types/${pallet.id}`, {
    version: pallet.version,
    defaultIntervalMonths: 6,
    protocolTemplate: '# Upravený text regálů',
  });
  const shelf = await make('Regál policový', [
    { key: 'manufacturer', label: 'Výrobce', kind: 'text', order: 0 },
    { key: 'shelves', label: 'Počet polic', kind: 'integer', order: 1 },
  ]);
  const addItem = (equipmentTypeId: string, itemNumber: string, fieldValues = {}) =>
    api('POST', '/api/items', {
      siteId,
      locationId: null,
      equipmentTypeId,
      itemNumber,
      fieldValues,
    });
  await addItem(pallet.id, '9001', { manufacturer: 'Mecalux' });
  await addItem(shelf.id, '9002', { manufacturer: 'Kasten', shelves: 5 });

  const body = {
    targetId: pallet.id,
    sourceIds: [shelf.id],
    name: 'Regál univerzální',
    kindField: { key: 'rack_type', label: 'Typ regálu' },
  };
  const preview = (await api('POST', '/api/equipment-types/merge-preview', body)).json();
  expect(preview).toMatchObject({
    items: 1,
    addedFields: ['Počet polic', 'Typ regálu'],
    kindValues: { 'Regál paletový': 'Paletový', 'Regál policový': 'Policový' },
  });
  const merged = await api('POST', '/api/equipment-types/merge', body);
  expect(merged.statusCode, merged.body).toBe(200);
  expect(merged.json()).toMatchObject({
    name: 'Regál univerzální',
    defaultIntervalMonths: 6,
    protocolTemplate: '# Upravený text regálů',
  });
  const labels = merged.json().fieldDefinitions.map((f: { label: string }) => f.label);
  expect(labels).toEqual(['Výrobce regálu', 'Počet polic', 'Typ regálu']);

  const items = (await api('GET', `/api/items?q=900`)).json<{
    items: { itemNumber: string; equipmentTypeId: string; fieldValues: Record<string, unknown> }[];
  }>().items;
  const byNumber = Object.fromEntries(items.map((i) => [i.itemNumber, i]));
  expect(byNumber['9001']).toMatchObject({
    equipmentTypeId: pallet.id,
    fieldValues: { manufacturer: 'Mecalux', rack_type: 'Paletový' },
  });
  expect(byNumber['9002']).toMatchObject({
    equipmentTypeId: pallet.id,
    fieldValues: { manufacturer: 'Kasten', shelves: 5, rack_type: 'Policový' },
  });
  // The merged type is archived, not deleted.
  const all = (await api('GET', '/api/equipment-types?includeArchived=true')).json<
    { id: string; archived: boolean }[]
  >();
  expect(all.find((t) => t.id === shelf.id)?.archived ?? true).toBe(true);
});

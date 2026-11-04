import { newId } from '@revize/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ADMIN, bearer, createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
let token: string;
const api = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: unknown) =>
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

it('shows the history of an item and filters by the inspection state', async () => {
  const customers = (await api('GET', '/api/customers')).json<{ id: string }[]>();
  const siteId = (await api('GET', `/api/customers/${customers[0]!.id}/sites`)).json<
    { id: string }[]
  >()[0]!.id;
  const types = (await api('GET', '/api/equipment-types')).json<{ id: string; name: string }[]>();
  const ladder = types.find((t) => t.name === 'Žebřík')!.id;
  const inspect = async (date: string, results: Record<string, unknown>) => {
    const id = newId();
    await api('PUT', `/api/inspections/${id}`, {
      siteId,
      inspectionDate: date,
      equipmentTypeIds: [ladder],
    });
    const items = (await api('GET', `/api/inspections/${id}/items`)).json<{ id: string }[]>();
    for (const [index, body] of Object.entries(results)) {
      await api('PUT', `/api/inspections/${id}/results/${items[Number(index)]!.id}`, {
        id: newId(),
        recordedAt: new Date().toISOString(),
        ...(body as object),
      });
    }
    await api('POST', `/api/inspections/${id}/close`, { nextInspectionDate: '2026-01-15' });
    return items;
  };
  const items = await inspect('2025-11-03', {
    0: { outcome: 'defect', severity: 'red', defectDescription: 'Prasklá příčka' },
    1: { outcome: 'ok' },
  });
  // The second inspection checks only the first item.
  await inspect('2026-11-03', { 0: { outcome: 'ok' } });

  const history = (await api('GET', `/api/items/${items[1]!.id}/history`)).json<
    { inspectionDate: string; result: { outcome: string } | null }[]
  >();
  expect(history.map((h) => [h.inspectionDate, h.result?.outcome ?? null])).toEqual([
    ['2026-11-03', null],
    ['2025-11-03', 'ok'],
  ]);
  const first = (await api('GET', `/api/items/${items[0]!.id}/history`)).json();
  expect(first[1].result).toMatchObject({ outcome: 'defect', defectDescription: 'Prasklá příčka' });

  // Not checked in the last closed inspection: the second item, not the first one.
  const unchecked = (await api('GET', '/api/items?lastInspection=unchecked')).json<{
    items: { id: string }[];
  }>().items;
  expect(unchecked.map((i) => i.id)).toContain(items[1]!.id);
  expect(unchecked.map((i) => i.id)).not.toContain(items[0]!.id);
  // The second item still has the next date from the first inspection: overdue.
  const overdue = (await api('GET', '/api/items?due=overdue')).json<{ items: { id: string }[] }>()
    .items;
  expect(overdue.map((i) => i.id)).toContain(items[1]!.id);
  // The same filter in the database export.
  const csv = (await api('GET', '/api/exports/items.csv?lastInspection=unchecked')).body;
  expect(csv.trim().split('\r\n').length).toBe(unchecked.length + 1);
});

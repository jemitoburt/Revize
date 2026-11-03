import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_ADMIN, createDemoApi, type DemoApi, type DemoRequest } from './index.js';

const migrationsDir = new URL('../../drizzle/', import.meta.url);
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .map((name) => ({
    tag: name.replace(/\.sql$/, ''),
    sql: readFileSync(new URL(name, migrationsDir), 'utf8'),
  }));

let client: PGlite;
let demo: DemoApi;
let cookie = '';

async function call(method: string, url: string, body?: unknown, extra: Partial<DemoRequest> = {}) {
  const response = await demo.handle({
    method,
    url,
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...extra,
  });
  const setCookie = response.headers['set-cookie'];
  if (setCookie) cookie = setCookie.split(';')[0]!;
  const data =
    typeof response.body === 'string' && response.body !== '' ? JSON.parse(response.body) : null;
  return { ...response, data };
}

describe('demo runtime (API on PGlite)', () => {
  beforeAll(async () => {
    client = new PGlite();
    demo = await createDemoApi(client, migrations);
  }, 60_000);
  afterAll(() => client.close());

  it('requires login, then serves the seeded demo data', async () => {
    expect((await call('GET', '/api/customers')).status).toBe(401);
    const login = await call('POST', '/api/auth/login', {
      email: DEMO_ADMIN.email,
      password: DEMO_ADMIN.password,
    });
    expect(login.status).toBe(200);
    expect(cookie).toMatch(/^revize_session=/);

    const customers = await call('GET', '/api/customers');
    expect(customers.data.map((c: { name: string }) => c.name)).toEqual(['Ukázkový sklad s.r.o.']);
    const items = await call('GET', '/api/items?sort=itemNumber&pageSize=5');
    expect(items.status).toBe(200);
    expect(items.data.total).toBe(35);
  });

  it('validates input and maps errors like the server', async () => {
    const invalid = await call('POST', '/api/customers', { name: '' });
    expect(invalid.status).toBe(400);
    expect(invalid.data.error).toBe('validation');
    expect(invalid.data.issues[0].path).toEqual(['name']);

    const created = await call('POST', '/api/customers', { name: 'Nový zákazník' });
    expect(created.status).toBe(201);
    expect(created.data.name).toBe('Nový zákazník');
    expect((await call('GET', '/api/nothing')).status).toBe(404);
  });

  it('runs a whole CSV import including multipart upload and the XLSX template', async () => {
    const [type] = (await call('GET', '/api/equipment-types')).data.filter((t: { name: string }) =>
      t.name.startsWith('Žebřík'),
    );
    const template = await call('GET', `/api/equipment-types/${type.id}/import-template`);
    expect(template.status).toBe(200);
    expect(template.body).toBeInstanceOf(Uint8Array);

    const csv = 'Číslo;Hala;Výrobce;Typ žebříku;Počet příček\n777;Hala Z;Alve;Opěrný;9\n';
    const upload = await call('POST', '/api/imports', undefined, {
      body: {
        fields: {},
        file: {
          filename: 'zebriky.csv',
          mimetype: 'text/csv',
          data: new TextEncoder().encode(csv),
        },
      },
    });
    expect(upload.status).toBe(201);
    const customer = (await call('GET', '/api/customers')).data.find(
      (c: { name: string }) => c.name === 'Ukázkový sklad s.r.o.',
    );
    const sites = await call('GET', `/api/customers/${customer.id}/sites`);
    const suggestion = await call(
      'GET',
      `/api/imports/${upload.data.id}/suggestion?equipmentTypeId=${type.id}`,
    );
    const mapping = { ...suggestion.data, siteId: sites.data[0].id, equipmentTypeId: type.id };
    delete mapping.fromSavedMapping;
    const commit = await call('POST', `/api/imports/${upload.data.id}/commit`, {
      mapping,
      skipErrors: false,
    });
    expect(commit.status).toBe(200);
    expect(commit.data).toMatchObject({ created: 1, locationsCreated: 1 });
  });

  it('runs an inspection with results and photos', async () => {
    const id = '0190e8a0-0000-7000-8000-00000000a001';
    const customer = (await call('GET', '/api/customers')).data.find(
      (c: { name: string }) => c.name === 'Ukázkový sklad s.r.o.',
    );
    const site = (await call('GET', `/api/customers/${customer.id}/sites`)).data[0];
    const started = await call('PUT', `/api/inspections/${id}`, {
      siteId: site.id,
      inspectionDate: '2026-11-03',
    });
    expect(started.status).toBe(201);
    const items = (await call('GET', `/api/inspections/${id}/items`)).data;
    expect(items.length).toBeGreaterThan(30);
    const recorded = await call('PUT', `/api/inspections/${id}/results/${items[0].id}`, {
      id: '0190e8a0-0000-7000-8000-00000000a002',
      outcome: 'defect',
      defectDescription: 'Chybí pojistka',
      recordedAt: new Date().toISOString(),
    });
    expect(recorded.status).toBe(200);
    const photo = await call('PUT', '/api/photos/0190e8a0-0000-7000-8000-00000000a003', undefined, {
      body: {
        fields: { owner: 'result', itemId: items[0].id, inspectionId: id },
        file: { filename: 'f.jpg', mimetype: 'image/jpeg', data: new Uint8Array([1, 2, 3]) },
      },
    });
    expect(photo.status).toBe(201);
    const thumb = await call('GET', '/api/photos/0190e8a0-0000-7000-8000-00000000a003/thumbnail');
    expect([...(thumb.body as Uint8Array)]).toEqual([1, 2, 3]);
    const detail = await call('GET', `/api/inspections/${id}`);
    expect(detail.data.progress).toMatchObject({ checked: 1, defect: 1 });
  });

  it('keeps data in the database across runtime restarts', async () => {
    const again = await createDemoApi(client, migrations);
    demo = again;
    const customers = await call('GET', '/api/customers');
    expect(customers.data).toHaveLength(2);
  });
});

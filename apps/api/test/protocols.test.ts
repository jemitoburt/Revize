import { newId } from '@revize/shared';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, item } from '../src/db/schema.js';
import { DEMO_INSPECTOR } from '../src/seed/demo.js';
import { ADMIN, bearer, createTestContext, errorCode, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: string;
let technik: string;
let siteId: string;
let ladderTypeId: string;

type Method = 'GET' | 'PUT' | 'POST' | 'DELETE';
const api = (method: Method, url: string, payload?: unknown, as = admin) =>
  ctx.app.inject({ method, url, headers: bearer(as), ...(payload ? { payload } : {}) });

async function upload(url: string, fields: Record<string, string>, data: Buffer, type: string) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('file', new Blob([new Uint8Array(data)], { type }), 'soubor');
  return ctx.app.inject({ method: 'PUT', url, headers: bearer(admin), payload: form });
}

const result = (outcome: 'ok' | 'defect', extra: Record<string, unknown> = {}) => ({
  id: newId(),
  outcome,
  recordedAt: new Date().toISOString(),
  ...extra,
});

/** Ladder inspection with one OK and one defect (with a photo). */
async function inspectionWithResults() {
  const id = newId();
  await api('PUT', `/api/inspections/${id}`, {
    siteId,
    inspectionDate: '2026-11-03',
    equipmentTypeIds: [ladderTypeId],
  });
  const items = (await api('GET', `/api/inspections/${id}/items`)).json<{ id: string }[]>();
  await api('PUT', `/api/inspections/${id}/results/${items[0]!.id}`, result('ok'));
  await api(
    'PUT',
    `/api/inspections/${id}/results/${items[1]!.id}`,
    result('defect', { defectDescription: 'Prasklá příčka', takenOutOfService: true }),
  );
  const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#c00' } })
    .jpeg()
    .toBuffer();
  const photo = await upload(
    `/api/photos/${newId()}`,
    { owner: 'result', itemId: items[1]!.id, inspectionId: id },
    jpeg,
    'image/jpeg',
  );
  expect(photo.statusCode).toBe(201);
  return { id, items };
}

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.database.close();
});
beforeEach(async () => {
  await ctx.reset({ seedDemo: true });
  admin = (await ctx.login(ADMIN.email, ADMIN.password)).token;
  technik = (await ctx.login(DEMO_INSPECTOR.email, DEMO_INSPECTOR.password)).token;
  const customers = (await api('GET', '/api/customers')).json<{ id: string }[]>();
  siteId = (await api('GET', `/api/customers/${customers[0]!.id}/sites`)).json<
    { id: string }[]
  >()[0]!.id;
  const types = (await api('GET', '/api/equipment-types')).json<{ id: string; name: string }[]>();
  ladderTypeId = types.find((t) => t.name === 'Žebřík')!.id;
});

describe('closing and reopening inspections', () => {
  it('closes: results are read-only and checked items get their next inspection date', async () => {
    const { id, items } = await inspectionWithResults();
    expect((await api('POST', `/api/inspections/${id}/close`, {}, technik)).statusCode).toBe(403);

    const closed = await api('POST', `/api/inspections/${id}/close`, {});
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({ status: 'closed', nextInspectionDate: '2027-11-03' });
    const [checked] = await ctx.database.db.select().from(item).where(eq(item.id, items[0]!.id));
    expect(checked!.nextInspectionDate).toBe('2027-11-03');
    const [unchecked] = await ctx.database.db.select().from(item).where(eq(item.id, items[2]!.id));
    expect(unchecked!.nextInspectionDate).not.toBe('2027-11-03');

    const write = await api('PUT', `/api/inspections/${id}/results/${items[2]!.id}`, result('ok'));
    expect(errorCode(write)).toBe('inspection_closed');
    expect(errorCode(await api('POST', `/api/inspections/${id}/close`, {}))).toBe(
      'inspection_closed',
    );

    expect((await api('POST', `/api/inspections/${id}/reopen`, { reason: '' })).statusCode).toBe(
      400,
    );
    const reopened = await api('POST', `/api/inspections/${id}/reopen`, {
      reason: 'Doplnění artiklu',
    });
    expect(reopened.json()).toMatchObject({ status: 'open' });
    const audit = await ctx.database.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'inspection.reopen'));
    expect(audit[0]?.reason).toBe('Doplnění artiklu');
  });

  it('uses the date given for the whole inspection', async () => {
    const { id, items } = await inspectionWithResults();
    await api('POST', `/api/inspections/${id}/close`, { nextInspectionDate: '2027-05-31' });
    const [row] = await ctx.database.db.select().from(item).where(eq(item.id, items[1]!.id));
    expect(row!.nextInspectionDate).toBe('2027-05-31');
  });
});

describe('organization settings and protocol', () => {
  it('lets only administrators change company details and the logo', async () => {
    const body = {
      name: 'Revize Novák s.r.o.',
      settings: {
        companyId: '87654321',
        address: 'Revizní 5, 602 00 Brno',
        phone: '+420 777 000 111',
        email: 'kancelar@revize-novak.cz',
        web: '',
        certification: 'Osvědčení č. 42/2025',
        protocolFooter: 'Protokol byl vyhotoven elektronicky.',
      },
    };
    expect((await api('PUT', '/api/organization', body, technik)).statusCode).toBe(403);
    expect((await api('PUT', '/api/organization', body)).json()).toMatchObject({
      name: 'Revize Novák s.r.o.',
      hasLogo: false,
    });
    const png = await sharp({
      create: { width: 300, height: 100, channels: 3, background: '#1c4e80' },
    })
      .png()
      .toBuffer();
    expect(
      errorCode(await upload('/api/organization/logo', {}, Buffer.from('x'), 'text/plain')),
    ).toBe('invalid_logo');
    const logo = await upload('/api/organization/logo', {}, png, 'image/png');
    expect(logo.json().hasLogo).toBe(true);
    expect((await api('GET', '/api/organization/logo')).headers['content-type']).toBe('image/png');
  });

  it('renders the protocol as HTML and PDF, draft until closed', async () => {
    const { id } = await inspectionWithResults();
    const html = (await api('GET', `/api/inspections/${id}/protocol.html`)).body;
    expect(html).toContain('Protokol o kontrole technického vybavení');
    expect(html).toContain('PŘEDBĚŽNÝ PROTOKOL');
    expect(html).toContain('Ukázkový sklad s.r.o.');
    expect(html).toContain('Prasklá příčka');
    expect(html).toContain('Vyřazeno z provozu');
    expect(html).toContain('data:image/jpeg;base64,');
    // The type's protocol text with its placeholders filled in.
    expect(html).toContain('provozovna Provozovna Brno');
    expect(html).not.toContain('{{');

    const pdf = await api('GET', `/api/inspections/${id}/protocol.pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('protokol-Provozovna-Brno-2026-11-03.pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.rawPayload.length).toBeGreaterThan(20_000);

    await api('POST', `/api/inspections/${id}/close`, {});
    const final = (await api('GET', `/api/inspections/${id}/protocol.html`)).body;
    expect(final).not.toContain('PŘEDBĚŽNÝ PROTOKOL');
  }, 60_000);
});

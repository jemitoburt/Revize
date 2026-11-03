import { newId } from '@revize/shared';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, inspection } from '../src/db/schema.js';
import { DEMO_INSPECTOR } from '../src/seed/demo.js';
import { ADMIN, bearer, createTestContext, errorCode, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: string;
let technik: string;
let siteId: string;
let ladderTypeId: string;
let rackTypeId: string;

type Method = 'GET' | 'PUT' | 'POST' | 'DELETE';

async function api(method: Method, url: string, payload?: unknown, as = admin) {
  return ctx.app.inject({ method, url, headers: bearer(as), ...(payload ? { payload } : {}) });
}

async function uploadPhoto(id: string, fields: Record<string, string>, data: Buffer, as = admin) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('file', new Blob([new Uint8Array(data)], { type: 'image/jpeg' }), 'foto.jpg');
  return ctx.app.inject({
    method: 'PUT',
    url: `/api/photos/${id}`,
    headers: bearer(as),
    payload: form,
  });
}

const jpeg = () =>
  sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#c0392b' } })
    .jpeg()
    .toBuffer();

const result = (outcome: 'ok' | 'defect', extra: Record<string, unknown> = {}) => ({
  id: newId(),
  outcome,
  recordedAt: new Date().toISOString(),
  ...extra,
});

async function startLadderInspection(id = newId()) {
  const response = await api('PUT', `/api/inspections/${id}`, {
    siteId,
    inspectionDate: '2026-11-03',
    equipmentTypeIds: [ladderTypeId],
  });
  expect(response.statusCode).toBe(201);
  return id;
}

async function itemsOf(inspectionId: string, as = admin) {
  const response = await api('GET', `/api/inspections/${inspectionId}/items`, undefined, as);
  expect(response.statusCode).toBe(200);
  return response.json<
    {
      id: string;
      itemNumber: string;
      status: string;
      equipmentTypeId: string;
      result: null | Record<string, unknown>;
    }[]
  >();
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
  rackTypeId = types.find((t) => t.name === 'Regál paletový')!.id;
});

describe('inspections', () => {
  it('starts idempotently and lists the scoped items sorted by location with progress', async () => {
    const id = await startLadderInspection();
    const again = await api('PUT', `/api/inspections/${id}`, {
      siteId,
      inspectionDate: '2026-11-03',
      equipmentTypeIds: [ladderTypeId],
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({
      siteName: 'Provozovna Brno',
      leadInspectorName: 'Administrátor',
      equipmentTypeIds: [ladderTypeId],
      status: 'open',
      progress: { total: 15, checked: 0 },
    });

    const items = await itemsOf(id);
    expect(items).toHaveLength(15);
    expect(new Set(items.map((i) => i.equipmentTypeId))).toEqual(new Set([ladderTypeId]));
    // Hala A first, the 4-digit series in Hala C last.
    expect(items[0]!.itemNumber).toBe('10001');
    expect(items.at(-1)!.itemNumber).toBe('4005');

    const open = (await api('GET', '/api/inspections?status=open')).json<{ id: string }[]>();
    expect(open.map((i) => i.id)).toEqual([id]);
  });

  it('records results idempotently, the later one wins, out of service updates the item', async () => {
    const id = await startLadderInspection();
    const [first, second] = await itemsOf(id);

    const ok = result('ok');
    const saved = await api('PUT', `/api/inspections/${id}/results/${first!.id}`, ok, technik);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ outcome: 'ok', recordedByName: 'Jan Technik' });
    const repeat = await api('PUT', `/api/inspections/${id}/results/${first!.id}`, ok, technik);
    expect(repeat.json().version).toBe(saved.json().version);

    // The technician joined the inspection with the first result.
    const detail = (await api('GET', `/api/inspections/${id}`)).json();
    expect(detail.inspectors.map((i: { displayName: string }) => i.displayName)).toEqual([
      'Administrátor',
      'Jan Technik',
    ]);

    const older = result('defect', {
      defectDescription: 'Prasklá příčka',
      recordedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const overruled = await api('PUT', `/api/inspections/${id}/results/${first!.id}`, older);
    expect(overruled.json().outcome).toBe('ok');

    const invalid = await api(
      'PUT',
      `/api/inspections/${id}/results/${second!.id}`,
      result('defect'),
    );
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().issues[0].path).toEqual(['defectDescription']);

    const retire = result('defect', {
      defectDescription: 'Ohnutý žebřík',
      takenOutOfService: true,
    });
    expect(
      (await api('PUT', `/api/inspections/${id}/results/${second!.id}`, retire)).statusCode,
    ).toBe(200);
    const item = (await api('GET', `/api/items/${second!.id}`)).json();
    expect(item.status).toBe('out_of_service');

    const progress = (await api('GET', `/api/inspections/${id}`)).json().progress;
    expect(progress).toEqual({ total: 15, checked: 2, ok: 1, defect: 1, outOfService: 1 });

    const actions = (await ctx.database.db.select().from(auditLog)).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'inspection.start',
        'inspection.result',
        'inspection.result_overruled',
        'item.status',
      ]),
    );
  });

  it('rejects items outside the scope and writes to a closed inspection', async () => {
    const id = await startLadderInspection();
    const rack = (await api('GET', `/api/items?equipmentTypeId=${rackTypeId}&limit=1`)).json()
      .items[0];
    const outside = await api('PUT', `/api/inspections/${id}/results/${rack.id}`, result('ok'));
    expect(outside.statusCode).toBe(409);
    expect(errorCode(outside)).toBe('item_out_of_scope');

    await ctx.database.db.update(inspection).set({ status: 'closed' }).where(eq(inspection.id, id));
    const [first] = await itemsOf(id);
    const closed = await api('PUT', `/api/inspections/${id}/results/${first!.id}`, result('ok'));
    expect(closed.statusCode).toBe(409);
    expect(errorCode(closed)).toBe('inspection_closed');
  });
});

describe('photos', () => {
  it('stores defect, item and inspection photos with thumbnails', async () => {
    const id = await startLadderInspection();
    const [first] = await itemsOf(id);
    const image = await jpeg();
    const resultFields = { owner: 'result', itemId: first!.id, inspectionId: id };

    const early = await uploadPhoto(newId(), resultFields, image);
    expect(early.statusCode).toBe(409);
    expect(errorCode(early)).toBe('result_missing');

    await api(
      'PUT',
      `/api/inspections/${id}/results/${first!.id}`,
      result('defect', { defectDescription: 'Chybí patka' }),
    );
    const photoId = newId();
    const uploaded = await uploadPhoto(photoId, resultFields, image);
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json()).toMatchObject({
      owner: 'result',
      itemId: first!.id,
      inspectionId: id,
      width: 1600,
      height: 1200,
      hasThumbnail: true,
    });
    expect((await uploadPhoto(photoId, resultFields, image)).statusCode).toBe(200);
    expect(
      (await uploadPhoto(newId(), { owner: 'item', itemId: first!.id }, image)).statusCode,
    ).toBe(201);
    expect(
      (await uploadPhoto(newId(), { owner: 'inspection', inspectionId: id }, image)).statusCode,
    ).toBe(201);

    const forItem = (await api('GET', `/api/photos?itemId=${first!.id}&inspectionId=${id}`)).json();
    expect(forItem.map((p: { owner: string }) => p.owner).sort()).toEqual(['item', 'result']);
    const forInspection = (await api('GET', `/api/photos?inspectionId=${id}`)).json();
    expect(forInspection.map((p: { owner: string }) => p.owner)).toEqual(['inspection']);
    const items = await itemsOf(id);
    expect(items[0]).toMatchObject({ itemPhotoCount: 1, result: { photoCount: 1 } });

    const thumb = await api('GET', `/api/photos/${photoId}/thumbnail`);
    expect(thumb.headers['content-type']).toBe('image/jpeg');
    const meta = await sharp(thumb.rawPayload).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(480);
    expect((await api('GET', `/api/photos/${photoId}/original`)).rawPayload.length).toBe(
      image.length,
    );

    const blocked = await api('DELETE', `/api/inspections/${id}/results/${first!.id}`);
    expect(errorCode(blocked)).toBe('result_has_photos');
    expect((await api('DELETE', `/api/photos/${photoId}`)).statusCode).toBe(204);
    expect((await api('GET', `/api/photos/${photoId}/thumbnail`)).statusCode).toBe(404);
    expect((await api('DELETE', `/api/inspections/${id}/results/${first!.id}`)).statusCode).toBe(
      204,
    );
    expect((await itemsOf(id))[0]!.result).toBeNull();
  });

  it('rejects files that are not images and missing owners', async () => {
    const id = await startLadderInspection();
    const notImage = await uploadPhoto(
      newId(),
      { owner: 'inspection', inspectionId: id },
      Buffer.from('hello'),
    );
    expect(errorCode(notImage)).toBe('invalid_photo');
    const noOwner = await uploadPhoto(newId(), { owner: 'item' }, await jpeg());
    expect(noOwner.statusCode).toBe(400);
    expect(noOwner.json().issues[0].path).toEqual(['itemId']);
  });
});

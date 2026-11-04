import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, permissionsOf } from '@revize/shared';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { exiftool } from 'exiftool-vendored';
import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appUser, photo as photoTable } from '../src/db/schema.js';
import { createExportsService } from '../src/modules/exports/service.js';
import { createInspectionsService } from '../src/modules/inspections/service.js';
import { DEMO_INSPECTOR } from '../src/seed/demo.js';
import { ADMIN, bearer, createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: string;
let siteId: string;
let ladderTypeId: string;

type Method = 'GET' | 'PUT' | 'POST' | 'PATCH';
const api = (method: Method, url: string, payload?: unknown, as = admin) =>
  ctx.app.inject({ method, url, headers: bearer(as), ...(payload ? { payload } : {}) });

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await exiftool.end();
  await ctx.app.close();
  await ctx.database.close();
});
beforeEach(async () => {
  await ctx.reset({ seedDemo: true });
  admin = (await ctx.login(ADMIN.email, ADMIN.password)).token;
  const customers = (await api('GET', '/api/customers')).json<{ id: string }[]>();
  siteId = (await api('GET', `/api/customers/${customers[0]!.id}/sites`)).json<
    { id: string }[]
  >()[0]!.id;
  const types = (await api('GET', '/api/equipment-types')).json<{ id: string; name: string }[]>();
  const ladder = types.find((t) => t.name === 'Žebřík')! as { id: string; version?: number };
  ladderTypeId = ladder.id;
  // These tests check the risk levels (traffic light); ladders are fit / unfit by default
  // (see "fit / unfit" in protocols.test.ts).
  const enabled = await api('PATCH', `/api/equipment-types/${ladderTypeId}`, {
    riskLevels: true,
    version: ladder.version,
  });
  expect(enabled.statusCode, enabled.body).toBe(200);
});

/** Ladder inspection: one OK, one yellow defect with two photos, one overview photo. */
async function inspection() {
  const id = newId();
  await api('PUT', `/api/inspections/${id}`, {
    siteId,
    inspectionDate: '2026-11-03',
    equipmentTypeIds: [ladderTypeId],
  });
  const items = (await api('GET', `/api/inspections/${id}/items`)).json<
    { id: string; itemNumber: string }[]
  >();
  const at = new Date().toISOString();
  await api('PUT', `/api/inspections/${id}/results/${items[0]!.id}`, {
    id: newId(),
    outcome: 'ok',
    recordedAt: at,
  });
  await api('PUT', `/api/inspections/${id}/results/${items[1]!.id}`, {
    id: newId(),
    outcome: 'defect',
    severity: 'amber',
    defectDescription: 'Uvolněná příčka; "č. 3"',
    recordedAt: at,
  });
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#888' } })
    .jpeg()
    .toBuffer();
  const upload = async (fields: Record<string, string>) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'f.jpg');
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/api/photos/${newId()}`,
      headers: bearer(admin),
      payload: form,
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id;
  };
  await upload({ owner: 'result', itemId: items[1]!.id, inspectionId: id });
  await upload({ owner: 'result', itemId: items[1]!.id, inspectionId: id });
  await upload({ owner: 'inspection', inspectionId: id });
  // A photo of the item itself (nameplate), taken by mistake instead of a defect photo.
  const nameplate = await upload({ owner: 'item', itemId: items[1]!.id });
  return { id, items, nameplate };
}

describe('inspection exports', () => {
  it('exports results as XLSX (summary + sheet per type) and CSV for Czech Excel', async () => {
    const { id, items } = await inspection();
    const xlsx = await api('GET', `/api/inspections/${id}/export.xlsx`);
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-disposition']).toContain(
      'kontrola-Provozovna-Brno-2026-11-03.xlsx',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.rawPayload as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Kontrola', 'Žebřík']);
    const sheet = workbook.getWorksheet('Žebřík')!;
    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    expect(headers).toContain('Typ žebříku');
    const defect = (sheet.getRow(3).values as unknown[]).slice(1);
    expect(defect[0]).toBe(items[1]!.itemNumber);
    expect(defect).toContain('Závada – žlutá');
    const n = items[1]!.itemNumber;
    expect(defect).toContain(`${n}_01.jpg, ${n}_02.jpg, ${n}_artikl_01.jpg`);
    expect(sheet.rowCount).toBe(1 + items.length);

    const csv = await api('GET', `/api/inspections/${id}/export.csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.startsWith('﻿Číslo TZ;Označení;Typ vybavení;')).toBe(true);
    expect(csv.body).toContain('"Uvolněná příčka; ""č. 3"""');
    expect(csv.body).toContain('Nezkontrolováno');

    const technik = (await ctx.login(DEMO_INSPECTOR.email, DEMO_INSPECTOR.password)).token;
    expect(
      (await api('GET', `/api/inspections/${id}/export.csv`, undefined, technik)).statusCode,
    ).toBe(200);
  });

  it('exports photos as a ZIP named by item number, with EXIF/IPTC and a photo list', async () => {
    const { id, items } = await inspection();
    // The Export menu shows what the ZIP will contain.
    const list = (await api('GET', `/api/inspections/${id}/photos-list`)).json<{
      files: { fileName: string; exists: boolean }[];
    }>();
    expect(list.files).toHaveLength(4);
    expect(list.files.every((f) => f.exists)).toBe(true);
    const res = await api('GET', `/api/inspections/${id}/photos.zip`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    const raw = new Uint8Array(res.rawPayload);
    // Every entry deflated: a streamed "stored" entry (sizes only after the data) is extracted
    // empty by the macOS Archive Utility. Method of the first local header:
    expect(raw[8]! | (raw[9]! << 8)).toBe(8);
    const zip = unzipSync(raw);
    const number = items[1]!.itemNumber;
    // Item photos (nameplate, overview) go in too, named apart from the defect photos.
    expect(Object.keys(zip).sort()).toEqual(
      [
        `${number}_01.jpg`,
        `${number}_02.jpg`,
        `${number}_artikl_01.jpg`,
        'fotky.csv',
        'kontrola_01.jpg',
      ].sort(),
    );
    expect(strFromU8(zip['fotky.csv']!)).toContain(`${number}_artikl_01.jpg;`);
    expect(strFromU8(zip['fotky.csv']!)).toContain(`${number}_02.jpg;${number};Ž-02;Žebřík;`);

    const dir = await mkdtemp(join(tmpdir(), 'revize-test-'));
    try {
      const path = join(dir, 'photo.jpg');
      await writeFile(path, zip[`${number}_01.jpg`]!);
      const tags = (await exiftool.read(path)) as Record<string, unknown>;
      // ExifTool reads numeric-looking text back as a number.
      expect(String(tags.ObjectName)).toBe(number);
      expect(String(tags['Caption-Abstract'])).toContain('Uvolněná příčka');
      expect(String(tags.ImageDescription)).toContain('Žluté riziko');
      expect((tags.Keywords as unknown[]).map(String)).toEqual(
        expect.arrayContaining([number, 'Žebřík']),
      );
      expect(tags.Copyright).toBeTruthy();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('reports the photo files in Nastavení → Stav serveru', async () => {
    await inspection();
    const status = await api('GET', '/api/server-status');
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json()).toMatchObject({
      photos: 4,
      missingFiles: 0,
      byOwner: { item: 1, result: 2, inspection: 1 },
    });
    // A lost file is counted.
    const [row] = await ctx.database.db.select().from(photoTable).limit(1);
    await ctx.files.delete(row!.storageKey);
    expect((await api('GET', '/api/server-status')).json()).toMatchObject({ missingFiles: 1 });
  });

  it('closing replaces the defect photos of earlier inspections of the same items', async () => {
    const first = await inspection();
    await api('POST', `/api/inspections/${first.id}/close`, {});
    const second = await inspection();
    const preview = await api('GET', `/api/inspections/${second.id}/close-preview`);
    expect(preview.json()).toEqual({ previousDefectPhotos: 2, deletesPreviousDefectPhotos: true });
    await api('POST', `/api/inspections/${second.id}/close`, {});
    const photosOf = async (id: string) =>
      (await api('GET', `/api/photos?inspectionId=${id}&itemId=${first.items[1]!.id}`)).json<
        { owner: string }[]
      >();
    // The first inspection keeps no defect photos, the item photos (nameplate) stay.
    expect((await photosOf(first.id)).map((p) => p.owner).sort()).toEqual(['item', 'item']);
    expect((await photosOf(second.id)).filter((p) => p.owner === 'result')).toHaveLength(2);
    expect((await api('GET', '/api/server-status')).json()).toMatchObject({ missingFiles: 0 });
  });

  it('stores big photos re-encoded within the size limit', async () => {
    const { id, items } = await inspection();
    const big = await sharp({
      create: { width: 4032, height: 3024, channels: 3, background: '#556' },
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    const form = new FormData();
    form.append('owner', 'result');
    form.append('itemId', items[1]!.id);
    form.append('inspectionId', id);
    form.append('file', new Blob([new Uint8Array(big)], { type: 'image/jpeg' }), 'iphone.jpg');
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/api/photos/${newId()}`,
      headers: bearer(admin),
      payload: form,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ width: 1600, height: 1200, mimeType: 'image/jpeg' });
    expect(res.json().sizeBytes).toBeLessThan(700 * 1024);
  });

  it('the ZIP is complete even when the metadata cannot be written', async () => {
    const { id, items } = await inspection();
    const broken = createExportsService(
      ctx.database.db,
      ctx.files,
      createInspectionsService(ctx.database.db),
      {
        write: () => Promise.reject(new Error('exiftool missing')),
        close: () => Promise.resolve(),
      },
    );
    const [user] = await ctx.database.db
      .select()
      .from(appUser)
      .where(eq(appUser.email, ADMIN.email));
    const auth = {
      userId: user!.id,
      organizationId: user!.organizationId,
      role: 'admin' as const,
      permissions: permissionsOf('admin'),
      sessionId: 'test',
      via: 'bearer' as const,
    };
    const file = await broken.photosZip(auth, id);
    const zip = unzipSync(new Uint8Array(await new Response(file.data).arrayBuffer()));
    expect(Object.keys(zip)).toContain(`${items[1]!.itemNumber}_01.jpg`);
    expect(Object.keys(zip)).toContain('fotky.csv');
  });

  it('moves a photo between the item and its defect (office)', async () => {
    const { id, items, nameplate } = await inspection();
    const moved = await api('PUT', `/api/photos/${nameplate}/owner`, {
      owner: 'result',
      inspectionId: id,
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json()).toMatchObject({ owner: 'result', itemId: items[1]!.id, inspectionId: id });
    let zip = unzipSync(
      new Uint8Array((await api('GET', `/api/inspections/${id}/photos.zip`)).rawPayload),
    );
    expect(Object.keys(zip)).toContain(`${items[1]!.itemNumber}_03.jpg`);
    const back = await api('PUT', `/api/photos/${nameplate}/owner`, { owner: 'item' });
    expect(back.json()).toMatchObject({ owner: 'item', itemId: items[1]!.id });
    // The OK item has a result too; a defect-less item without a result cannot get one.
    const noResult = await api('PUT', `/api/photos/${nameplate}/owner`, {
      owner: 'result',
      inspectionId: newId(),
    });
    expect(noResult.statusCode).toBe(404);
    zip = unzipSync(
      new Uint8Array((await api('GET', `/api/inspections/${id}/photos.zip`)).rawPayload),
    );
    expect(Object.keys(zip)).toContain(`${items[1]!.itemNumber}_artikl_01.jpg`);
  });

  it('exports the whole database as CSV and XLSX with the last inspection result', async () => {
    const { items } = await inspection();
    const csv = await api('GET', '/api/exports/items.csv');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-disposition']).toMatch(/evidence-\d{4}-\d{2}-\d{2}\.csv/);
    expect(csv.body.startsWith('\uFEFFZákazník;Provozovna;Číslo TZ;Označení;')).toBe(true);
    const line = csv.body.split('\r\n').find((l) => l.includes(`;${items[1]!.itemNumber};`))!;
    expect(line).toContain('Ukázkový sklad s.r.o.;Provozovna Brno');
    expect(line).toContain('Závada – žlutá');
    expect(line).toContain('Uvolněná příčka');
    // Seeded demo items: 35 rows plus the header.
    expect(csv.body.trim().split('\r\n')).toHaveLength(36);

    const ladderOnly = await api('GET', `/api/exports/items.csv?equipmentTypeId=${ladderTypeId}`);
    expect(ladderOnly.body).not.toContain(';Regál;');

    const xlsx = await api('GET', '/api/exports/items.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.rawPayload as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((w) => w.name)).toEqual(
      expect.arrayContaining(['Vše', 'Regál', 'Žebřík', 'Historie kontrol']),
    );
    expect(workbook.getWorksheet('Vše')!.rowCount).toBe(36);
    const all = workbook.getWorksheet('Vše')!;
    expect((all.getRow(1).values as unknown[]).slice(1)).toEqual(
      expect.arrayContaining(['V provozu', 'Schopno bezpečného provozu']),
    );
    // The history: every result of the exported items (here one OK and one defect).
    const history = workbook.getWorksheet('Historie kontrol')!;
    expect(history.rowCount).toBe(3);
    const historyCsv = await api('GET', '/api/exports/history.csv');
    expect(historyCsv.statusCode).toBe(200);
    expect(historyCsv.headers['cache-control']).toBe('no-store');
    expect(historyCsv.body).toContain('"Uvolněná příčka; ""č. 3"" – žluté riziko"');
  });
});

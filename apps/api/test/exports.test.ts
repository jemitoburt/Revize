import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '@revize/shared';
import ExcelJS from 'exceljs';
import { exiftool } from 'exiftool-vendored';
import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_INSPECTOR } from '../src/seed/demo.js';
import { ADMIN, bearer, createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: string;
let siteId: string;
let ladderTypeId: string;

type Method = 'GET' | 'PUT' | 'POST';
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
  ladderTypeId = types.find((t) => t.name === 'Žebřík')!.id;
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
  };
  await upload({ owner: 'result', itemId: items[1]!.id, inspectionId: id });
  await upload({ owner: 'result', itemId: items[1]!.id, inspectionId: id });
  await upload({ owner: 'inspection', inspectionId: id });
  return { id, items };
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
    expect(defect).toContain(`${items[1]!.itemNumber}_01.jpg, ${items[1]!.itemNumber}_02.jpg`);
    expect(sheet.rowCount).toBe(1 + items.length);

    const csv = await api('GET', `/api/inspections/${id}/export.csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.startsWith('﻿Kontrolní číslo;Typ vybavení;')).toBe(true);
    expect(csv.body).toContain('"Uvolněná příčka; ""č. 3"""');
    expect(csv.body).toContain('Nezkontrolováno');

    const technik = (await ctx.login(DEMO_INSPECTOR.email, DEMO_INSPECTOR.password)).token;
    expect(
      (await api('GET', `/api/inspections/${id}/export.csv`, undefined, technik)).statusCode,
    ).toBe(200);
  });

  it('exports photos as a ZIP named by item number, with EXIF/IPTC and a photo list', async () => {
    const { id, items } = await inspection();
    const res = await api('GET', `/api/inspections/${id}/photos.zip`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    const zip = unzipSync(new Uint8Array(res.rawPayload));
    const number = items[1]!.itemNumber;
    expect(Object.keys(zip).sort()).toEqual(
      [`${number}_01.jpg`, `${number}_02.jpg`, 'fotky.csv', 'kontrola_01.jpg'].sort(),
    );
    expect(strFromU8(zip['fotky.csv']!)).toContain(`${number}_02.jpg;${number};Žebřík;`);

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
});

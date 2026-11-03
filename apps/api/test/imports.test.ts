import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bearer, createTestContext, errorCode, type TestContext } from './helpers.js';

let ctx: TestContext;
let token: string;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.database.close();
});
beforeEach(async () => {
  await ctx.reset();
  token = (await ctx.login(ADMIN.email, ADMIN.password)).token;
});

async function api(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, as = token) {
  return ctx.app.inject({ method, url, headers: bearer(as), ...(payload ? { payload } : {}) });
}

async function upload(fileName: string, content: Buffer, as = token) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(content)]), fileName);
  return ctx.app.inject({
    method: 'POST',
    url: '/api/imports',
    headers: bearer(as),
    payload: form,
  });
}

/** Encodes Czech text as Windows-1250, like CSV exported from Czech Excel. */
function cp1250(text: string): Buffer {
  const map: Record<string, number> = {
    Ž: 0x8e,
    ž: 0x9e,
    Š: 0x8a,
    š: 0x9a,
    č: 0xe8,
    Č: 0xc8,
    ř: 0xf8,
    Ř: 0xd8,
    í: 0xed,
    á: 0xe1,
    é: 0xe9,
    ě: 0xec,
    ý: 0xfd,
    ů: 0xf9,
    ú: 0xfa,
  };
  return Buffer.from([...text].map((c) => map[c] ?? c.charCodeAt(0)));
}

async function setup() {
  const customer = (await api('POST', '/api/customers', { name: 'Sklad' })).json();
  const site = (await api('POST', `/api/customers/${customer.id}/sites`, { name: 'Brno' })).json();
  const hall = (
    await api('POST', `/api/sites/${site.id}/locations`, { parentId: null, name: 'Hala A' })
  ).json();
  const ladder = (
    await api('POST', '/api/equipment-types', { presetKey: 'portable_ladder' })
  ).json();
  return { customer, site, hall, ladder };
}

const CSV = [
  'Ev. číslo;Hala;Řada;Výrobce;Typ žebříku;Počet příček;Příští revize',
  '04001;Hala A;Řada 1;Alve;opěrný;9;14.11.2026',
  '4002;hala a;Řada 2;Krause;Dvojitý (štaflový);6;',
  ';;;;;;',
  '4003;Hala A;Řada 1;Hailo;Kolo;deset;31.2.2026',
  '4001;Hala A;Řada 1;Alve;Opěrný;9;',
  ';Hala B;;Zarges;Opěrný;12;',
].join('\r\n');

describe('import', () => {
  it('parses Czech CSV, suggests the mapping and reports problems per row without writing', async () => {
    const { site, ladder } = await setup();
    const job = (await upload('seznam.csv', cp1250(CSV))).json();
    expect(job).toMatchObject({
      headerRow: 1,
      rowCount: 6,
      headers: expect.arrayContaining(['Výrobce', 'Řada']),
    });

    const suggestion = (
      await api('GET', `/api/imports/${job.id}/suggestion?equipmentTypeId=${ladder.id}`)
    ).json();
    expect(suggestion).toMatchObject({
      itemNumber: 0,
      location: [1, 2],
      nextInspectionDate: 6,
      fromSavedMapping: false,
    });
    expect(suggestion.fields).toMatchObject({ manufacturer: 3, ladder_type: 4, rungs: 5 });

    const mapping = { siteId: site.id, equipmentTypeId: ladder.id, ...suggestion };
    const report = (await api('POST', `/api/imports/${job.id}/validate`, { mapping })).json();
    expect(report.summary).toEqual({
      total: 6,
      create: 4,
      update: 0,
      skip: 1,
      error: 1,
      warning: 1,
    });
    const byRow = Object.fromEntries(
      report.rows.map((r: { rowNumber: number }) => [r.rowNumber, r]),
    );
    expect(byRow[2]).toMatchObject({
      action: 'create',
      itemNumber: '4001',
      locationPath: ['Hala A', 'Řada 1'],
    });
    expect(byRow[4]).toMatchObject({ action: 'skip' });
    // Formats are not locked hard: the row imports, its problems are warnings.
    expect(byRow[5]).toMatchObject({ action: 'create', issues: [] });
    const warnings5 = byRow[5].warnings.map(
      (i: { header: string; message: string }) => `${i.header}: ${i.message}`,
    );
    expect(warnings5).toEqual([
      'Příští revize: „31.2.2026“ není datum (např. 31.12.2026) – nepřevzato',
      'Typ žebříku: „Kolo“ je nová hodnota číselníku – přidá se',
      'Počet příček: „deset“ není číslo – uloženo jako text',
    ]);
    expect(report.newOptions).toEqual([
      { fieldKey: 'ladder_type', label: 'Typ žebříku', values: ['Kolo'] },
    ]);
    expect(byRow[6].issues[0].message).toBe('Číslo 4001 je v souboru už na řádku 2');
    expect(byRow[7]).toMatchObject({
      action: 'create',
      itemNumber: null,
      locationPath: ['Hala B'],
    });
    // "hala a" matches the existing Hala A; Řada 1, Řada 2 and Hala B are new.
    expect(report.newLocations).toEqual(
      expect.arrayContaining([['Hala A', 'Řada 1'], ['hala a', 'Řada 2'], ['Hala B']]),
    );

    expect((await api('GET', `/api/items?siteId=${site.id}`)).json().total).toBe(0);
  });

  it('commits only without errors (or skipping them), creates locations and numbers, once', async () => {
    const { site, ladder } = await setup();
    await api('POST', '/api/items', {
      siteId: site.id,
      locationId: null,
      equipmentTypeId: ladder.id,
      itemNumber: '9000',
      fieldValues: { manufacturer: 'Alve', ladder_type: 'Opěrný', rungs: 5 },
    });
    const job = (await upload('seznam.csv', Buffer.from(CSV, 'utf8'))).json();
    const suggestion = (
      await api('GET', `/api/imports/${job.id}/suggestion?equipmentTypeId=${ladder.id}`)
    ).json();
    const mapping = { siteId: site.id, equipmentTypeId: ladder.id, ...suggestion };

    const blocked = await api('POST', `/api/imports/${job.id}/commit`, { mapping });
    expect(errorCode(blocked)).toBe('import_has_errors');

    const result = (
      await api('POST', `/api/imports/${job.id}/commit`, { mapping, skipErrors: true })
    ).json();
    expect(result).toEqual({ created: 4, updated: 0, skipped: 2, locationsCreated: 3 });

    const items = (await api('GET', `/api/items?siteId=${site.id}&sort=itemNumber`)).json().items;
    expect(
      items.map((i: { itemNumber: string; locationPath: string[] }) => [
        i.itemNumber,
        i.locationPath.join(' › '),
      ]),
    ).toEqual([
      ['4001', 'Hala A › Řada 1'],
      ['4002', 'Hala A › Řada 2'],
      ['4003', 'Hala A › Řada 1'],
      ['9000', ''],
      ['9001', 'Hala B'], // automatic number after the highest one
    ]);
    expect(items[0]).toMatchObject({
      fieldValues: { manufacturer: 'Alve', ladder_type: 'Opěrný', rungs: 9 },
      nextInspectionDate: '2026-11-14',
    });
    // Kept as imported; the new option value is now part of the type's list.
    expect(items[2].fieldValues).toMatchObject({ ladder_type: 'Kolo', rungs: 'deset' });
    const type = (await api('GET', `/api/equipment-types/${ladder.id}`)).json();
    const ladderType = type.fieldDefinitions.find((f: { key: string }) => f.key === 'ladder_type');
    expect(ladderType.options).toContain('Kolo');

    const locations = (await api('GET', `/api/sites/${site.id}/locations`)).json();
    expect(locations.map((l: { pathNames: string[] }) => l.pathNames.join(' › '))).toEqual([
      'Hala A',
      'Hala A › Řada 1',
      'Hala A › Řada 2',
      'Hala B',
    ]);
    const audit = (await api('GET', `/api/audit?entityType=item&entityId=${items[0].id}`)).json();
    expect(audit[0]).toMatchObject({ action: 'item.import' });

    expect(
      errorCode(await api('POST', `/api/imports/${job.id}/commit`, { mapping, skipErrors: true })),
    ).toBe('import_committed');
  });

  it('updates existing items in upsert mode without clearing values that are not in the file', async () => {
    const { site, hall, ladder } = await setup();
    await api('POST', '/api/items', {
      siteId: site.id,
      locationId: hall.id,
      equipmentTypeId: ladder.id,
      itemNumber: '4001',
      qrCode: 'R4001',
      fieldValues: { manufacturer: 'Alve', ladder_type: 'Opěrný', rungs: 9, year: 2018 },
    });
    const job = (
      await upload('zmeny.csv', Buffer.from('Číslo,Počet příček,Výrobce\n4001,12,\n', 'utf8'))
    ).json();
    const suggestion = (
      await api('GET', `/api/imports/${job.id}/suggestion?equipmentTypeId=${ladder.id}`)
    ).json();

    const asCreate = { siteId: site.id, equipmentTypeId: ladder.id, ...suggestion };
    const report = (
      await api('POST', `/api/imports/${job.id}/validate`, { mapping: asCreate })
    ).json();
    expect(report.rows[0].issues.map((i: { message: string }) => i.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('už v evidenci je')]),
    );

    const mapping = { ...asCreate, mode: 'upsert' };
    expect(
      (await api('POST', `/api/imports/${job.id}/validate`, { mapping })).json().summary.update,
    ).toBe(1);
    expect((await api('POST', `/api/imports/${job.id}/commit`, { mapping })).json()).toMatchObject({
      updated: 1,
      created: 0,
    });

    const [updated] = (await api('GET', `/api/items?siteId=${site.id}`)).json().items;
    expect(updated).toMatchObject({
      qrCode: 'R4001',
      locationPath: ['Hala A'],
      version: 2,
      fieldValues: { manufacturer: 'Alve', ladder_type: 'Opěrný', rungs: 12, year: 2018 },
    });
  });

  it('remembers the mapping per type and imports a filled template without mapping', async () => {
    const { site, ladder } = await setup();
    const template = await api('GET', `/api/equipment-types/${ladder.id}/import-template`);
    expect(template.headers['content-type']).toContain('spreadsheetml');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(template.rawPayload as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('Artikly')!;
    const headers = (sheet.getRow(1).values as string[]).slice(1);
    expect(headers.slice(0, 7)).toEqual([
      'Číslo TZ',
      'Označení',
      'QR kód',
      'Hala',
      'Řada',
      'Pozice',
      'Příští kontrola',
    ]);
    expect(workbook.getWorksheet('Nápověda')).toBeDefined();

    const values: Record<string, unknown> = {
      'Číslo TZ': 10001,
      Označení: 'Ž-07',
      'QR kód': 'R10001',
      Hala: 'Hala A',
      Řada: 'Řada 3',
      Pozice: 'Pozice 12',
      'Příští kontrola': new Date(Date.UTC(2027, 0, 31)),
      Výrobce: 'Hymer',
      'Typ žebříku': 'Teleskopický',
      'Počet příček / stupňů na díl': 11,
      'Příčný stabilizátor': 'ano',
    };
    sheet.addRow(headers.map((h) => values[h] ?? null));
    const filled = Buffer.from(await workbook.xlsx.writeBuffer());

    const job = (await upload('sablona.xlsx', filled)).json();
    expect(job.sheets).toEqual(['Artikly', 'Nápověda']);
    const suggestion = (
      await api('GET', `/api/imports/${job.id}/suggestion?equipmentTypeId=${ladder.id}`)
    ).json();
    expect(Object.values(suggestion.fields).filter((v) => v !== null)).toHaveLength(13);
    const mapping = { siteId: site.id, equipmentTypeId: ladder.id, ...suggestion };
    expect((await api('POST', `/api/imports/${job.id}/commit`, { mapping })).json().created).toBe(
      1,
    );

    const [created] = (await api('GET', `/api/items?siteId=${site.id}`)).json().items;
    expect(created).toMatchObject({
      itemNumber: '10001',
      designation: 'Ž-07',
      qrCode: 'R10001',
      locationPath: ['Hala A', 'Řada 3', 'Pozice 12'],
      nextInspectionDate: '2027-01-31',
      fieldValues: {
        manufacturer: 'Hymer',
        ladder_type: 'Teleskopický',
        rungs: 11,
        stabilizer: true,
      },
    });

    // Next file with differently named columns: the saved mapping is offered by header name.
    const next = (
      await upload('dalsi.csv', Buffer.from('Číslo artiklu,Výrobce\n10002,Alve\n'))
    ).json();
    const again = (
      await api('GET', `/api/imports/${next.id}/suggestion?equipmentTypeId=${ladder.id}`)
    ).json();
    expect(again).toMatchObject({
      fromSavedMapping: true,
      itemNumber: 0,
      fields: { manufacturer: 1 },
    });
  });

  it('rejects unsupported files and needs the import permission', async () => {
    expect(errorCode(await upload('stary.xls', Buffer.from('x')))).toBe('invalid_file');
    await api('POST', '/api/users', {
      email: 't@test.cz',
      displayName: 'T',
      role: 'inspector',
      password: 'technik-heslo-1',
    });
    const { token: inspector } = await ctx.login('t@test.cz', 'technik-heslo-1');
    expect((await upload('a.csv', Buffer.from('a\n1'), inspector)).statusCode).toBe(403);
  });
});

describe('import value replacements and defaults', () => {
  it('lists column values, replaces values, fills defaults and remembers both', async () => {
    const { site, ladder } = await setup();
    const job = (await upload('seznam.csv', Buffer.from(CSV, 'utf8'))).json();
    const values = (await api('GET', `/api/imports/${job.id}/columns/4/values`)).json();
    expect(values).toEqual(
      expect.arrayContaining([
        { value: 'Opěrný', count: 2 },
        { value: 'Kolo', count: 1 },
      ]),
    );

    const suggestion = (
      await api('GET', `/api/imports/${job.id}/suggestion?equipmentTypeId=${ladder.id}`)
    ).json();
    const mapping = {
      ...suggestion,
      siteId: site.id,
      equipmentTypeId: ladder.id,
      replacements: { ladder_type: [{ from: 'Kolo', to: 'Opěrný' }] },
      defaults: { max_load_kg: '150 kg' },
    };
    delete mapping.fromSavedMapping;
    const report = (await api('POST', `/api/imports/${job.id}/validate`, { mapping })).json();
    expect(report.newOptions).toEqual([]);
    await api('POST', `/api/imports/${job.id}/commit`, { mapping, skipErrors: true });
    const items = (await api('GET', `/api/items?siteId=${site.id}&sort=itemNumber`)).json().items;
    const item4003 = items.find((i: { itemNumber: string }) => i.itemNumber === '4003');
    expect(item4003.fieldValues).toMatchObject({ ladder_type: 'Opěrný', max_load_kg: 150 });
    expect(
      items.every(
        (i: { fieldValues: { max_load_kg: number } }) => i.fieldValues.max_load_kg === 150,
      ),
    ).toBe(true);

    // The next file of the same type gets them back with the mapping.
    const next = (await upload('dalsi.csv', Buffer.from(CSV, 'utf8'))).json();
    const remembered = (
      await api('GET', `/api/imports/${next.id}/suggestion?equipmentTypeId=${ladder.id}`)
    ).json();
    expect(remembered).toMatchObject({
      replacements: { ladder_type: [{ from: 'Kolo', to: 'Opěrný' }] },
      defaults: { max_load_kg: '150 kg' },
    });
  });
});

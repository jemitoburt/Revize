import { newId } from '@revize/shared';
import { eq } from 'drizzle-orm';
import { strFromU8, unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
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

type Method = 'GET' | 'PUT' | 'POST' | 'DELETE' | 'PATCH';
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
        protocolIssueDate: '01.10.2026',
        protocolVersion: '1',
        pageFooter: 'BOZP • PO • REVIZE',
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

  it('prints the traffic light, leaves out minor defects not to include, filters by type', async () => {
    const { id, items } = await inspectionWithResults();
    await api(
      'PUT',
      `/api/inspections/${id}/results/${items[2]!.id}`,
      result('defect', {
        defectDescription: 'Odřený lak',
        severity: 'green',
        includeInProtocol: false,
      }),
    );
    const listed = (await api('GET', `/api/inspections/${id}/items`)).json();
    expect(listed[2].result).toMatchObject({ severity: 'green', includeInProtocol: false });
    expect(listed[1].result).toMatchObject({ severity: 'red', takenOutOfService: true });

    const html = (await api('GET', `/api/inspections/${id}/protocol.html`)).body;
    expect(html).toContain('Červené riziko (1)');
    expect(html).toContain('Prasklá příčka');
    expect(html).not.toContain('Odřený lak');

    const racks = (await api('GET', '/api/equipment-types'))
      .json()
      .find((t: { name: string }) => t.name === 'Regál');
    const onlyRacks = (
      await api('GET', `/api/inspections/${id}/protocol.html?equipmentTypeId=${racks.id}`)
    ).body;
    expect(onlyRacks).not.toContain('Prasklá příčka');
    expect(onlyRacks).not.toContain('<h3>Žebříky a schůdky</h3>');
  });

  it('rates types without risk levels as fit / unfit; office leaves photos out', async () => {
    const type = (await api('GET', `/api/equipment-types/${ladderTypeId}`)).json<{
      version: number;
    }>();
    const off = await api('PATCH', `/api/equipment-types/${ladderTypeId}`, {
      riskLevels: false,
      version: type.version,
    });
    expect(off.json()).toMatchObject({ riskLevels: false });
    const { id, items } = await inspectionWithResults();
    // A minor level sent for a fit / unfit type is stored as unfit: out of service.
    const amber = await api(
      'PUT',
      `/api/inspections/${id}/results/${items[2]!.id}`,
      result('defect', { severity: 'amber', defectDescription: 'Uvolněná patka' }),
    );
    expect(amber.json()).toMatchObject({ severity: 'red', takenOutOfService: true });
    // A defect not preventing safe operation (green): recorded, stays in use, always printed.
    const minor = await api(
      'PUT',
      `/api/inspections/${id}/results/${items[3]!.id}`,
      result('defect', {
        severity: 'green',
        defectDescription: 'Chybí štítek',
        includeInProtocol: false,
      }),
    );
    expect(minor.json()).toMatchObject({
      severity: 'green',
      takenOutOfService: false,
      includeInProtocol: true,
    });
    let html = (await api('GET', `/api/inspections/${id}/protocol.html`)).body;
    expect(html).toContain('Závady bránící bezpečnému provozu (2)');
    expect(html).toContain('Závady nebránící bezpečnému provozu (1)');
    expect(html).not.toContain('riziko');
    expect(html).toContain('Uvolněná patka – nevyhovuje');
    expect(html).toContain('Chybí štítek – závada nebránící bezpečnému provozu');
    // Only red defects chosen: the fit / unfit groups stay.
    const redOnly = (await api('GET', `/api/inspections/${id}/protocol.html?defects=red`)).body;
    expect(redOnly).toContain('Závady nebránící bezpečnému provozu (1)');
    expect(html).toContain('data:image/jpeg;base64,');

    // The office leaves the photos of one defect out of the protocol (audited).
    const photos = await api(
      'PUT',
      `/api/inspections/${id}/results/${items[1]!.id}/photos-in-protocol`,
      { photosInProtocol: false },
    );
    expect(photos.statusCode, photos.body).toBe(200);
    expect(photos.json()).toMatchObject({ photosInProtocol: false });
    html = (await api('GET', `/api/inspections/${id}/protocol.html`)).body;
    expect(html).toContain('Prasklá příčka');
    expect(html).not.toContain('data:image/jpeg;base64,');
    const listed = (await api('GET', `/api/inspections/${id}/items`)).json<
      { id: string; result: { photosInProtocol: boolean } | null }[]
    >();
    expect(listed.find((i) => i.id === items[1]!.id)!.result!.photosInProtocol).toBe(false);
    // Read-only once closed.
    await api('POST', `/api/inspections/${id}/close`, {});
    const closed = await api(
      'PUT',
      `/api/inspections/${id}/results/${items[1]!.id}/photos-in-protocol`,
      { photosInProtocol: true },
    );
    expect(closed.statusCode).toBe(409);
  });

  it('renders the protocol as HTML and PDF, draft until closed', async () => {
    const { id, items } = await inspectionWithResults();
    await api(
      'PUT',
      `/api/inspections/${id}/results/${items[2]!.id}`,
      result('defect', { severity: 'amber', defectDescription: 'Uvolněná patka' }),
    );
    const html = (await api('GET', `/api/inspections/${id}/protocol.html`)).body;
    expect(html).toContain('Protokol o kontrole technického vybavení');
    expect(html).toContain('PŘEDBĚŽNÝ PROTOKOL');
    expect(html).toContain('Ukázkový sklad s.r.o.');
    expect(html).toContain('Prasklá příčka');
    // The defect card under its risk level (explained once in the group heading).
    expect(html).toContain('Červené riziko (1)<span>okamžitě vyprázdnit a vyřadit z užívání');
    // The photo at 300 dpi of its printed size (layout: 50 mm high).
    expect(html).toMatch(/style="height:50mm;width:\d+(\.\d)?mm"/);
    // Only red defects get cards: the green one is left out of the cards.
    const redOnly = (await api('GET', `/api/inspections/${id}/protocol.html?defects=red`)).body;
    expect(html).toContain('Žluté riziko (1)');
    expect(redOnly).toContain('Červené riziko (1)');
    expect(redOnly).not.toContain('Žluté riziko (');
    // The table on page 1 names the level in short only.
    expect(html).toContain('Prasklá příčka – červené riziko');
    expect(html).toContain('Uvolněná patka – žluté riziko');
    // PDF and Word follow the choice too.
    const redDocx = await api('GET', `/api/inspections/${id}/protocol.docx?defects=red`);
    const allDocx = await api('GET', `/api/inspections/${id}/protocol.docx`);
    expect(redDocx.rawPayload.length).toBeLessThan(allDocx.rawPayload.length);
    expect(html).toContain('data:image/jpeg;base64,');
    // Only the protocol text of the type in the protocol.
    expect(html).toContain('<h3>Žebříky a schůdky</h3>');
    expect(html).not.toContain('<h3>Regály</h3>');
    expect(html).not.toContain('{{');

    const pdf = await api('GET', `/api/inspections/${id}/protocol.pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('protokol-Provozovna-Brno-2026-11-03.pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.rawPayload.length).toBeGreaterThan(20_000);

    // Appendix for the customer with the chosen columns.
    const columns = (await api('GET', `/api/inspections/${id}/protocol-columns`)).json();
    expect(columns.map((c: { key: string }) => c.key)).toEqual(
      expect.arrayContaining(['itemNumber', 'designation', 'result', 'field:manufacturer']),
    );
    const withList = (
      await api(
        'GET',
        `/api/inspections/${id}/protocol.html?appendix=always&columns=itemNumber,field:manufacturer,result,unknown`,
      )
    ).body;
    expect(withList).toContain('Příloha 1 – tabulka kontrolovaného vybavení');
    expect(withList).toContain('Kontrolované vybavení viz Příloha 1');
    expect(withList).toContain('<th class="grey">Číslo TZ</th><th class="grey">Výrobce</th>');
    // Not fit for safe operation (the red defect): bold and red.
    expect(withList).toContain('<tr class="unsafe"><td>');
    const docxList = await api(
      'GET',
      `/api/inspections/${id}/protocol.docx?appendix=always&columns=itemNumber`,
    );
    const listXml = strFromU8(unzipSync(new Uint8Array(docxList.rawPayload))['word/document.xml']!);
    expect(listXml).toContain('Příloha');
    expect(listXml).toContain('w:orient="landscape"');
    expect(listXml).toContain('w:color w:val="E00000"');
    // The appendix pages of the PDF are A4 landscape, the protocol stays portrait.
    const listPdf = await PDFDocument.load(
      (
        await api(
          'GET',
          `/api/inspections/${id}/protocol.pdf?appendix=always&columns=itemNumber,result,defect`,
        )
      ).rawPayload,
    );
    const widths = listPdf.getPages().map((p) => Math.round(p.getWidth()));
    expect(widths[0]).toBe(595);
    expect(widths.at(-1)).toBe(842);
    if (process.env.PROTOCOL_SAMPLE) {
      const fs = await import('node:fs');
      fs.writeFileSync(process.env.PROTOCOL_SAMPLE, await listPdf.save());
    }

    // Příloha 1 on its own (landscape only, with the page header).
    const alone = await api('GET', `/api/inspections/${id}/protocol.pdf?part=appendix`);
    expect(alone.headers['content-disposition']).toContain('priloha-1-');
    const alonePdf = await PDFDocument.load(alone.rawPayload);
    expect(alonePdf.getPages().every((p) => Math.round(p.getWidth()) === 842)).toBe(true);
    const aloneHtml = (await api('GET', `/api/inspections/${id}/protocol.html?part=appendix`)).body;
    expect(aloneHtml).toContain('Příloha 1 – tabulka kontrolovaného vybavení');
    expect(aloneHtml).not.toContain('PŘI VÝSLEDKU');

    // Two A4 pages on one landscape A4 sheet.
    const twoUp = await api('GET', `/api/inspections/${id}/protocol.pdf?layout=two-up`);
    expect(twoUp.headers['content-disposition']).toContain('-2-na-list.pdf');
    const sheets = await PDFDocument.load(twoUp.rawPayload);
    const pages = await PDFDocument.load(pdf.rawPayload);
    expect(sheets.getPageCount()).toBe(Math.ceil(pages.getPageCount() / 2));
    const { width, height } = sheets.getPage(0).getSize();
    expect(Math.round(width)).toBe(842);
    expect(Math.round(height)).toBe(595);

    // Word: a DOCX (ZIP) with the texts, the table and the photo.
    const docx = await api('GET', `/api/inspections/${id}/protocol.docx`);
    expect(docx.headers['content-type']).toContain('wordprocessingml');
    const files = unzipSync(new Uint8Array(docx.rawPayload));
    const xml = strFromU8(files['word/document.xml']!);
    expect(xml).toContain('Protokol o kontrole technického vybavení');
    expect(xml).toContain('Prasklá příčka');
    expect(xml).toContain('Žebříky a schůdky');
    expect(Object.keys(files).some((f) => f.startsWith('word/media/'))).toBe(true);
    expect(strFromU8(files['word/header1.xml']!)).toContain('Datum vydání');

    await api('POST', `/api/inspections/${id}/close`, {});
    const final = (await api('GET', `/api/inspections/${id}/protocol.html`)).body;
    expect(final).not.toContain('PŘEDBĚŽNÝ PROTOKOL');
  }, 60_000);
});

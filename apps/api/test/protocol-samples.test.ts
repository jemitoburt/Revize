/**
 * Sample protocols for checking the layout by eye (not part of the normal test run):
 * PROTOCOL_SAMPLES=<folder> pnpm vitest run --project api test/protocol-samples.test.ts
 * Builds ten inspections with different numbers of items, defects, photos and halls through the
 * API and writes their PDF protocols and a summary (summary.json) into the folder.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, protocolLayout } from '@revize/shared';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, bearer, createTestContext, type TestContext } from './helpers.js';

const out = process.env.PROTOCOL_SAMPLES;

interface Scenario {
  name: string;
  items: number;
  defects: number;
  halls: number;
  photos: (i: number) => number;
}

const SCENARIOS: Scenario[] = [
  { name: '01-maly-sklad', items: 10, defects: 2, halls: 1, photos: () => 1 },
  { name: '02-dve-haly', items: 20, defects: 5, halls: 2, photos: () => 1 },
  { name: '03-tri-haly', items: 30, defects: 10, halls: 3, photos: (i) => 1 + (i % 2) },
  { name: '04-ctyri-haly', items: 40, defects: 15, halls: 4, photos: () => 1 },
  { name: '05-stredni', items: 60, defects: 25, halls: 3, photos: (i) => 1 + (i % 2) },
  { name: '06-vetsi-2-fotky', items: 80, defects: 35, halls: 4, photos: () => 2 },
  { name: '07-velky-1-3-fotky', items: 100, defects: 45, halls: 4, photos: (i) => 1 + (i % 3) },
  { name: '08-velky', items: 120, defects: 60, halls: 5, photos: () => 1 },
  { name: '09-bez-fotek', items: 50, defects: 20, halls: 2, photos: () => 0 },
  { name: '10-extremni', items: 150, defects: 80, halls: 6, photos: () => 1 },
];

const DESCRIPTIONS = [
  'Ohnutý sloupek',
  'Chybí pojistka nosníku',
  'Ohnutý sloupek nad patkou, poškozená ochrana stojiny',
  'Prasklý svar diagonály rámu',
  'Uvolněné kotvení patky',
  'Deformovaný nosník, přetížená úroveň',
];
const SEVERITIES = ['red', 'amber', 'amber', 'green'] as const;

describe.skipIf(!out)('sample protocols', () => {
  let ctx: TestContext;
  let token: string;
  const api = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
    ctx.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    ctx = await createTestContext();
    await ctx.reset();
    token = (await ctx.login(ADMIN.email, ADMIN.password)).token;
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.database.close();
  });

  it('writes ten protocols', async () => {
    // A photo like from a phone: 2000 × 1500 with structure, so JPEG sizes are realistic.
    const photo = await sharp({
      create: {
        width: 2000,
        height: 1500,
        channels: 3,
        background: '#7a7f88',
        noise: { type: 'gaussian', mean: 120, sigma: 40 },
      },
    })
      .jpeg({ quality: 85 })
      .toBuffer();
    const rack = (await api('POST', '/api/equipment-types', { presetKey: 'rack' })).json();
    const summary: Record<string, unknown>[] = [];
    let next = 10001;

    for (const scenario of SCENARIOS) {
      const customer = (
        await api('POST', '/api/customers', { name: `Sklad ${scenario.name} s.r.o.` })
      ).json();
      const site = (
        await api('POST', `/api/customers/${customer.id}/sites`, {
          name: `Provozovna ${scenario.name}`,
        })
      ).json();
      // Halls › rows › positions.
      const positions: string[] = [];
      for (let h = 0; h < scenario.halls; h++) {
        const hall = (
          await api('POST', `/api/sites/${site.id}/locations`, {
            parentId: null,
            name: `Hala ${'ABCDEF'[h]}`,
          })
        ).json();
        for (let r = 1; r <= 3; r++) {
          const row = (
            await api('POST', `/api/sites/${site.id}/locations`, {
              parentId: hall.id,
              name: `Řada ${r}`,
            })
          ).json();
          positions.push(row.id);
        }
      }
      const itemIds: string[] = [];
      for (let i = 0; i < scenario.items; i++) {
        const created = await api('POST', '/api/items', {
          siteId: site.id,
          locationId: positions[i % positions.length],
          equipmentTypeId: rack.id,
          itemNumber: String(next++),
          designation: `${'ABCDEF'[i % scenario.halls]}${1 + (i % 3)}-${String(i + 1).padStart(2, '0')}`,
          fieldValues: {
            rack_type: 'Paletový',
            manufacturer: ['Mecalux', 'Stow', 'Dexion'][i % 3],
          },
        });
        expect(created.statusCode, created.body).toBe(201);
        itemIds.push(created.json().id);
      }
      const inspectionId = newId();
      await api('PUT', `/api/inspections/${inspectionId}`, {
        siteId: site.id,
        inspectionDate: '2026-11-03',
      });
      const list = (await api('GET', `/api/inspections/${inspectionId}/items`)).json() as {
        id: string;
      }[];
      // Defects spread over the whole list (all halls), the rest is OK.
      const step = list.length / Math.max(1, scenario.defects);
      const defective = new Set(
        Array.from({ length: scenario.defects }, (_, k) => list[Math.floor(k * step)]!.id),
      );
      let photoCount = 0;
      for (const [index, item] of list.entries()) {
        const isDefect = defective.has(item.id);
        const severity = SEVERITIES[index % SEVERITIES.length]!;
        await api('PUT', `/api/inspections/${inspectionId}/results/${item.id}`, {
          id: newId(),
          outcome: isDefect ? 'defect' : 'ok',
          recordedAt: new Date().toISOString(),
          ...(isDefect
            ? { severity, defectDescription: DESCRIPTIONS[index % DESCRIPTIONS.length] }
            : {}),
        });
        if (!isDefect) continue;
        for (let p = 0; p < scenario.photos(index); p++) {
          const form = new FormData();
          form.append('owner', 'result');
          form.append('itemId', item.id);
          form.append('inspectionId', inspectionId);
          form.append('file', new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), 'f.jpg');
          const uploaded = await ctx.app.inject({
            method: 'PUT',
            url: `/api/photos/${newId()}`,
            headers: bearer(token),
            payload: form,
          });
          expect(uploaded.statusCode).toBe(201);
          photoCount++;
        }
      }
      await api('POST', `/api/inspections/${inspectionId}/close`, {});
      const pdf = await api('GET', `/api/inspections/${inspectionId}/protocol.pdf`);
      expect(pdf.statusCode).toBe(200);
      const docx = await api('GET', `/api/inspections/${inspectionId}/protocol.docx`);
      writeFileSync(join(out!, `${scenario.name}.docx`), docx.rawPayload);
      const file = join(out!, `${scenario.name}.pdf`);
      writeFileSync(file, pdf.rawPayload);
      const pages = Number(
        /Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [file], { encoding: 'utf8' }))![1],
      );
      // The layout the protocol used (same data as the PDF, photos only counted).
      const html = (await api('GET', `/api/inspections/${inspectionId}/protocol.html`)).body;
      const photoHeight = /height:(\d+)mm;width/.exec(html)?.[1] ?? '–';
      const columns = /class="flow c(\d)"/.exec(html)?.[1] ?? '–';
      summary.push({
        protocol: scenario.name,
        items: scenario.items,
        defects: scenario.defects,
        halls: scenario.halls,
        photos: photoCount,
        pages,
        photoHeightMm: photoHeight,
        columns,
        appendix: html.includes('Kontrolované vybavení viz Příloha 1'),
        sizeKb: Math.round(pdf.rawPayload.length / 1024),
      });
      void protocolLayout;
    }
    writeFileSync(join(out!, 'summary.json'), JSON.stringify(summary, null, 2));
    console.table(summary);
  }, 1_800_000);
});

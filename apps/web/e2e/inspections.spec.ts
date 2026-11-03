import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createData, login } from './field/helpers.js';

test('office: company settings, inspection overview, protocol PDF, close and reopen', async ({
  page,
}) => {
  await login(page, 'admin@revize.local', 'admin-heslo-123');
  await expect(page.getByRole('heading', { name: 'Zákazníci' })).toBeVisible();
  const { site, type } = await createData(page.request, ' kancelář');

  // Company details for the protocol header.
  await page.getByRole('navigation').getByRole('link', { name: 'Nastavení' }).click();
  await page.getByLabel('Název firmy').fill('Revize Novák s.r.o.');
  await page.getByLabel('IČO').fill('87654321');
  await page.getByLabel('Oprávnění technika').fill('Osvědčení č. 42/2025');
  await page.getByRole('button', { name: 'Uložit' }).click();
  await expect(page.getByText('Uloženo')).toBeVisible();

  // An inspection with one OK and one defect, recorded through the API.
  const inspectionId = '0190e8a0-0000-7000-8000-0000000c0001';
  await page.request.put(`/api/inspections/${inspectionId}`, {
    data: { siteId: site.id, inspectionDate: '2026-11-03', equipmentTypeIds: [type.id] },
  });
  const items = await (await page.request.get(`/api/inspections/${inspectionId}/items`)).json();
  const byNumber = Object.fromEntries(
    items.map((i: { itemNumber: string; id: string }) => [i.itemNumber, i.id]),
  );
  const record = (itemNumber: string, data: Record<string, unknown>) =>
    page.request.put(`/api/inspections/${inspectionId}/results/${byNumber[itemNumber]}`, {
      data: { id: crypto.randomUUID(), recordedAt: new Date().toISOString(), ...data },
    });
  await record('10001', { outcome: 'ok' });
  await record('10002', { outcome: 'defect', defectDescription: 'Ohnutá štěřina' });

  await page.getByRole('navigation').getByRole('link', { name: 'Kontroly', exact: true }).click();
  await page.getByRole('row', { name: /Sklad Zlín kancelář/ }).click();
  await expect(page.getByRole('heading', { name: 'Sklad Zlín kancelář' })).toBeVisible();
  await expect(page.getByTestId('inspection-results')).toContainText('Ohnutá štěřina');

  // Preview: the draft protocol with the company header.
  await page.getByRole('button', { name: 'Protokol' }).click();
  const preview = page.frameLocator('iframe[title="Náhled protokolu"]');
  await expect(preview.getByText('PŘEDBĚŽNÝ PROTOKOL')).toBeVisible();
  await expect(preview.getByText('Revize Novák s.r.o.').first()).toBeVisible();
  await expect(preview.getByText('Osvědčení č. 42/2025')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Stáhnout PDF' }).click();
  const pdf = readFileSync(await (await download).path());
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  await page.keyboard.press('Escape');

  // Exports: results in Excel and CSV.
  const xlsx = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'Výsledky – Excel (XLSX)' }).click();
  expect((await xlsx).suggestedFilename()).toMatch(/^kontrola-.+\.xlsx$/);
  expect(
    readFileSync(await (await xlsx).path())
      .subarray(0, 2)
      .toString(),
  ).toBe('PK');
  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'Výsledky – CSV' }).click();
  expect(readFileSync(await (await csv).path(), 'utf8')).toContain('Kontrolní číslo;');

  // Closing sets the next inspection date of the checked items.
  await page.getByRole('button', { name: 'Uzavřít kontrolu' }).click();
  await expect(page.getByText('1 artiklů zůstalo nezkontrolovaných')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Uzavřít kontrolu' }).click();
  await expect(page.getByText('Uzavřená', { exact: true })).toBeVisible();
  await expect(page.getByText('03/11/2027')).toBeVisible();
  const item = await (await page.request.get(`/api/items/${byNumber['10001']}`)).json();
  expect(item.nextInspectionDate).toBe('2027-11-03');

  await page.getByRole('button', { name: 'Protokol' }).click();
  await expect(
    preview.getByRole('heading', { name: 'Protokol o kontrole technického vybavení' }),
  ).toBeVisible();
  await expect(preview.getByText('PŘEDBĚŽNÝ PROTOKOL')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Reopening needs a reason.
  await page.getByRole('button', { name: 'Znovu otevřít' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Znovu otevřít' }).click();
  await expect(page.getByText('Uveďte důvod znovuotevření')).toBeVisible();
  await page.getByLabel('Důvod').fill('Doplnění artiklu 4001');
  await page.getByRole('dialog').getByRole('button', { name: 'Znovu otevřít' }).click();
  await expect(page.getByText('Otevřená', { exact: true })).toBeVisible();
});

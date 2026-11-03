import { expect, test } from '@playwright/test';

test('admin imports items from CSV: mapping, per-row report, skip bad rows', async ({ page }) => {
  await page.goto('/prihlaseni');
  await page.getByLabel('E-mail').fill('admin@revize.local');
  await page.getByLabel('Heslo').fill('admin-heslo-123');
  await page.getByRole('button', { name: 'Přihlásit' }).click();
  await expect(page.getByRole('heading', { name: 'Zákazníci' })).toBeVisible();

  // Own data, so the test does not depend on the other spec files.
  const customer = await (
    await page.request.post('/api/customers', { data: { name: 'Import s.r.o.' } })
  ).json();
  await page.request.post(`/api/customers/${customer.id}/sites`, {
    data: { name: 'Sklad Ostrava' },
  });
  await page.request.post('/api/equipment-types', {
    data: { presetKey: 'portable_ladder', name: 'Žebřík (import)' },
  });

  await page.getByRole('navigation').getByRole('link', { name: 'Import' }).click();
  const choose = async (label: string, option: string) => {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  await choose('Zákazník', 'Import s.r.o.');
  await choose('Provozovna', 'Sklad Ostrava');
  await choose('Typ vybavení', 'Žebřík (import)');
  await expect(page.getByRole('button', { name: /Stáhnout šablonu XLSX/ })).toBeVisible();

  const csv = [
    'Číslo;Hala;Řada;Výrobce;Typ žebříku;Počet příček',
    '04001;Hala A;Řada 1;Alve;opěrný;9',
    '4002;Hala A;Řada 2;Krause;Kolo;6',
    ';Hala B;;Hailo;Dvojitý (štaflový);8',
  ].join('\n');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'zebriky.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Načíst soubor' }).click();

  await expect(page.getByText('zebriky.csv')).toBeVisible();
  await expect(page.getByText('3 řádků')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Sloupec pro Výrobce' })).toHaveValue(
    'Výrobce (sloupec 4)',
  );
  await expect(page.getByRole('combobox', { name: 'Sloupec pro Umístění – úroveň 2' })).toHaveValue(
    'Řada (sloupec 3)',
  );
  await page.getByRole('button', { name: 'Zkontrolovat' }).click();

  await expect(page.getByText('Nové: 2')).toBeVisible();
  await expect(page.getByText('Chyby: 1')).toBeVisible();
  const report = page.getByTestId('import-report');
  await expect(report).toContainText('Typ žebříku: „Kolo“ není v číselníku');
  await expect(page.getByText('Hala A › Řada 1')).toBeVisible(); // locations to be created

  const importButton = page.getByRole('button', { name: 'Importovat 2 artiklů' });
  await expect(importButton).toBeDisabled();
  await page.getByLabel('Přeskočit řádky s chybami').check();
  await importButton.click();
  await expect(page.getByText('Import dokončen')).toBeVisible();
  await expect(page.getByText(/Nových artiklů: 2/)).toBeVisible();

  await page.getByRole('link', { name: 'Zobrazit artikly' }).click();
  const rows = page.getByTestId('item-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('4001');
  await expect(rows.nth(0)).toContainText('Hala A › Řada 1');
  await expect(rows.nth(1)).toContainText('Hala B');
});

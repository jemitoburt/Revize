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
    '08001;Hala A;Řada 1;Alve;opěrný;9',
    '8002;Hala A;Řada 2;Krause;Kolo;6',
    ';Hala B;;Hailo;Dvojitý (štaflový);8',
    '8001;Hala A;Řada 1;Alve;Opěrný;10',
  ].join('\n');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'zebriky.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Načíst soubor' }).click();

  await expect(page.getByText('zebriky.csv')).toBeVisible();
  await expect(page.getByText('4 řádků')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Sloupec pro Výrobce' })).toHaveValue(
    'Výrobce (sloupec 4)',
  );
  await expect(page.getByRole('combobox', { name: 'Sloupec pro Umístění – úroveň 2' })).toHaveValue(
    'Řada (sloupec 3)',
  );
  await page.getByRole('button', { name: 'Zkontrolovat' }).click();

  await expect(page.getByText('Nové: 3')).toBeVisible();
  await expect(page.getByText('S varováním: 1')).toBeVisible();
  await expect(page.getByText('Chyby: 1')).toBeVisible();
  const report = page.getByTestId('import-report');
  // An unknown option value does not stop the row: it is added to the type's list.
  await expect(report).toContainText('Typ žebříku: „Kolo“ je nová hodnota číselníku – přidá se');
  await expect(page.getByText('Typ žebříku: Kolo')).toBeVisible();
  await expect(report).toContainText('Číslo 8001 je v souboru už na řádku 2');
  await expect(page.getByText('Hala A › Řada 1').first()).toBeVisible(); // locations to be created

  // The problem list: one line per field and value; skipping leaves the value out.
  const problems = page.getByTestId('import-problems');
  await expect(problems.getByTestId('import-problem')).toHaveCount(1);
  await expect(problems.getByTestId('import-problem')).toContainText('Kolo');
  await problems.getByRole('button', { name: 'Přeskočit' }).click();
  // The field is required, so the row now only tells that its value is missing.
  await expect(report).toContainText('Chybí povinná hodnota „Typ žebříku“');
  await expect(problems).toBeHidden();

  // Back to the mapping: replace the wrong value everywhere and give all items a load.
  await page.getByRole('button', { name: 'Zpět k mapování' }).click();
  await page.getByRole('button', { name: 'Hodnoty pole Typ žebříku' }).click();
  await expect(page.getByTestId('column-values')).toContainText('Kolo');
  await page.getByRole('combobox', { name: 'Nahradit Kolo' }).fill('Opěrný');
  await page.getByRole('button', { name: 'Použít' }).click();
  await expect(page.getByText('náhrad: 1')).toBeVisible();
  await page.getByRole('button', { name: 'Hodnoty pole Max. zatížení' }).click();
  await page.getByLabel('Hodnota pro všechny artikly').fill('150 kg');
  await page.getByRole('button', { name: 'Použít' }).click();
  await expect(page.getByText('= 150 kg')).toBeVisible();
  await page.getByRole('button', { name: 'Zkontrolovat' }).click();
  await expect(page.getByText('S varováním: 0')).toBeVisible();
  await expect(page.getByText('Typ žebříku: Kolo')).toHaveCount(0);

  const importButton = page.getByRole('button', { name: 'Importovat 3 artiklů' });
  await expect(importButton).toBeDisabled();
  await page.getByLabel('Přeskočit řádky s chybami').check();
  await importButton.click();
  await expect(page.getByText('Import dokončen')).toBeVisible();
  await expect(page.getByText(/Nových artiklů: 3/)).toBeVisible();

  await page.getByRole('link', { name: 'Zobrazit artikly' }).click();
  const rows = page.getByTestId('item-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('8001');
  await expect(rows.nth(0)).toContainText('Hala A › Řada 1');
  await expect(rows.nth(1)).toContainText('8002');
  await expect(rows.nth(2)).toContainText('Hala B');
  const imported = await (await page.request.get('/api/items?q=8002')).json();
  expect(imported.items[0].fieldValues).toMatchObject({ ladder_type: 'Opěrný', max_load_kg: 150 });
});

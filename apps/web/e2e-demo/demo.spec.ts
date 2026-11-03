import { expect, test } from '@playwright/test';

test('demo runs the whole app in the browser and keeps its data', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText('Ukázková verze')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Administrátor' }).click();
  await page.getByRole('button', { name: 'Přihlásit' }).click();
  await expect(page.getByRole('cell', { name: 'Ukázkový sklad s.r.o.' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText('Demo', { exact: true })).toBeVisible();

  // A write through the real service rules, then a reload: data and session stay.
  await page.getByRole('button', { name: 'Nový zákazník' }).click();
  await page.getByLabel('Název').fill('Testovací firma demo');
  await page.getByRole('button', { name: 'Uložit' }).click();
  const heading = page.getByRole('heading', { name: 'Testovací firma demo' });
  await expect(heading).toBeVisible();
  await page.reload();
  await expect(heading).toBeVisible({ timeout: 60_000 });

  // Deep link straight into a page (on Pages served through 404.html).
  await page.goto('artikly');
  await expect(page.getByRole('heading', { name: 'Artikly' })).toBeVisible();

  // Reset brings back only the demo data.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Uživatelské menu' }).click();
  await page.getByRole('menuitem', { name: 'Obnovit ukázková data' }).click();
  await expect(page.getByText('Ukázková verze')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Administrátor' }).click();
  await page.getByRole('button', { name: 'Přihlásit' }).click();
  await expect(page.getByRole('cell', { name: 'Ukázkový sklad s.r.o.' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole('cell', { name: 'Testovací firma demo' })).toHaveCount(0);
});

test('demo field mode: a technician records results and photos in the browser', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.getByText('Ukázková verze')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Technik' }).click();
  await page.getByRole('button', { name: 'Přihlásit' }).click();
  await expect(page.getByRole('heading', { name: 'Kontroly v terénu' })).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole('button', { name: 'Zahájit kontrolu' }).click();
  await page.getByRole('combobox', { name: 'Zákazník', exact: true }).click();
  await page.getByRole('option', { name: 'Ukázkový sklad s.r.o.' }).click();
  await page.getByRole('combobox', { name: 'Provozovna', exact: true }).click();
  await page.getByRole('option', { name: 'Provozovna Brno' }).click();
  await page.getByRole('button', { name: 'Zahájit', exact: true }).click();
  await expect(page.getByTestId('progress')).toHaveText('0 / 35 zkontrolováno');

  await page.getByRole('button', { name: 'Číslo', exact: true }).click();
  for (const digit of '10001') {
    await page.getByRole('dialog').getByRole('button', { name: digit, exact: true }).click();
  }
  const sheet = page.getByRole('dialog').filter({ hasText: 'Výsledek kontroly' });
  await sheet.getByRole('button', { name: 'V pořádku' }).click();
  await expect(page.getByTestId('progress')).toHaveText('1 / 35 zkontrolováno');

  // An inspection photo goes through the canvas thumbnail and the PGlite file table.
  await page.getByRole('button', { name: 'Fotky kontroly' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Vyfotit' }).click();
  await (await chooser).setFiles('e2e/.generated/defect.jpg');
  await expect(page.getByText('Celkové fotky kontroly (1)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zobrazit fotku' }).locator('img')).toBeVisible();

  // The protocol is rendered in the browser too (printed instead of a server PDF).
  await page.goto('kontroly');
  await page.getByRole('row', { name: /Provozovna Brno/ }).click();
  await page.getByRole('button', { name: 'Protokol' }).click();
  const preview = page.frameLocator('iframe[title="Náhled protokolu"]');
  await expect(preview.getByText('PŘEDBĚŽNÝ PROTOKOL')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tisk / uložit jako PDF' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stáhnout PDF' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Photos as a ZIP also in the browser (without EXIF/IPTC, no ExifTool there).
  const zip = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'Fotky (ZIP s popisy)' }).click();
  expect((await zip).suggestedFilename()).toMatch(/^fotky-.+\.zip$/);
});

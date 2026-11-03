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

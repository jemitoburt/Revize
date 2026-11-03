import { expect, test } from '@playwright/test';
import { card } from './helpers.js';

test('creates a new item with validated fields, photo and immediate check', async ({ page }) => {
  await page.goto('/#/inspection');
  await page.getByRole('link', { name: '＋ Nový artikl' }).tap();
  await expect(page.getByRole('heading', { name: 'Nový artikl' })).toBeVisible();
  await expect(page.getByLabel('Číslo artiklu')).toHaveValue('10051'); // next free number

  // Required fields and a taken number are reported per field.
  await page.getByLabel('Číslo artiklu').fill('10001');
  await page.getByRole('button', { name: 'Uložit a zkontrolovat' }).tap();
  await expect(page.getByText('Toto číslo už má jiný artikl.')).toBeVisible();
  await expect(page.getByText('Pole „Výrobce“ je povinné')).toBeVisible();

  await page.getByLabel('Číslo artiklu').fill('20001');
  await page
    .getByRole('group', { name: 'Typ vybavení' })
    .getByRole('button', { name: 'Žebřík' })
    .tap();
  await page.getByRole('button', { name: 'C', exact: true }).tap();
  await page.getByLabel('Řada').fill('7');
  const field = (label: string) => page.locator('.field', { hasText: label });
  await field('Výrobce').locator('input').fill('Krause');
  await field('Typ žebříku').getByRole('button', { name: 'Výsuvný' }).tap();
  await field('Počet příček').locator('input').fill('14');
  await page.locator('.gallery input[type=file]').setInputFiles('e2e/.generated/defect.jpg');
  await expect(page.locator('.thumb')).toHaveCount(1);
  await page.getByRole('button', { name: 'Uložit a zkontrolovat' }).tap();

  // The new item opens right away for checking, with its fields and photo.
  await expect(card(page).locator('.card-number')).toHaveText('20001');
  await expect(card(page)).toContainText('nový');
  await expect(card(page)).toContainText('Hala C › Řada 7 › Pozice 1');
  await expect(card(page)).toContainText('Výsuvný');
  await expect(card(page).locator('.thumb')).toHaveCount(1);
  await card(page).getByRole('button', { name: 'V pořádku' }).tap();
  await expect(page).toHaveURL(/#\/inspection$/);
  await expect(page.locator('.progress')).toContainText('Zkontrolováno 1 z 56');

  // It survives a restart and is found by its number.
  await page.reload();
  await page.keyboard.type('20001', { delay: 5 });
  await page.keyboard.press('Enter');
  await expect(card(page)).toContainText('Krause');
});

test('an unknown scanned code can become a new item with that QR code', async ({ page }) => {
  await page.goto('/#/inspection');
  // Let the screen finish rendering: Playwright sends keys one by one, a busy page delays them.
  await expect(page.locator('.item-row').first()).toBeVisible();
  await page.keyboard.type('https://revize.example/q/NOVY-7', { delay: 2 });
  await page.keyboard.press('Enter');
  await expect(card(page)).toContainText('Neznámý kód');
  await card(page).getByRole('button', { name: 'Založit nový artikl' }).tap();

  await expect(page.getByLabel('QR kód')).toHaveValue('NOVY-7');
  await page.locator('.field', { hasText: 'Výrobce' }).locator('input').fill('Stow');
  await page.getByRole('button', { name: 'Paletový' }).tap();
  await page.getByRole('button', { name: 'Oboustranný' }).tap();
  await page.getByRole('button', { name: 'Uložit a založit další' }).tap();
  // Next item: same location, next position, next free number.
  await expect(page.getByLabel('Pozice')).toHaveValue('2');
  await expect(page.getByLabel('Číslo artiklu')).toHaveValue('10052');

  await page.getByRole('button', { name: '← Zrušit' }).tap();
  await expect(page.locator('.item-row').first()).toBeVisible();
  await page.keyboard.type('https://revize.example/q/NOVY-7', { delay: 2 });
  await page.keyboard.press('Enter');
  await expect(card(page).locator('.card-number')).toHaveText('10051');
  await expect(card(page)).toContainText('Stow');
});

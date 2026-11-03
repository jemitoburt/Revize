import { expect, test } from '@playwright/test';
import { PHOTO, createData, login, sheet, wedgeScan } from './helpers.js';

test('technician inspects a site: number pad, camera, defect with photo, new item', async ({
  page,
}) => {
  await login(page, 'admin@revize.local', 'admin-heslo-123');
  await expect(page.getByRole('heading', { name: 'Zákazníci' })).toBeVisible();
  await createData(page.request);

  // A technician (no office rights) lands directly in the field mode.
  await page.request.post('/api/users', {
    data: {
      email: 'teren@revize.local',
      displayName: 'Petr Terén',
      role: 'inspector',
      password: 'teren-heslo-123',
    },
  });
  await page.getByRole('button', { name: 'Uživatelské menu' }).click();
  await page.getByRole('menuitem', { name: 'Odhlásit' }).click();
  await login(page, 'teren@revize.local', 'teren-heslo-123');
  await expect(page.getByRole('heading', { name: 'Kontroly v terénu' })).toBeVisible();

  // Start the inspection.
  await page.getByRole('button', { name: 'Zahájit kontrolu' }).click();
  const choose = async (label: string, option: string) => {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  await choose('Zákazník', 'Terén s.r.o.');
  await choose('Provozovna', 'Sklad Zlín');
  await page.getByRole('button', { name: 'Zahájit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sklad Zlín' })).toBeVisible();
  await expect(page.getByTestId('progress')).toHaveText('0 / 3 zkontrolováno');

  // Number pad: a 4-digit number typed with a leading zero opens after the 5th digit.
  await page.getByRole('button', { name: 'Číslo', exact: true }).click();
  for (const digit of '04001') {
    await page.getByRole('dialog').getByRole('button', { name: digit, exact: true }).click();
  }
  await expect(sheet(page).getByRole('heading', { name: '4001', exact: true })).toBeVisible();
  await sheet(page).getByRole('button', { name: 'V pořádku' }).click();
  await expect(page.getByTestId('progress')).toHaveText('1 / 3 zkontrolováno');

  // Camera: the fake camera shows the QR label of 10001.
  await page.getByRole('button', { name: 'Skenovat' }).click();
  await expect(sheet(page).getByRole('heading', { name: '10001', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await sheet(page).getByRole('button', { name: 'Žlutá' }).click();
  await sheet(page).getByRole('button', { name: 'Uložit závadu' }).click();
  await expect(sheet(page).getByText('Popište závadu')).toBeVisible();
  // Minor (green/amber) defects can be left out of the protocol; included by default.
  await expect(sheet(page).getByLabel('Zahrnout do protokolu')).toBeChecked();
  await sheet(page).getByLabel('Popis závady').fill('Prasklá příčka');
  const chooser = page.waitForEvent('filechooser');
  await sheet(page).getByRole('button', { name: 'Vyfotit' }).first().click();
  await (await chooser).setFiles(PHOTO);
  await expect(sheet(page).getByText('Fotky závady (1)')).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Uložit závadu' }).click();
  await expect(sheet(page)).toBeHidden();
  // Back in the scanner, which keeps running; close it.
  await page.getByTestId('scanner').getByRole('button', { name: 'Zavřít' }).click();
  await expect(page.getByTestId('progress')).toHaveText('2 / 3 zkontrolováno');

  // The defect and its uploaded photo are on the server.
  await page.getByText('Závady (1)').click();
  await page.getByTestId('item-10001').click();
  await expect(sheet(page).getByText('Zapsáno: Závada – žlutá')).toBeVisible();
  await expect(sheet(page).getByText('Fotky závady (1)')).toBeVisible();
  await expect(sheet(page).getByRole('button', { name: 'Zobrazit fotku' })).toHaveCount(1);
  await sheet(page).getByRole('button', { name: 'Zavřít' }).last().click();
  await expect(sheet(page)).toBeHidden();

  // The designation finds the item too (scanner or keyboard), case and dashes ignored.
  await wedgeScan(page, 'a101');
  await expect(sheet(page).getByTestId('designation')).toHaveText('A1-01');
  await sheet(page).getByRole('button', { name: 'Zavřít' }).last().click();
  await expect(sheet(page)).toBeHidden();

  // A Bluetooth scanner reads an unknown label: create the item with that code.
  await wedgeScan(page, 'R20001');
  await expect(page.getByText('nepatří žádnému artiklu')).toBeVisible();
  await page.getByRole('button', { name: 'Založit artikl s tímto kódem' }).click();
  const form = page.getByRole('dialog').filter({ hasText: 'Nový artikl' });
  await expect(form.getByLabel('QR kód')).toHaveValue('R20001');
  await form.getByRole('combobox', { name: 'Typ vybavení' }).click();
  await page.getByRole('option', { name: 'Žebřík (terén)' }).click();
  // Číslo TZ typed (the automatic one depends on items of the other tests).
  await form.getByLabel('Číslo TZ').fill('10003');
  await form.getByLabel('Označení', { exact: true }).fill('Ž-03');
  await form.getByLabel('Výrobce').fill('Krause');
  await form.getByRole('combobox', { name: 'Typ žebříku' }).click();
  await page.getByRole('option', { name: 'Opěrný', exact: true }).click();
  await form.getByLabel('Počet příček / stupňů na díl').fill('10');
  await form.getByRole('button', { name: 'Založit artikl' }).click();
  // The new item opens for its result right away.
  await expect(sheet(page).getByRole('heading', { name: '10003', exact: true })).toBeVisible();
  await sheet(page).getByRole('button', { name: 'V pořádku' }).click();
  await expect(page.getByTestId('progress')).toHaveText('3 / 4 zkontrolováno');

  // Leaving keeps the inspection open with its progress.
  await page.getByRole('button', { name: 'Ukončit práci' }).click();
  await page.getByRole('button', { name: 'Odejít' }).click();
  await expect(page.getByText('3 / 4 zkontrolováno')).toBeVisible();
});

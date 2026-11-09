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
  await sheet(page).getByRole('button', { name: 'Vyhovuje', exact: true }).click();
  await expect(page.getByTestId('progress')).toHaveText('1 / 3 zkontrolováno');

  // The designation (A1-01) from a quick key + digits, without the keyboard; opens by itself.
  await page.getByRole('button', { name: 'Číslo', exact: true }).click();
  await page.getByRole('button', { name: 'Označení A', exact: true }).click();
  for (const digit of '101') {
    await page.getByRole('dialog').getByRole('button', { name: digit, exact: true }).click();
  }
  await expect(sheet(page).getByTestId('designation')).toHaveText('A1-01');
  await sheet(page).getByRole('button', { name: 'Zavřít' }).last().click();
  await expect(sheet(page)).toBeHidden();

  // Camera: the fake camera shows the QR label of 10001.
  await page.getByRole('button', { name: 'Skenovat' }).click();
  await expect(sheet(page).getByRole('heading', { name: '10001', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await sheet(page).getByRole('button', { name: 'Nevyhovuje' }).click();
  await sheet(page).getByRole('button', { name: 'Uložit – nevyhovuje' }).click();
  await expect(sheet(page).getByText('Popište závadu')).toBeVisible();
  // Ladders are fit / unfit (risk levels are for racks); photos go to the protocol by default.
  await expect(sheet(page).getByRole('button', { name: 'Žlutá' })).toHaveCount(0);
  await expect(sheet(page).getByLabel('Zahrnout fotky do protokolu')).toBeChecked();
  await sheet(page).getByLabel('Popis závady').fill('Prasklá příčka');
  const chooser = page.waitForEvent('filechooser');
  await sheet(page).getByRole('button', { name: 'Vyfotit' }).first().click();
  await (await chooser).setFiles(PHOTO);
  // Right after taking it: turn the photo and cut out a part.
  const editor = page.getByRole('dialog', { name: 'Upravit fotku' });
  await editor.getByRole('button', { name: 'Doprava' }).click();
  await expect(editor.locator('img[data-rotation="90"]')).toBeVisible();
  const corner = editor.getByLabel('Roh výřezu se');
  const box = (await corner.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 40, box.y - 40, { steps: 4 });
  await page.mouse.up();
  await expect(editor.getByRole('button', { name: 'Celá' })).toBeEnabled();
  await editor.getByRole('button', { name: 'Uložit fotku' }).click();
  await expect(editor).toBeHidden();
  await expect(sheet(page).getByText('Fotky závady (1)')).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Uložit – nevyhovuje' }).click();
  await expect(sheet(page)).toBeHidden();
  // Back in the scanner, which keeps running; close it.
  await page.getByTestId('scanner').getByRole('button', { name: 'Zavřít' }).click();
  await expect(page.getByTestId('progress')).toHaveText('2 / 3 zkontrolováno');

  // The defect and its uploaded photo are on the server.
  await page.getByText('Závady (1)').click();
  await page.getByTestId('item-10001').click();
  await expect(sheet(page).getByText('Zapsáno: Nevyhovuje')).toBeVisible();
  await expect(sheet(page).getByText('Fotky závady (1)')).toBeVisible();
  await expect(sheet(page).getByRole('button', { name: 'Zobrazit fotku' })).toHaveCount(1);
  // Turned (the test photo is landscape 1600 × 1200) and cropped on the device.
  const inspectionId = page.url().split('/').pop()!;
  const inspected = (await (
    await page.request.get(`/api/inspections/${inspectionId}/items`)
  ).json()) as { id: string; itemNumber: string }[];
  const defectItem = inspected.find((i) => i.itemNumber === '10001')!;
  const photos = (await (
    await page.request.get(`/api/photos?inspectionId=${inspectionId}&itemId=${defectItem.id}`)
  ).json()) as { owner: string; width: number; height: number }[];
  const defectPhoto = photos.find((p) => p.owner === 'result')!;
  expect(defectPhoto.height).toBeGreaterThan(defectPhoto.width);
  expect(defectPhoto.width).toBeLessThan(1200);
  expect(defectPhoto.height).toBeLessThan(1600);
  // A photo added to the saved defect is sent even when the card is just closed.
  const another = page.waitForEvent('filechooser');
  await sheet(page).getByRole('button', { name: 'Vyfotit' }).first().click();
  await (await another).setFiles(PHOTO);
  await page
    .getByRole('dialog', { name: 'Upravit fotku' })
    .getByRole('button', { name: 'Uložit fotku' })
    .click();
  await sheet(page).getByRole('button', { name: 'Zavřít' }).last().click();
  await expect(sheet(page)).toBeHidden();
  await expect
    .poll(async () => {
      const list = (await (
        await page.request.get(`/api/photos?inspectionId=${inspectionId}&itemId=${defectItem.id}`)
      ).json()) as { owner: string }[];
      return list.filter((p) => p.owner === 'result').length;
    })
    .toBe(2);

  // The designation finds the item too (scanner or keyboard), case and dashes ignored.
  await wedgeScan(page, 'a101');
  await expect(sheet(page).getByTestId('designation')).toHaveText('A1-01');
  await sheet(page).getByRole('button', { name: 'Zavřít' }).last().click();
  await expect(sheet(page)).toBeHidden();

  // A label with a číslo TZ that is not in the records yet (as printed: "TZ: 20 002").
  await wedgeScan(page, 'TZ: 20 002');
  await expect(
    page.getByRole('button', { name: 'Založit artikl s číslem TZ 20002' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Pokračovat' }).click();

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
  // A row that is not in the records yet: added right here (through the device's outbox).
  await form.getByRole('button', { name: 'Nové umístění' }).click();
  const newLocation = form.getByTestId('new-location');
  await newLocation.getByRole('combobox', { name: 'Nadřazené umístění' }).click();
  await page.getByRole('option', { name: 'Hala A', exact: true }).click();
  await newLocation.getByLabel('Název umístění').fill('Řada 9');
  await newLocation.getByRole('button', { name: 'Přidat umístění' }).click();
  await expect(form.getByRole('combobox', { name: 'Umístění', exact: true })).toHaveValue(
    'Hala A › Řada 9',
  );
  await form.getByLabel('Výrobce').fill('Krause');
  await form.getByRole('combobox', { name: 'Typ žebříku' }).click();
  await page.getByRole('option', { name: 'Opěrný', exact: true }).click();
  await form.getByLabel('Počet příček / stupňů na díl').fill('10');
  await form.getByRole('button', { name: 'Založit artikl' }).click();
  // The new item opens for its result right away.
  await expect(sheet(page).getByRole('heading', { name: '10003', exact: true })).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Vyhovuje', exact: true }).click();
  await expect(page.getByTestId('progress')).toHaveText('3 / 4 zkontrolováno');
  // Location and item reached the server (the item waited for its location).
  await expect(page.getByText('Vše odesláno')).toBeVisible();
  const created = await (await page.request.get('/api/items?q=10003')).json();
  expect(created.items[0].locationPath).toEqual(['Hala A', 'Řada 9']);

  // Leaving keeps the inspection open with its progress.
  await page.getByRole('button', { name: 'Ukončit práci' }).click();
  await page.getByRole('button', { name: 'Odejít' }).click();
  await expect(page.getByText('3 / 4 zkontrolováno')).toBeVisible();
});

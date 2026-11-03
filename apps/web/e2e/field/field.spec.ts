import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const PHOTO = 'e2e/.generated/defect.jpg';
const ladder = { manufacturer: 'Alve', ladder_type: 'Opěrný', rungs: 8 };

/** Own customer, site, locations, type and three items (10001 has the QR code of the video). */
async function createData(request: APIRequestContext) {
  const post = async (url: string, data: unknown) => {
    const response = await request.post(url, { data });
    expect(response.ok(), `${url}: ${await response.text()}`).toBe(true);
    return response.json();
  };
  const customer = await post('/api/customers', { name: 'Terén s.r.o.' });
  const site = await post(`/api/customers/${customer.id}/sites`, { name: 'Sklad Zlín' });
  const hall = await post(`/api/sites/${site.id}/locations`, { parentId: null, name: 'Hala A' });
  const row = await post(`/api/sites/${site.id}/locations`, { parentId: hall.id, name: 'Řada 1' });
  const type = await post('/api/equipment-types', {
    presetKey: 'portable_ladder',
    name: 'Žebřík (terén)',
  });
  for (const [itemNumber, qrCode] of [
    ['10001', 'R10001'],
    ['10002', 'R10002'],
    ['4001', null],
  ] as const) {
    await post('/api/items', {
      siteId: site.id,
      locationId: row.id,
      equipmentTypeId: type.id,
      itemNumber,
      qrCode,
      fieldValues: ladder,
    });
  }
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/prihlaseni');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Heslo').fill(password);
  await page.getByRole('button', { name: 'Přihlásit' }).click();
}

const sheet = (page: Page) => page.getByRole('dialog').filter({ hasText: 'Výsledek kontroly' });

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
  await sheet(page).getByRole('button', { name: 'Závada' }).click();
  await sheet(page).getByRole('button', { name: 'Uložit závadu' }).click();
  await expect(sheet(page).getByText('Popište závadu')).toBeVisible();
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
  await expect(sheet(page).getByText('Zapsáno: Závada')).toBeVisible();
  await expect(sheet(page).getByText('Fotky závady (1)')).toBeVisible();
  await expect(sheet(page).getByRole('button', { name: 'Zobrazit fotku' })).toHaveCount(1);
  await sheet(page).getByRole('button', { name: 'Zavřít' }).last().click();

  // A Bluetooth scanner reads an unknown label: create the item with that code.
  await page.keyboard.type('R20001\n');
  await expect(page.getByText('nepatří žádnému artiklu')).toBeVisible();
  await page.getByRole('button', { name: 'Založit artikl s tímto kódem' }).click();
  const form = page.getByRole('dialog').filter({ hasText: 'Nový artikl' });
  await expect(form.getByLabel('QR kód')).toHaveValue('R20001');
  await form.getByRole('combobox', { name: 'Typ vybavení' }).click();
  await page.getByRole('option', { name: 'Žebřík (terén)' }).click();
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

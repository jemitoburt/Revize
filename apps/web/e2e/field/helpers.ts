import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const PHOTO = 'e2e/.generated/defect.jpg';
const ladder = { manufacturer: 'Alve', ladder_type: 'Opěrný', rungs: 8 };

/** Own customer, site, locations, type and three items (10001 has the QR code of the video). */
export async function createData(request: APIRequestContext, suffix = '') {
  const post = async (url: string, data: unknown) => {
    const response = await request.post(url, { data });
    expect(response.ok(), `${url}: ${await response.text()}`).toBe(true);
    return response.json();
  };
  const customer = await post('/api/customers', { name: `Terén${suffix} s.r.o.` });
  const site = await post(`/api/customers/${customer.id}/sites`, { name: `Sklad Zlín${suffix}` });
  const hall = await post(`/api/sites/${site.id}/locations`, { parentId: null, name: 'Hala A' });
  const row = await post(`/api/sites/${site.id}/locations`, { parentId: hall.id, name: 'Řada 1' });
  const type = await post('/api/equipment-types', {
    presetKey: 'portable_ladder',
    name: `Žebřík (terén${suffix})`,
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
      qrCode: qrCode && suffix ? `${qrCode}-${suffix.trim()}` : qrCode,
      fieldValues: ladder,
    });
  }
  return { customer, site, type };
}

export async function login(page: Page, email: string, password: string) {
  await page.goto('/prihlaseni');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Heslo').fill(password);
  await page.getByRole('button', { name: 'Přihlásit' }).click();
}

export const sheet = (page: Page) =>
  page.getByRole('dialog').filter({ hasText: 'Výsledek kontroly' });

/** Starts an inspection of the test site from the field home page; returns its id. */
export async function startInspection(page: Page, suffix = '') {
  await page.getByRole('button', { name: 'Zahájit kontrolu' }).click();
  for (const [label, option] of [
    ['Zákazník', `Terén${suffix} s.r.o.`],
    ['Provozovna', `Sklad Zlín${suffix}`],
  ]) {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Zahájit', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Sklad Zlín${suffix}` })).toBeVisible();
  return page.url().split('/').pop()!;
}

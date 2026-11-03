import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const PHOTO = 'e2e/.generated/defect.jpg';
const ladder = { manufacturer: 'Alve', ladder_type: 'Opěrný', rungs: 8 };

/**
 * Own customer, site, locations, type and three items (10001 has the QR code of the video).
 * Číslo TZ is unique in the whole organization: `series` 2 gives 20001, 20002 and 5001.
 */
export async function createData(request: APIRequestContext, suffix = '', series = 1) {
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
  const big = (n: number) => String(series * 10000 + n);
  for (const [itemNumber, qrCode] of [
    [big(1), 'R10001'],
    [big(2), 'R10002'],
    [String(3000 + series * 1000 + 1), null],
  ] as const) {
    await post('/api/items', {
      siteId: site.id,
      locationId: row.id,
      equipmentTypeId: type.id,
      itemNumber,
      designation: itemNumber === big(1) ? 'A1-01' : null,
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

/**
 * A Bluetooth scanner in keyboard mode: the keys arrive in one fast burst ending with Enter.
 * Dispatched inside the page so that the timing does not depend on the load of the test run.
 */
export async function wedgeScan(page: Page, text: string) {
  await page.evaluate((value) => {
    (document.activeElement as HTMLElement | null)?.blur();
    for (const key of [...value, 'Enter']) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
  }, text);
}

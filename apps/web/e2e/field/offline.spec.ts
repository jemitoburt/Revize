import { expect, test } from '@playwright/test';
import { PHOTO, createData, login, sheet, startInspection } from './helpers.js';

test('without a connection results and photos stay on the device, survive a reload and are sent later', async ({
  page,
  context,
}) => {
  await login(page, 'admin@revize.local', 'admin-heslo-123');
  await expect(page.getByRole('heading', { name: 'Zákazníci' })).toBeVisible();
  await createData(page.request, ' offline');
  await page.goto('/teren');
  const inspectionId = await startInspection(page, ' offline');

  // The service worker must control the page so that it can open again without a network.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByTestId('progress')).toHaveText('0 / 3 zkontrolováno');
  await expect(page.getByTestId('sync-status')).toHaveText('Vše odesláno');

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Číslo', exact: true }).click();
  for (const digit of '04001') {
    await page.getByRole('dialog').getByRole('button', { name: digit, exact: true }).click();
  }
  await sheet(page).getByRole('button', { name: 'V pořádku' }).click();
  await expect(page.getByTestId('progress')).toHaveText('1 / 3 zkontrolováno');

  await page.getByTestId('item-10002').click();
  await sheet(page).getByRole('button', { name: 'Oranžová' }).click();
  await sheet(page).getByLabel('Popis závady').fill('Uvolněná příčka');
  const chooser = page.waitForEvent('filechooser');
  await sheet(page).getByRole('button', { name: 'Vyfotit' }).first().click();
  await (await chooser).setFiles(PHOTO);
  await expect(sheet(page).getByText('Fotky závady (1)')).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Uložit závadu' }).click();
  await expect(page.getByTestId('progress')).toHaveText('2 / 3 zkontrolováno');
  await expect(page.getByTestId('sync-status')).toHaveText('Neodesláno: 3');

  // The app restarts without a connection: everything is still there.
  await page.reload();
  await expect(page.getByTestId('progress')).toHaveText('2 / 3 zkontrolováno', { timeout: 15_000 });
  await expect(page.getByTestId('sync-status')).toHaveText('Neodesláno: 3');
  await page.getByText('Závady (1)').click();
  await page.getByTestId('item-10002').click();
  await expect(sheet(page).getByRole('alert').getByText('Uvolněná příčka')).toBeVisible();
  await expect(sheet(page).getByText('Fotky závady (1)')).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Zavřít' }).last().click();

  // Back online: the outbox empties by itself and the server has everything.
  await context.setOffline(false);
  await expect(page.getByTestId('sync-status')).toHaveText('Vše odesláno', { timeout: 30_000 });
  const items = await (await page.request.get(`/api/inspections/${inspectionId}/items`)).json();
  const byNumber = Object.fromEntries(
    items.map((i: { itemNumber: string; result: unknown }) => [i.itemNumber, i.result]),
  );
  expect(byNumber['4001']).toMatchObject({ outcome: 'ok' });
  expect(byNumber['10002']).toMatchObject({
    outcome: 'defect',
    defectDescription: 'Uvolněná příčka',
    photoCount: 1,
  });
  expect(byNumber['10001']).toBeNull();
});

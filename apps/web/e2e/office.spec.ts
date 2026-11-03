import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

async function login(page: Page) {
  await page.goto('/prihlaseni');
  await page.getByLabel('E-mail').fill('Admin@Revize.local');
  await page.getByLabel('Heslo').fill('admin-heslo-123');
  await page.getByRole('button', { name: 'Přihlásit' }).click();
  await expect(page.getByRole('heading', { name: 'Zákazníci' })).toBeVisible();
}

/** Mantine Select: open the dropdown and pick an option. */
async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

const dialog = (page: Page) => page.getByRole('dialog');
const nav = (page: Page, name: string) =>
  page.getByRole('navigation').getByRole('link', { name }).click();

test('login rejects a wrong password and redirects back after login', async ({ page }) => {
  await page.goto('/typy');
  await expect(page).toHaveURL(/prihlaseni/);
  await page.getByLabel('E-mail').fill('admin@revize.local');
  await page.getByLabel('Heslo').fill('spatne-heslo');
  await page.getByRole('button', { name: 'Přihlásit' }).click();
  await expect(page.getByText('Nesprávný e-mail nebo heslo.')).toBeVisible();
  await page.getByLabel('Heslo').fill('admin-heslo-123');
  await page.getByRole('button', { name: 'Přihlásit' }).click();
  await expect(page.getByRole('heading', { name: 'Typy vybavení' })).toBeVisible();
});

test('admin creates a customer, a site and its location tree', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Nový zákazník' }).click();
  await dialog(page).getByLabel('Název').fill('Sklad Brno s.r.o.');
  await dialog(page).getByLabel('IČO').fill('12345678');
  await dialog(page).getByLabel('E-mail').fill('neni-email');
  await dialog(page).getByRole('button', { name: 'Uložit' }).click();
  await expect(dialog(page).getByText('Neplatný e-mail')).toBeVisible();
  await dialog(page).getByLabel('E-mail').fill('sklad@example.cz');
  await dialog(page).getByRole('button', { name: 'Uložit' }).click();
  await expect(page.getByRole('heading', { name: 'Sklad Brno s.r.o.' })).toBeVisible();

  await page.getByRole('button', { name: 'Nová provozovna' }).click();
  await dialog(page).getByLabel('Název provozovny').fill('Hlavní sklad');
  await dialog(page).getByRole('button', { name: 'Uložit' }).click();
  await expect(page.getByRole('heading', { name: 'Hlavní sklad' })).toBeVisible();

  const tree = page.getByRole('tree', { name: 'Umístění' });
  await page.getByRole('button', { name: 'Hlavní umístění', exact: true }).click();
  await dialog(page).getByLabel('Název').fill('Hala A');
  await dialog(page).getByRole('button', { name: 'Přidat' }).click();
  await expect(tree.getByText('Hala A')).toBeVisible();

  await page.getByRole('button', { name: 'Přidat pod Hala A' }).click();
  await dialog(page).getByLabel('Název').fill('Řada 1');
  await dialog(page).getByRole('button', { name: 'Přidat' }).click();
  await page.getByRole('button', { name: 'Akce pro Řada 1' }).click();
  await page.getByRole('menuitem', { name: 'Přidat řadu podřízených…' }).click();
  await dialog(page).getByLabel('Do').fill('12');
  await dialog(page).getByRole('button', { name: 'Přidat řadu' }).click();
  await expect(tree.getByRole('treeitem')).toHaveCount(14);
  // Numeric order: Pozice 2 comes before Pozice 10.
  const names = await tree.getByRole('treeitem').allInnerTexts();
  expect(names.findIndex((n) => n.startsWith('Pozice 2'))).toBeLessThan(
    names.findIndex((n) => n.startsWith('Pozice 10')),
  );
});

test('admin adds "Žebřík" from the library and builds a custom "Regál" type', async ({ page }) => {
  await login(page);
  await nav(page, 'Typy vybavení');
  await page.getByRole('button', { name: 'Nový typ' }).click();
  const ladderCard = dialog(page).locator('.mantine-Card-root', { hasText: 'ČSN EN 131-1' });
  await ladderCard.getByRole('button', { name: 'Přidat' }).click();
  await expect(page.getByRole('heading', { name: 'Žebřík' })).toBeVisible();
  await expect(page.getByTestId('field-row')).toHaveCount(13);
  await expect(
    page
      .getByText('Kontrola žebříků a schůdků je provedena dle nařízení vlády', { exact: false })
      .last(),
  ).toBeVisible();

  await nav(page, 'Typy vybavení');
  await page.getByRole('button', { name: 'Nový typ' }).click();
  await dialog(page).getByRole('tab', { name: 'Prázdný typ' }).click();
  await dialog(page).getByLabel('Název typu').fill('Regál');
  await dialog(page).getByRole('button', { name: 'Vytvořit' }).click();
  await expect(page.getByRole('heading', { name: 'Regál' })).toBeVisible();

  await page.getByRole('button', { name: 'Přidat pole' }).click();
  const first = page.getByTestId('field-row').nth(0);
  await first.getByLabel('Popisek').fill('Nosnost pole');
  await expect(first.getByLabel('Klíč')).toHaveValue('nosnost_pole');
  await choose(page, 'Druh', 'Celé číslo');
  await first.getByLabel('Jednotka').fill('kg');
  await first.getByLabel('Povinné', { exact: true }).check();

  await page.getByRole('button', { name: 'Přidat pole' }).click();
  const second = page.getByTestId('field-row').nth(1);
  await second.getByLabel('Popisek').fill('Provedení');
  await second.getByRole('combobox', { name: 'Druh' }).click();
  await page.getByRole('option', { name: 'Výběr z číselníku', exact: true }).click();
  await page.getByRole('button', { name: 'Uložit změny' }).click();
  await expect(page.getByText('Číselník musí mít aspoň jednu hodnotu')).toBeVisible();
  const options = second.getByLabel('Hodnoty číselníku');
  await options.fill('Jednostranný');
  await options.press('Enter');
  await options.fill('Oboustranný');
  await options.press('Enter');

  await page.getByLabel('Text protokolu').fill('Kontrola regálů u zákazníka ');
  await page.getByRole('button', { name: 'Zákazník', exact: true }).click();
  await expect(page.getByText('Kontrola regálů u zákazníka Ukázkový sklad s.r.o.')).toBeVisible();
  await page.getByRole('button', { name: 'Uložit změny' }).click();
  await expect(page.getByText('Uloženo')).toBeVisible();

  // After saving, key and kind are locked; the form preview shows the fields.
  await page.reload();
  await expect(page.getByTestId('field-row').nth(0).getByLabel('Klíč')).toBeDisabled();
  await expect(page.getByLabel('Text protokolu')).toHaveValue(
    'Kontrola regálů u zákazníka {{zakaznik}}',
  );
  await expect(page.getByText('Verze polí 2', { exact: false })).toBeVisible();
});

test('items: create with validation and automatic number, 4-digit series, status change, bulk move', async ({
  page,
}) => {
  await login(page);
  await nav(page, 'Artikly');
  await choose(page, 'Zákazník', 'Sklad Brno s.r.o.');
  await choose(page, 'Provozovna', 'Hlavní sklad');

  await page.getByRole('button', { name: 'Nový artikl' }).click();
  const drawer = page.getByRole('dialog', { name: 'Nový artikl' });
  await drawer.getByRole('combobox', { name: 'Umístění' }).click();
  await page.getByRole('option', { name: 'Hala A › Řada 1 › Pozice 2', exact: true }).click();
  await drawer.getByRole('combobox', { name: 'Typ vybavení' }).click();
  await page.getByRole('option', { name: 'Žebřík', exact: true }).click();
  await drawer.getByRole('button', { name: 'Založit artikl' }).click();
  await expect(drawer.getByText('Pole „Výrobce“ je povinné')).toBeVisible();

  await drawer.getByRole('combobox', { name: 'Výrobce' }).fill('Alve');
  await drawer.getByRole('combobox', { name: 'Typ žebříku' }).click();
  await page.getByRole('option', { name: 'Víceúčelový', exact: true }).click();
  await drawer.getByRole('textbox', { name: 'Počet příček / stupňů na díl' }).fill('9');
  await drawer.getByRole('button', { name: 'Založit artikl' }).click();
  // Číslo TZ is assigned from the organization's series (other tests add items too).
  const created = page.getByText(/^Artikl \d{4,5} založen$/);
  await expect(created).toBeVisible();
  const autoNumber = (await created.textContent())!.match(/\d+/)![0];

  // A 4-digit series item typed with a leading zero, in another position.
  await page.getByRole('button', { name: 'Nový artikl' }).click();
  await drawer.getByRole('combobox', { name: 'Umístění' }).click();
  await page.getByRole('option', { name: 'Hala A › Řada 1 › Pozice 10', exact: true }).click();
  await drawer.getByRole('combobox', { name: 'Typ vybavení' }).click();
  await page.getByRole('option', { name: 'Regál', exact: true }).click();
  await drawer.getByLabel('Číslo TZ').fill('07001');
  await drawer.getByRole('textbox', { name: 'Nosnost pole' }).fill('3000');
  await drawer.getByRole('button', { name: 'Založit artikl' }).click();
  await expect(page.getByText('Artikl 7001 založen')).toBeVisible();

  const rows = page.getByTestId('item-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Hala A › Řada 1 › Pozice 2');
  await expect(rows.nth(1)).toContainText('7001');

  // Search by number prefix ignores leading zeros.
  await page.getByLabel('Hledat').fill('070');
  await expect(rows).toHaveCount(1);
  await page.getByLabel('Hledat').fill('');
  await expect(rows).toHaveCount(2);

  // Taking an item out of service needs a reason.
  await rows.nth(0).click();
  const edit = page.getByRole('dialog', { name: `Artikl ${autoNumber}` });
  await edit.getByText('Vyřazen z provozu', { exact: true }).click();
  await edit.getByRole('button', { name: 'Uložit' }).click();
  await expect(edit.getByText('Uveďte důvod změny stavu')).toBeVisible();
  await edit.getByLabel('Důvod změny stavu').fill('Prasklá štěřina');
  await edit.getByRole('button', { name: 'Uložit' }).click();
  await expect(rows.nth(0)).toContainText('vyřazen z provozu');

  // Bulk move both items.
  await page.getByRole('checkbox', { name: 'Vybrat vše' }).check();
  await page.getByRole('button', { name: 'Přesunout…' }).click();
  await dialog(page).getByRole('combobox', { name: 'Nové umístění' }).click();
  await page.getByRole('option', { name: 'Hala A › Řada 1 › Pozice 5', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Provést' }).click();
  await expect(page.getByText('Upraveno 2 artiklů')).toBeVisible();
  await expect(rows.nth(0)).toContainText('Pozice 5');
  await expect(rows.nth(1)).toContainText('Pozice 5');
});

test('changing the type of a new item drops values of the previous type', async ({ page }) => {
  await login(page);
  await nav(page, 'Artikly');
  await choose(page, 'Zákazník', 'Sklad Brno s.r.o.');
  await choose(page, 'Provozovna', 'Hlavní sklad');
  await page.getByRole('button', { name: 'Nový artikl' }).click();
  const drawer = page.getByRole('dialog', { name: 'Nový artikl' });
  await drawer.getByRole('combobox', { name: 'Typ vybavení' }).click();
  await page.getByRole('option', { name: 'Žebřík', exact: true }).click();
  await drawer.getByRole('combobox', { name: 'Výrobce' }).fill('Krause');
  await drawer.getByRole('combobox', { name: 'Typ vybavení' }).click();
  await page.getByRole('option', { name: 'Regál', exact: true }).click();
  await drawer.getByRole('textbox', { name: 'Nosnost pole' }).fill('1500');
  await drawer.getByRole('button', { name: 'Založit artikl' }).click();
  await expect(page.getByText(/Artikl \d+ založen/)).toBeVisible();
});

test('rack bay load is prefilled as level load × levels and can be overwritten', async ({
  page,
}) => {
  await login(page);
  await page.request.post('/api/equipment-types', {
    data: { presetKey: 'rack', name: 'Regál (nosnost)' },
  });
  await nav(page, 'Artikly');
  await choose(page, 'Zákazník', 'Sklad Brno s.r.o.');
  await choose(page, 'Provozovna', 'Hlavní sklad');
  await page.getByRole('button', { name: 'Nový artikl' }).click();
  const drawer = page.getByRole('dialog', { name: 'Nový artikl' });
  await drawer.getByRole('combobox', { name: 'Typ vybavení' }).click();
  await page.getByRole('option', { name: 'Regál (nosnost)', exact: true }).click();
  const bayLoad = drawer.getByRole('textbox', { name: 'Nosnost pole' });
  await drawer.getByRole('textbox', { name: 'Počet úrovní / polic' }).fill('4');
  await drawer.getByRole('textbox', { name: 'Nosnost úrovně / police' }).fill('2000');
  await expect(bayLoad).toHaveValue('8000');
  await drawer.getByRole('textbox', { name: 'Počet úrovní / polic' }).fill('5');
  await expect(bayLoad).toHaveValue('10000');
  // A lower value from the load sign stays when the inputs change again.
  await bayLoad.fill('7200');
  await drawer.getByRole('textbox', { name: 'Počet úrovní / polic' }).fill('6');
  await expect(bayLoad).toHaveValue('7200');
});

test('admin deletes a user (with confirmation)', async ({ page }) => {
  await login(page);
  await page.request.post('/api/users', {
    data: {
      email: 'smazat@revize.local',
      displayName: 'Karel Smazat',
      role: 'inspector',
      password: 'x',
    },
  });
  await nav(page, 'Uživatelé');
  await page.getByRole('cell', { name: 'Karel Smazat' }).click();
  await dialog(page).getByRole('button', { name: 'Smazat uživatele' }).click();
  await dialog(page).getByRole('button', { name: 'Smazat', exact: true }).click();
  await expect(page.getByText('Uživatel smazán')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Karel Smazat' })).toBeHidden();
});

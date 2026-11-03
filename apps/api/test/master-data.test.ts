import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bearer, createTestContext, errorCode, type TestContext } from './helpers.js';

let ctx: TestContext;
let token: string;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.database.close();
});
beforeEach(async () => {
  await ctx.reset();
  token = (await ctx.login(ADMIN.email, ADMIN.password)).token;
});

async function api(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, as = token) {
  return ctx.app.inject({ method, url, headers: bearer(as), ...(payload ? { payload } : {}) });
}

async function setup() {
  const customer = (
    await api('POST', '/api/customers', { name: 'Sklad Brno s.r.o.', companyId: '12345678' })
  ).json();
  const site = (
    await api('POST', `/api/customers/${customer.id}/sites`, { name: 'Hlavní sklad' })
  ).json();
  const hall = (
    await api('POST', `/api/sites/${site.id}/locations`, { parentId: null, name: 'Hala A' })
  ).json();
  const ladder = (
    await api('POST', '/api/equipment-types', { presetKey: 'portable_ladder' })
  ).json();
  return { customer, site, hall, ladder };
}

const ladderValues = { manufacturer: 'Alve', ladder_type: 'Opěrný', rungs: 10 };

describe('customers and sites', () => {
  it('create, update with optimistic locking, archive', async () => {
    const created = await api('POST', '/api/customers', { name: 'ACME', contactEmail: '' });
    expect(created.statusCode).toBe(201);
    const customer = created.json();
    expect(customer).toMatchObject({ name: 'ACME', contactEmail: null, siteCount: 0, version: 1 });

    const updated = await api('PATCH', `/api/customers/${customer.id}`, {
      note: 'VIP',
      version: 1,
    });
    expect(updated.json()).toMatchObject({ note: 'VIP', version: 2 });
    const stale = await api('PATCH', `/api/customers/${customer.id}`, { note: 'x', version: 1 });
    expect(errorCode(stale)).toBe('version_conflict');

    await api('PATCH', `/api/customers/${customer.id}`, { archived: true, version: 2 });
    expect((await api('GET', '/api/customers')).json()).toHaveLength(0);
    expect((await api('GET', '/api/customers?includeArchived=true')).json()).toHaveLength(1);
  });

  it('is idempotent for a repeated create with the same id', async () => {
    const id = '0195f1a2-0000-7000-8000-0000000000aa';
    await api('POST', '/api/customers', { id, name: 'ACME' });
    await api('POST', '/api/customers', { id, name: 'ACME' });
    expect((await api('GET', '/api/customers')).json()).toHaveLength(1);
  });

  it('lets inspectors read but not write master data', async () => {
    await api('POST', '/api/users', {
      email: 'technik@test.cz',
      displayName: 'Technik',
      role: 'inspector',
      password: 'technik-heslo-1',
    });
    const { token: inspector } = await ctx.login('technik@test.cz', 'technik-heslo-1');
    expect((await api('GET', '/api/customers', undefined, inspector)).statusCode).toBe(200);
    expect((await api('POST', '/api/customers', { name: 'X' }, inspector)).statusCode).toBe(403);
  });
});

describe('locations', () => {
  it('builds a tree, creates series and sorts numerically', async () => {
    const { site, hall } = await setup();
    const row = (
      await api('POST', `/api/sites/${site.id}/locations`, { parentId: hall.id, name: 'Řada 1' })
    ).json();
    const series = await api('POST', `/api/sites/${site.id}/locations/series`, {
      parentId: row.id,
      prefix: 'Pozice',
      from: 1,
      to: 12,
    });
    expect(series.statusCode).toBe(201);
    expect(series.json()).toHaveLength(12);

    const list = (await api('GET', `/api/sites/${site.id}/locations`)).json();
    expect(list.map((l: { name: string }) => l.name).slice(0, 5)).toEqual([
      'Hala A',
      'Řada 1',
      'Pozice 1',
      'Pozice 2',
      'Pozice 3',
    ]);
    expect(list.at(-1)).toMatchObject({
      name: 'Pozice 12',
      depth: 2,
      pathNames: ['Hala A', 'Řada 1', 'Pozice 12'],
    });
  });

  it('moves a subtree and prevents cycles', async () => {
    const { site, hall } = await setup();
    const hallB = (
      await api('POST', `/api/sites/${site.id}/locations`, { parentId: null, name: 'Hala B' })
    ).json();
    const row = (
      await api('POST', `/api/sites/${site.id}/locations`, { parentId: hall.id, name: 'Řada 7' })
    ).json();
    const position = (
      await api('POST', `/api/sites/${site.id}/locations`, { parentId: row.id, name: 'Pozice 1' })
    ).json();

    const moved = await api('PATCH', `/api/locations/${row.id}`, {
      parentId: hallB.id,
      version: 1,
    });
    expect(moved.json().pathNames).toEqual(['Hala B', 'Řada 7']);
    const list = (await api('GET', `/api/sites/${site.id}/locations`)).json();
    expect(list.find((l: { id: string }) => l.id === position.id).pathNames).toEqual([
      'Hala B',
      'Řada 7',
      'Pozice 1',
    ]);
    // Tree order follows the move: Hala A, Hala B, Řada 7, Pozice 1.
    expect(list.map((l: { name: string }) => l.name)).toEqual([
      'Hala A',
      'Hala B',
      'Řada 7',
      'Pozice 1',
    ]);

    const cycle = await api('PATCH', `/api/locations/${hallB.id}`, {
      parentId: position.id,
      version: 1,
    });
    expect(errorCode(cycle)).toBe('location_cycle');
  });

  it('refuses to archive a location that still holds items', async () => {
    const { site, hall, ladder } = await setup();
    await api('POST', '/api/items', {
      siteId: site.id,
      locationId: hall.id,
      equipmentTypeId: ladder.id,
      fieldValues: ladderValues,
    });
    const archive = await api('PATCH', `/api/locations/${hall.id}`, { archived: true, version: 1 });
    expect(errorCode(archive)).toBe('location_has_items');
  });
});

describe('equipment types', () => {
  it('copies a library type and protects stored values when editing', async () => {
    const presets = (await api('GET', '/api/equipment-type-presets')).json();
    expect(presets.map((p: { key: string }) => p.key)).toContain('rack');

    const rack = (await api('POST', '/api/equipment-types', { presetKey: 'rack' })).json();
    expect(rack).toMatchObject({
      name: 'Regál',
      defaultIntervalMonths: 12,
      schemaVersion: 1,
    });
    expect(errorCode(await api('POST', '/api/equipment-types', { presetKey: 'rack' }))).toBe(
      'name_taken',
    );

    const withoutField = rack.fieldDefinitions.filter(
      (f: { key: string }) => f.key !== 'height_mm',
    );
    const removed = await api('PATCH', `/api/equipment-types/${rack.id}`, {
      fieldDefinitions: withoutField,
      version: 1,
    });
    expect(removed.statusCode).toBe(400);
    expect(removed.json().message).toContain('Archivujte');

    const archivedField = rack.fieldDefinitions.map((f: { key: string }) =>
      f.key === 'height_mm' ? { ...f, archived: true } : f,
    );
    const ok = await api('PATCH', `/api/equipment-types/${rack.id}`, {
      fieldDefinitions: archivedField,
      version: 1,
    });
    expect(ok.json()).toMatchObject({ schemaVersion: 2, version: 2 });
  });

  it('changes the kind of a saved field and converts the stored values', async () => {
    const { site, ladder } = await setup();
    const base = { siteId: site.id, locationId: null, equipmentTypeId: ladder.id };
    const values = { manufacturer: 'Alve', ladder_type: 'Opěrný', rungs: 8 };
    const one = (
      await api('POST', '/api/items', { ...base, fieldValues: { ...values, model: '150 kg' } })
    ).json();
    const two = (
      await api('POST', '/api/items', { ...base, fieldValues: { ...values, model: 'neznámý' } })
    ).json();
    const type = (await api('GET', `/api/equipment-types/${ladder.id}`)).json();
    const definitions = type.fieldDefinitions.map((f: { key: string }) =>
      f.key === 'model' ? { ...f, kind: 'integer' } : f,
    );

    const preview = (
      await api('POST', `/api/equipment-types/${ladder.id}/conversion-preview`, {
        fieldDefinitions: definitions,
      })
    ).json();
    expect(preview).toEqual([
      expect.objectContaining({
        key: 'model',
        from: 'text',
        to: 'integer',
        total: 2,
        converted: 0,
      }),
    ]);
    expect(preview[0].problems.map((p: { value: string }) => p.value).sort()).toEqual([
      '150 kg',
      'neznámý',
    ]);

    const saved = await api('PATCH', `/api/equipment-types/${ladder.id}`, {
      fieldDefinitions: definitions,
      version: type.version,
    });
    expect(saved.statusCode).toBe(200);
    expect((await api('GET', `/api/items/${one.id}`)).json().fieldValues.model).toBe(150);
    // What does not fit stays as text (nothing is lost).
    expect((await api('GET', `/api/items/${two.id}`)).json().fieldValues.model).toBe('neznámý');
  });

  it('creates a custom type', async () => {
    const created = await api('POST', '/api/equipment-types', {
      name: 'Pracovní plošina',
      defaultIntervalMonths: 6,
      protocolTemplate: 'Kontrola dne {{datum_kontroly}}',
      fieldDefinitions: [
        { key: 'max_height_m', label: 'Pracovní výška', kind: 'number', unit: 'm', order: 0 },
      ],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().fieldDefinitions[0]).toMatchObject({
      key: 'max_height_m',
      required: false,
    });
  });
});

describe('items', () => {
  it('assigns numbers from 1000, keeps číslo TZ unique in the organization', async () => {
    const { site, ladder } = await setup();
    const base = {
      siteId: site.id,
      locationId: null,
      equipmentTypeId: ladder.id,
      fieldValues: ladderValues,
    };

    const auto = await api('POST', '/api/items', base);
    expect(auto.statusCode).toBe(201);
    expect(auto.json()).toMatchObject({
      itemNumber: '1000',
      equipmentTypeName: 'Žebřík',
      status: 'in_service',
    });

    const four = await api('POST', '/api/items', { ...base, itemNumber: '04001' });
    expect(four.json().itemNumber).toBe('4001');
    await api('POST', '/api/items', { ...base, itemNumber: '10001', qrCode: 'R10001' });
    expect((await api('POST', '/api/items', base)).json().itemNumber).toBe('10002');

    const duplicate = await api('POST', '/api/items', { ...base, itemNumber: '4001' });
    expect(errorCode(duplicate)).toBe('item_number_taken');
    expect(duplicate.json().issues[0].path).toEqual(['itemNumber']);
    expect(errorCode(await api('POST', '/api/items', { ...base, qrCode: 'R10001' }))).toBe(
      'qr_code_taken',
    );
    expect((await api('POST', '/api/items', { ...base, itemNumber: '123456' })).statusCode).toBe(
      400,
    );

    // Unique across customers too.
    const other = (await api('POST', '/api/customers', { name: 'Jiný zákazník s.r.o.' })).json<{
      id: string;
    }>();
    const otherSite = (
      await api('POST', `/api/customers/${other.id}/sites`, { name: 'Sklad Ostrava' })
    ).json<{ id: string }>();
    expect(
      errorCode(
        await api('POST', '/api/items', { ...base, siteId: otherSite.id, itemNumber: '10001' }),
      ),
    ).toBe('item_number_taken');
  });

  it('keeps the designation unique within the site (case, spaces and dashes ignored)', async () => {
    const { site, ladder } = await setup();
    const base = {
      siteId: site.id,
      locationId: null,
      equipmentTypeId: ladder.id,
      fieldValues: ladderValues,
    };
    const first = await api('POST', '/api/items', { ...base, designation: ' Ž-01 ' });
    expect(first.json()).toMatchObject({ designation: 'Ž-01' });
    expect(errorCode(await api('POST', '/api/items', { ...base, designation: 'ž 01' }))).toBe(
      'designation_taken',
    );
    const second = (await api('POST', '/api/items', { ...base, designation: 'Ž-02' })).json();
    const found = (await api('GET', `/api/items?siteId=${site.id}&q=ž02`)).json();
    expect(found.items.map((i: { id: string }) => i.id)).toEqual([second.id]);
    // Retiring frees the designation.
    await api('PATCH', `/api/items/${first.json().id}`, {
      retired: true,
      version: first.json().version,
    });
    expect((await api('POST', '/api/items', { ...base, designation: 'Ž-01' })).statusCode).toBe(
      201,
    );
  });

  it('validates field values against the equipment type', async () => {
    const { site, ladder } = await setup();
    const response = await api('POST', '/api/items', {
      siteId: site.id,
      locationId: null,
      equipmentTypeId: ladder.id,
      fieldValues: { ladder_type: 'Kolo', rungs: 'deset', colour: 'red' },
    });
    expect(response.statusCode).toBe(400);
    const paths = response.json().issues.map((i: { path: string[] }) => i.path.join('.'));
    expect(paths).toEqual(
      expect.arrayContaining([
        'fieldValues.manufacturer',
        'fieldValues.ladder_type',
        'fieldValues.rungs',
        'fieldValues.colour',
      ]),
    );
  });

  it('lists with location subtree filter, search and numeric location order', async () => {
    const { site, hall, ladder } = await setup();
    const row = (
      await api('POST', `/api/sites/${site.id}/locations`, { parentId: hall.id, name: 'Řada 1' })
    ).json();
    const positions = (
      await api('POST', `/api/sites/${site.id}/locations/series`, {
        parentId: row.id,
        prefix: 'Pozice',
        from: 1,
        to: 10,
      })
    ).json();
    const other = (
      await api('POST', `/api/sites/${site.id}/locations`, { parentId: null, name: 'Hala B' })
    ).json();
    const create = (itemNumber: string, locationId: string, manufacturer = 'Alve') =>
      api('POST', '/api/items', {
        siteId: site.id,
        locationId,
        equipmentTypeId: ladder.id,
        itemNumber,
        fieldValues: { ...ladderValues, manufacturer },
      });
    await create('10003', positions[9].id); // Pozice 10
    await create('10001', positions[1].id); // Pozice 2
    await create('999', positions[1].id); // Pozice 2, shorter number first
    await create('20000', other.id, 'Krause');

    const inHallA = (await api('GET', `/api/items?locationId=${hall.id}`)).json();
    expect(inHallA.total).toBe(3);
    expect(inHallA.items.map((i: { itemNumber: string }) => i.itemNumber)).toEqual([
      '999',
      '10001',
      '10003',
    ]);
    expect(inHallA.items[0].locationPath).toEqual(['Hala A', 'Řada 1', 'Pozice 2']);

    expect((await api('GET', '/api/items?q=krause')).json().items[0].itemNumber).toBe('20000');
    expect(
      (await api('GET', '/api/items?q=01000'))
        .json()
        .items.map((i: { itemNumber: string }) => i.itemNumber),
    ).toEqual(['10001', '10003']);
  });

  it('requires a reason for status changes, audits them and supports bulk updates', async () => {
    const { site, hall, ladder } = await setup();
    const base = {
      siteId: site.id,
      locationId: hall.id,
      equipmentTypeId: ladder.id,
      fieldValues: ladderValues,
    };
    const a = (await api('POST', '/api/items', base)).json();
    const b = (await api('POST', '/api/items', base)).json();

    const noReason = await api('PATCH', `/api/items/${a.id}`, {
      status: 'out_of_service',
      version: 1,
    });
    expect(noReason.statusCode).toBe(400);
    const withReason = await api('PATCH', `/api/items/${a.id}`, {
      status: 'out_of_service',
      reason: 'Prasklá štěřina',
      version: 1,
    });
    expect(withReason.json().status).toBe('out_of_service');
    const audit = (await api('GET', `/api/audit?entityType=item&entityId=${a.id}`)).json();
    expect(audit[0]).toMatchObject({ action: 'item.status_change', reason: 'Prasklá štěřina' });

    const hallB = (
      await api('POST', `/api/sites/${site.id}/locations`, { parentId: null, name: 'Hala B' })
    ).json();
    const bulk = await api('POST', '/api/items/bulk-update', {
      ids: [a.id, b.id],
      set: { locationId: hallB.id },
    });
    expect(bulk.json()).toEqual({ updated: 2 });
    expect((await api('GET', `/api/items?locationId=${hallB.id}`)).json().total).toBe(2);

    const otherSite = (
      await api('POST', `/api/customers/${site.customerId}/sites`, { name: 'Pobočka' })
    ).json();
    const foreignLocation = (
      await api('POST', `/api/sites/${otherSite.id}/locations`, { parentId: null, name: 'X' })
    ).json();
    const wrong = await api('PATCH', `/api/items/${b.id}`, {
      locationId: foreignLocation.id,
      version: 2,
    });
    expect(wrong.statusCode).toBe(400);
  });
});

describe('validation messages', () => {
  it('reports an invalid contact e-mail on its field in Czech', async () => {
    const response = await api('POST', '/api/customers', {
      name: 'ACME',
      contactEmail: 'neni-email',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().issues).toEqual([
      { path: ['contactEmail'], message: 'Neplatný e-mail' },
    ]);
  });
});

describe('counts', () => {
  it('reports item and site counts on customers, sites, locations and types', async () => {
    const { customer, site, hall, ladder } = await setup();
    await api('POST', '/api/items', {
      siteId: site.id,
      locationId: hall.id,
      equipmentTypeId: ladder.id,
      fieldValues: ladderValues,
    });
    await api('POST', '/api/items', {
      siteId: site.id,
      locationId: null,
      equipmentTypeId: ladder.id,
      fieldValues: ladderValues,
    });

    expect((await api('GET', `/api/customers/${customer.id}`)).json()).toMatchObject({
      siteCount: 1,
      itemCount: 2,
    });
    expect((await api('GET', `/api/sites/${site.id}`)).json()).toMatchObject({ itemCount: 2 });
    expect((await api('GET', `/api/equipment-types/${ladder.id}`)).json()).toMatchObject({
      itemCount: 2,
    });
    const locations = (await api('GET', `/api/sites/${site.id}/locations`)).json();
    expect(locations[0]).toMatchObject({ name: 'Hala A', itemCount: 1 });
  });
});

describe('default products of fields', () => {
  it('fills an empty rack bay load as level load × levels, keeps a given one', async () => {
    const { site } = await setup();
    const rack = (
      await api('POST', '/api/equipment-types', {
        presetKey: 'rack',
        name: 'Regál (součin)',
      })
    ).json();
    const base = {
      siteId: site.id,
      locationId: null,
      equipmentTypeId: rack.id,
      fieldValues: {
        rack_type: 'Paletový',
        manufacturer: 'Mecalux',
        configuration: 'Jednostranný',
        levels: 4,
        level_load_kg: 2000,
      },
    };
    const filled = await api('POST', '/api/items', base);
    expect(filled.json().fieldValues.bay_load_kg).toBe(8000);
    const given = await api('POST', '/api/items', {
      ...base,
      fieldValues: { ...base.fieldValues, bay_load_kg: 7200 },
    });
    expect(given.json().fieldValues.bay_load_kg).toBe(7200);
  });
});

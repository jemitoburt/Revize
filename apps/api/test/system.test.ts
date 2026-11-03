import { asc, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrap } from '../src/bootstrap.js';
import { EQUIPMENT_TYPE_PRESETS, newId } from '@revize/shared';
import { appUser, equipmentType, item, location, organization, photo } from '../src/db/schema.js';
import { DEMO_INSPECTOR } from '../src/seed/demo.js';
import { createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.database.close();
});

describe('health and OpenAPI', () => {
  it('reports database health', async () => {
    const response = await ctx.app.inject({ url: '/api/health' });
    expect(response.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('publishes the OpenAPI document', async () => {
    const response = await ctx.app.inject({ url: '/api/docs/json' });
    expect(response.statusCode).toBe(200);
    const doc = response.json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/api/auth/login', '/api/users', '/api/users/{id}', '/api/audit']),
    );
  });
});

describe('bootstrap and demo data', () => {
  it('creates the first administrator only once', async () => {
    await ctx.reset();
    await bootstrap(ctx.database.db, ctx.config, ctx.app.log);
    const [admins] = await ctx.database.db.select({ value: count() }).from(appUser);
    expect(admins?.value).toBe(1);
  });

  it('seeds the demo customer, the library equipment types and items in location order', async () => {
    await ctx.reset({ seedDemo: true });
    const db = ctx.database.db;
    const types = await db.select().from(equipmentType).orderBy(asc(equipmentType.name));
    expect(types.map((t) => t.name).sort()).toEqual(
      EQUIPMENT_TYPE_PRESETS.map((p) => p.name).sort(),
    );
    const byName = new Map(types.map((t) => [t.name, t]));
    expect(byName.get('Žebřík')!.fieldDefinitions.map((f) => f.key)).toContain('ladder_type');
    expect(byName.get('Regál paletový')!.protocolTemplate).toContain('ČSN EN 15635');

    const items = await db
      .select({ number: item.itemNumber, qr: item.qrCode, sortPath: location.sortPath })
      .from(item)
      .innerJoin(location, eq(location.id, item.locationId))
      .orderBy(asc(location.sortPath));
    expect(items).toHaveLength(35);
    expect(items[0]).toMatchObject({ number: '10001', qr: 'R10001' });
    // Location order: the 5-digit series in halls A–B, then the 4-digit series in hall C.
    expect(items.slice(0, 30).map((i) => i.number)).toEqual(
      [...items.slice(0, 30).map((i) => i.number)].sort(),
    );
    expect(items.slice(30).map((i) => i.number)).toEqual(['4001', '4002', '4003', '4004', '4005']);

    await expect(ctx.login(DEMO_INSPECTOR.email, DEMO_INSPECTOR.password)).resolves.toBeTruthy();
  });
});

describe('photo ownership', () => {
  it('requires exactly one owner: item, inspection result or inspection', async () => {
    await ctx.reset({ seedDemo: true });
    const db = ctx.database.db;
    const [org] = await db.select().from(organization);
    const [anItem] = await db.select().from(item).limit(1);
    const base = {
      organizationId: org!.id,
      storageKey: 'k',
      mimeType: 'image/jpeg',
      sizeBytes: 1,
      sha256: 'x',
    };

    await expect(
      db.insert(photo).values({ ...base, id: newId(), itemId: anItem!.id }),
    ).resolves.toBeDefined();
    await expect(db.insert(photo).values({ ...base, id: newId() })).rejects.toThrow();
    const [anyPhoto] = await db.select().from(photo).limit(1);
    expect(anyPhoto?.inspectionId).toBeNull();
  });
});

import {
  EQUIPMENT_TYPE_PRESETS,
  buildFieldValuesSchema,
  designationOf,
  locationPath,
  newId,
  type EquipmentTypePreset,
  type LocationPath,
} from '@revize/shared';
import { count, eq } from 'drizzle-orm';
import { hashPassword } from '../auth/passwords.js';
import type { Db, Tx } from '../db/client.js';
import { appUser, customer, equipmentType, item, location, site } from '../db/schema.js';

export const DEMO_INSPECTOR = { email: 'technik@revize.local', password: 'technik-demo-heslo' };

const ladderValues = (i: number) => ({
  manufacturer: ['Krause', 'Alve', 'Hailo'][i % 3]!,
  ladder_type: ['Opěrný', 'Dvojitý (štaflový)', 'Víceúčelový'][i % 3]!,
  standard: i % 2 ? 'EN 131 Professional' : 'EN 131 (před r. 2018)',
  material: 'Hliník',
  rungs: [6, 8, 10, 12][i % 4]!,
  max_load_kg: 150,
  year: 2015 + (i % 9),
});

const rackValues = (i: number) => ({
  rack_type: i % 4 === 1 ? 'Policový' : 'Paletový',
  manufacturer: ['Mecalux', 'Stow', 'Jungheinrich'][i % 3]!,
  configuration: ['Jednostranný', 'Oboustranný', 'Double deep'][i % 3]!,
  height_mm: [4500, 6000, 7500][i % 3]!,
  bay_width_mm: [1825, 2225, 2700][i % 3]!,
  levels: [3, 4, 5][i % 3]!,
  bay_load_kg: [6000, 9000, 12000][i % 3]!,
  load_sign: i % 5 !== 0,
  anchored: true,
  year: 2012 + (i % 12),
});

/** Field values go through the type's validator, so demo data cannot drift from the presets. */
function valuesFor(preset: EquipmentTypePreset, values: Record<string, unknown>) {
  return buildFieldValuesSchema(preset.fieldDefinitions).parse(values);
}

/**
 * Demo data for the prototype: inspector, all equipment types of the shared library, one
 * customer with a site, a hall › row › position tree, 30 items of a 5-digit series (numbers and
 * QR codes R10001… match the printable QR test sheet of the spike) and a 4-digit series
 * 4001–4005 in the same site. Skipped when the organization already has customers.
 */
export async function seedDemo(db: Db, organizationId: string): Promise<boolean> {
  const [existing] = await db
    .select({ value: count() })
    .from(customer)
    .where(eq(customer.organizationId, organizationId));
  if ((existing?.value ?? 0) > 0) return false;

  await db.transaction(async (tx) => {
    await tx
      .insert(appUser)
      .values({
        id: newId(),
        organizationId,
        email: DEMO_INSPECTOR.email,
        displayName: 'Jan Technik',
        role: 'inspector',
        passwordHash: await hashPassword(DEMO_INSPECTOR.password),
      })
      .onConflictDoNothing();

    const typeIds = new Map<string, string>();
    for (const preset of EQUIPMENT_TYPE_PRESETS) {
      const id = newId();
      typeIds.set(preset.key, id);
      await tx.insert(equipmentType).values({
        id,
        organizationId,
        name: preset.name,
        fieldDefinitions: preset.fieldDefinitions,
        defaultIntervalMonths: preset.defaultIntervalMonths,
        protocolTemplate: preset.protocolTemplate,
        riskLevels: preset.riskLevels ?? false,
      });
    }
    const ladder = EQUIPMENT_TYPE_PRESETS.find((p) => p.key === 'portable_ladder')!;
    const rack = EQUIPMENT_TYPE_PRESETS.find((p) => p.key === 'rack')!;

    const customerId = newId();
    await tx.insert(customer).values({
      id: customerId,
      organizationId,
      name: 'Ukázkový sklad s.r.o.',
      companyId: '12345678',
      address: 'Skladová 1, 602 00 Brno',
      contactName: 'Petra Skladníková',
      contactEmail: 'sklad@example.cz',
      contactPhone: '+420 600 000 000',
    });
    const siteId = newId();
    await tx.insert(site).values({
      id: siteId,
      organizationId,
      customerId,
      name: 'Provozovna Brno',
      address: 'Skladová 1, 602 00 Brno',
    });

    const positions = await createLocationTree(tx, organizationId, siteId);
    const year = new Date().getFullYear();
    const base = { organizationId, customerId, siteId };
    await tx.insert(item).values([
      ...positions.slice(0, 30).map((locationId, i) => {
        const n = 10001 + i;
        const isLadder = i % 3 === 0;
        // Designation: ladders "Ž-01"…, racks by hall, row and position ("A1-01").
        const designation = isLadder
          ? `Ž-${String(i / 3 + 1).padStart(2, '0')}`
          : `${i < 15 ? 'A' : 'B'}${Math.floor((i % 15) / 5) + 1}-${String((i % 5) + 1).padStart(2, '0')}`;
        return {
          ...base,
          id: newId(),
          locationId,
          equipmentTypeId: typeIds.get(isLadder ? ladder.key : rack.key)!,
          itemNumber: String(n),
          ...designationOf(designation),
          qrCode: `R${n}`,
          fieldValues: isLadder
            ? valuesFor(ladder, ladderValues(i))
            : valuesFor(rack, rackValues(i)),
          nextInspectionDate: `${year}-${String(1 + (i % 12)).padStart(2, '0')}-15`,
        };
      }),
      // A 4-digit series of ladders in the same site (hall C).
      ...positions.slice(30, 35).map((locationId, i) => ({
        ...base,
        id: newId(),
        locationId,
        equipmentTypeId: typeIds.get(ladder.key)!,
        itemNumber: String(4001 + i),
        ...designationOf(`Ž-${21 + i}`),
        qrCode: null,
        fieldValues: valuesFor(ladder, ladderValues(i)),
        nextInspectionDate: `${year}-11-15`,
      })),
    ]);
  });
  return true;
}

/** Hala A–B › Řada 1–3 › Pozice 1–5 and Hala C › Řada 5 › Pozice 1–5; position ids in order. */
async function createLocationTree(tx: Tx, organizationId: string, siteId: string) {
  const positions: string[] = [];
  const add = async (
    parent: LocationPath | null,
    parentId: string | null,
    name: string,
    order: number,
  ) => {
    const id = newId();
    const path = locationPath(parent, id, order);
    await tx
      .insert(location)
      .values({ id, organizationId, siteId, parentId, name, sortOrder: order, ...path });
    return { id, path };
  };
  const halls: [name: string, rows: number[]][] = [
    ['Hala A', [1, 2, 3]],
    ['Hala B', [1, 2, 3]],
    ['Hala C', [5]],
  ];
  for (const [h, [hallName, rows]] of halls.entries()) {
    const hall = await add(null, null, hallName, h + 1);
    for (const r of rows) {
      const row = await add(hall.path, hall.id, `Řada ${r}`, r);
      for (let p = 1; p <= 5; p++) {
        positions.push((await add(row.path, row.id, `Pozice ${p}`, p)).id);
      }
    }
  }
  return positions;
}

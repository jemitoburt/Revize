import { equipmentTypePreset, type FieldDefinition } from '@revize/shared';

export const TYPE_NAMES = ['Regál', 'Žebřík'] as const;
export type TypeName = (typeof TYPE_NAMES)[number];

/** The spike uses two types from the shared library (same fields as the server). */
export const EQUIPMENT_TYPES: Record<TypeName, FieldDefinition[]> = {
  Regál: equipmentTypePreset('rack')!.fieldDefinitions,
  Žebřík: equipmentTypePreset('portable_ladder')!.fieldDefinitions,
};

export interface CatalogItem {
  itemNumber: string;
  qrCode: string | null;
  type: TypeName;
  hall: string;
  row: number;
  position: number;
  fieldValues: Record<string, unknown>;
  lastInspection: { date: string; result: string } | null;
  nextInspection: string | null;
  /** Created in the field (stored in IndexedDB), not part of the demo catalog. */
  local?: { createdAt: string; inspectionId: string };
}

/** Item numbers used by the printable test sheet. */
export const FIRST_ITEM = 10001;
export const ITEM_COUNT = 50;

/** Base of label URLs, mirrors the phase-2 label format `https://<server>/q/<code>`. */
export const LABEL_URL_BASE = 'https://revize.example/q/';

export const MOCK_CUSTOMER = {
  name: 'Ukázkový sklad s.r.o.',
  site: 'Provozovna Brno – Hala A–C',
};

const pick = <T>(list: readonly T[], i: number): T => list[i % list.length]!;

export const MOCK_ITEMS: CatalogItem[] = Array.from({ length: ITEM_COUNT }, (_, i) => {
  const n = FIRST_ITEM + i;
  const type: TypeName = i % 3 === 0 ? 'Žebřík' : 'Regál';
  return {
    itemNumber: String(n),
    qrCode: `R${n}`,
    type,
    hall: String.fromCharCode(65 + Math.floor(i / 20)),
    row: 1 + (Math.floor(i / 5) % 4),
    position: 1 + (i % 5),
    fieldValues:
      type === 'Regál'
        ? {
            manufacturer: pick(['Mecalux', 'Stow', 'Jungheinrich', 'Kasten'], i),
            configuration: pick(['Jednostranný', 'Oboustranný', 'Double deep'], i),
            height_mm: pick([4500, 6000, 7500, 9000], i),
            bay_width_mm: pick([1825, 2225, 2700], i),
            levels: pick([3, 4, 5, 6], i),
            bay_load_kg: pick([6000, 9000, 12000], i),
            load_sign: i % 5 !== 0,
            anchored: true,
            year: 2012 + (i % 12),
          }
        : {
            manufacturer: pick(['Krause', 'Alve', 'Hailo'], i),
            ladder_type: pick(
              ['Dvojitý (štaflový)', 'Opěrný', 'Schůdky', 'Pojízdný s plošinou'],
              i,
            ),
            standard: pick(['EN 131 Professional', 'EN 131 (před r. 2018)'], i),
            rungs: pick([6, 8, 10, 12], i),
            max_load_kg: 150,
            material: pick(['Hliník', 'Ocel', 'Sklolaminát'], i),
            year: 2015 + (i % 9),
          },
    lastInspection:
      i % 7 === 6 ? null : { date: '2025-11-14', result: i % 9 === 4 ? 'Závada' : 'V pořádku' },
    nextInspection: '2026-11-14',
  };
});

/** A 4-digit series in the same site (hall C) – both series live side by side. */
export const MOCK_ITEMS_4_DIGIT: CatalogItem[] = Array.from({ length: 5 }, (_, i) => ({
  itemNumber: String(4001 + i),
  qrCode: null,
  type: 'Žebřík',
  hall: 'C',
  row: 5,
  position: 1 + i,
  fieldValues: {
    manufacturer: 'Alve',
    ladder_type: 'Dvojitý (štaflový)',
    standard: 'EN 131 Professional',
    rungs: 4 + i,
    max_load_kg: 150,
  },
  lastInspection: { date: '2025-11-14', result: 'V pořádku' },
  nextInspection: '2026-11-14',
}));

export function locationLabel(item: CatalogItem): string {
  return `Hala ${item.hall} › Řada ${item.row} › Pozice ${item.position}`;
}

/** Sort key for "sorted by location": hall, row, position, then item number. */
export function compareByLocation(a: CatalogItem, b: CatalogItem): number {
  return (
    a.hall.localeCompare(b.hall) ||
    a.row - b.row ||
    a.position - b.position ||
    a.itemNumber.length - b.itemNumber.length ||
    a.itemNumber.localeCompare(b.itemNumber)
  );
}

function formatValue(field: FieldDefinition, value: unknown): string {
  if (typeof value === 'boolean') return value ? 'ano' : 'ne';
  if (Array.isArray(value)) return value.join(', ');
  if (field.kind === 'date' && typeof value === 'string') {
    return new Date(value).toLocaleDateString('cs-CZ');
  }
  const text = typeof value === 'number' ? value.toLocaleString('cs-CZ') : String(value);
  return field.unit ? `${text} ${field.unit}` : text;
}

/** Label/value pairs of the type's fields, in definition order (empty values skipped). */
export function displayFields(item: CatalogItem): [label: string, value: string][] {
  return EQUIPMENT_TYPES[item.type]
    .filter((field) => !field.archived)
    .sort((a, b) => a.order - b.order)
    .flatMap((field): [string, string][] => {
      const value = item.fieldValues[field.key];
      if (value === undefined || value === null || value === '') return [];
      return [[field.label, formatValue(field, value)]];
    });
}

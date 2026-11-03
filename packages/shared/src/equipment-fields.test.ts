import { describe, expect, it } from 'vitest';
import {
  buildFieldValuesSchema,
  applyDefaultProducts,
  displayFields,
  fieldDefinitionsSchema,
  type FieldDefinition,
} from './equipment-fields.js';

const definitions: FieldDefinition[] = fieldDefinitionsSchema.parse([
  { key: 'manufacturer', label: 'Výrobce', kind: 'text', required: true, order: 0 },
  { key: 'height_mm', label: 'Výška', kind: 'integer', unit: 'mm', order: 1 },
  { key: 'material', label: 'Materiál', kind: 'select', options: ['Hliník', 'Ocel'], order: 2 },
  { key: 'checked_on', label: 'Datum', kind: 'date', order: 3 },
  { key: 'tags', label: 'Štítky', kind: 'multiselect', options: ['A', 'B'], order: 4 },
  { key: 'old_code', label: 'Starý kód', kind: 'text', order: 5, archived: true },
]);
const schema = buildFieldValuesSchema(definitions);

describe('field definitions', () => {
  it('rejects duplicate keys and selects without options', () => {
    const result = fieldDefinitionsSchema.safeParse([
      { key: 'a', label: 'A', kind: 'text', order: 0 },
      { key: 'a', label: 'B', kind: 'select', order: 1 },
    ]);
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => i.message);
    expect(messages).toContain('Duplicitní klíč „a“');
    expect(messages).toContain('Číselník musí mít aspoň jednu hodnotu');
  });

  it('rejects invalid keys', () => {
    expect(
      fieldDefinitionsSchema.safeParse([{ key: 'Výška', label: 'V', kind: 'text', order: 0 }])
        .success,
    ).toBe(false);
  });
});

describe('buildFieldValuesSchema', () => {
  it('accepts valid values and drops empty optional ones', () => {
    expect(
      schema.parse({
        manufacturer: ' Krause ',
        height_mm: 2400,
        material: 'Ocel',
        tags: [],
        checked_on: '',
      }),
    ).toEqual({ manufacturer: 'Krause', height_mm: 2400, material: 'Ocel' });
  });

  it('reports every problem with its field path', () => {
    const result = schema.safeParse({
      height_mm: 12.5,
      material: 'Dřevo',
      checked_on: '2026-02-30x',
      unknown: 1,
    });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(
      expect.arrayContaining(['manufacturer', 'height_mm', 'material', 'checked_on', 'unknown']),
    );
  });

  it('keeps values of archived fields', () => {
    expect(schema.parse({ manufacturer: 'Alve', old_code: 'X-1' })).toEqual({
      manufacturer: 'Alve',
      old_code: 'X-1',
    });
  });
});

describe('displayFields', () => {
  it('formats values in Czech in definition order and skips empty ones', () => {
    const definitions = fieldDefinitionsSchema.parse([
      { key: 'b', label: 'Výška', kind: 'number', unit: 'mm', order: 2 },
      { key: 'a', label: 'Výrobce', kind: 'text', order: 1 },
      { key: 'c', label: 'Kotveno', kind: 'boolean', order: 3 },
      { key: 'd', label: 'Revize', kind: 'date', order: 4 },
      { key: 'e', label: 'Poznámka', kind: 'text', order: 5 },
    ]);
    expect(
      displayFields(definitions, { a: 'Mecalux', b: 4500, c: true, d: '2026-03-05', e: '' }),
    ).toEqual([
      { label: 'Výrobce', value: 'Mecalux' },
      { label: 'Výška', value: '4\u00a0500 mm' },
      { label: 'Kotveno', value: 'ano' },
      { label: 'Revize', value: '05/03/2026' },
    ]);
  });
});

describe('applyDefaultProducts', () => {
  const definitions = fieldDefinitionsSchema.parse([
    { key: 'levels', label: 'Počet úrovní', kind: 'integer', order: 1 },
    { key: 'level_load_kg', label: 'Nosnost úrovně', kind: 'integer', order: 2 },
    {
      key: 'bay_load_kg',
      label: 'Nosnost pole',
      kind: 'integer',
      order: 3,
      defaultProduct: ['level_load_kg', 'levels'],
    },
  ]);

  it('prefills the product once all inputs are numbers', () => {
    expect(applyDefaultProducts(definitions, { levels: 4 })).toEqual({ levels: 4 });
    expect(applyDefaultProducts(definitions, { levels: 4, level_load_kg: 2000 })).toEqual({
      levels: 4,
      level_load_kg: 2000,
      bay_load_kg: 8000,
    });
  });

  it('follows changed inputs while the prefill is untouched, keeps a value typed by hand', () => {
    const before = { levels: 4, level_load_kg: 2000, bay_load_kg: 8000 };
    expect(applyDefaultProducts(definitions, { ...before, levels: 5 }, before).bay_load_kg).toBe(
      10_000,
    );
    const fromSign = { ...before, bay_load_kg: 7200 };
    expect(
      applyDefaultProducts(definitions, { ...fromSign, levels: 5 }, fromSign).bay_load_kg,
    ).toBe(7200);
    // Import / API (no previous values): only empty fields are filled.
    expect(applyDefaultProducts(definitions, fromSign).bay_load_kg).toBe(7200);
  });

  it('rejects products of non-numeric or missing fields', () => {
    const invalid = fieldDefinitionsSchema.safeParse([
      { key: 'maker', label: 'Výrobce', kind: 'text', order: 1 },
      {
        key: 'total',
        label: 'Celkem',
        kind: 'integer',
        order: 2,
        defaultProduct: ['maker', 'nope'],
      },
    ]);
    expect(invalid.success).toBe(false);
    expect(invalid.error?.issues.map((i) => i.path.join('.'))).toEqual([
      '1.defaultProduct',
      '1.defaultProduct',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { equipmentTypePreset } from '../equipment-presets.js';
import { importMappingSchema } from './mapping.js';
import { buildRowCandidate } from './rows.js';

const ladder = equipmentTypePreset('portable_ladder')!.fieldDefinitions;
const mapping = importMappingSchema.parse({
  siteId: '0195f1a2-0000-7000-8000-000000000001',
  equipmentTypeId: '0195f1a2-0000-7000-8000-000000000002',
  itemNumber: 0,
  qrCode: 1,
  location: [2],
  locationSeparator: '/',
  nextInspectionDate: 3,
  fields: { manufacturer: 4, ladder_type: 5, rungs: 6 },
});

describe('buildRowCandidate', () => {
  it('builds a valid item from a row', () => {
    const candidate = buildRowCandidate(
      ['04001', 'R1', 'Hala A / Řada 1', '14.11.2026', 'Alve', 'opěrný', 9],
      2,
      mapping,
      ladder,
    );
    expect(candidate).toMatchObject({
      rowNumber: 2,
      empty: false,
      itemNumber: '4001',
      qrCode: 'R1',
      locationPath: ['Hala A', 'Řada 1'],
      nextInspectionDate: '2026-11-14',
      fieldValues: { manufacturer: 'Alve', ladder_type: 'Opěrný', rungs: 9 },
      issues: [],
    });
  });

  it('accepts numeric item numbers from XLSX and reports every problem with its column', () => {
    const candidate = buildRowCandidate(
      [10001.5, null, '', 'zítra', '', 'Kolo', 'deset'],
      3,
      mapping,
      ladder,
    );
    // Only the item number is an error; everything else is imported with a warning.
    expect(candidate.issues.map((i) => [i.column, i.message])).toEqual([
      [
        0,
        '„10001.5“ není číslo TZ (4 nebo 5 číslic) – patří-li do Označení, namapujte sloupec tam',
      ],
    ]);
    const byColumn = Object.fromEntries(candidate.warnings.map((i) => [i.column, i.message]));
    expect(byColumn[3]).toContain('není datum');
    expect(byColumn[4]).toContain('Chybí povinná hodnota „Výrobce“');
    expect(byColumn[5]).toContain('nová hodnota číselníku');
    expect(byColumn[6]).toContain('„deset“ není číslo – uloženo jako text');
    expect(candidate.fieldValues).toMatchObject({ ladder_type: 'Kolo', rungs: 'deset' });
    expect(candidate.newOptions).toEqual({ ladder_type: ['Kolo'] });
    expect(
      buildRowCandidate([10001, null, '', '', 'Alve', 'Opěrný', 8], 4, mapping, ladder).itemNumber,
    ).toBe('10001');
  });

  it('marks empty rows and missing numbers', () => {
    expect(buildRowCandidate(['', null, '', '', '', '', ''], 5, mapping, ladder).empty).toBe(true);
    const strict = { ...mapping, autoNumber: false };
    const missing = buildRowCandidate(['', null, '', '', 'Alve', 'Opěrný', 8], 6, strict, ladder);
    expect(missing.issues).toEqual([{ column: 0, message: 'Chybí číslo TZ' }]);
  });
});

describe('buildRowCandidate for updates', () => {
  it('keeps existing values for empty cells and satisfies required fields from them', () => {
    const base = { manufacturer: 'Alve', ladder_type: 'Opěrný', rungs: 9, year: 2018 };
    const candidate = buildRowCandidate(
      ['10001', null, '', '', '', '', 12],
      2,
      mapping,
      ladder,
      base,
    );
    expect(candidate.issues).toEqual([]);
    expect(candidate.fieldValues).toEqual({ ...base, rungs: 12 });
  });
});

describe('buildRowCandidate with a default product', () => {
  it('fills an empty bay load as level load × levels, keeps a given one', () => {
    const rack = equipmentTypePreset('rack')!.fieldDefinitions;
    const rackMapping = importMappingSchema.parse({
      siteId: '0195f1a2-0000-7000-8000-000000000001',
      equipmentTypeId: '0195f1a2-0000-7000-8000-000000000002',
      itemNumber: 0,
      fields: { manufacturer: 1, configuration: 2, levels: 3, level_load_kg: 4, bay_load_kg: 5 },
    });
    const row = (bayLoad: string) =>
      buildRowCandidate(
        ['1', 'Mecalux', 'Jednostranný', 4, '2 000', bayLoad],
        2,
        rackMapping,
        rack,
      );
    expect(row('').fieldValues.bay_load_kg).toBe(8000);
    expect(row('7200').fieldValues.bay_load_kg).toBe(7200);
  });
});

describe('buildRowCandidate with replacements and default values', () => {
  const withValues = importMappingSchema.parse({
    ...mapping,
    fields: { manufacturer: 4, ladder_type: 5, rungs: 6 },
    replacements: { ladder_type: [{ from: 'kolo', to: 'Opěrný' }] },
    defaults: { max_load_kg: '150 kg', manufacturer: 'Neznámý' },
  });

  it('replaces values in every row and fills fields the sheet does not have', () => {
    const candidate = buildRowCandidate(
      ['1', '', '', '', 'Alve', 'Kolo', 8],
      2,
      withValues,
      ladder,
    );
    expect(candidate.fieldValues).toMatchObject({
      manufacturer: 'Alve',
      ladder_type: 'Opěrný',
      max_load_kg: 150,
    });
    expect(candidate.newOptions).toEqual({});
    expect(candidate.warnings).toEqual([]);
    // The default also fills an empty cell of a mapped column.
    expect(
      buildRowCandidate(['2', '', '', '', '', 'Opěrný', 8], 3, withValues, ladder).fieldValues
        .manufacturer,
    ).toBe('Neznámý');
  });

  it('replaces only in the field it belongs to', () => {
    // "8" → "10" for the rungs must not touch an "8" elsewhere (here: the manufacturer column).
    const perField = importMappingSchema.parse({
      ...withValues,
      replacements: { rungs: [{ from: '8', to: '10' }] },
    });
    expect(
      buildRowCandidate(['1', '', '', '', '8', 'Opěrný', 8], 2, perField, ladder).fieldValues,
    ).toMatchObject({ manufacturer: '8', rungs: 10 });
  });

  it('keeps an existing value instead of the default when updating', () => {
    const candidate = buildRowCandidate(
      ['1', '', '', '', 'Alve', 'Opěrný', 8],
      2,
      withValues,
      ladder,
      {
        max_load_kg: 120,
      },
    );
    expect(candidate.fieldValues.max_load_kg).toBe(120);
  });

  it('does not turn an empty row into an item', () => {
    expect(buildRowCandidate(['', '', '', '', '', '', ''], 4, withValues, ladder).empty).toBe(true);
  });
});

describe('buildRowCandidate for the problem list', () => {
  it('tells the field and value of a warning and leaves skipped values out', () => {
    const row = ['10001', '', '', '', 'Alve', 'dvojitý', 'deset'];
    const warned = buildRowCandidate(row, 2, mapping, ladder);
    expect(warned.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column: 5, field: 'ladder_type', value: 'dvojitý' }),
        expect.objectContaining({ column: 6, field: 'rungs', value: 'deset' }),
      ]),
    );
    const skipped = buildRowCandidate(
      row,
      2,
      {
        ...mapping,
        replacements: {
          ladder_type: [{ from: 'Dvojitý', to: '', skip: true }],
          rungs: [{ from: 'deset', to: '10' }],
        },
      },
      ladder,
    );
    expect(skipped.fieldValues.ladder_type).toBeUndefined();
    expect(skipped.fieldValues.rungs).toBe(10);
    expect(skipped.newOptions).toEqual({});
    expect(skipped.warnings.filter((w) => w.field)).toEqual([]);
  });
});

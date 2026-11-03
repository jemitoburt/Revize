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
      [0, '„10001.5“ není číslo artiklu (1–8 číslic)'],
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
    expect(missing.issues).toEqual([{ column: 0, message: 'Chybí číslo artiklu' }]);
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
    const rack = equipmentTypePreset('pallet_rack')!.fieldDefinitions;
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

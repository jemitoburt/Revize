import { describe, expect, it } from 'vitest';
import { buildFieldValuesSchema } from './equipment-fields.js';
import { EQUIPMENT_TYPE_PRESETS, fillProtocolTemplate } from './equipment-presets.js';

describe('equipment type presets', () => {
  it('have unique keys and names and valid field definitions', () => {
    expect(new Set(EQUIPMENT_TYPE_PRESETS.map((p) => p.key)).size).toBe(
      EQUIPMENT_TYPE_PRESETS.length,
    );
    expect(new Set(EQUIPMENT_TYPE_PRESETS.map((p) => p.name)).size).toBe(
      EQUIPMENT_TYPE_PRESETS.length,
    );
    for (const preset of EQUIPMENT_TYPE_PRESETS) {
      expect(preset.fieldDefinitions.length).toBeGreaterThan(3);
      const orders = preset.fieldDefinitions.map((f) => f.order);
      expect(new Set(orders).size).toBe(orders.length);
      expect(preset.protocolTemplate).toMatch(/^# /);
    }
  });

  it('accept realistic values', () => {
    const ladder = EQUIPMENT_TYPE_PRESETS.find((p) => p.key === 'portable_ladder')!;
    expect(
      buildFieldValuesSchema(ladder.fieldDefinitions).parse({
        manufacturer: 'Alve',
        ladder_type: 'Víceúčelový',
        standard: 'EN 131 Professional',
        rungs: 9,
        length_m: 5.6,
        stabilizer: true,
      }),
    ).toMatchObject({ manufacturer: 'Alve', rungs: 9 });
  });

  it('describes textile lifting slings (fit / unfit, 12 months)', () => {
    const sling = EQUIPMENT_TYPE_PRESETS.find((p) => p.key === 'lifting_sling')!;
    expect(sling.riskLevels).toBeFalsy();
    expect(sling.defaultIntervalMonths).toBe(12);
    expect(
      buildFieldValuesSchema(sling.fieldDefinitions).parse({
        manufacturer: 'Dolezych',
        sling_type: 'Kruhová smyce (EN 1492-2)',
        wll_t: 2,
        colour: 'Zelená (2 t)',
        length_m: 3,
        material: 'Polyester (PES)',
        label_ok: true,
      }),
    ).toMatchObject({ wll_t: 2, label_ok: true });
  });

  it('fills protocol placeholders', () => {
    expect(
      fillProtocolTemplate('Dne {{datum_kontroly}} u {{ zakaznik }}, {{neznamy}}', {
        datum_kontroly: '1. 11. 2026',
        zakaznik: 'ACME',
      }),
    ).toBe('Dne 1. 11. 2026 u ACME, {{neznamy}}');
  });
});

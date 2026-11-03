import { describe, expect, it } from 'vitest';
import { fieldDefinitionsSchema } from './equipment-fields.js';
import { convertItemValues, kindChanges, summarizeConversion } from './field-conversion.js';

const before = fieldDefinitionsSchema.parse([
  { key: 'load', label: 'Nosnost', kind: 'text', order: 0 },
  { key: 'anchored', label: 'Kotvení', kind: 'text', order: 1 },
  { key: 'colour', label: 'Barva', kind: 'text', order: 2 },
]);
const after = fieldDefinitionsSchema.parse([
  { key: 'load', label: 'Nosnost', kind: 'integer', unit: 'kg', order: 0 },
  { key: 'anchored', label: 'Kotvení', kind: 'boolean', order: 1 },
  { key: 'colour', label: 'Barva', kind: 'select', options: ['Modrá'], order: 2 },
]);

describe('field kind change', () => {
  it('lists the saved fields whose kind changes', () => {
    expect(kindChanges(before, after).map((c) => `${c.key}:${c.from}>${c.to}`)).toEqual([
      'load:text>integer',
      'anchored:text>boolean',
      'colour:text>select',
    ]);
  });

  it('converts values tolerantly and keeps what does not fit as text', () => {
    const changes = kindChanges(before, after);
    const done = convertItemValues(changes, after, {
      load: '2 000 kg',
      anchored: 'ano',
      colour: 'Zelená',
      other: 1,
    });
    expect(done.values).toEqual({ load: 2000, anchored: true, colour: 'Zelená', other: 1 });
    expect(done.newOptions).toEqual({ colour: ['Zelená'] });
    const kept = convertItemValues(changes, after, { load: 'neznámá', anchored: 'možná' });
    expect(kept.values).toEqual({ load: 'neznámá', anchored: 'možná' });
    expect(kept.changed.every((c) => c.warning)).toBe(true);
  });

  it('summarizes how many values convert and which do not', () => {
    const summary = summarizeConversion(before, after, [
      { load: '150' },
      { load: '150 kg' },
      { load: 'neznámá' },
      { load: 'neznámá' },
      {},
    ]);
    expect(summary[0]).toMatchObject({ key: 'load', total: 4, converted: 1 });
    expect(summary[0]!.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'neznámá', count: 2 }),
        expect.objectContaining({ value: '150 kg', count: 1 }),
      ]),
    );
    expect(summary[1]).toMatchObject({ key: 'anchored', total: 0 });
  });
});

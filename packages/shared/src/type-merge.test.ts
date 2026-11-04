import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from './equipment-fields.js';
import { commonLeadingWords, kindValueOf, planTypeMerge } from './type-merge.js';

const field = (key: string, extra: Partial<FieldDefinition> = {}): FieldDefinition => ({
  key,
  label: key,
  kind: 'text',
  required: false,
  options: [],
  suggestions: [],
  order: 0,
  archived: false,
  ...extra,
});

describe('merging equipment types', () => {
  it('derives the kind from the type name', () => {
    expect(kindValueOf('Regál paletový', 'Regál')).toBe('Paletový');
    expect(kindValueOf('Regál – konzolový', 'Regál')).toBe('Konzolový');
    expect(kindValueOf('Regál', 'Regál')).toBe('Regál');
    expect(kindValueOf('Policový regál', 'Regál')).toBe('Policový regál');
    expect(commonLeadingWords(['Regál paletový', 'Regál policový', 'Regál'])).toBe('');
    expect(commonLeadingWords(['Regál paletový', 'regál policový'])).toBe('Regál');
  });

  it("keeps the target's fields, adds missing ones and the former type", () => {
    const target = {
      id: 't',
      name: 'Regál paletový',
      fieldDefinitions: [
        field('manufacturer', { label: 'Výrobce (upraveno)', order: 0 }),
        field('material', { kind: 'select', options: ['Ocel'], order: 1 }),
      ],
    };
    const shelf = {
      id: 's',
      name: 'Regál policový',
      fieldDefinitions: [
        field('manufacturer', { label: 'Výrobce' }),
        field('shelves', { kind: 'integer', label: 'Počet polic' }),
        field('material', { kind: 'select', options: ['Ocel', 'Dřevo'] }),
        field('levels', { kind: 'integer' }),
      ],
    };
    const cantilever = {
      id: 'c',
      name: 'Regál konzolový',
      fieldDefinitions: [field('levels', { kind: 'text', label: 'Úrovně' })],
    };
    const plan = planTypeMerge(target, [shelf, cantilever], {
      name: 'Regál',
      kindField: { key: 'rack_type', label: 'Typ regálu' },
    });
    // The target's own (edited) definition stays.
    expect(plan.fieldDefinitions.find((f) => f.key === 'manufacturer')!.label).toBe(
      'Výrobce (upraveno)',
    );
    expect(plan.fieldDefinitions.find((f) => f.key === 'material')!.options).toEqual([
      'Ocel',
      'Dřevo',
    ]);
    expect(plan.addedFields).toEqual(['Počet polic', 'levels', 'Typ regálu']);
    expect(plan.conflicts).toEqual(['levels']);
    expect(plan.kindValues).toEqual({
      'Regál paletový': 'Paletový',
      'Regál policový': 'Policový',
      'Regál konzolový': 'Konzolový',
    });
    const kind = plan.fieldDefinitions.find((f) => f.key === 'rack_type')!;
    expect(kind).toMatchObject({ kind: 'select', options: ['Paletový', 'Policový', 'Konzolový'] });
    expect(new Set(plan.fieldDefinitions.map((f) => f.order)).size).toBe(
      plan.fieldDefinitions.length,
    );
  });

  it('merges into the plain library type without a kind for its own items', () => {
    const plan = planTypeMerge(
      {
        id: 't',
        name: 'Regál',
        fieldDefinitions: [field('rack_type', { kind: 'select', options: ['Paletový'] })],
      },
      [{ id: 's', name: 'Regál vjezdový', fieldDefinitions: [] }],
      { kindField: { key: 'rack_type', label: 'Typ regálu' } },
    );
    expect(plan.kindValues).toEqual({ 'Regál vjezdový': 'Vjezdový' });
    expect(plan.fieldDefinitions[0]!.options).toEqual(['Paletový', 'Vjezdový']);
  });
});

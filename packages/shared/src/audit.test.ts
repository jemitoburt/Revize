import { describe, expect, it } from 'vitest';
import { auditActionLabel, auditChanges, auditEntityLabel } from './audit.js';

describe('audit for people', () => {
  it('names actions in Czech', () => {
    expect(auditActionLabel('photo.delete')).toBe('Smazání fotky');
    expect(auditActionLabel('something.new')).toBe('something.new');
  });

  it('says what a record is about', () => {
    expect(
      auditEntityLabel({
        entityType: 'item',
        before: { itemNumber: '62', designation: 'Ž-03' },
        after: null,
      }),
    ).toBe('Artikl 62 (Ž-03)');
    expect(
      auditEntityLabel({
        entityType: 'inspection',
        before: null,
        after: { inspectionDate: '2026-11-03' },
      }),
    ).toBe('Kontrola 03/11/2026');
    expect(auditEntityLabel({ entityType: 'site', before: null, after: { name: 'Výroba' } })).toBe(
      'Výroba',
    );
  });

  it('lists the changed values without bookkeeping', () => {
    expect(
      auditChanges({
        before: { status: 'in_service', version: 1, updatedAt: 'a', note: null, active: true },
        after: { status: 'out_of_service', version: 2, updatedAt: 'b', note: null, active: false },
      }),
    ).toEqual([
      { field: 'Stav', from: 'in_service', to: 'out_of_service' },
      { field: 'Aktivní', from: 'ano', to: 'ne' },
    ]);
    expect(auditChanges({ before: null, after: { name: 'X' } })).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { fieldDefinitionsSchema } from '../equipment-fields.js';
import { convertCell, normalizeText, parseCzechNumber, parseDate } from './cells.js';

const [text, integer, number, bool, date, select, multi] = fieldDefinitionsSchema.parse([
  { key: 't', label: 'Text', kind: 'text', order: 0 },
  { key: 'i', label: 'Celé', kind: 'integer', order: 1 },
  { key: 'n', label: 'Číslo', kind: 'number', order: 2 },
  { key: 'b', label: 'Ano/ne', kind: 'boolean', order: 3 },
  { key: 'd', label: 'Datum', kind: 'date', order: 4 },
  { key: 's', label: 'Výběr', kind: 'select', options: ['Opěrný', 'Dvojitý (štaflový)'], order: 5 },
  { key: 'm', label: 'Více', kind: 'multiselect', options: ['A', 'B'], order: 6 },
]);

describe('cell conversion', () => {
  it('normalizes texts for matching', () => {
    expect(normalizeText('  Číslo artiklu: ')).toBe('cislo artiklu');
  });

  it('parses Czech numbers', () => {
    expect(parseCzechNumber('1 234,5')).toBe(1234.5);
    expect(parseCzechNumber('1 500')).toBe(1500);
    expect(parseCzechNumber('2.5')).toBe(2.5);
    expect(parseCzechNumber('12 kg')).toBeNull();
  });

  it('parses dates in common formats', () => {
    expect(parseDate('31.12.2026')).toBe('2026-12-31');
    expect(parseDate('1. 3. 2027')).toBe('2027-03-01');
    expect(parseDate('2026-11-14')).toBe('2026-11-14');
    expect(parseDate('11/2026')).toBe('2026-11-01');
    expect(parseDate(46340)).toBe('2026-11-14'); // Excel serial
    expect(parseDate(new Date(Date.UTC(2026, 10, 14)))).toBe('2026-11-14');
    expect(parseDate('31.2.2026')).toBeNull();
  });

  it('converts values per field kind', () => {
    expect(convertCell(text!, ' Alve ')).toEqual({ value: 'Alve' });
    expect(convertCell(integer!, '12')).toEqual({ value: 12 });
    expect(convertCell(number!, '5,6')).toEqual({ value: 5.6 });
    expect(convertCell(bool!, 'ANO')).toEqual({ value: true });
    expect(convertCell(bool!, 'x')).toEqual({ value: true });
    expect(convertCell(bool!, 'ne')).toEqual({ value: false });
    expect(convertCell(date!, '14.11.2026')).toEqual({ value: '2026-11-14' });
    expect(convertCell(select!, 'operny')).toEqual({ value: 'Opěrný' });
    expect(convertCell(select!, 'dvojity (staflovy)')).toEqual({ value: 'Dvojitý (štaflový)' });
    expect(convertCell(multi!, 'a; B')).toEqual({ value: ['A', 'B'] });
    expect(convertCell(text!, '')).toEqual({ value: null });
  });

  it('is tolerant: units, rounding, text kept with a warning, new option values', () => {
    expect(convertCell(integer!, '2 000 kg')).toEqual({
      value: 2000,
      warning: '„2 000 kg“ převzato jako 2000',
    });
    expect(convertCell(number!, 'cca 2,5 m').value).toBe(2.5);
    expect(convertCell(integer!, '12,5')).toEqual({
      value: 13,
      warning: '12.5 zaokrouhleno na 13',
    });
    expect(convertCell(integer!, '2 až 3')).toMatchObject({
      value: '2 až 3',
      warning: expect.stringContaining('uloženo jako text'),
    });
    expect(convertCell(bool!, 'možná')).toMatchObject({ value: 'možná' });
    expect(convertCell(date!, 'jaro 2026')).toMatchObject({ value: 'jaro 2026' });
    expect(convertCell(select!, 'Kolo')).toEqual({
      value: 'Kolo',
      warning: '„Kolo“ je nová hodnota číselníku – přidá se',
      newOptions: ['Kolo'],
    });
    expect(convertCell(multi!, 'a; Z')).toMatchObject({ value: ['A', 'Z'], newOptions: ['Z'] });
  });
});

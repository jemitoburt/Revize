import { describe, expect, it } from 'vitest';
import {
  canonicalItemNumber,
  compareItemNumbers,
  isValidItemNumber,
  normalizeDesignation,
} from './item-number.js';

describe('item number', () => {
  it('accepts číslo TZ up to 5 digits and ignores leading zeros', () => {
    expect(canonicalItemNumber('01234')).toBe('1234');
    expect(canonicalItemNumber(' 12345 ')).toBe('12345');
    expect(canonicalItemNumber('7')).toBe('7');
    expect(canonicalItemNumber('0012345')).toBe('12345');
    expect(canonicalItemNumber('123456')).toBeNull();
  });

  it('rejects non-numbers, zero and too long input', () => {
    expect(canonicalItemNumber('123456789')).toBeNull();
    expect(canonicalItemNumber('12a45')).toBeNull();
    expect(canonicalItemNumber('0000')).toBeNull();
    expect(canonicalItemNumber('')).toBeNull();
  });

  it('validates the stored canonical form', () => {
    expect(isValidItemNumber('1234')).toBe(true);
    expect(isValidItemNumber('01234')).toBe(false);
    expect(isValidItemNumber('0')).toBe(false);
    expect(isValidItemNumber('123456789')).toBe(false);
  });

  it('compares designations without case, spaces and dashes', () => {
    expect(normalizeDesignation('Ž-01')).toBe(normalizeDesignation('ž 01'));
    expect(normalizeDesignation('A1/12')).toBe('a112');
  });

  it('sorts numerically', () => {
    expect(['10001', '999', '1234', '1000'].sort(compareItemNumbers)).toEqual([
      '999',
      '1000',
      '1234',
      '10001',
    ]);
  });
});

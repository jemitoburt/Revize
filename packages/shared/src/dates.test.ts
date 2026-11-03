import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, parseDateInput } from './dates.js';

describe('dates as DD/MM/YYYY', () => {
  it('formats dates and timestamps (Czech time)', () => {
    expect(formatDate('2026-11-03')).toBe('03/11/2026');
    expect(formatDate(null)).toBe('');
    expect(formatDateTime('2026-11-03T08:05:00Z')).toBe('03/11/2026 09:05');
    expect(formatDate('2026-07-01T22:30:00Z')).toBe('02/07/2026');
  });
  it('parses typed dates', () => {
    expect(parseDateInput('3/11/2026')).toBe('2026-11-03');
    expect(parseDateInput('03/11/2026')).toBe('2026-11-03');
    expect(parseDateInput('3. 11. 2026')).toBe('2026-11-03');
    expect(parseDateInput('2026-11-03')).toBe('2026-11-03');
    expect(parseDateInput('31/02/2026')).toBeNull();
    expect(parseDateInput('11/2026')).toBeNull();
  });
});

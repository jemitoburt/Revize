import { describe, expect, it } from 'vitest';
import { parseScanPayload } from './scan-payload.js';

describe('parseScanPayload', () => {
  it('treats a numeric payload as an item number candidate (any series length)', () => {
    expect(parseScanPayload('01234\n')).toEqual({
      kind: 'digits',
      code: '01234',
      itemNumber: '1234',
    });
    expect(parseScanPayload('12345')).toEqual({
      kind: 'digits',
      code: '12345',
      itemNumber: '12345',
    });
  });

  it('reads the číslo TZ as printed on a label', () => {
    for (const printed of ['TZ: 12 447', 'TZ12447', 'tz 12447', 'TZ-12447', '12 447']) {
      expect(parseScanPayload(printed)).toEqual({
        kind: 'digits',
        code: printed,
        itemNumber: '12447',
      });
    }
    expect(parseScanPayload('TZ: 123456')).toEqual({ kind: 'qr', code: 'TZ: 123456' });
    expect(parseScanPayload('TZA1')).toEqual({ kind: 'qr', code: 'TZA1' });
  });

  it('extracts the code from a label URL', () => {
    expect(parseScanPayload('https://revize.example.ts.net/q/AB12CD')).toEqual({
      kind: 'qr',
      code: 'AB12CD',
    });
    expect(parseScanPayload('https://host/app/q/X%2F1/?src=label')).toEqual({
      kind: 'qr',
      code: 'X/1',
    });
  });

  it('keeps any other payload as an opaque QR code', () => {
    expect(parseScanPayload('REG-0001')).toEqual({ kind: 'qr', code: 'REG-0001' });
    expect(parseScanPayload('123456789')).toEqual({ kind: 'qr', code: '123456789' });
    expect(parseScanPayload('https://example.com/other')).toEqual({
      kind: 'qr',
      code: 'https://example.com/other',
    });
  });

  it('ignores empty input', () => {
    expect(parseScanPayload('   ')).toBeNull();
  });
});

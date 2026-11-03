import { describe, expect, it } from 'vitest';
import { recordResultSchema } from './api/inspections.js';
import { findScannedItem, outcomeLabel, progressOf, shouldApplyResult } from './inspection.js';
import { parseScanPayload } from './scan-payload.js';

describe('shouldApplyResult', () => {
  const at = (iso: string) => new Date(iso);
  it('applies a later result and a repeat of the same one', () => {
    expect(shouldApplyResult(at('2026-11-03T10:00:00Z'), at('2026-11-03T10:05:00Z'))).toBe(true);
    expect(shouldApplyResult(at('2026-11-03T10:00:00Z'), at('2026-11-03T10:00:00Z'))).toBe(true);
  });
  it('keeps the existing result when an older one arrives late', () => {
    expect(shouldApplyResult(at('2026-11-03T10:05:00Z'), at('2026-11-03T10:00:00Z'))).toBe(false);
  });
});

describe('findScannedItem', () => {
  const items = [
    { itemNumber: '4001', qrCode: null, designation: 'Ž-01' },
    { itemNumber: '10001', qrCode: 'R10001', designation: null },
    { itemNumber: '10002', qrCode: '4001', designation: 'A1-12' },
  ];
  it('finds by QR code first, then by item number without leading zeros', () => {
    expect(findScannedItem(items, parseScanPayload('R10001')!)?.itemNumber).toBe('10001');
    // "4001" is also the QR code of item 10002: the QR code wins.
    expect(findScannedItem(items, parseScanPayload('4001')!)?.itemNumber).toBe('10002');
    expect(findScannedItem(items, parseScanPayload('010001')!)?.itemNumber).toBe('10001');
    expect(findScannedItem(items, parseScanPayload('https://x.cz/q/R10001')!)?.itemNumber).toBe(
      '10001',
    );
  });
  it('finds by designation, ignoring case, spaces and dashes', () => {
    expect(findScannedItem(items, parseScanPayload('ž 01')!)?.itemNumber).toBe('4001');
    expect(findScannedItem(items, parseScanPayload('a112')!)?.itemNumber).toBe('10002');
  });
  it('returns null for unknown codes', () => {
    expect(findScannedItem(items, parseScanPayload('99999')!)).toBeNull();
    expect(findScannedItem(items, parseScanPayload('ABC')!)).toBeNull();
  });
});

describe('progressOf and outcomeLabel', () => {
  const result = (outcome: 'ok' | 'defect', takenOutOfService = false) =>
    ({ outcome, takenOutOfService }) as never;
  it('counts checked, ok, defects and items taken out of service', () => {
    const items = [
      { result: null },
      { result: result('ok') },
      { result: result('defect') },
      { result: result('defect', true) },
    ];
    expect(progressOf(items)).toEqual({ total: 4, checked: 3, ok: 1, defect: 2, outOfService: 1 });
  });
  it('labels results in Czech', () => {
    expect(outcomeLabel(null)).toBe('Nezkontrolováno');
    expect(outcomeLabel(result('defect', true))).toBe('Vyřazeno z provozu');
    expect(outcomeLabel({ outcome: 'defect', takenOutOfService: false, severity: 'green' })).toBe(
      'Závada – zelená',
    );
    expect(outcomeLabel(result('defect'))).toBe('Závada – žlutá');
  });
});

describe('recordResultSchema', () => {
  const base = { id: '0190e8a0-0000-7000-8000-000000000001', recordedAt: '2026-11-03T10:00:00Z' };
  it('requires a description for defects', () => {
    const parsed = recordResultSchema.safeParse({ ...base, outcome: 'defect' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['defectDescription']);
  });
  it('derives the traffic light: red = out of service and always in the protocol', () => {
    const defect = { ...base, outcome: 'defect' as const, defectDescription: 'Ohnutý nosník' };
    expect(
      recordResultSchema.parse({ ...defect, severity: 'red', includeInProtocol: false }),
    ).toMatchObject({
      severity: 'red',
      takenOutOfService: true,
      includeInProtocol: true,
    });
    expect(
      recordResultSchema.parse({ ...defect, severity: 'green', includeInProtocol: false }),
    ).toMatchObject({
      severity: 'green',
      takenOutOfService: false,
      includeInProtocol: false,
    });
    // Older clients: no severity, only "taken out of service".
    expect(recordResultSchema.parse({ ...defect, takenOutOfService: true }).severity).toBe('red');
    expect(recordResultSchema.parse(defect).severity).toBe('amber');
    expect(recordResultSchema.parse({ ...base, outcome: 'ok' })).toMatchObject({ severity: null });
    expect(
      recordResultSchema.safeParse({ ...base, outcome: 'ok', severity: 'green' }).success,
    ).toBe(false);
  });

  it('allows taking out of service only with a defect', () => {
    expect(
      recordResultSchema.safeParse({ ...base, outcome: 'ok', takenOutOfService: true }).success,
    ).toBe(false);
    expect(
      recordResultSchema.parse({
        ...base,
        outcome: 'defect',
        defectDescription: 'Ohnutý stojan',
        takenOutOfService: true,
      }).takenOutOfService,
    ).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { InspectionItem } from './api/inspections.js';
import { fieldDefinitionsSchema } from './equipment-fields.js';
import {
  exportColumns,
  exportRow,
  fileNamePart,
  photoCaption,
  photoFileName,
  sheetName,
  toCsv,
  type ExportType,
} from './export.js';

const ladder: ExportType = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Žebřík',
  fieldDefinitions: fieldDefinitionsSchema.parse([
    { key: 'manufacturer', label: 'Výrobce', kind: 'text', order: 0 },
    { key: 'rungs', label: 'Počet příček', kind: 'integer', order: 1 },
    { key: 'stabilizer', label: 'Stabilizátor', kind: 'boolean', order: 2 },
    { key: 'old', label: 'Staré pole', kind: 'text', order: 3, archived: true },
  ]),
};
const rack: ExportType = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Regál paletový',
  fieldDefinitions: fieldDefinitionsSchema.parse([
    { key: 'manufacturer', label: 'Výrobce', kind: 'text', order: 0 },
    { key: 'level_load_kg', label: 'Nosnost úrovně', kind: 'integer', unit: 'kg', order: 1 },
  ]),
};

const item = (over: Partial<InspectionItem> = {}): InspectionItem => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  itemNumber: '10001',
  designation: 'Ž-01',
  qrCode: null,
  equipmentTypeId: ladder.id,
  locationId: null,
  locationPath: ['Hala A', 'Řada 1'],
  fieldValues: { manufacturer: 'Alve', rungs: 8, stabilizer: true, old: 'x' },
  status: 'in_service',
  nextInspectionDate: '2027-11-03',
  itemPhotoCount: 0,
  result: null,
  ...over,
});

describe('export table', () => {
  it('has the union of active fields (by header) between item and result columns', () => {
    const headers = exportColumns([ladder, rack]).map((c) => c.header);
    expect(headers.slice(0, 5)).toEqual([
      'Číslo TZ',
      'Označení',
      'Typ vybavení',
      'Umístění',
      'QR kód',
    ]);
    expect(headers.slice(5, 9)).toEqual([
      'Výrobce',
      'Počet příček',
      'Stabilizátor',
      'Nosnost úrovně [kg]',
    ]);
    expect(headers).not.toContain('Staré pole');
    expect(headers.at(-1)).toBe('Příští kontrola');
  });

  it('fills a row: numbers stay numbers, other types’ fields empty, result columns', () => {
    const row = exportRow(
      [ladder, rack],
      item({
        result: {
          id: '00000000-0000-4000-8000-0000000000bb',
          itemId: '00000000-0000-4000-8000-0000000000aa',
          outcome: 'defect',
          defectDescription: 'Chybí patka',
          takenOutOfService: false,
          severity: 'amber',
          includeInProtocol: true,
          recordedAt: '2026-11-03T08:05:00Z',
          recordedBy: '00000000-0000-4000-8000-0000000000cc',
          recordedByName: 'Jan Technik',
          photoCount: 1,
          version: 1,
        },
      }),
      ['10001_01.jpg'],
    );
    expect(row).toEqual([
      '10001',
      'Ž-01',
      'Žebřík',
      'Hala A › Řada 1',
      '',
      'Alve',
      8,
      'ano',
      null,
      'Závada – žlutá',
      'Žlutá',
      'Chybí patka',
      'ne',
      'ano',
      'Jan Technik',
      '03/11/2026 09:05',
      '10001_01.jpg',
      '03/11/2027',
    ]);
    expect(exportRow([ladder], item(), [])).toContain('Nezkontrolováno');
  });

  it('names and describes photos', () => {
    expect(photoFileName('10001', 0, 'image/jpeg')).toBe('10001_01.jpg');
    expect(photoFileName('kontrola', 11, 'image/png')).toBe('kontrola_12.png');
    expect(photoCaption(item(), 'Žebřík')).toBe(
      'Číslo TZ 10001 – označení Ž-01 – Žebřík – Hala A › Řada 1',
    );
  });
});

describe('file formats', () => {
  it('writes CSV for Czech Excel', () => {
    expect(
      toCsv([
        ['a;b', 'say "hi"', 1.5, null],
        ['x', 'line\nbreak', 2, 'z'],
      ]),
    ).toBe('﻿"a;b";"say ""hi""";1,5;\r\nx;"line\nbreak";2;z\r\n');
  });
  it('makes valid unique sheet names and safe file names', () => {
    expect(sheetName('Regál: hala [A]/B', [])).toBe('Regál  hala  A  B');
    expect(sheetName('Žebřík', ['Žebřík'])).toBe('Žebřík (2)');
    expect(sheetName('x'.repeat(40), [])).toHaveLength(31);
    expect(fileNamePart('Sklad Brno – hala č. 2')).toBe('Sklad-Brno-hala-c-2');
    expect(sheetName('a', [])).toBe('a');
  });
});

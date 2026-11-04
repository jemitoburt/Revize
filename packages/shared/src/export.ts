/**
 * Exports of an inspection (M7): the result table (XLSX per equipment type, one CSV) and the
 * names and captions of exported photos. Pure functions; the API turns them into files.
 */
import type { InspectionItem, Severity } from './api/inspections.js';
import { LOCATION_SEPARATOR } from './api/master-data.js';
import { formatDate, formatDateTime } from './dates.js';
import type { FieldDefinition } from './equipment-fields.js';
import {
  FIT_DEFECT_TITLES,
  FIT_LABELS,
  outcomeLabel,
  SEVERITY_LABELS,
  severityOf,
} from './inspection.js';

/** A cell: text, number (kept as a number for Excel) or empty. */
export type ExportCell = string | number | null;

export interface ExportType {
  id: string;
  name: string;
  fieldDefinitions: readonly FieldDefinition[];
  /** Risk levels of ČSN EN 15635 (racks; default); otherwise fit / unfit. */
  riskLevels?: boolean;
}

export interface ExportColumn {
  header: string;
  /** Approximate width in characters (XLSX). */
  width: number;
}

const FIXED_BEFORE: ExportColumn[] = [
  { header: 'Číslo TZ', width: 10 },
  { header: 'Označení', width: 12 },
  { header: 'Typ vybavení', width: 22 },
  { header: 'Umístění', width: 28 },
  { header: 'QR kód', width: 14 },
];
const FIXED_AFTER: ExportColumn[] = [
  { header: 'Výsledek', width: 20 },
  { header: 'Úroveň rizika', width: 14 },
  { header: 'Popis závady', width: 40 },
  { header: 'Vyřazeno z provozu', width: 12 },
  { header: 'V protokolu', width: 10 },
  { header: 'Zapsal', width: 18 },
  { header: 'Zapsáno', width: 18 },
  { header: 'Fotky závady', width: 30 },
  { header: 'Příští kontrola', width: 14 },
];

const activeFields = (type: ExportType) =>
  [...type.fieldDefinitions].filter((f) => !f.archived).sort((a, b) => a.order - b.order);

const fieldHeader = (f: FieldDefinition) => (f.unit ? `${f.label} [${f.unit}]` : f.label);

/**
 * Columns for the given types: item, its fields (the union by header, in the order they first
 * appear), then the result. A sheet of one type gets just that type's fields.
 */
export function exportColumns(types: readonly ExportType[]): ExportColumn[] {
  const fields: ExportColumn[] = [];
  for (const type of types) {
    for (const f of activeFields(type)) {
      const header = fieldHeader(f);
      if (!fields.some((c) => c.header === header)) fields.push({ header, width: 16 });
    }
  }
  return [...FIXED_BEFORE, ...fields, ...FIXED_AFTER];
}

function fieldCell(field: FieldDefinition, value: unknown): ExportCell {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value ? 'ano' : 'ne';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'number') return value;
  if (field.kind === 'date' && typeof value === 'string') return formatDate(value);
  return String(value);
}

/** One row of the result table, matching `exportColumns(types)`. */
export function exportRow(
  types: readonly ExportType[],
  item: InspectionItem,
  photoNames: readonly string[],
): ExportCell[] {
  const type = types.find((t) => t.id === item.equipmentTypeId);
  const fieldHeaders = exportColumns(types).slice(FIXED_BEFORE.length, -FIXED_AFTER.length);
  const ownFields = type ? activeFields(type) : [];
  const result = item.result;
  const riskLevels = type?.riskLevels ?? true;
  const severity = result && riskLevels ? severityOf(result) : null;
  return [
    item.itemNumber,
    item.designation ?? '',
    type?.name ?? '',
    item.locationPath.join(LOCATION_SEPARATOR),
    item.qrCode ?? '',
    ...fieldHeaders.map(({ header }) => {
      const field = ownFields.find((f) => fieldHeader(f) === header);
      return field ? fieldCell(field, item.fieldValues[field.key]) : null;
    }),
    outcomeLabel(result, riskLevels),
    severity ? SEVERITY_LABELS[severity].short : '',
    result?.defectDescription ?? '',
    result ? (result.takenOutOfService ? 'ano' : 'ne') : '',
    severity ? (result!.includeInProtocol ? 'ano' : 'ne') : '',
    result?.recordedByName ?? '',
    formatDateTime(result?.recordedAt ?? null),
    photoNames.join(', '),
    formatDate(item.nextInspectionDate),
  ];
}

/** `12345_01.jpg`: item number and the photo's order within the item. */
export function photoFileName(prefix: string, index: number, mimeType: string): string {
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return `${prefix}_${String(index + 1).padStart(2, '0')}.${ext}`;
}

/** Caption written into a defect photo (EXIF/IPTC) and into the photo list. */
export function photoCaption(
  item: Pick<InspectionItem, 'itemNumber' | 'designation' | 'locationPath' | 'result'>,
  typeName: string,
  riskLevels = true,
): string {
  const severity = item.result ? severityOf(item.result) : null;
  return [
    `Číslo TZ ${item.itemNumber}`,
    item.designation ? `označení ${item.designation}` : '',
    typeName,
    item.locationPath.join(LOCATION_SEPARATOR),
    severity
      ? riskLevels
        ? SEVERITY_LABELS[severity].protocol
        : severity === 'green'
          ? FIT_DEFECT_TITLES.minor
          : FIT_LABELS.defect
      : '',
    item.result?.defectDescription ?? '',
  ]
    .filter(Boolean)
    .join(' – ');
}

/**
 * CSV for Czech Excel: UTF-8 with BOM, `;` as the separator, CRLF, decimal comma, values with
 * separators, quotes or line breaks in quotes.
 */
export function toCsv(rows: readonly (readonly ExportCell[])[]): string {
  const cell = (value: ExportCell) => {
    if (value === null) return '';
    const text = typeof value === 'number' ? String(value).replace('.', ',') : value;
    return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `\uFEFF${rows.map((row) => row.map(cell).join(';')).join('\r\n')}\r\n`;
}

/** Excel sheet name: at most 31 characters, without `[]:*?/\`, unique within the workbook. */
export function sheetName(name: string, taken: readonly string[]): string {
  const base =
    name
      .replace(/[[\]:*?/\\]/g, ' ')
      .trim()
      .slice(0, 31) || 'List';
  let candidate = base;
  for (let n = 2; taken.includes(candidate); n++) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  return candidate;
}

/** Safe part of a download name: `Sklad Brno – hala` → `Sklad-Brno-hala`. */
export function fileNamePart(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'kontrola'
  );
}

// ---------- export of the whole database (items) ----------

/** One item of the records with what the database export shows about it. */
export interface DatabaseItem {
  customerName: string;
  siteName: string;
  locationPath: string[];
  itemNumber: string;
  designation: string | null;
  qrCode: string | null;
  equipmentTypeId: string;
  fieldValues: Record<string, unknown>;
  status: 'in_service' | 'out_of_service';
  retired: boolean;
  nextInspectionDate: string | null;
  /** Result in the most recent inspection that checked the item. */
  lastInspection: {
    date: string;
    result: {
      outcome: 'ok' | 'defect';
      takenOutOfService: boolean;
      severity?: 'green' | 'amber' | 'red' | null;
      defectDescription: string | null;
    };
  } | null;
}

const DB_BEFORE: ExportColumn[] = [
  { header: 'Zákazník', width: 24 },
  { header: 'Provozovna', width: 20 },
  { header: 'Číslo TZ', width: 10 },
  { header: 'Označení', width: 12 },
  { header: 'Typ vybavení', width: 22 },
  { header: 'Umístění', width: 28 },
  { header: 'V provozu', width: 10 },
  { header: 'QR kód', width: 14 },
];
const DB_AFTER: ExportColumn[] = [
  { header: 'Příští kontrola', width: 14 },
  { header: 'Poslední kontrola', width: 14 },
  { header: 'Výsledek poslední kontroly', width: 24 },
  { header: 'Schopno bezpečného provozu', width: 14 },
  { header: 'Poznámka (popis zjištění, závady, doporučení)', width: 50 },
];

/** ANO / NE: safe to operate after a result (as in the protocol table and Příloha 1). */
export function safeAnswer(result: {
  outcome: 'ok' | 'defect';
  takenOutOfService: boolean;
  severity?: Severity | null;
}): 'ANO' | 'NE' {
  // Racks: green is fine to use, yellow and red are not; other types: minor (green) or unfit.
  const severity = severityOf(result);
  return !severity || severity === 'green' ? 'ANO' : 'NE';
}

/** "Ohnutý stojan – nevyhovuje": the defect with its level in short (as in Příloha 1). */
export function resultNote(
  result: {
    outcome: 'ok' | 'defect';
    takenOutOfService: boolean;
    severity?: Severity | null;
    defectDescription: string | null;
  },
  riskLevels = true,
): string {
  const severity = severityOf(result);
  if (!severity) return '';
  const level = riskLevels
    ? RISK_SHORT[severity]
    : severity === 'green'
      ? 'závada nebránící bezpečnému provozu'
      : 'nevyhovuje';
  return [result.defectDescription, level].filter(Boolean).join(' – ');
}

/** Columns of the database export: item, the types' fields (union), state and last inspection. */
export function databaseColumns(types: readonly ExportType[]): ExportColumn[] {
  const fields = exportColumns(types).slice(FIXED_BEFORE.length, -FIXED_AFTER.length);
  return [...DB_BEFORE, ...fields, ...DB_AFTER];
}

/** One row of the database export, matching `databaseColumns(types)`. */
export function databaseRow(types: readonly ExportType[], item: DatabaseItem): ExportCell[] {
  const type = types.find((t) => t.id === item.equipmentTypeId);
  const riskLevels = type?.riskLevels ?? true;
  const fieldHeaders = databaseColumns(types).slice(DB_BEFORE.length, -DB_AFTER.length);
  const ownFields = type ? activeFields(type) : [];
  const last = item.lastInspection;
  return [
    item.customerName,
    item.siteName,
    item.itemNumber,
    item.designation ?? '',
    type?.name ?? '',
    item.locationPath.join(LOCATION_SEPARATOR),
    item.retired ? 'NE (vyřazen z evidence)' : item.status === 'out_of_service' ? 'NE' : 'ANO',
    item.qrCode ?? '',
    ...fieldHeaders.map(({ header }) => {
      const field = ownFields.find((f) => fieldHeader(f) === header);
      return field ? fieldCell(field, item.fieldValues[field.key]) : null;
    }),
    formatDate(item.nextInspectionDate),
    formatDate(last?.date ?? null),
    last ? outcomeLabel(last.result, riskLevels) : 'Nezkontrolováno',
    last ? safeAnswer(last.result) : '',
    last ? resultNote(last.result, riskLevels) : '',
  ];
}

/** One result of an item in an inspection: a row of the history sheet. */
export interface HistoryRow {
  customerName: string;
  siteName: string;
  itemNumber: string;
  designation: string | null;
  equipmentTypeId: string;
  locationPath: string[];
  inspectionDate: string;
  inspectionClosed: boolean;
  result: {
    outcome: 'ok' | 'defect';
    takenOutOfService: boolean;
    severity: Severity | null;
    defectDescription: string | null;
    includeInProtocol: boolean;
  };
  recordedByName: string;
  recordedAt: string;
  photoCount: number;
}

export const HISTORY_COLUMNS: ExportColumn[] = [
  { header: 'Zákazník', width: 24 },
  { header: 'Provozovna', width: 20 },
  { header: 'Číslo TZ', width: 10 },
  { header: 'Označení', width: 12 },
  { header: 'Typ vybavení', width: 22 },
  { header: 'Umístění', width: 28 },
  { header: 'Datum kontroly', width: 14 },
  { header: 'Kontrola', width: 12 },
  { header: 'Výsledek', width: 24 },
  { header: 'Schopno bezpečného provozu', width: 14 },
  { header: 'Vyřazeno z provozu', width: 12 },
  { header: 'Poznámka (popis zjištění, závady, doporučení)', width: 50 },
  { header: 'V protokolu', width: 10 },
  { header: 'Zapsal', width: 20 },
  { header: 'Zapsáno', width: 17 },
  { header: 'Fotky závady', width: 10 },
];

export function historyRow(types: readonly ExportType[], row: HistoryRow): ExportCell[] {
  const type = types.find((t) => t.id === row.equipmentTypeId);
  const riskLevels = type?.riskLevels ?? true;
  return [
    row.customerName,
    row.siteName,
    row.itemNumber,
    row.designation ?? '',
    type?.name ?? '',
    row.locationPath.join(LOCATION_SEPARATOR),
    formatDate(row.inspectionDate),
    row.inspectionClosed ? 'uzavřená' : 'otevřená',
    outcomeLabel(row.result, riskLevels),
    safeAnswer(row.result),
    row.result.takenOutOfService ? 'ano' : 'ne',
    resultNote(row.result, riskLevels),
    row.result.includeInProtocol ? 'ano' : 'ne',
    row.recordedByName,
    formatDateTime(row.recordedAt),
    row.photoCount,
  ];
}

// ---------- appendix of the protocol: equipment list with chosen columns ----------

export interface AppendixColumn {
  /** `itemNumber`, `designation`, … or `field:<key>` for a field of the equipment type. */
  key: string;
  label: string;
}

const APPENDIX_FIXED: AppendixColumn[] = [
  { key: 'itemNumber', label: 'Číslo TZ' },
  { key: 'designation', label: 'Označení' },
  { key: 'type', label: 'Typ vybavení' },
  { key: 'location', label: 'Umístění' },
  { key: 'qrCode', label: 'QR kód' },
  { key: 'result', label: 'Výsledek' },
  { key: 'safe', label: 'Schopno bezpečného provozu' },
  { key: 'defect', label: 'Závada' },
  { key: 'note', label: 'Poznámka (popis zjištění, závady, doporučení)' },
  { key: 'nextInspection', label: 'Příští kontrola' },
];

/** Columns the office can choose from for the inspection's types. */
export function appendixColumns(types: readonly ExportType[]): AppendixColumn[] {
  const fields: AppendixColumn[] = [];
  for (const type of types) {
    for (const f of activeFields(type)) {
      const key = `field:${f.key}`;
      if (!fields.some((c) => c.key === key)) fields.push({ key, label: fieldHeader(f) });
    }
  }
  return [...APPENDIX_FIXED, ...fields];
}

const RISK_SHORT = { red: 'červené riziko', amber: 'žluté riziko', green: 'zelené riziko' };

/** Preset columns of Příloha 1 (the equipment table on A4 landscape). */
export const DEFAULT_APPENDIX_COLUMNS = [
  'itemNumber',
  'designation',
  'type',
  'location',
  'safe',
  'note',
];

/** One row of the appendix: the chosen columns as text. */
export function appendixRow(
  keys: readonly string[],
  types: readonly ExportType[],
  item: InspectionItem,
): string[] {
  const type = types.find((t) => t.id === item.equipmentTypeId);
  const riskLevels = type?.riskLevels ?? true;
  return keys.map((key) => {
    if (key.startsWith('field:')) {
      const field = type?.fieldDefinitions.find((f) => f.key === key.slice(6));
      const cell = field ? fieldCell(field, item.fieldValues[field.key]) : null;
      return cell === null ? '' : typeof cell === 'number' ? cell.toLocaleString('cs-CZ') : cell;
    }
    switch (key) {
      case 'itemNumber':
        return item.itemNumber;
      case 'designation':
        return item.designation ?? '';
      case 'type':
        return type?.name ?? '';
      case 'location':
        return item.locationPath.join(LOCATION_SEPARATOR);
      case 'qrCode':
        return item.qrCode ?? '';
      case 'result':
        return outcomeLabel(item.result, riskLevels);
      case 'defect':
        return item.result?.defectDescription ?? '';
      case 'safe': {
        // As in the protocol table: ok and green = ANO, yellow and red = NE.
        return item.result ? safeAnswer(item.result) : '';
      }
      case 'note': {
        // Short: the meaning of the levels is explained with the defect groups.
        return item.result ? resultNote(item.result, riskLevels) : 'Nezkontrolováno';
      }
      case 'nextInspection':
        return formatDate(item.nextInspectionDate);
      default:
        return '';
    }
  });
}

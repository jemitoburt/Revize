/**
 * Exports of an inspection (M7): the result table (XLSX per equipment type, one CSV) and the
 * names and captions of exported photos. Pure functions; the API turns them into files.
 */
import type { InspectionItem } from './api/inspections.js';
import { LOCATION_SEPARATOR } from './api/master-data.js';
import { formatDate, formatDateTime } from './dates.js';
import type { FieldDefinition } from './equipment-fields.js';
import { outcomeLabel, SEVERITY_LABELS, severityOf } from './inspection.js';

/** A cell: text, number (kept as a number for Excel) or empty. */
export type ExportCell = string | number | null;

export interface ExportType {
  id: string;
  name: string;
  fieldDefinitions: readonly FieldDefinition[];
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
  const severity = result ? severityOf(result) : null;
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
    outcomeLabel(result),
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
): string {
  const severity = item.result ? severityOf(item.result) : null;
  return [
    `Číslo TZ ${item.itemNumber}`,
    item.designation ? `označení ${item.designation}` : '',
    typeName,
    item.locationPath.join(LOCATION_SEPARATOR),
    severity ? SEVERITY_LABELS[severity].protocol : '',
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

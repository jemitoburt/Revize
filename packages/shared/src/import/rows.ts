import { applyDefaultProducts, type FieldDefinition } from '../equipment-fields.js';
import { canonicalItemNumber } from '../item-number.js';
import {
  cellText,
  convertCell,
  isEmptyCell,
  normalizeText,
  parseDate,
  type RawCell,
} from './cells.js';
import type { ImportMapping } from './mapping.js';

export interface RowIssue {
  /** Column index, or null for row-level problems. */
  column: number | null;
  message: string;
}

export interface RowCandidate {
  /** 1-based row number as shown in the spreadsheet (header is row 1 by default). */
  rowNumber: number;
  empty: boolean;
  itemNumber: string | null;
  designation: string | null;
  qrCode: string | null;
  nextInspectionDate: string | null;
  locationPath: string[];
  fieldValues: Record<string, unknown>;
  /** Errors: the row is not imported (only problems with the item's identity). */
  issues: RowIssue[];
  /** Warnings: the row is imported, e.g. a value kept as text or a new option value. */
  warnings: RowIssue[];
  /** Option values to add to select/multiselect fields, by field key. */
  newOptions: Record<string, string[]>;
}

/**
 * Turns one spreadsheet row into an item candidate using the mapping and the type's fields.
 * Only checks what can be checked without the database. Formats of field values are not locked
 * hard: values that do not fit are kept (as text) with a warning, missing required values are
 * warnings too, so that a messy spreadsheet still imports and is cleaned up in the office.
 *
 * `base` are the current values of an existing item that the row updates: empty cells keep
 * them, and required fields that the file does not contain are satisfied by them.
 */
export function buildRowCandidate(
  row: readonly RawCell[],
  rowNumber: number,
  mapping: ImportMapping,
  definitions: readonly FieldDefinition[],
  base: Record<string, unknown> = {},
): RowCandidate {
  const issues: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const newOptions: Record<string, string[]> = {};
  const at = (index: number | null): RawCell => (index === null ? null : (row[index] ?? null));
  const mappedColumns = [
    mapping.itemNumber,
    mapping.designation,
    mapping.qrCode,
    mapping.nextInspectionDate,
    ...mapping.location,
    ...Object.values(mapping.fields),
  ].filter((i): i is number => i !== null);
  const empty = mappedColumns.every((i) => isEmptyCell(at(i)));

  let itemNumber: string | null = null;
  if (mapping.itemNumber !== null && !isEmptyCell(at(mapping.itemNumber))) {
    const raw = at(mapping.itemNumber);
    const text = typeof raw === 'number' ? String(Math.trunc(raw)) : cellText(raw);
    itemNumber = canonicalItemNumber(text);
    if (!itemNumber || (typeof raw === 'number' && !Number.isInteger(raw))) {
      issues.push({
        column: mapping.itemNumber,
        message: `„${cellText(raw)}“ není číslo TZ (4 nebo 5 číslic) – patří-li do Označení, namapujte sloupec tam`,
      });
      itemNumber = null;
    }
  } else if (!mapping.autoNumber && !empty) {
    issues.push({ column: mapping.itemNumber, message: 'Chybí číslo TZ' });
  }

  const designationText = cellText(at(mapping.designation)).trim();
  const designation = designationText === '' ? null : designationText.slice(0, 50);

  const qrText = cellText(at(mapping.qrCode));
  const qrCode = qrText === '' ? null : qrText;

  let nextInspectionDate: string | null = null;
  if (mapping.nextInspectionDate !== null && !isEmptyCell(at(mapping.nextInspectionDate))) {
    nextInspectionDate = parseDate(at(mapping.nextInspectionDate));
    if (!nextInspectionDate) {
      warnings.push({
        column: mapping.nextInspectionDate,
        message: `„${cellText(at(mapping.nextInspectionDate))}“ není datum (např. 31.12.2026) – nepřevzato`,
      });
    }
  }

  const locationPath: string[] = [];
  for (const index of mapping.location) {
    const text = cellText(at(index));
    if (text === '') continue;
    const parts = mapping.locationSeparator ? text.split(mapping.locationSeparator) : [text];
    locationPath.push(...parts.map((p) => p.trim()).filter(Boolean));
  }

  const values: Record<string, unknown> = {};
  const active = definitions.filter((f) => !f.archived);
  for (const field of active) {
    const index = mapping.fields[field.key] ?? null;
    const fallback = mapping.defaults[field.key]?.trim() ?? '';
    let cell: RawCell = index === null ? null : at(index);
    let fromDefault = false;
    if (!isEmptyCell(cell)) {
      const text = normalizeText(cellText(cell));
      const replacement = mapping.replacements[field.key]?.find(
        (r) => normalizeText(r.from) === text,
      );
      if (replacement) cell = replacement.to;
    }
    if (isEmptyCell(cell) && fallback) {
      // Updates keep the item's own value; the default only fills what is missing.
      if (base[field.key] !== undefined && base[field.key] !== null && base[field.key] !== '')
        continue;
      cell = fallback;
      fromDefault = true;
    }
    if (index === null && isEmptyCell(cell)) continue;
    const converted = convertCell(field, cell);
    // Empty cells do not overwrite values of an existing item.
    if (converted.value !== null) values[field.key] = converted.value;
    // The value for all items was typed in the mapping: "150 kg" → 150 needs no warning per row,
    // only a value that cannot be converted at all (kept as text) does.
    const keptAsText =
      converted.value === cell && typeof cell === 'string' && field.kind !== 'text';
    if (converted.warning && (!fromDefault || keptAsText)) {
      warnings.push({ column: index, message: converted.warning });
    }
    if (converted.newOptions) newOptions[field.key] = converted.newOptions;
  }

  const fieldValues = applyDefaultProducts(definitions, { ...base, ...values });
  if (!empty) {
    for (const field of active) {
      const value = fieldValues[field.key];
      const missing =
        value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && !value.length);
      if (field.required && missing) {
        warnings.push({
          column: mapping.fields[field.key] ?? null,
          message: `Chybí povinná hodnota „${field.label}“ – doplňte ji v kanceláři`,
        });
      }
    }
  }

  return {
    rowNumber,
    empty,
    itemNumber,
    designation,
    qrCode,
    nextInspectionDate,
    locationPath,
    fieldValues,
    issues,
    warnings,
    newOptions,
  };
}

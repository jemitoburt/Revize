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

/** Keys of `mapping.replacements` for the item's own columns (field keys never start with @). */
export const ITEM_NUMBER_KEY = '@itemNumber';
export const DESIGNATION_KEY = '@designation';

/** The cell after the mapping's value replacements; a skipped value becomes empty. */
function replaced(
  cell: RawCell,
  replacements: readonly { from: string; to: string; skip?: boolean }[] | undefined,
): RawCell {
  if (isEmptyCell(cell) || !replacements?.length) return cell;
  const text = normalizeText(cellText(cell));
  const replacement = replacements.find((r) => normalizeText(r.from) === text);
  if (!replacement) return cell;
  return replacement.skip ? null : replacement.to;
}

export interface RowIssue {
  /** Column index, or null for row-level problems. */
  column: number | null;
  message: string;
  /** Field key and the cell value, for the list of problems (replace / accept / skip). */
  field?: string;
  value?: string;
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

  // Číslo TZ and Označení may share a column (records where each row has one or the other):
  // a valid číslo TZ goes to Číslo TZ, anything else to Označení.
  const shared = mapping.itemNumber !== null && mapping.itemNumber === mapping.designation;
  const numberCell = replaced(at(mapping.itemNumber), mapping.replacements[ITEM_NUMBER_KEY]);
  let designationText = shared
    ? ''
    : cellText(replaced(at(mapping.designation), mapping.replacements[DESIGNATION_KEY])).trim();

  let itemNumber: string | null = null;
  if (mapping.itemNumber !== null && !isEmptyCell(numberCell)) {
    const raw = numberCell;
    const text = typeof raw === 'number' ? String(Math.trunc(raw)) : cellText(raw);
    itemNumber = canonicalItemNumber(text);
    if (!itemNumber || (typeof raw === 'number' && !Number.isInteger(raw))) {
      itemNumber = null;
      const value = cellText(raw).trim();
      if (shared) {
        designationText = value;
      } else if (designationText === '') {
        // Not a číslo TZ but the row has no designation: it is one ("15-RVLS").
        designationText = value;
        warnings.push({
          column: mapping.itemNumber,
          message: `„${value}“ není číslo TZ – převzato jako označení`,
          field: ITEM_NUMBER_KEY,
          value,
        });
      } else {
        warnings.push({
          column: mapping.itemNumber,
          message: `„${value}“ není číslo TZ (4 nebo 5 číslic) – artikl bude bez čísla TZ`,
          field: ITEM_NUMBER_KEY,
          value,
        });
      }
    }
  }

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
    const original = cellText(cell);
    if (!isEmptyCell(cell)) {
      const text = normalizeText(original);
      const replacement = mapping.replacements[field.key]?.find(
        (r) => normalizeText(r.from) === text,
      );
      // Skipped: the value is left out on purpose (no value, no default, no warning).
      if (replacement?.skip) continue;
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
      warnings.push({
        column: index,
        message: converted.warning,
        field: field.key,
        value: fromDefault ? cellText(cell) : original,
      });
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

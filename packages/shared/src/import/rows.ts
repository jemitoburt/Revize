import {
  applyDefaultProducts,
  buildFieldValuesSchema,
  type FieldDefinition,
} from '../equipment-fields.js';
import { canonicalItemNumber } from '../item-number.js';
import { cellText, convertCell, isEmptyCell, parseDate, type RawCell } from './cells.js';
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
  qrCode: string | null;
  nextInspectionDate: string | null;
  locationPath: string[];
  fieldValues: Record<string, unknown>;
  issues: RowIssue[];
}

/**
 * Turns one spreadsheet row into an item candidate using the mapping and the type's fields.
 * Only checks what can be checked without the database (formats, required fields, options).
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
  const at = (index: number | null): RawCell => (index === null ? null : (row[index] ?? null));
  const mappedColumns = [
    mapping.itemNumber,
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
        message: `„${cellText(raw)}“ není číslo artiklu (1–8 číslic)`,
      });
      itemNumber = null;
    }
  } else if (!mapping.autoNumber && !empty) {
    issues.push({ column: mapping.itemNumber, message: 'Chybí číslo artiklu' });
  }

  const qrText = cellText(at(mapping.qrCode));
  const qrCode = qrText === '' ? null : qrText;

  let nextInspectionDate: string | null = null;
  if (mapping.nextInspectionDate !== null && !isEmptyCell(at(mapping.nextInspectionDate))) {
    nextInspectionDate = parseDate(at(mapping.nextInspectionDate));
    if (!nextInspectionDate) {
      issues.push({
        column: mapping.nextInspectionDate,
        message: `„${cellText(at(mapping.nextInspectionDate))}“ není datum (např. 31.12.2026)`,
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
  const columnOf = new Map<string, number>();
  for (const field of definitions.filter((f) => !f.archived)) {
    const index = mapping.fields[field.key] ?? null;
    if (index === null) continue;
    columnOf.set(field.key, index);
    const converted = convertCell(field, at(index));
    if (converted.ok) values[field.key] = converted.value;
    else issues.push({ column: index, message: converted.error });
  }

  const failedKeys = new Set(issues.map((i) => i.column));
  const filled = Object.fromEntries(
    // Fields with a conversion error are reported once, not again as "required";
    // empty cells do not overwrite values of an existing item.
    Object.entries(values).filter(([k, v]) => !failedKeys.has(columnOf.get(k) ?? -1) && v !== null),
  );
  const parsed = buildFieldValuesSchema(definitions).safeParse(
    applyDefaultProducts(definitions, { ...base, ...filled }),
  );
  let fieldValues: Record<string, unknown> = {};
  if (parsed.success) fieldValues = parsed.data;
  else {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      if (failedKeys.has(columnOf.get(key) ?? -1)) continue;
      issues.push({ column: columnOf.get(key) ?? null, message: issue.message });
    }
  }

  return {
    rowNumber,
    empty,
    itemNumber,
    qrCode,
    nextInspectionDate,
    locationPath,
    fieldValues,
    issues,
  };
}

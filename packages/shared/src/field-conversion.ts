/**
 * Changing the kind of a saved field (e.g. text → number) of an equipment type with items:
 * stored values are converted like import cells (tolerant, `convertCell`). A value that does not
 * fit is kept as text and reported, so nothing is lost and the office can fix it.
 */
import type { FieldDefinition } from './equipment-fields.js';
import { convertCell, type RawCell } from './import/cells.js';

export interface KindChange {
  key: string;
  label: string;
  from: FieldDefinition['kind'];
  to: FieldDefinition['kind'];
}

/** Saved fields whose kind changes. */
export function kindChanges(
  before: readonly FieldDefinition[],
  after: readonly FieldDefinition[],
): KindChange[] {
  return after.flatMap((field) => {
    const old = before.find((f) => f.key === field.key);
    return old && old.kind !== field.kind
      ? [{ key: field.key, label: field.label, from: old.kind, to: field.kind }]
      : [];
  });
}

/** A stored value as a cell for conversion: lists joined, booleans as ano/ne. */
function asCell(value: unknown): RawCell {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'ano' : 'ne';
  if (typeof value === 'number') return value;
  return String(value);
}

export interface ConvertedValues {
  values: Record<string, unknown>;
  /** Fields whose value changed, with a warning when it was kept as text or adjusted. */
  changed: { key: string; from: unknown; to: unknown; warning?: string }[];
  /** New option values for select/multiselect fields, by key. */
  newOptions: Record<string, string[]>;
}

/** Converts the values of the changed fields of one item. */
export function convertItemValues(
  changes: readonly KindChange[],
  after: readonly FieldDefinition[],
  values: Record<string, unknown>,
): ConvertedValues {
  const result: ConvertedValues = { values: { ...values }, changed: [], newOptions: {} };
  for (const change of changes) {
    const field = after.find((f) => f.key === change.key)!;
    const from = values[change.key];
    if (from === undefined || from === null || from === '') continue;
    const converted = convertCell(field, asCell(from));
    result.values[change.key] = converted.value;
    result.changed.push({
      key: change.key,
      from,
      to: converted.value,
      ...(converted.warning ? { warning: converted.warning } : {}),
    });
    if (converted.newOptions?.length) {
      result.newOptions[change.key] = [
        ...new Set([...(result.newOptions[change.key] ?? []), ...converted.newOptions]),
      ];
    }
  }
  return result;
}

export interface ConversionSummary extends KindChange {
  /** Items with a value in this field. */
  total: number;
  /** Converted without a remark. */
  converted: number;
  /** Values kept as text or adjusted, with how many items have them. */
  problems: { value: string; warning: string; count: number }[];
}

/** What a kind change would do to the stored values (preview before saving). */
export function summarizeConversion(
  before: readonly FieldDefinition[],
  after: readonly FieldDefinition[],
  items: readonly Record<string, unknown>[],
): ConversionSummary[] {
  const changes = kindChanges(before, after);
  return changes.map((change) => {
    const problems = new Map<string, { value: string; warning: string; count: number }>();
    let total = 0;
    let converted = 0;
    for (const values of items) {
      const done = convertItemValues([change], after, values).changed[0];
      if (!done) continue;
      total += 1;
      if (!done.warning) {
        converted += 1;
        continue;
      }
      const value = String(asCell(done.from));
      const entry = problems.get(value) ?? { value, warning: done.warning, count: 0 };
      entry.count += 1;
      problems.set(value, entry);
    }
    return { ...change, total, converted, problems: [...problems.values()] };
  });
}

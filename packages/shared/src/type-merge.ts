import { z } from 'zod';
import { idSchema } from './api/common.js';
import type { FieldDefinition } from './equipment-fields.js';

/**
 * Merging equipment types into one (e.g. "Regál paletový", "Regál policový" … into "Regál"):
 * the target keeps its own settings (fields, protocol text, interval, risk levels), gets the
 * fields of the merged types it does not have, and the former type of each item is kept in a
 * select field ("Typ regálu" = "Paletový", …).
 */
export const mergeTypesRequestSchema = z.object({
  targetId: idSchema,
  sourceIds: z.array(idSchema).min(1).max(50),
  /** New name of the target (e.g. "Regál"); empty = keep it. */
  name: z.string().trim().max(100).optional(),
  /** Field that keeps the former type of each item; omitted = not kept. */
  kindField: z
    .object({
      key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
      label: z.string().trim().min(1).max(100),
    })
    .optional(),
});
export type MergeTypesRequest = z.infer<typeof mergeTypesRequestSchema>;

export const mergePlanSchema = z.object({
  /** Items moved to the target. */
  items: z.number().int(),
  /** Labels of the fields the target gets from the merged types. */
  addedFields: z.array(z.string()),
  /** Fields with the same key but another kind: the target's definition stays. */
  conflicts: z.array(z.string()),
  /** The value written into the kind field for the items of each type (by type name). */
  kindValues: z.record(z.string(), z.string()),
});
export type MergePlan = z.infer<typeof mergePlanSchema>;

interface MergeType {
  id: string;
  name: string;
  fieldDefinitions: readonly FieldDefinition[];
}

/** The words every name starts with: ["Regál paletový", "Regál policový"] → "Regál". */
export function commonLeadingWords(names: readonly string[]): string {
  const split = names.map((n) => n.trim().split(/\s+/));
  const first = split[0] ?? [];
  const common: string[] = [];
  for (let i = 0; i < first.length; i++) {
    const word = first[i]!.toLocaleLowerCase('cs');
    if (split.every((w) => w.length > i + 1 && w[i]!.toLocaleLowerCase('cs') === word)) {
      common.push(first[i]!);
    } else break;
  }
  return common.join(' ');
}

/** "Regál paletový" with the base "Regál" → "Paletový"; otherwise the whole name. */
export function kindValueOf(typeName: string, base: string): string {
  const name = typeName.trim();
  const prefix = base.trim().toLocaleLowerCase('cs');
  let rest = name;
  if (prefix && name.toLocaleLowerCase('cs').startsWith(prefix)) {
    rest = name.slice(prefix.length).replace(/^[\s\-–:,]+/, '');
  }
  if (!rest) return name;
  return rest.charAt(0).toLocaleUpperCase('cs') + rest.slice(1);
}

/** The field definitions of the merged type and what the merge does (for the preview). */
export function planTypeMerge(
  target: MergeType,
  sources: readonly MergeType[],
  options: { name?: string; kindField?: { key: string; label: string } },
): {
  fieldDefinitions: FieldDefinition[];
  addedFields: string[];
  conflicts: string[];
  kindValues: Record<string, string>;
} {
  // "Regál paletový", "Regál policový" → base "Regál": the words all the names start with.
  const base =
    commonLeadingWords([target, ...sources].map((t) => t.name)) || options.name || target.name;
  const fields: FieldDefinition[] = target.fieldDefinitions.map((f) => ({ ...f }));
  const addedFields: string[] = [];
  const conflicts: string[] = [];
  let order = Math.max(-1, ...fields.map((f) => f.order)) + 1;
  for (const source of sources) {
    for (const field of source.fieldDefinitions) {
      const own = fields.find((f) => f.key === field.key);
      if (!own) {
        fields.push({ ...field, order: order++ });
        addedFields.push(field.label);
      } else if (own.kind !== field.kind) {
        if (!conflicts.includes(own.label)) conflicts.push(own.label);
      } else if (own.kind === 'select' || own.kind === 'multiselect') {
        // The same list: the target gets the values it does not offer yet.
        own.options = [...own.options, ...field.options.filter((o) => !own.options.includes(o))];
      }
    }
  }
  const kindValues: Record<string, string> = {};
  if (options.kindField) {
    for (const t of [target, ...sources]) {
      // A target named just like the base ("Regál") says nothing about the kind of its items.
      if (t === target && t.name.trim().toLocaleLowerCase('cs') === base.toLocaleLowerCase('cs')) {
        continue;
      }
      kindValues[t.name] = kindValueOf(t.name, base);
    }
    const values = [...new Set(Object.values(kindValues))];
    const existing = fields.find((f) => f.key === options.kindField!.key);
    if (existing && existing.kind === 'select') {
      existing.options = [
        ...existing.options,
        ...values.filter((v) => !existing.options.includes(v)),
      ];
    } else if (!existing) {
      fields.push({
        key: options.kindField.key,
        label: options.kindField.label,
        kind: 'select',
        required: false,
        options: values,
        suggestions: [],
        order,
        archived: false,
      });
      addedFields.push(options.kindField.label);
    }
  }
  return { fieldDefinitions: fields, addedFields, conflicts, kindValues };
}

import { z } from 'zod';

/**
 * Configurable fields of an equipment type (ADR-0006). The definition is stored on
 * `equipment_type.field_definitions`; item values live in `item.field_values` (JSONB) and are
 * validated by the schema built here – on the client, in the API and in the import.
 */
export const FIELD_KINDS = [
  'text',
  'number',
  'integer',
  'date',
  'boolean',
  'select',
  'multiselect',
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  text: 'Text',
  number: 'Číslo',
  integer: 'Celé číslo',
  date: 'Datum',
  boolean: 'Ano/ne',
  select: 'Výběr z číselníku',
  multiselect: 'Více hodnot z číselníku',
};

/** Field keys are stable identifiers inside the JSONB values; they never change once created. */
export const fieldKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Klíč: malá písmena, číslice a _, začíná písmenem');

export const fieldDefinitionSchema = z
  .object({
    key: fieldKeySchema,
    label: z.string().trim().min(1).max(100),
    kind: z.enum(FIELD_KINDS),
    required: z.boolean().default(false),
    /** Allowed values for select/multiselect. */
    options: z.array(z.string().trim().min(1).max(100)).max(200).default([]),
    /** Offered values for text fields (e.g. common manufacturers); any other text is allowed. */
    suggestions: z.array(z.string().trim().min(1).max(100)).max(200).default([]),
    /** Help text shown under the field. */
    help: z.string().trim().max(300).optional(),
    unit: z.string().trim().max(20).optional(),
    order: z.number().int().min(0),
    /** Archived fields are hidden in forms but their stored values are kept. */
    archived: z.boolean().default(false),
  })
  .superRefine((field, ctx) => {
    const needsOptions = field.kind === 'select' || field.kind === 'multiselect';
    if (needsOptions && field.options.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Číselník musí mít aspoň jednu hodnotu',
      });
    }
    if (new Set(field.options).size !== field.options.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Hodnoty číselníku se opakují' });
    }
  });

export type FieldDefinition = z.output<typeof fieldDefinitionSchema>;

export const fieldDefinitionsSchema = z
  .array(fieldDefinitionSchema)
  .max(100)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((field, index) => {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'key'],
          message: `Duplicitní klíč „${field.key}“`,
        });
      }
      seen.add(field.key);
    });
  });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function valueSchema(field: FieldDefinition): z.ZodType {
  switch (field.kind) {
    case 'text':
      return z.string().trim().max(2000);
    case 'number':
      return z.number().finite();
    case 'integer':
      return z.number().int();
    case 'date':
      return z
        .string()
        .regex(ISO_DATE, 'Datum ve formátu RRRR-MM-DD')
        .refine((value) => !Number.isNaN(Date.parse(value)), 'Neplatné datum');
    case 'boolean':
      return z.boolean();
    case 'select':
      return z.enum(field.options as [string, ...string[]]);
    case 'multiselect':
      return z.array(z.enum(field.options as [string, ...string[]]));
  }
}

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

/**
 * Builds the validator for `item.field_values`. Empty values (`''`, `null`, `[]`) of optional
 * fields are dropped. Values of archived fields are preserved untouched; unknown keys are
 * rejected so that typos in imports do not silently disappear.
 */
export function buildFieldValuesSchema(definitions: readonly FieldDefinition[]) {
  const active = definitions.filter((field) => !field.archived);
  const archivedKeys = new Set(definitions.filter((f) => f.archived).map((f) => f.key));

  return z.record(z.string(), z.unknown()).transform((input, ctx) => {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input)) {
      if (archivedKeys.has(key)) output[key] = input[key];
      else if (!active.some((field) => field.key === key)) {
        ctx.addIssue({ code: 'custom', path: [key], message: `Neznámé pole „${key}“` });
      }
    }
    for (const field of active) {
      const value = input[field.key];
      if (isEmpty(value)) {
        if (field.required) {
          ctx.addIssue({
            code: 'custom',
            path: [field.key],
            message: `Pole „${field.label}“ je povinné`,
          });
        }
        continue;
      }
      const parsed = valueSchema(field).safeParse(value);
      if (parsed.success) output[field.key] = parsed.data;
      else {
        for (const issue of parsed.error.issues) {
          ctx.addIssue({
            code: 'custom',
            path: [field.key, ...issue.path],
            message: issue.message,
          });
        }
      }
    }
    return output;
  });
}

function formatFieldValue(field: FieldDefinition, value: unknown): string {
  if (typeof value === 'boolean') return value ? 'ano' : 'ne';
  if (Array.isArray(value)) return value.join(', ');
  if (field.kind === 'date' && typeof value === 'string') {
    const [y, m, d] = value.slice(0, 10).split('-');
    return `${Number(d)}. ${Number(m)}. ${y}`;
  }
  const text = typeof value === 'number' ? value.toLocaleString('cs-CZ') : String(value);
  return field.unit ? `${text} ${field.unit}` : text;
}

/** Label/value pairs of an item's fields in definition order; empty values are left out. */
export function displayFields(
  definitions: readonly FieldDefinition[],
  values: Record<string, unknown>,
): { label: string; value: string }[] {
  return [...definitions]
    .filter((field) => !field.archived)
    .sort((a, b) => a.order - b.order)
    .flatMap((field) => {
      const value = values[field.key];
      if (value === undefined || value === null || value === '') return [];
      return [{ label: field.label, value: formatFieldValue(field, value) }];
    });
}

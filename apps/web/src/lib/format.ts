import { LOCATION_SEPARATOR, type FieldDefinition } from '@revize/shared';

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return date.toLocaleDateString('cs-CZ');
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('cs-CZ');
}

export function locationLabel(path: readonly string[]): string {
  return path.length ? path.join(LOCATION_SEPARATOR) : 'Bez umístění';
}

/** "Výška rámu" → "vyska_ramu" – a stable key for a new field. */
export function slugKey(label: string): string {
  const slug = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return /^[a-z]/.test(slug) ? slug : `pole_${slug}`.slice(0, 40);
}

function formatFieldValue(field: FieldDefinition, value: unknown): string {
  if (typeof value === 'boolean') return value ? 'ano' : 'ne';
  if (Array.isArray(value)) return value.join(', ');
  if (field.kind === 'date' && typeof value === 'string') return formatDate(value);
  const text = typeof value === 'number' ? value.toLocaleString('cs-CZ') : String(value);
  return field.unit ? `${text} ${field.unit}` : text;
}

/** Label/value pairs of an item's fields in definition order; empty values are left out. */
export function displayFields(
  definitions: readonly FieldDefinition[],
  values: Record<string, unknown>,
): { label: string; value: string }[] {
  return definitions
    .filter((field) => !field.archived)
    .sort((a, b) => a.order - b.order)
    .flatMap((field) => {
      const value = values[field.key];
      if (value === undefined || value === null || value === '') return [];
      return [{ label: field.label, value: formatFieldValue(field, value) }];
    });
}

import { LOCATION_SEPARATOR } from '@revize/shared';

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

export { displayFields } from '@revize/shared';

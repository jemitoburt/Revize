import {
  LOCATION_SEPARATOR,
  formatDate as sharedFormatDate,
  formatDateTime as sharedFormatDateTime,
} from '@revize/shared';

/** DD/MM/YYYY (shared formatter), a dash when empty. */
export function formatDate(iso: string | null | undefined): string {
  return sharedFormatDate(iso) || '–';
}

/** DD/MM/YYYY HH:mm, a dash when empty. */
export function formatDateTime(iso: string | null | undefined): string {
  return sharedFormatDateTime(iso) || '–';
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

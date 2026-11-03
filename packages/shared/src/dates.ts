/**
 * Date formats shown to people: DD/MM/YYYY everywhere (UI, protocol, exports). The API keeps
 * ISO dates (`2026-11-03`) and timestamps.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-11-03` (or a timestamp) → `03/11/2026`; empty for null. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }
  return formatDateTime(iso).slice(0, 10);
}

/** `2026-11-03T08:05:00Z` → `03/11/2026 09:05` in Czech time. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return `${pad(get('day'))}/${pad(get('month'))}/${get('year')} ${pad(get('hour'))}:${pad(get('minute'))}`;
}

/**
 * Typed date → ISO: `3/11/2026`, `03/11/2026`, `3.11.2026` or `2026-11-03`; null when it is
 * not a real date.
 */
export function parseDateInput(input: string): string | null {
  const text = input.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const cz = /^(\d{1,2})\s*[/.]\s*(\d{1,2})\s*[/.]\s*(\d{4})$/.exec(text);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (cz) [d, m, y] = [Number(cz[1]), Number(cz[2]), Number(cz[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${pad(m)}-${pad(d)}`;
}

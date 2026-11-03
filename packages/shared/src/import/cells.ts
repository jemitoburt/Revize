import type { FieldDefinition } from '../equipment-fields.js';

/** A cell as delivered by the parser (XLSX keeps numbers/dates/booleans, CSV gives text). */
export type RawCell = string | number | boolean | Date | null;

/**
 * Result of converting a cell. Import never rejects a value of a configurable field (the user
 * asked for formats that are not locked hard): what cannot be converted is kept as text and
 * reported as a warning; option values that are not in the list yet are added to it.
 */
export interface Converted {
  value: unknown;
  warning?: string;
  /** Values to add to the field's options (select/multiselect). */
  newOptions?: string[];
}

const ok = (value: unknown): Converted => ({ value });
const asText = (text: string, warning: string): Converted => ({ value: text, warning });

/** Lower-case, without diacritics and punctuation – for tolerant matching of texts. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isEmptyCell(cell: RawCell): boolean {
  return cell === null || (typeof cell === 'string' && cell.trim() === '');
}

export function cellText(cell: RawCell): string {
  if (cell === null) return '';
  if (cell instanceof Date) return toIsoDate(cell);
  return String(cell).trim();
}

/** "1 234,5" / "1234.5" / "1 234" (incl. non-breaking spaces) → number. */
export function parseCzechNumber(text: string): number | null {
  const compact = text.replace(/[\s\u00A0\u202F]/g, '');
  if (!/^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/.test(compact)) return null;
  return Number(compact.replace(',', '.'));
}

const TRUE_WORDS = new Set(['ano', 'a', 'yes', 'y', 'true', '1', 'x', 'ok']);
const FALSE_WORDS = new Set(['ne', 'n', 'no', 'false', '0', '-']);

function toIsoDate(date: Date): string {
  // Excel dates arrive as UTC midnight; use the UTC parts so the day does not shift.
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function validDate(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  return toIsoDate(date);
}

/** Excel serial date (days since 1899-12-30) → ISO date. */
function fromExcelSerial(serial: number): string | null {
  if (serial < 1 || serial > 100_000) return null;
  return toIsoDate(new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000));
}

/** Accepts Date, Excel serial numbers, "31.12.2026", "31. 12. 2026", "2026-12-31", "12/2026". */
export function parseDate(cell: RawCell): string | null {
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? null : toIsoDate(cell);
  if (typeof cell === 'number') return fromExcelSerial(cell);
  const text = cellText(cell);
  let m = /^(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{4})$/.exec(text); // 3.11.2026, 03/11/2026
  if (m) return validDate(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\s*[./]\s*(\d{4})$/.exec(text); // month/year → first day of the month
  if (m) return validDate(Number(m[2]), Number(m[1]), 1);
  return null;
}

/**
 * The number in a text like "2 000 kg", "2,5 m", "cca 3000": the first number when the text
 * contains exactly one. Null when there is none or several.
 */
export function extractNumber(text: string): number | null {
  const pattern = /[+-]?(?:\d{1,3}(?:[\s\u00A0\u202F]\d{3})+|\d+)(?:[.,]\d+)?/g;
  const found = text.match(pattern);
  if (!found || found.length !== 1) return null;
  return parseCzechNumber(found[0]);
}

function matchOption(options: readonly string[], text: string): string | null {
  const wanted = normalizeText(text);
  return options.find((o) => normalizeText(o) === wanted) ?? null;
}

/**
 * Converts one cell to the value of a configurable field. Tolerant of what people type into
 * spreadsheets: decimal commas, units ("2 000 kg"), "ano/ne/x", Czech dates, option texts
 * without diacritics. What still does not fit is kept as text with a warning.
 */
export function convertCell(field: FieldDefinition, cell: RawCell): Converted {
  if (isEmptyCell(cell)) return ok(null);
  const text = cellText(cell);
  switch (field.kind) {
    case 'text':
      return ok(text);
    case 'number':
    case 'integer': {
      const plain = typeof cell === 'number' ? cell : parseCzechNumber(text);
      const value = plain ?? extractNumber(text);
      if (value === null) return asText(text, `„${text}“ není číslo – uloženo jako text`);
      const warnings: string[] = [];
      if (plain === null) warnings.push(`„${text}“ převzato jako ${value}`);
      let result = value;
      if (field.kind === 'integer' && !Number.isInteger(value)) {
        result = Math.round(value);
        warnings.push(`${value} zaokrouhleno na ${result}`);
      }
      return warnings.length ? { value: result, warning: warnings.join(', ') } : ok(result);
    }
    case 'boolean': {
      if (typeof cell === 'boolean') return ok(cell);
      const word = normalizeText(text);
      if (TRUE_WORDS.has(word)) return ok(true);
      if (FALSE_WORDS.has(word)) return ok(false);
      return asText(text, `„${text}“ není ano/ne – uloženo jako text`);
    }
    case 'date': {
      const date = parseDate(cell);
      return date ? ok(date) : asText(text, `„${text}“ není datum – uloženo jako text`);
    }
    case 'select': {
      const option = matchOption(field.options, text);
      if (option) return ok(option);
      return {
        value: text,
        warning: `„${text}“ je nová hodnota číselníku – přidá se`,
        newOptions: [text],
      };
    }
    case 'multiselect': {
      const parts = text
        .split(/[,;|]/)
        .map((p) => p.trim())
        .filter(Boolean);
      const values: string[] = [];
      const added: string[] = [];
      for (const part of parts) {
        const option = matchOption(field.options, part);
        values.push(option ?? part);
        if (!option) added.push(part);
      }
      return added.length
        ? {
            value: values,
            warning: `${added.map((a) => `„${a}“`).join(', ')}: nové hodnoty číselníku – přidají se`,
            newOptions: added,
          }
        : ok(values);
    }
  }
}

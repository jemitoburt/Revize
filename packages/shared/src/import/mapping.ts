import { z } from 'zod';
import type { FieldDefinition } from '../equipment-fields.js';
import { normalizeText } from './cells.js';

const columnRef = z.number().int().min(0).nullable();

/**
 * How spreadsheet columns map onto an item. Columns are referenced by index (headers may repeat);
 * the header names are kept so that a saved mapping can be re-applied to the next file.
 */
export const importMappingSchema = z.object({
  siteId: z.uuid(),
  equipmentTypeId: z.uuid(),
  /** `create`: existing numbers are errors; `upsert`: rows with an existing number update it. */
  mode: z.enum(['create', 'upsert']).default('create'),
  itemNumber: columnRef.default(null),
  /** Designation such as "Ž-01" (prefix + number). */
  designation: columnRef.default(null),
  qrCode: columnRef.default(null),
  nextInspectionDate: columnRef.default(null),
  /** Columns forming the location path from the top (e.g. Hala, Řada, Pozice). */
  location: z.array(z.number().int().min(0)).max(10).default([]),
  /** When a single location column holds the whole path ("Hala A / Řada 1"), split by this. */
  locationSeparator: z.string().max(5).default(''),
  createMissingLocations: z.boolean().default(true),
  /**
   * Rows without a číslo TZ get the next free number; otherwise they are imported without
   * číslo TZ (racks; filled in on site later, ADR-0020).
   */
  autoNumber: z.boolean().default(false),
  fields: z.record(z.string(), columnRef).default({}),
  /**
   * Per field key: replace a cell value with another one in every row ("Kolo" → "Opěrný").
   * Matched like options (case and diacritics do not matter); applied before conversion.
   */
  replacements: z
    .record(
      z.string(),
      z
        .array(
          z.object({
            from: z.string().max(500),
            to: z.string().max(500),
            /** "Přeskočit": the value is not imported (the field stays empty). */
            skip: z.boolean().optional(),
          }),
        )
        .max(500),
    )
    .default({}),
  /**
   * Per field key: value for every row whose cell is empty or whose field has no column
   * ("150 kg" for all ladders). Written like a cell, so it is converted the same way.
   */
  defaults: z.record(z.string(), z.string().max(500)).default({}),
});

/** Replacements and default values remembered with the mapping of a type. */
export type MappingValues = Pick<ImportMapping, 'replacements' | 'defaults'>;
export type ImportMapping = z.output<typeof importMappingSchema>;
export type ImportMappingInput = z.input<typeof importMappingSchema>;

export type MappingTarget =
  'itemNumber' | 'designation' | 'qrCode' | 'nextInspectionDate' | 'location';

/** Header names (normalized) that commonly mean the standard targets. */
const STANDARD_HEADERS: Record<MappingTarget, string[]> = {
  itemNumber: [
    'cislo tz',
    'c tz',
    'tz',
    'cislo',
    'cislo artiklu',
    'c artiklu',
    'artikl',
    'evidencni cislo',
    'ev cislo',
    'inventarni cislo',
    'inv cislo',
    'item number',
    'number',
  ],
  designation: [
    'oznaceni',
    'oznaceni regalu',
    'oznaceni zebriku',
    'oznaceni voziku',
    'oznaceni tz',
    'popisne oznaceni',
  ],
  qrCode: ['qr', 'qr kod', 'qr code', 'kod stitku', 'stitek'],
  nextInspectionDate: [
    'pristi kontrola',
    'pristi revize',
    'dalsi kontrola',
    'dalsi revize',
    'datum pristi kontroly',
  ],
  location: [
    'umisteni',
    'lokace',
    'misto',
    'hala',
    'budova',
    'sklad',
    'rada',
    'ulicka',
    'pozice',
    'regal',
    'patro',
    'mistnost',
  ],
};

/** A previously used mapping: target → header name. */
export type SavedHeaders = Partial<Record<string, string | string[]>>;

/**
 * Proposes a mapping for the given headers: first the saved mapping of the same type (by header
 * name), then standard header names and the field labels/keys of the type.
 */
export function suggestMapping(
  headers: readonly string[],
  definitions: readonly FieldDefinition[],
  saved: SavedHeaders = {},
): Pick<
  ImportMapping,
  'itemNumber' | 'designation' | 'qrCode' | 'nextInspectionDate' | 'location' | 'fields'
> {
  const normalized = headers.map((h) => normalizeText(h));
  const used = new Set<number>();
  const find = (candidates: string[]) => {
    for (const candidate of candidates.map(normalizeText)) {
      const index = normalized.findIndex((h, i) => h === candidate && !used.has(i));
      if (index >= 0) {
        used.add(index);
        return index;
      }
    }
    return null;
  };
  const fromSaved = (target: string) => {
    const header = saved[target];
    return typeof header === 'string' ? find([header]) : null;
  };

  const itemNumber = fromSaved('itemNumber') ?? find(STANDARD_HEADERS.itemNumber);
  const designation = fromSaved('designation') ?? find(STANDARD_HEADERS.designation);
  const qrCode = fromSaved('qrCode') ?? find(STANDARD_HEADERS.qrCode);
  const nextInspectionDate =
    fromSaved('nextInspectionDate') ?? find(STANDARD_HEADERS.nextInspectionDate);

  const active = definitions.filter((f) => !f.archived);
  const fields: Record<string, number | null> = {};
  for (const field of active) {
    fields[field.key] = fromSaved(`field:${field.key}`) ?? find([field.label, field.key]);
  }
  // Second pass: a header that is the start of a field label (or the other way round) at a word
  // boundary, e.g. "Počet příček" → "Počet příček / stupňů na díl". Exact matches win.
  const startsWithWord = (long: string, short: string) =>
    short.length >= 4 && (long === short || long.startsWith(`${short} `));
  for (const field of active) {
    if (fields[field.key] !== null) continue;
    const label = normalizeText(field.label);
    const index = normalized.findIndex(
      (h, i) => !used.has(i) && h !== '' && (startsWithWord(label, h) || startsWithWord(h, label)),
    );
    if (index >= 0) {
      used.add(index);
      fields[field.key] = index;
    }
  }

  let location: number[];
  const savedLocation = saved.location;
  if (Array.isArray(savedLocation) && savedLocation.length) {
    location = savedLocation.map((h) => find([h])).filter((i): i is number => i !== null);
  } else {
    // All location-like columns, in the order they appear in the sheet.
    location = normalized
      .map((h, i) => ({ h, i }))
      .filter(({ h, i }) => !used.has(i) && STANDARD_HEADERS.location.includes(h))
      .map(({ i }) => {
        used.add(i);
        return i;
      });
  }
  return { itemNumber, designation, qrCode, nextInspectionDate, location, fields };
}

/** The header names of a mapping, for saving and re-applying it to the next file. */
export function mappingHeaders(mapping: ImportMapping, headers: readonly string[]): SavedHeaders {
  const name = (i: number | null) => (i === null ? undefined : headers[i]);
  const result: SavedHeaders = {
    itemNumber: name(mapping.itemNumber),
    designation: name(mapping.designation),
    qrCode: name(mapping.qrCode),
    nextInspectionDate: name(mapping.nextInspectionDate),
    location: mapping.location.map((i) => headers[i]).filter((h): h is string => h !== undefined),
  };
  for (const [key, index] of Object.entries(mapping.fields)) result[`field:${key}`] = name(index);
  return result;
}

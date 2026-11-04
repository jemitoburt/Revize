/**
 * Item number = "číslo TZ": a 4- or 5-digit code, unique in the whole organization. Leading
 * zeros carry no meaning: "01234" is the same item as "1234" (on the keypad a 4-digit number is
 * typed with a leading 0 so that lookup can fire after the 5th digit). Numbers are stored in
 * canonical form, without leading zeros (ADR-0012). The human designation ("Ž-01") is a
 * separate, optional text (`designation`).
 */
export const ITEM_NUMBER_MAX_LENGTH = 5;

/** The keypad looks up automatically after this many digits; shorter numbers are confirmed. */
export const KEYPAD_AUTO_LENGTH = 5;

const DIGITS = /^\d{1,12}$/;

/** Canonical form ("01234" → "1234"), or null when the input is not an item number. */
export function canonicalItemNumber(input: string): string | null {
  const trimmed = input.trim();
  if (!DIGITS.test(trimmed)) return null;
  const canonical = trimmed.replace(/^0+/, '');
  return isValidItemNumber(canonical) ? canonical : null;
}

/** A stored item number: digits without leading zeros, at most 5 digits, not zero. */
export function isValidItemNumber(value: string): boolean {
  return /^[1-9]\d{0,4}$/.test(value);
}

export const DESIGNATION_MAX_LENGTH = 50;

/**
 * Designation for comparison and search: "Ž-01", "ž 01" and "Ž01" are the same. Case, spaces,
 * dashes, dots and slashes do not matter.
 */
export function normalizeDesignation(value: string): string {
  return value
    .normalize('NFC')
    .toLocaleLowerCase('cs')
    .replace(/[\s\-–./]+/g, '');
}

/** Designation as stored (trimmed, null when empty) and its comparison key. */
export function designationOf(value: string | null | undefined): {
  designation: string | null;
  designationKey: string | null;
} {
  const designation = value?.trim() || null;
  const key = designation ? normalizeDesignation(designation) || null : null;
  return { designation, designationKey: key };
}

/**
 * The letter parts of designations, most frequent first, for quick keys on the field number pad:
 * ["Ž-01", "Ž-02", "NH01", "AG01", "01-ŽLS"] → ["Ž", "NH", "AG", "ŽLS"] (upper case; the case of
 * a designation does not matter when it is found). At most `limit` keys.
 */
export function designationTokens(designations: readonly (string | null)[], limit = 12): string[] {
  const counts = new Map<string, number>();
  for (const designation of designations) {
    if (!designation) continue;
    const seen = new Set<string>();
    for (const match of designation.matchAll(/\p{L}+/gu)) {
      const token = match[0].toLocaleUpperCase('cs');
      if (seen.has(token)) continue;
      seen.add(token);
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'cs'))
    .slice(0, limit)
    .map(([token]) => token);
}

/** Numeric order of item numbers (so that "999" sorts before "1000"). */
export function compareItemNumbers(a: string, b: string): number {
  return a.length - b.length || a.localeCompare(b);
}

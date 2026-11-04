/**
 * Layout of the protocol with as few pages as possible (ADR-0016): whether the equipment table
 * fits on the first page (else it becomes Příloha 1 on A4 landscape), and how large the defect
 * photos are and whether defects go in two columns. Heights are estimated from the text (Arial
 * 9 pt) – the same decision is used by the HTML/PDF and the Word protocol.
 */
import type { ProtocolData, ProtocolItem } from './protocol.js';

/** A4 portrait minus the PDF margins (29 + 20 mm, 14 + 14 mm). */
export const PAGE = { width: 182, height: 248 };
const LINE = 3.75; // mm per line of 9 pt text (measured in the PDF)
const CHAR = 1.6; // mm per character (average, Arial 9 pt, measured)

/** Photo heights to try, from the largest; 35 mm is the smallest acceptable. */
export const PHOTO_HEIGHTS = [60, 55, 50, 45, 40, 35] as const;
/** Best for reading (the user's choice): used whenever the protocol stays within the target. */
export const PREFERRED_PHOTO_HEIGHT = 50;
/** Protocols should not be longer than this; beyond it the smallest sizes are used. */
export const TARGET_PAGES = 8;
export const PHOTO_ASPECT = 4 / 3;

/** Estimated number of lines of a text in a column of the given width (mm). */
export const linesOf = (text: string, widthMm: number) => {
  const perLine = Math.max(1, Math.floor(widthMm / CHAR));
  return text
    .split('\n')
    .reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / perLine)), 0);
};

/** Estimated height of one row of the protocol table (mm). */
export function tableRowHeight(item: ProtocolItem, noteLines: string[]): number {
  const description = `${item.designation ? `${item.designation} ` : ''}${item.details}`;
  const descriptionLines = linesOf(description, 68) + (item.location ? 1 : 0);
  const noteHeight = noteLines.reduce((sum, line) => sum + linesOf(line, 67), 0);
  return Math.max(ROW_MIN, Math.max(descriptionLines, noteHeight) * LINE + ROW_PADDING);
}

/** Space the first page needs besides the item rows (title, details, table headers). */
const ROW_MIN = 7;
const ROW_PADDING = 1.6;
/** Heading rows of one equipment table and the gap above it (mm). */
const TABLE_HEADERS = 17;

function firstPageFixed(data: ProtocolData): number {
  const draft = data.final ? 0 : 10;
  const title = 11;
  const info = 5 * 8.2 + (data.note ? linesOf(data.note, 130) * LINE + 2 : 0);
  const tableHeaders = data.sections.length * TABLE_HEADERS;
  const footnote = 5;
  return draft + title + info + tableHeaders + footnote;
}

export interface DefectCardInput {
  /** Characters of the title line ("10004 · A1-04 · Pozice 4"). */
  titleLength: number;
  /** Characters of the defect description. */
  descriptionLength: number;
  photos: number;
}

/** Defects of one severity, by workplace (as rendered: a heading per severity and place). */
export type DefectGroupsInput = readonly (readonly (readonly DefectCardInput[])[])[];

export interface PhotoLayout {
  photoHeight: number;
  columns: 1 | 2 | 3;
  pages: number;
}

// Defect cards are 8 pt (measured): line 3.4 mm, character 1.45 mm.
const CARD_LINE = 3.4;
const CARD_CHAR = 1.45;
const CARD_GAP = 2;
const SEVERITY_HEADING = 9;
const PLACE_HEADING = 6;

const columnWidthOf = (columns: number) => (PAGE.width - (columns - 1) * CARD_GAP) / columns;

/** Photos may be cropped from 4:3 down to a square so that two fit side by side. */
export const MIN_PHOTO_ASPECT = 1;

/**
 * Size of the photos of one card: as many side by side as fit at the given height (cropped
 * towards a square if needed), each as wide as possible up to 4:3.
 */
export function photoBox(
  columns: 1 | 2 | 3,
  photoHeight: number,
  photos: number,
): { width: number; perRow: number } {
  // Padding 2 × 1.2 mm, border and rounding: keep 1 mm more so that photos never wrap.
  const inner = columnWidthOf(columns) - 3.5;
  const maxPerRow = Math.max(1, Math.floor((inner + 1) / (photoHeight * MIN_PHOTO_ASPECT + 1)));
  const perRow = Math.max(1, Math.min(photos, maxPerRow));
  const width = Math.min(photoHeight * PHOTO_ASPECT, (inner + 1) / perRow - 1);
  return { width: Math.floor(width * 10) / 10, perRow };
}

/** Height of a compact defect card (mm) in a column of the given width. */
function cardHeight(
  card: DefectCardInput,
  columnWidth: number,
  photoHeight: number,
  columns: 1 | 2 | 3,
): number {
  const inner = columnWidth - 2.5;
  const perLine = Math.max(1, Math.floor(inner / CARD_CHAR));
  const lines = (n: number) => (n ? Math.ceil(n / perLine) : 0);
  const text = (lines(card.titleLength) + lines(card.descriptionLength)) * CARD_LINE;
  if (!card.photos) return text + 2.5;
  const { perRow } = photoBox(columns, photoHeight, card.photos);
  const rows = Math.ceil(card.photos / perRow);
  return text + 1 + rows * (photoHeight + 1) + 2.5;
}

/**
 * Pages the defect section takes. Cards flow in newspaper columns (down one column, then the
 * next, then the next page) – no half-empty rows when a workplace has few defects. A severity
 * heading spans all columns; a workplace heading stays with its first card; cards never split.
 */
export function defectPages(
  groups: DefectGroupsInput,
  photoHeight: number,
  columns: 1 | 2 | 3,
  /** Photos of the inspection as a whole, always full width at the end. */
  overviewPhotos = 0,
  /** Space already used on the page where the defects start. */
  startUsed = 0,
): number {
  const width = columnWidthOf(columns);
  // A few mm of reserve: a page break one card too early costs a whole column.
  const usable = PAGE.height - 6;
  let pages = 1;
  let top = startUsed;
  /** How many items fill `columns` columns of height `height` from the start (greedy). */
  const fitting = (items: number[], height: number) => {
    let column = 0;
    let filled = 0;
    let count = 0;
    for (const h of items) {
      if (filled + h > height && filled > 0) {
        column += 1;
        filled = 0;
      }
      if (column >= columns || h > height) break;
      filled += h;
      count += 1;
    }
    return count;
  };
  /** Items in newspaper columns; the last page's columns are balanced (as the browser does). */
  const flow = (all: number[]) => {
    let items = all.map((h) => Math.min(h, usable));
    while (items.length) {
      const available = usable - top;
      if (fitting(items, available) === items.length) {
        // Balanced: the lowest column height that still takes everything.
        let low = Math.max(...items);
        let high = available;
        while (high - low > 1) {
          const mid = (low + high) / 2;
          if (fitting(items, mid) === items.length) high = mid;
          else low = mid;
        }
        top += high;
        return;
      }
      const placed = fitting(items, available);
      items = items.slice(placed);
      pages += 1;
      top = 0;
    }
  };
  /** A full-width block (severity heading, overview photos) kept with what follows. */
  const span = (height: number, keepWith: number) => {
    if (top + height + keepWith > usable && top > 0) {
      pages += 1;
      top = 0;
    }
    top += height;
  };
  for (const severity of groups) {
    const cards = severity.flat();
    if (!cards.length) continue;
    const heights = severity.flatMap((place) =>
      place.map(
        (card, i) =>
          // The workplace heading goes with its first card.
          (i === 0 ? PLACE_HEADING : 0) + cardHeight(card, width, photoHeight, columns) + CARD_GAP,
      ),
    );
    span(SEVERITY_HEADING, heights[0]!);
    flow(heights);
  }
  if (overviewPhotos) {
    const perRow = Math.max(1, Math.floor((PAGE.width + 1) / (photoHeight * PHOTO_ASPECT + 1)));
    span(SEVERITY_HEADING, photoHeight + 1);
    for (let i = 0; i < Math.ceil(overviewPhotos / perRow); i++) span(photoHeight + 1, 0);
  }
  return pages;
}

/**
 * Photo size and number of columns. Within the target number of pages the photos closest to
 * 5 cm win (then fewer pages, then fewer columns); when even the best layout is longer, the one
 * with the fewest pages and the smallest photos (never below 3.5 cm). A photo must fit the column width.
 * `totalOf` turns the pages of the defect section into the pages of the whole protocol.
 */
export function choosePhotoLayout(
  groups: DefectGroupsInput,
  overviewPhotos = 0,
  startUsed = 0,
  totalOf: (defectPages: number) => number = (n) => n,
  /** "Co nejkratší protokol": the fewest pages with the minimal sizes, even within 8 pages. */
  shortest = false,
): PhotoLayout & { total: number } {
  const options: (PhotoLayout & { total: number })[] = [];
  for (const photoHeight of PHOTO_HEIGHTS) {
    for (const columns of [1, 2, 3] as const) {
      if (photoHeight * MIN_PHOTO_ASPECT > columnWidthOf(columns) - 2.5) continue;
      const pages = defectPages(groups, photoHeight, columns, overviewPhotos, startUsed);
      options.push({ photoHeight, columns, pages, total: totalOf(pages) });
    }
  }
  const within = shortest ? [] : options.filter((o) => o.total <= TARGET_PAGES);
  const pick = within.length
    ? within.sort(
        (a, b) =>
          Math.abs(a.photoHeight - PREFERRED_PHOTO_HEIGHT) -
            Math.abs(b.photoHeight - PREFERRED_PHOTO_HEIGHT) ||
          a.total - b.total ||
          a.columns - b.columns,
      )[0]
    : // Longer protocols: the fewest pages, and the minimal sizes (the user's rule).
      options.sort(
        (a, b) => a.total - b.total || a.photoHeight - b.photoHeight || b.columns - a.columns,
      )[0];
  return pick ?? { photoHeight: PREFERRED_PHOTO_HEIGHT, columns: 1, pages: 0, total: 0 };
}

/** Pages of Příloha 1 on A4 landscape (8 pt rows; the last column holds the long text). */
export function appendixPages(rows: readonly { cells: readonly string[] }[]): number {
  const usable = 210 - 49;
  const perLine = Math.floor(((297 - 28) * 0.3) / 1.45);
  const body = rows.reduce((sum, row) => {
    const longest = Math.max(1, ...row.cells.map((c) => Math.ceil(c.length / perLine)));
    return sum + longest * 3.2 + 1.2;
  }, 0);
  return Math.max(1, Math.ceil((12 + 6 + body) / usable));
}

export interface ProtocolLayout {
  /** The equipment table fits on the first page (otherwise Příloha 1). */
  inlineTable: boolean;
  /** The warning, signatures and texts start on a new page (they do not fit below page 1). */
  warningOnNewPage: boolean;
  photoHeight: number;
  defectColumns: 1 | 2 | 3;
  /** Estimated pages of the whole protocol. */
  pages: number;
}

export function planProtocolLayout(
  data: ProtocolData,
  noteLinesOf: (item: ProtocolItem) => string[],
  /** Defects by severity and workplace, as cards: title (number, designation, rest of location). */
  defects: readonly (readonly (readonly { title: string; item: ProtocolItem }[])[])[],
  /** Height of the warning, signatures, statements and texts (mm). */
  warningHeight: number,
  /** The table goes to Příloha 1 even when it fits. */
  forceAppendix = false,
): ProtocolLayout {
  const rows = data.sections
    .flatMap((s) => s.items)
    .reduce((sum, i) => sum + tableRowHeight(i, noteLinesOf(i)), 0);
  const fixed = firstPageFixed(data);
  const inlineTable = fixed + rows <= PAGE.height;
  // Page 1 ends after the table, or after the reference to Příloha 1.
  const firstPage =
    inlineTable && !forceAppendix
      ? fixed + rows
      : fixed - data.sections.length * TABLE_HEADERS + 10;
  // The warning block keeps together on page 1 only if it fits there whole.
  const warningOnNewPage = firstPage + warningHeight > PAGE.height;
  // Where the defects start: page number and space used on it.
  const position = (warningOnNewPage ? PAGE.height : firstPage) + warningHeight;
  const startPage = Math.floor(position / PAGE.height) + 1;
  const afterWarning = position % PAGE.height;
  const useAppendix = Boolean(data.appendix?.columns.length && (forceAppendix || !inlineTable));
  const appendix = useAppendix ? appendixPages(data.appendix!.rows) : 0;
  const groups = defects.map((severity) =>
    severity.map((place) =>
      place.map(({ title, item }) => ({
        titleLength: title.length,
        descriptionLength: item.defectDescription?.length ?? 0,
        photos: item.photos.length,
      })),
    ),
  );
  const hasPhotoPages = groups.some((g) => g.some((p) => p.length)) || data.overviewPhotos.length;
  const photos = choosePhotoLayout(
    groups,
    data.overviewPhotos.length,
    afterWarning,
    (pages) => (hasPhotoPages ? startPage + pages - 1 + appendix : startPage + appendix),
    data.shortest,
  );
  return {
    inlineTable,
    warningOnNewPage,
    photoHeight: photos.photoHeight,
    defectColumns: photos.columns,
    pages: photos.total,
  };
}

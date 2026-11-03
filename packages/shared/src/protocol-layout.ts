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
  return Math.max(9, Math.max(descriptionLines, noteHeight) * LINE + 2.4);
}

/** Space the first page needs besides the item rows (title, details, table headers). */
function firstPageFixed(data: ProtocolData): number {
  const draft = data.final ? 0 : 12;
  const title = 15;
  const info = 5 * 10.5 + (data.note ? linesOf(data.note, 130) * LINE + 3 : 0);
  const tableHeaders = data.sections.length * (4 + 6 + 14);
  const footnote = 6;
  return draft + title + info + tableHeaders + footnote;
}

export interface DefectCardInput {
  /** Characters of the title line ("Kontrolní číslo …, označení … – typ, umístění"). */
  titleLength: number;
  /** Characters of the defect description (its own line). */
  descriptionLength: number;
  photos: number;
}

export interface PhotoLayout {
  photoHeight: number;
  columns: 1 | 2;
  pages: number;
}

/** Height of a defect card (mm) in a column of the given width. */
function cardHeight(card: DefectCardInput, columnWidth: number, photoHeight: number): number {
  const inner = columnWidth - 4;
  // Title, description and the (smaller) risk line, each starting on its own line.
  const text =
    linesOf('x'.repeat(card.titleLength), inner) * LINE +
    (card.descriptionLength ? linesOf('x'.repeat(card.descriptionLength), inner) * LINE : 0) +
    linesOf('x'.repeat(90), inner) * 3.4;
  // Padding and border 4.5 mm, gap below the card 3 mm (measured in the PDF).
  if (!card.photos) return text + 4.5 + 3;
  const photoWidth = photoHeight * PHOTO_ASPECT;
  const perRow = Math.max(1, Math.floor((inner + 2) / (photoWidth + 2)));
  const rows = Math.ceil(card.photos / perRow);
  return text + rows * (photoHeight + 2) + 4.5 + 3;
}

/** Pages the defect cards take from a fresh page (cards never split between pages). */
export function defectPages(
  groups: readonly (readonly DefectCardInput[])[],
  photoHeight: number,
  columns: 1 | 2,
  /** Photos of the inspection as a whole, always full width at the end. */
  overviewPhotos = 0,
  /** Space already used on the page where the defects start. */
  startUsed = 0,
): number {
  const columnWidth = columns === 1 ? PAGE.width : (PAGE.width - 4) / 2;
  let pages = 1;
  let used = startUsed;
  // A few mm of reserve: a page break one card too early costs a whole page.
  const usable = PAGE.height - 8;
  const place = (height: number) => {
    if (used + height > usable && used > 0) {
      pages += 1;
      used = 0;
    }
    used += Math.min(height, usable);
  };
  for (const cards of groups) {
    if (!cards.length) continue;
    place(16); // section heading with its margins
    for (let i = 0; i < cards.length; i += columns) {
      const row = cards.slice(i, i + columns);
      place(Math.max(...row.map((c) => cardHeight(c, columnWidth, photoHeight))));
    }
  }
  if (overviewPhotos) {
    place(16);
    const perRow = Math.max(1, Math.floor((PAGE.width + 2) / (photoHeight * PHOTO_ASPECT + 2)));
    place(Math.ceil(overviewPhotos / perRow) * (photoHeight + 2));
  }
  return pages;
}

/**
 * The photo size and number of columns with the fewest pages; at equal pages the larger photos,
 * then one column. Two columns only when every defect has at most one photo.
 */
export function choosePhotoLayout(
  groups: readonly (readonly DefectCardInput[])[],
  overviewPhotos = 0,
  startUsed = 0,
): PhotoLayout {
  const all = groups.flat();
  const columnOptions: (1 | 2)[] = all.every((c) => c.photos <= 1) && all.length > 1 ? [1, 2] : [1];
  let best: PhotoLayout | null = null;
  for (const photoHeight of PHOTO_HEIGHTS) {
    for (const columns of columnOptions) {
      const pages = defectPages(groups, photoHeight, columns, overviewPhotos, startUsed);
      if (!best || pages < best.pages) best = { photoHeight, columns, pages };
    }
  }
  return best ?? { photoHeight: PHOTO_HEIGHTS[0], columns: 1, pages: 0 };
}

export interface ProtocolLayout {
  /** The equipment table fits on the first page (otherwise Příloha 1). */
  inlineTable: boolean;
  /** The warning, signatures and texts start on a new page (they do not fit below page 1). */
  warningOnNewPage: boolean;
  photoHeight: number;
  defectColumns: 1 | 2;
}

export function planProtocolLayout(
  data: ProtocolData,
  noteLinesOf: (item: ProtocolItem) => string[],
  defects: readonly (readonly ProtocolItem[])[],
  typeNameOf: (item: ProtocolItem) => string,
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
  const firstPage = inlineTable && !forceAppendix ? fixed + rows : fixed - 30 + 16;
  // The warning block keeps together on page 1 only if it fits there whole.
  const warningOnNewPage = firstPage + warningHeight > PAGE.height;
  const afterWarning = ((warningOnNewPage ? 0 : firstPage) + warningHeight) % PAGE.height;
  const groups = defects.map((group) =>
    group.map((d) => ({
      titleLength:
        `Kontrolní číslo ${d.itemNumber}, označení ${d.designation ?? ''} – ${typeNameOf(d)}, ${d.location}`
          .length,
      descriptionLength: d.defectDescription?.length ?? 0,
      photos: d.photos.length,
    })),
  );
  const photos = choosePhotoLayout(groups, data.overviewPhotos.length, afterWarning);
  return {
    inlineTable,
    warningOnNewPage,
    photoHeight: photos.photoHeight,
    defectColumns: photos.columns,
  };
}

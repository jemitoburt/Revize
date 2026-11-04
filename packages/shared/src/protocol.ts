/**
 * Inspection protocol (M7): placeholders of the per-type protocol text, next inspection dates,
 * and the HTML of the protocol. The layout follows the inspection company's protocol form
 * (docs/vzory, ADR-0016). The same HTML is printed to PDF by the server (Chromium, with the page
 * header and footer as Chromium templates) and by the browser in the demo, so it must not
 * depend on anything but its data.
 */

import { formatDate } from './dates.js';
import {
  appendixPages,
  linesOf,
  PAGE,
  photoBox,
  planProtocolLayout,
  type ProtocolLayout,
} from './protocol-layout.js';
import { FIT_DEFECT_TITLES, SEVERITY_LABELS } from './inspection.js';

export const PROTOCOL_PLACEHOLDERS = [
  ['firma', 'Naše firma'],
  ['zakaznik', 'Zákazník'],
  ['provozovna', 'Provozovna'],
  ['datum_kontroly', 'Datum kontroly'],
  ['technik', 'Technik'],
  ['datum_pristi_kontroly', 'Příští kontrola'],
] as const;
export type ProtocolPlaceholder = (typeof PROTOCOL_PLACEHOLDERS)[number][0];

/** `2026-01-31` + 1 month = `2026-02-28` (the day is clamped to the end of the month). */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(Math.min(d, lastDay))}`;
}

/**
 * Next inspection date of an item checked in an inspection (ADR-0011): the date set for the
 * whole inspection, otherwise the inspection date plus the equipment type's interval.
 */
/**
 * The interval that applies to an item: its own, else the nearest location's (row, then hall…),
 * else the site's, else the equipment type's default.
 */
export function inspectionIntervalOf(
  own: number | null | undefined,
  /** Intervals of the item's locations, nearest first. */
  locations: readonly (number | null | undefined)[],
  site: number | null | undefined,
  typeDefault: number,
): number {
  for (const value of [own, ...locations, site]) if (value) return value;
  return typeDefault;
}

/**
 * The technician's authorization under the signature: per equipment type of the protocol
 * ("Vázací prostředky: Osvědčení č. 12/2025"; a one-type protocol just the text), the general
 * one for the types without their own (alone when no type has one).
 */
export function certificationLines(
  general: string,
  perType: Readonly<Record<string, string>>,
  types: readonly { id: string; name: string }[],
): string[] {
  const own = types.filter((t) => perType[t.id]);
  if (!own.length) return general ? [general] : [];
  if (types.length === 1) return [perType[types[0]!.id]!];
  const lines = own.map((t) => `${t.name}: ${perType[t.id]}`);
  if (general && own.length < types.length) lines.push(general);
  return lines;
}

export function nextInspectionDateOf(
  inspectionDate: string,
  intervalMonths: number,
  inspectionNext: string | null,
): string {
  return inspectionNext ?? addMonths(inspectionDate, intervalMonths);
}

export interface ProtocolCompany {
  name: string;
  companyId: string;
  address: string;
  phone: string;
  email: string;
  web: string;
  /** data: URL of the logo, or null. */
  logo: string | null;
  /** Additional text after the standard statements at the end of the protocol. */
  footer: string;
  /** The lead technician's authorization (their profile), printed with their name. */
  certification: string;
  /**
   * "Datum vydání", "Verze" in the page header: from Nastavení, otherwise the closing date of
   * the inspection and 1 + the number of reopenings.
   */
  issueDate: string;
  version: string;
  /** Bottom left of every page, e.g. "BOZP • PO • REVIZE". */
  pageFooter: string;
}

export interface ProtocolItem {
  itemNumber: string;
  /** "Ž-01", printed before the description. */
  designation?: string | null;
  location: string;
  /** Name with description: the type and selected field values ("Alve · Opěrný · 8 příček"). */
  details: string;
  /**
   * Result as printed. A minor defect the technician left out of the protocol is printed as
   * `ok` without its note (`includeInProtocol`, decided by the service that builds the data).
   */
  outcome: 'ok' | 'green' | 'amber' | 'red' | 'unfit' | 'minor' | 'unchecked';
  defectDescription: string | null;
  /** data: URLs of defect photo thumbnails. */
  photos: string[];
}

export interface ProtocolSection {
  typeName: string;
  /** Protocol text of the type with placeholders filled in ("Pokyny k provádění kontrol"). */
  text: string;
  items: ProtocolItem[];
}

export interface ProtocolData {
  number: string;
  final: boolean;
  company: ProtocolCompany;
  customer: { name: string; companyId: string | null; address: string | null };
  site: { name: string; address: string | null };
  inspectionDate: string;
  nextInspectionDate: string | null;
  inspectors: string[];
  leadInspector: string;
  note: string | null;
  sections: ProtocolSection[];
  /** data: URLs of photos of the inspection as a whole. */
  overviewPhotos: string[];
  /**
   * Equipment list for the customer with the columns chosen in the office (last pages, A4
   * landscape). `unsafe` rows (not fit for safe operation) are printed bold and red.
   */
  appendix?: { columns: string[]; rows: { cells: string[]; unsafe: boolean }[] } | null;
  /** Příloha 1 even when the table would fit on the first page. */
  forceAppendix?: boolean;
  /** "Co nejkratší protokol": the fewest pages (minimal photos, more columns), even within 8. */
  shortest?: boolean;
  /**
   * Risk levels whose defects get a card with photos (default all); the table lists all. Unfit
   * items of types without risk levels always get one.
   */
  defectSeverities?: readonly ('red' | 'amber' | 'green')[];
  generatedAt: string;
}

export const APPENDIX_TITLE = 'Příloha 1 – tabulka kontrolovaného vybavení';
/** Printed instead of the equipment table when it does not fit on the first page. */
export const APPENDIX_REFERENCE = `Kontrolované vybavení viz ${APPENDIX_TITLE}, která je nedílnou součástí tohoto protokolu.`;

export interface ProtocolHtmlOptions {
  /** `appendix`: only Příloha 1 (printed on its own). */
  part?: 'all' | 'appendix';
  /**
   * Print the page header and footer in the document itself (browser print, preview). The PDF
   * renderer passes false and prints `protocolPageHeader`/`protocolPageFooter` on every page.
   */
  pageFrame?: boolean;
}

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const czechDate = (iso: string | null) => formatDate(iso);

/** A block of a protocol text: heading, paragraph, or a list with sub-items. */
export type ProtocolTextBlock =
  | { kind: 'h'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: { text: string; sub: string[] }[] };

/**
 * Protocol text of an equipment type: `# ` heading, `• ` (or `- `) item, indented item
 * = sub-item, a line without a mark continues the previous item, blank line = new paragraph.
 */
export function parseProtocolText(text: string): ProtocolTextBlock[] {
  const blocks: ProtocolTextBlock[] = [];
  let open = false;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      open = false;
      continue;
    }
    const bullet = /^(\s*)[•\-*]\s+(.*)$/.exec(line);
    const last = blocks.at(-1);
    if (line.startsWith('# ')) {
      blocks.push({ kind: 'h', text: line.slice(2).trim() });
      open = false;
    } else if (bullet) {
      const [, indent = '', content = ''] = bullet;
      const list = last?.kind === 'ul' ? last : null;
      if (indent.length >= 2 && list?.items.length) list.items.at(-1)!.sub.push(content);
      else if (list) list.items.push({ text: content, sub: [] });
      else blocks.push({ kind: 'ul', items: [{ text: content, sub: [] }] });
      open = true;
    } else if (open && last?.kind === 'ul') {
      const item = last.items.at(-1)!;
      if (item.sub.length) item.sub[item.sub.length - 1] += ` ${line.trim()}`;
      else item.text += ` ${line.trim()}`;
    } else if (open && last?.kind === 'p') {
      last.text += `\n${line.trim()}`;
    } else {
      blocks.push({ kind: 'p', text: line.trim() });
      open = true;
    }
  }
  return blocks;
}

/** Protocol text as HTML (see `parseProtocolText`). */
export function protocolTextHtml(text: string): string {
  const blocks = parseProtocolText(text);
  return blocks
    .map((b) =>
      b.kind === 'h'
        ? `<h3>${escape(b.text)}</h3>`
        : b.kind === 'p'
          ? `<p>${escape(b.text).replace(/\n/g, '<br>')}</p>`
          : `<ul>${b.items
              .map(
                (i) =>
                  `<li>${escape(i.text)}${
                    i.sub.length
                      ? `<ul>${i.sub.map((t) => `<li>${escape(t)}</li>`).join('')}</ul>`
                      : ''
                  }</li>`,
              )
              .join('')}</ul>`,
    )
    .join('');
}

/** Defect levels in the protocol: the risk levels of racks, or "unfit" (other types). */
export type DefectLevel = 'red' | 'unfit' | 'amber' | 'green' | 'minor';
const DEFECT_LEVELS: readonly DefectLevel[] = ['red', 'unfit', 'amber', 'green', 'minor'];
const isDefect = (o: ProtocolItem['outcome']): o is DefectLevel =>
  o === 'green' || o === 'amber' || o === 'red' || o === 'unfit' || o === 'minor';
const SEVERITY_ORDER = { red: 0, unfit: 1, amber: 2, green: 3, minor: 4 } as const;

/**
 * "Schopno bezpečného provozu": ok and green = ANO, yellow and red = NE, unchecked = none
 * ("nehodící se škrtněte" strikes the other answer).
 */
export function safeToOperate(outcome: ProtocolItem['outcome']): boolean | null {
  if (outcome === 'unchecked') return null;
  return outcome === 'ok' || outcome === 'green' || outcome === 'minor';
}

export type ProtocolDefect = ProtocolItem & {
  outcome: DefectLevel;
  typeName: string;
};

/** Defects for the photo pages: serious (red) first, then the others. */
export function protocolDefects(data: ProtocolData): {
  serious: ProtocolDefect[];
  other: ProtocolDefect[];
} {
  const defects = data.sections
    .flatMap((s) =>
      s.items
        .filter((i) => isDefect(i.outcome))
        .map((i) => ({
          ...i,
          outcome: i.outcome as ProtocolDefect['outcome'],
          typeName: s.typeName,
        })),
    )
    .sort((a, b) => SEVERITY_ORDER[a.outcome] - SEVERITY_ORDER[b.outcome]);
  return {
    serious: defects.filter((d) => d.outcome === 'red' || d.outcome === 'unfit'),
    other: defects.filter((d) => d.outcome !== 'red' && d.outcome !== 'unfit'),
  };
}

/** Defects of one workplace (the top level of the location, e.g. "Hala A"). */
export interface DefectPlace {
  place: string;
  defects: ProtocolDefect[];
}

/** Defects by risk level (red, yellow, green) and, within it, by workplace. */
export interface DefectGroup {
  severity: DefectLevel;
  count: number;
  places: DefectPlace[];
}

const PLACE_SEPARATOR = ' › ';

/**
 * Workplace of a defect – the top level of its location (e.g. the hall) – and what remains for
 * the card ("Řada 1 › Pozice 4").
 */
export function placeOf(location: string): { place: string; rest: string } {
  const parts = location ? location.split(PLACE_SEPARATOR) : [];
  return { place: parts[0] ?? '', rest: parts.slice(1).join(PLACE_SEPARATOR) };
}

/**
 * Defects grouped primarily by severity and then by workplace, in the order of the protocol
 * (the items are already sorted by location).
 */
export function protocolDefectGroups(data: ProtocolData): DefectGroup[] {
  const { serious, other } = protocolDefects(data);
  const all = [...serious, ...other];
  const shown: readonly DefectLevel[] = [
    ...(data.defectSeverities ?? ['red', 'amber', 'green']),
    'unfit',
    'minor',
  ];
  return DEFECT_LEVELS.flatMap((severity) => {
    if (!shown.includes(severity)) return [];
    const defects = all.filter((d) => d.outcome === severity);
    if (!defects.length) return [];
    const places: DefectPlace[] = [];
    for (const d of defects) {
      const { place } = placeOf(d.location);
      const existing = places.find((p) => p.place === place);
      if (existing) existing.defects.push(d);
      else places.push({ place, defects: [d] });
    }
    return [{ severity, count: defects.length, places }];
  });
}

/** Title of a compact defect card: number, designation and the rest of the location. */
export function defectCardTitle(d: ProtocolDefect): string {
  return [d.itemNumber, d.designation, placeOf(d.location).rest].filter(Boolean).join(' · ');
}

/** Heading of a severity group: the level, how many and what it means (once, not per card). */
export const SEVERITY_GROUP_TITLE: Record<DefectLevel, string> = {
  red: 'Červené riziko',
  unfit: FIT_DEFECT_TITLES.unfit,
  minor: FIT_DEFECT_TITLES.minor,
  amber: 'Žluté riziko',
  green: 'Zelené riziko',
};

/** The level next to a defect in the equipment table (short). */
const NOTE_LEVEL: Record<DefectLevel, string> = {
  red: 'červené riziko',
  amber: 'žluté riziko',
  green: 'zelené riziko',
  unfit: 'nevyhovuje',
  minor: 'závada nebránící bezpečnému provozu',
};

/** What a defect group means, printed once next to its heading. */
export function defectGroupMeaning(level: DefectLevel): string {
  if (level === 'unfit') return 'nevyhovuje, vyřadit z užívání až do opravy.';
  if (level === 'minor') return 'schopno bezpečného provozu, závadu odstranit v rámci údržby.';
  return SEVERITY_LABELS[level].protocol.replace(/^[^–]*–\s*/, '');
}

/**
 * The note column: the defect with its risk level in short ("Ohnutý sloupek – červené riziko"),
 * or "Nezkontrolováno". What a level means is said once, in the heading of the defect section.
 */
export function protocolNoteLines(i: ProtocolItem): string[] {
  if (i.outcome === 'unchecked') return ['Nezkontrolováno'];
  if (!isDefect(i.outcome)) return [];
  const risk = NOTE_LEVEL[i.outcome];
  return [
    i.defectDescription ? `${i.defectDescription} – ${risk}` : SEVERITY_GROUP_TITLE[i.outcome],
  ];
}

/** The layout decisions for this protocol (table on page 1 or Příloha 1, photo size, columns). */
export function protocolLayout(data: ProtocolData): ProtocolLayout & { useAppendix: boolean } {
  const groups = protocolDefectGroups(data).map((g) =>
    g.places.map((p) => p.defects.map((d) => ({ title: defectCardTitle(d), item: d }))),
  );
  const layout = planProtocolLayout(
    data,
    protocolNoteLines,
    groups,
    warningHeight(data),
    data.forceAppendix,
  );
  const useAppendix = Boolean(
    data.appendix?.columns.length && (data.forceAppendix || !layout.inlineTable),
  );
  return { ...layout, useAppendix };
}

/** The types' texts are printed at 8 pt (the estimate above is for 9 pt). */
const TEXT_SCALE = 0.85;

/** Estimated height of the warning, signatures, statements and the types' texts (mm). */
function warningHeight(data: ProtocolData): number {
  const textBlocks = [...protocolTexts(data), data.company.footer].filter(Boolean);
  const texts = textBlocks.reduce(
    (sum, text) =>
      sum +
      parseProtocolText(text).reduce((h, b) => {
        if (b.kind === 'h') return h + 6;
        if (b.kind === 'p') return h + linesOf(b.text, PAGE.width) * 3.75 + 2;
        return (
          h +
          b.items.reduce(
            (n, i) =>
              n +
              linesOf(i.text, PAGE.width - 6) * 3.75 +
              i.sub.reduce((m, t) => m + linesOf(t, PAGE.width - 14) * 3.75, 0),
            0,
          )
        );
      }, 0),
    0,
  );
  const statements = PROTOCOL_STATEMENTS.reduce((h, t) => h + linesOf(t, PAGE.width - 6) * 3.75, 0);
  return 20 + 30 + statements + 4 + (textBlocks.length ? 11 : 0) + texts * TEXT_SCALE;
}

/** Texts of the types in the protocol, each once (all racks share one text). */
export const protocolTexts = (data: ProtocolData) => [
  ...new Set(data.sections.map((s) => s.text.trim()).filter(Boolean)),
];

/** Standard statements of the form, printed after the signatures. */
export const PROTOCOL_STATEMENTS = [
  'Kontrola technického vybavení byla provedena v souladu s právními předpisy, normativními požadavky a dokumentací technického vybavení.',
  'Za odstranění případných závad odpovídá provozovatel.',
];

const FONT = "Arial, 'Liberation Sans', 'Noto Sans', 'DejaVu Sans', sans-serif";

const HEADER_STYLE = `
.ph { width: 100%; border-collapse: collapse; font-family: ${FONT}; font-size: 7pt; color: #000; }
.ph td { border: 0.75pt solid #000; padding: 0.6mm 1.5mm; vertical-align: middle; }
.ph .logo { width: 28mm; text-align: center; }
.ph .logo img { max-width: 26mm; max-height: 11mm; object-fit: contain; }
.ph .center { text-align: center; }
.ph .label { font-weight: 700; white-space: nowrap; }
.pf { width: 100%; font-family: ${FONT}; font-size: 7pt; color: #000; display: flex; justify-content: space-between; align-items: flex-end; border-top: 0.5pt solid #000; padding-top: 1mm; }
.pf .tag { font-weight: 700; }
.pf .web { font-weight: 700; font-size: 9pt; border: 0.75pt solid #000; background: #ffeb00; padding: 0.4mm 2mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;

/** "Firma, adresa, IČ: …" – the first line of the page header. */
export const companyLine = (c: ProtocolCompany) =>
  [c.name, c.address, c.companyId && `IČ: ${c.companyId}`].filter(Boolean).join(', ');

/**
 * Page header of the form: logo, company line, title, document control and "Stránka X z Y".
 * `page` is HTML (Chromium's `<span class="pageNumber">` in the PDF); null leaves it empty.
 */
function pageHeader(c: ProtocolCompany, page: { page: string; pages: string } | null): string {
  return `<table class="ph"><tr>
<td class="logo" rowspan="3">${c.logo ? `<img src="${c.logo}" alt="">` : ''}</td>
<td class="center" colspan="6">${escape(companyLine(c))}</td></tr>
<tr><td class="center label" colspan="6">Protokol o kontrole technického vybavení</td></tr>
<tr><td class="label">Datum vydání:<br>Date of publication:</td><td class="center">${escape(c.issueDate)}</td>
<td class="label">Verze:<br>Version:</td><td class="center">${escape(c.version)}</td>
<td class="label">Počet stránek:<br>Number of pages:</td><td class="center">${page ? `Stránka<br>${page.page} z ${page.pages}` : ''}</td></tr></table>`;
}

function pageFooter(c: ProtocolCompany): string {
  return `<div class="pf"><span class="tag">${escape(c.pageFooter)}</span>${
    c.web ? `<span class="web">${escape(c.web)}</span>` : '<span></span>'
  }</div>`;
}

/** Chromium header template (every PDF page); its content starts unstyled at font-size 0. */
export function protocolPageHeader(data: ProtocolData): string {
  return `<div style="width:100%;margin:0 14mm;font-size:7pt"><style>${HEADER_STYLE}</style>${pageHeader(
    data.company,
    { page: '<span class="pageNumber"></span>', pages: '<span class="totalPages"></span>' },
  )}</div>`;
}

/** Chromium footer template (every PDF page). */
export function protocolPageFooter(data: ProtocolData): string {
  return `<div style="width:100%;margin:0 14mm;font-size:7pt"><style>${HEADER_STYLE}</style>${pageFooter(
    data.company,
  )}</div>`;
}

/** Margins of the PDF pages: the header and footer templates live in them. */
export const PROTOCOL_PDF_MARGINS = { top: '29mm', bottom: '20mm', left: '14mm', right: '14mm' };
/** The same margins for `@page` (the PDF uses the CSS page sizes: portrait and landscape). */
const PDF_MARGIN_CSS = `${PROTOCOL_PDF_MARGINS.top} ${PROTOCOL_PDF_MARGINS.right} ${PROTOCOL_PDF_MARGINS.bottom} ${PROTOCOL_PDF_MARGINS.left}`;

const STYLE = `
* { box-sizing: border-box; }
body { font-family: ${FONT}; font-size: 9pt; color: #000; margin: 0; }
h1 { font-size: 14pt; text-align: center; color: #e00000; margin: 2mm 0 3mm; }
h2 { font-size: 13pt; text-align: center; color: #e00000; margin: 4mm 0 2mm; }
h3 { font-size: 9pt; margin: 1.5mm 0 0.5mm; }
p { margin: 0 0 1.5mm; }
ul { margin: 0 0 1mm; padding-left: 5mm; }
ul ul { padding-left: 7mm; }
li { margin: 0; text-align: justify; }
table { width: 100%; border-collapse: collapse; }
td, th { border: 0.75pt solid #000; padding: 0.8mm 1.2mm; vertical-align: middle; text-align: left; }
.grey { background: #f2f2f2; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.info td { height: 8mm; }
.info td.grey { width: 47mm; }
.items { table-layout: fixed; margin-top: 3mm; }
.items th { font-weight: 700; }
.items tr { page-break-inside: avoid; }
.items .c-num { width: 19mm; } .items .c-yn { width: 11mm; text-align: center; font-weight: 700; }
.items .c-note { width: 70mm; }
.items td { height: 7mm; overflow-wrap: anywhere; }
.items .struck { text-decoration: line-through; text-decoration-thickness: 1.2pt; }
.where { font-size: 8pt; }
.small { font-size: 8pt; margin: 1mm 0 0; }
.draft { border: 1.5pt solid #000; padding: 2mm 3mm; margin: 3mm 0; font-weight: 700; text-align: center; }
.warning.new-page { page-break-before: always; }
.warning h2 { margin-top: 2mm; text-transform: uppercase; font-size: 12pt; }
.signatures { margin: 2mm 0 1mm; page-break-inside: avoid; }
.signatures td { height: 13mm; vertical-align: middle; }
.signatures td.grey { width: 47mm; }
.statements { margin: 1mm 0 2mm; }
.texts { font-size: 8pt; }
.texts h3 { font-size: 8pt; }
.photo-pages { margin-top: 3mm; }
.appendix { page: appendix; page-break-before: always; }
.appendix h2 { font-size: 13pt; }
.list { font-size: 8pt; table-layout: auto; }
.list td:last-child { min-width: 70mm; }
.list tr.unsafe td { font-weight: 700; color: #e00000; }
.list th, .list td { padding: 0.4mm 1mm; line-height: 1.15; }
.list tr { page-break-inside: avoid; }
.photo-pages h2 { text-transform: none; }
.sev { font-size: 11pt; text-align: left; margin: 3mm 0 1mm; text-transform: none; }
.sev span { font-size: 8pt; font-weight: 400; color: #000; margin-left: 2mm; }
.place { font-size: 8.5pt; margin: 1.5mm 0 1mm; }
.sev { break-after: avoid; page-break-after: avoid; }
.flow { column-gap: 2mm; }
.flow.c1 { column-count: 1; } .flow.c2 { column-count: 2; } .flow.c3 { column-count: 3; }
.flow .keep, .flow > .defect { break-inside: avoid; page-break-inside: avoid; }
.place { break-after: avoid; page-break-after: avoid; }
.defect { border: 0.5pt solid #000; padding: 1mm 1.2mm; font-size: 8pt; line-height: 1.2; margin-bottom: 2mm; break-inside: avoid; page-break-inside: avoid; }
.defect .t { font-weight: 700; }
.photos { display: flex; flex-wrap: wrap; gap: 1mm; margin-top: 1mm; }
.photos img { object-fit: cover; border: 0.5pt solid #000; }
.keep { break-inside: avoid; page-break-inside: avoid; }
.reference { margin: 4mm 0; font-weight: 700; }
.frame-head { margin-bottom: 2mm; }
.frame-foot { margin-top: 6mm; }
${HEADER_STYLE}
`;

/** Note column: the defect, its risk level after ČSN EN 15635 and, if red, the removal. */
function noteOf(i: ProtocolItem): string {
  return protocolNoteLines(i).map(escape).join('<br>');
}

/**
 * The protocol as a complete HTML document (A4) after the company's form: details, the table
 * "Kontrolní číslo | Popis | Schopno bezpečného provozu ANO/NE | Poznámka" per equipment type,
 * signatures, the statements and "Pokyny k provádění kontrol" with the texts of the types in the
 * protocol only. Defects with reduced photos follow on separate pages, serious (red) first.
 */
export function renderProtocolHtml(data: ProtocolData, options: ProtocolHtmlOptions = {}): string {
  const frame = options.pageFrame ?? true;
  const c = data.company;
  const { serious, other } = protocolDefects(data);
  const defects = [...serious, ...other];
  const layout = protocolLayout(data);
  // The preview and its printing have one header at the top (the PDF numbers every page itself):
  // the page count there is the layout's estimate.
  const framePages = {
    page: '1',
    pages: String(
      options.part === 'appendix' && data.appendix
        ? appendixPages(data.appendix.rows)
        : Math.max(1, layout.pages),
    ),
  };
  const photoTags = (photos: string[], columns: 1 | 2 | 3 = 1) => {
    const { width } = photoBox(columns, layout.photoHeight, photos.length);
    const style = `height:${layout.photoHeight}mm;width:${width}mm`;
    return photos.map((p) => `<img src="${p}" alt="" style="${style}">`).join('');
  };

  const row = (i: ProtocolItem) => {
    // "nehodící se škrtněte": the answer that does not apply is struck through.
    const yes = safeToOperate(i.outcome) === true;
    const answered = i.outcome !== 'unchecked';
    return `<tr><td>${escape(i.itemNumber)}</td><td>${
      i.designation ? `<strong>${escape(i.designation)}</strong> ` : ''
    }${escape(i.details)}${
      i.location ? `<div class="where">${escape(i.location)}</div>` : ''
    }</td><td class="c-yn${answered && !yes ? ' struck' : ''}">ANO</td><td class="c-yn${
      answered && yes ? ' struck' : ''
    }">NE</td><td>${noteOf(i)}</td></tr>`;
  };

  const tables = data.sections
    .map(
      (s) => `
<table class="items">
  <colgroup><col class="c-num"><col><col class="c-yn"><col class="c-yn"><col class="c-note"></colgroup>
  <thead>
    <tr><th class="grey" colspan="5">Kontrolované technické vybavení – ${escape(s.typeName)}</th></tr>
    <tr><th class="grey">Kontrolní číslo</th><th class="grey">Popis</th><th class="grey" colspan="2">Schopno bezpečného provozu*</th><th class="grey">Poznámka<br>(popis zjištění, závady, doporučení atd.)</th></tr>
  </thead>
  <tbody>${s.items.map(row).join('')}</tbody>
</table>`,
    )
    .join('');

  // The same text for several types (e.g. all racks) is printed once.
  const texts = protocolTexts(data);

  // Defects: by severity, then by workplace; compact cards in 1–3 columns (rows never split).
  const columns = layout.defectColumns;
  const defectCard = (d: ProtocolDefect) =>
    `<div class="defect"><div class="t">${escape(defectCardTitle(d))}</div>${
      d.defectDescription ? `<div>${escape(d.defectDescription)}</div>` : ''
    }${d.photos.length ? `<div class="photos">${photoTags(d.photos, columns)}</div>` : ''}</div>`;
  // Cards flow in newspaper columns (no half-empty rows); a workplace heading stays with its
  // first card, a severity heading spans the columns.
  const defectGroups = protocolDefectGroups(data)
    .map((group) => {
      const places = group.places
        .map((place) => {
          const [first, ...rest] = place.defects;
          const heading = place.place ? `<h3 class="place">${escape(place.place)}</h3>` : '';
          return `<div class="keep">${heading}${defectCard(first!)}</div>${rest.map(defectCard).join('')}`;
        })
        .join('');
      return `<h2 class="sev">${SEVERITY_GROUP_TITLE[group.severity]} (${group.count})<span>${escape(
        defectGroupMeaning(group.severity),
      )}</span></h2><div class="flow c${columns}">${places}</div>`;
    })
    .join('');
  const appendixHtml = data.appendix
    ? `<div class="appendix"><h2>${APPENDIX_TITLE}</h2><table class="list"><thead><tr>${data.appendix.columns
        .map((h) => `<th class="grey">${escape(h)}</th>`)
        .join('')}</tr></thead><tbody>${data.appendix.rows
        .map(
          (r) =>
            `<tr${r.unsafe ? ' class="unsafe"' : ''}>${r.cells.map((v) => `<td>${escape(v)}</td>`).join('')}</tr>`,
        )
        .join('')}</tbody></table></div>`
    : '';
  const photoPages =
    defects.length || data.overviewPhotos.length
      ? `<div class="photo-pages">
${defectGroups}
${
  data.overviewPhotos.length
    ? `<div class="keep"><h2 class="sev">Fotodokumentace</h2><div class="photos">${photoTags(data.overviewPhotos)}</div></div>`
    : ''
}
</div>`
      : '';

  if (options.part === 'appendix') {
    // Příloha 1 on its own: landscape pages with the page header.
    const margins = frame ? '12mm 14mm 14mm 14mm' : PDF_MARGIN_CSS;
    return `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><title>${APPENDIX_TITLE}</title>
<style>${STYLE}@page { size: A4 landscape; margin: ${margins}; } .appendix { page-break-before: auto; }</style></head><body>
${frame ? `<div class="frame-head">${pageHeader(c, framePages)}</div>` : ''}
<p class="small">${escape(data.customer.name)}, ${escape(data.site.name)} – kontrola ${czechDate(data.inspectionDate)}</p>
${appendixHtml}
${frame ? `<div class="frame-foot">${pageFooter(c)}</div>` : ''}
</body></html>`;
  }

  const customer = [
    data.customer.name,
    data.customer.companyId && `IČ: ${data.customer.companyId}`,
    data.customer.address,
  ]
    .filter(Boolean)
    .map((t) => escape(t as string))
    .join(', ');
  const site = [data.site.name, data.site.address].filter(Boolean).map((t) => escape(t as string));
  const inspectors = escape(data.inspectors.join(', ') || data.leadInspector);

  return `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><title>Protokol ${escape(data.number)}</title>
<style>${STYLE}${
    // Browser print sets its own margins; the PDF renderer passes them with the header/footer.
    frame
      ? '@page { size: A4; margin: 12mm 14mm 14mm 14mm; } @page appendix { size: A4 landscape; }'
      : `@page { size: A4; margin: ${PDF_MARGIN_CSS}; } @page appendix { size: A4 landscape; margin: ${PDF_MARGIN_CSS}; }`
  }</style></head><body>
${frame ? `<div class="frame-head">${pageHeader(c, framePages)}</div>` : ''}
${data.final ? '' : '<div class="draft">PŘEDBĚŽNÝ PROTOKOL – kontrola ještě není uzavřena, údaje se mohou změnit.</div>'}
<h1>Protokol o kontrole technického vybavení</h1>
<table class="info">
  <tr><td class="grey">Provozovatel</td><td>${customer}</td></tr>
  <tr><td class="grey">Pracoviště/objekt/umístění</td><td>${site.join(', ')}</td></tr>
  <tr><td class="grey">Kontrolu provedl</td><td>${inspectors}</td></tr>
  <tr><td class="grey">Kontrola provedena dne</td><td>${czechDate(data.inspectionDate)}</td></tr>
  <tr><td class="grey">Následnou kontrolu provést nejpozději do</td><td>${czechDate(data.nextInspectionDate)}</td></tr>
  ${data.note ? `<tr><td class="grey">Poznámka</td><td>${escape(data.note)}</td></tr>` : ''}
</table>
${
  layout.useAppendix
    ? `<p class="reference">${APPENDIX_REFERENCE}</p>`
    : `${tables}\n<p class="small">*nehodící se škrtněte</p>`
}
<div class="warning${layout.warningOnNewPage ? ' new-page' : ''}">
<h2>Při výsledku kontroly nevyhovuje<br>musí být technické vybavení okamžitě vyřazeno z užívání</h2>
<table class="signatures">
  <tr><td class="grey">Kontrolu provedl</td><td>${escape(data.leadInspector)}${
    c.certification
      ? `<br>${c.certification
          .split('\n')
          .map((line) => escape(line))
          .join('<br>')}`
      : ''
  }</td></tr>
  <tr><td class="grey">S výsledkem kontroly byl seznámen</td><td></td></tr>
</table>
<ul class="statements">${PROTOCOL_STATEMENTS.map((t) => `<li>${escape(t)}</li>`).join('')}</ul>
${c.footer ? protocolTextHtml(c.footer) : ''}
${texts.length ? `<h2>Pokyny k provádění kontrol</h2><div class="texts">${texts.map(protocolTextHtml).join('')}</div>` : ''}
</div>
${photoPages}
${layout.useAppendix ? appendixHtml : ''}
${frame ? `<div class="frame-foot">${pageFooter(c)}</div>` : ''}
</body></html>`;
}

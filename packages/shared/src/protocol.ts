/**
 * Inspection protocol (M7): placeholders of the per-type protocol text, next inspection dates,
 * and the HTML of the protocol. The layout follows the inspection company's protocol form
 * (docs/vzory, ADR-0016). The same HTML is printed to PDF by the server (Chromium, with the page
 * header and footer as Chromium templates) and by the browser in the demo, so it must not
 * depend on anything but its data.
 */

import { formatDate } from './dates.js';
import { SEVERITY_LABELS } from './inspection.js';

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
  /** E.g. "Osvědčení č. 123/2024" – printed with the technician's name. */
  certification: string;
  /** Document control of the form ("Datum vydání", "Verze") in the page header. */
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
  outcome: 'ok' | 'green' | 'amber' | 'red' | 'unchecked';
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
  generatedAt: string;
}

export interface ProtocolHtmlOptions {
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

/**
 * Protocol text of an equipment type as HTML: `# ` heading, `• ` (or `- `) item, indented item
 * = sub-item, a line without a mark continues the previous item, blank line = new paragraph.
 */
export function protocolTextHtml(text: string): string {
  type Block =
    | { kind: 'h'; text: string }
    | { kind: 'p'; text: string }
    | { kind: 'ul'; items: { text: string; sub: string[] }[] };
  const blocks: Block[] = [];
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

const isDefect = (o: ProtocolItem['outcome']): o is 'green' | 'amber' | 'red' =>
  o === 'green' || o === 'amber' || o === 'red';
const SEVERITY_ORDER = { red: 0, amber: 1, green: 2 } as const;

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

const companyLine = (c: ProtocolCompany) =>
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

const STYLE = `
* { box-sizing: border-box; }
body { font-family: ${FONT}; font-size: 9pt; color: #000; margin: 0; }
h1 { font-size: 15pt; text-align: center; color: #e00000; margin: 4mm 0 5mm; }
h2 { font-size: 15pt; text-align: center; color: #e00000; margin: 6mm 0 3mm; }
h3 { font-size: 9pt; margin: 2.5mm 0 1mm; }
p { margin: 0 0 1.5mm; }
ul { margin: 0 0 1mm; padding-left: 5mm; }
ul ul { padding-left: 7mm; }
li { margin: 0; text-align: justify; }
table { width: 100%; border-collapse: collapse; }
td, th { border: 0.75pt solid #000; padding: 1.2mm 1.5mm; vertical-align: middle; text-align: left; }
.grey { background: #f2f2f2; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.info td { height: 10mm; }
.info td.grey { width: 47mm; }
.items { table-layout: fixed; margin-top: 4mm; }
.items th { font-weight: 700; }
.items tr { page-break-inside: avoid; }
.items .c-num { width: 19mm; } .items .c-yn { width: 11mm; text-align: center; font-weight: 700; }
.items .c-note { width: 70mm; }
.items td { height: 9mm; overflow-wrap: anywhere; }
.items .struck { text-decoration: line-through; text-decoration-thickness: 1.2pt; }
.where { font-size: 8pt; }
.small { font-size: 8pt; margin: 1mm 0 0; }
.draft { border: 1.5pt solid #000; padding: 2mm 3mm; margin: 3mm 0; font-weight: 700; text-align: center; }
.warning { page-break-before: always; }
.warning h2 { margin-top: 2mm; text-transform: uppercase; font-size: 13pt; }
.signatures { margin: 4mm 0 2mm; page-break-inside: avoid; }
.signatures td { height: 20mm; vertical-align: middle; }
.signatures td.grey { width: 47mm; }
.statements { margin: 1mm 0 4mm; }
.photo-pages { page-break-before: always; }
.photo-pages h2 { text-transform: none; }
.defect { page-break-inside: avoid; border: 0.75pt solid #000; padding: 2mm; margin-bottom: 3mm; }
.photos { display: flex; flex-wrap: wrap; gap: 2mm; margin-top: 2mm; }
.photos img { width: 42mm; height: 32mm; object-fit: cover; border: 0.5pt solid #000; }
.frame-head { margin-bottom: 2mm; }
.frame-foot { margin-top: 6mm; }
${HEADER_STYLE}
`;

/** Note column: the defect, its risk level after ČSN EN 15635 and, if red, the removal. */
function noteOf(i: ProtocolItem): string {
  if (i.outcome === 'unchecked') return 'Nezkontrolováno';
  if (!isDefect(i.outcome)) return '';
  return [i.defectDescription ?? '', SEVERITY_LABELS[i.outcome].protocol]
    .filter(Boolean)
    .map(escape)
    .join('<br>');
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
  const defects = data.sections
    .flatMap((s) =>
      s.items
        .filter((i) => isDefect(i.outcome))
        .map((i) => ({
          ...i,
          outcome: i.outcome as 'green' | 'amber' | 'red',
          typeName: s.typeName,
        })),
    )
    .sort((a, b) => SEVERITY_ORDER[a.outcome] - SEVERITY_ORDER[b.outcome]);
  const serious = defects.filter((d) => d.outcome === 'red');
  const other = defects.filter((d) => d.outcome !== 'red');

  const row = (i: ProtocolItem) => {
    // "nehodící se škrtněte": the answer that does not apply is struck through.
    const yes = i.outcome === 'ok' || i.outcome === 'green';
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
  const texts = [...new Set(data.sections.map((s) => s.text.trim()).filter(Boolean))];

  const defectCard = (d: (typeof defects)[number]) => `
<div class="defect">
  <strong>Kontrolní číslo ${escape(d.itemNumber)}${
    d.designation ? `, označení ${escape(d.designation)}` : ''
  }</strong> – ${escape(d.typeName)}${d.location ? `, ${escape(d.location)}` : ''}
  <div>${escape(d.defectDescription ?? '')}</div>
  <div class="small">${escape(SEVERITY_LABELS[d.outcome].protocol)}</div>
  ${d.photos.length ? `<div class="photos">${d.photos.map((p) => `<img src="${p}" alt="">`).join('')}</div>` : ''}
</div>`;

  const photoPages =
    defects.length || data.overviewPhotos.length
      ? `<div class="photo-pages">
${serious.length ? `<h2>Závažné závady (${serious.length})</h2>${serious.map(defectCard).join('')}` : ''}
${other.length ? `<h2>Závady (${other.length})</h2>${other.map(defectCard).join('')}` : ''}
${
  data.overviewPhotos.length
    ? `<h2>Fotodokumentace</h2><div class="photos">${data.overviewPhotos.map((p) => `<img src="${p}" alt="">`).join('')}</div>`
    : ''
}
</div>`
      : '';

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
    frame ? '@page { size: A4; margin: 12mm 14mm 14mm 14mm; }' : '@page { size: A4; }'
  }</style></head><body>
${frame ? `<div class="frame-head">${pageHeader(c, null)}</div>` : ''}
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
${tables}
<p class="small">*nehodící se škrtněte</p>
<div class="warning">
<h2>Při výsledku kontroly nevyhovuje<br>musí být technické vybavení okamžitě vyřazeno z užívání</h2>
<table class="signatures">
  <tr><td class="grey">Kontrolu provedl</td><td>${escape(data.leadInspector)}${
    c.certification ? `<br>${escape(c.certification)}` : ''
  }</td></tr>
  <tr><td class="grey">S výsledkem kontroly byl seznámen</td><td></td></tr>
</table>
<ul class="statements">${PROTOCOL_STATEMENTS.map((t) => `<li>${escape(t)}</li>`).join('')}</ul>
${c.footer ? protocolTextHtml(c.footer) : ''}
${texts.length ? `<h2>Pokyny k provádění kontrol</h2>${texts.map(protocolTextHtml).join('')}` : ''}
</div>
${photoPages}
${frame ? `<div class="frame-foot">${pageFooter(c)}</div>` : ''}
</body></html>`;
}

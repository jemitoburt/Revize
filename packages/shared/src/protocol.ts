/**
 * Inspection protocol (M7): placeholders of the per-type protocol text, next inspection dates,
 * and the HTML of the protocol. The same HTML is printed to PDF by the server (Chromium) and by
 * the browser in the demo, so it must not depend on anything but its data.
 */

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
  footer: string;
  /** E.g. "Osvědčení č. 123/2024" – printed under the technician's signature line. */
  certification: string;
}

export interface ProtocolItem {
  itemNumber: string;
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
  /** Protocol text of the type with placeholders filled in. */
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

const SEVERITY_TEXT: Record<'green' | 'amber' | 'red', string> = {
  red: 'Červená – ihned vyřadit z provozu',
  amber: 'Oranžová – opravit co nejdřív',
  green: 'Zelená – sledovat',
};

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const czechDate = (iso: string | null) => {
  if (!iso) return '–';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${Number(d)}. ${Number(m)}. ${y}`;
};
const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
const box = (checked: boolean) => `<span class="box">${checked ? '&#10003;' : ''}</span>`;

const isDefect = (o: ProtocolItem['outcome']): o is 'green' | 'amber' | 'red' =>
  o === 'green' || o === 'amber' || o === 'red';
const SEVERITY_ORDER = { red: 0, amber: 1, green: 2 } as const;

function counts(sections: ProtocolSection[]) {
  const all = sections.flatMap((s) => s.items);
  const by = (o: ProtocolItem['outcome']) => all.filter((i) => i.outcome === o).length;
  return {
    total: all.length,
    ok: by('ok'),
    green: by('green'),
    amber: by('amber'),
    red: by('red'),
    unchecked: by('unchecked'),
  };
}

const STYLE = `
@page { size: A4; margin: 16mm 14mm 18mm 14mm; }
* { box-sizing: border-box; }
body { font-family: 'Noto Sans', 'DejaVu Sans', Arial, sans-serif; font-size: 9.5pt; color: #1a1a1a; margin: 0; }
h1 { font-size: 16pt; margin: 0 0 2mm; }
h2 { font-size: 12pt; margin: 7mm 0 2mm; padding-bottom: 1mm; border-bottom: 1.5px solid #1c4e80; color: #1c4e80; }
h3 { font-size: 10.5pt; margin: 4mm 0 2mm; }
p { margin: 0 0 2mm; text-align: justify; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; padding-bottom: 3mm; border-bottom: 2.5px solid #1c4e80; margin-bottom: 5mm; }
.head img { max-height: 22mm; max-width: 60mm; object-fit: contain; }
.company { text-align: right; font-size: 8.5pt; line-height: 1.45; }
.company strong { font-size: 10.5pt; }
.draft { border: 2px solid #c2410c; color: #c2410c; padding: 2mm 3mm; margin-bottom: 4mm; font-weight: 700; }
table { width: 100%; border-collapse: collapse; }
.info td { padding: 1.2mm 2mm; vertical-align: top; border-bottom: 1px solid #e3e6ea; }
.info td:first-child { width: 34mm; color: #555; }
.summary { display: flex; gap: 3mm; margin: 2mm 0; }
.summary div { flex: 1; border: 1px solid #d4d9df; border-radius: 2mm; padding: 2mm; text-align: center; font-size: 8.5pt; }
.summary b { display: block; font-size: 13pt; }
.items { table-layout: fixed; }
.items th { text-align: left; background: #eef2f6; padding: 1.5mm 2mm; font-size: 8.5pt; border: 1px solid #c9d1da; }
.items td { padding: 1.3mm 2mm; border: 1px solid #d4d9df; vertical-align: top; overflow-wrap: anywhere; }
.items tr { page-break-inside: avoid; }
.items .c-num { width: 17mm; } .items .c-ok { width: 25mm; text-align: center; white-space: nowrap; }
.items .c-note { width: 62mm; }
.where { color: #555; font-size: 8pt; }
.box { display: inline-block; width: 3.4mm; height: 3.4mm; border: 1px solid #1a1a1a; line-height: 3.2mm; text-align: center; font-size: 8pt; vertical-align: -0.6mm; margin: 0 0.8mm 0 1.8mm; }
.num { font-family: 'Noto Sans Mono', 'DejaVu Sans Mono', monospace; font-weight: 700; white-space: nowrap; }
.dot { display: inline-block; width: 2.6mm; height: 2.6mm; border-radius: 50%; margin-right: 1.2mm; vertical-align: -0.3mm; }
.s-red { background: #b91c1c; } .s-amber { background: #ea8c00; } .s-green { background: #15803d; }
.t-red { color: #b91c1c; } .t-amber { color: #b45309; } .t-green { color: #15803d; } .t-unchecked { color: #6b7280; }
.photo-pages { page-break-before: always; }
.defect { page-break-inside: avoid; border: 1px solid #e3e6ea; border-left: 3px solid #b45309; padding: 2mm 3mm; margin-bottom: 3mm; }
.defect.red { border-left-color: #b91c1c; } .defect.green { border-left-color: #15803d; }
.photos { display: flex; flex-wrap: wrap; gap: 2mm; margin-top: 2mm; }
.photos img { width: 42mm; height: 32mm; object-fit: cover; border: 1px solid #d4d9df; }
.signatures { display: flex; gap: 12mm; margin-top: 14mm; page-break-inside: avoid; }
.signatures div { flex: 1; border-top: 1px solid #1a1a1a; padding-top: 1.5mm; font-size: 8.5pt; }
.footer { margin-top: 8mm; font-size: 8pt; color: #555; }
`;

/**
 * The protocol as a complete HTML document (A4, print styles). Per equipment type: its own
 * protocol text and a table "number | name and description | complies yes/no | note/defect".
 * Defects with reduced photos follow on separate pages, the serious (red) ones first.
 */
export function renderProtocolHtml(data: ProtocolData): string {
  const c = data.company;
  const sum = counts(data.sections);
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
  const companyLines = [
    c.address,
    c.companyId && `IČO: ${c.companyId}`,
    [c.phone, c.email].filter(Boolean).join(' · '),
    c.web,
  ].filter(Boolean) as string[];

  const row = (i: ProtocolItem) => {
    const complies = i.outcome === 'ok' ? true : isDefect(i.outcome) ? false : null;
    const note = isDefect(i.outcome)
      ? `<span class="dot s-${i.outcome}"></span><span class="t-${i.outcome}">${escape(
          i.defectDescription ?? '',
        )}</span>`
      : i.outcome === 'unchecked'
        ? '<span class="t-unchecked">Nezkontrolováno</span>'
        : '';
    return `<tr><td class="num">${escape(i.itemNumber)}</td><td>${escape(i.details)}<div class="where">${escape(
      i.location,
    )}</div></td><td class="c-ok">ano${box(complies === true)} ne${box(complies === false)}</td><td>${note}</td></tr>`;
  };

  const sections = data.sections
    .map(
      (s) => `
<h2>${escape(s.typeName)}</h2>
${paragraphs(s.text)}
<table class="items">
  <colgroup><col class="c-num"><col><col class="c-ok"><col class="c-note"></colgroup>
  <thead><tr><th>Číslo</th><th>Název a popis</th><th class="c-ok">Vyhovuje</th><th>Poznámka / závada</th></tr></thead>
  <tbody>${s.items.map(row).join('')}</tbody>
</table>`,
    )
    .join('');

  const defectCard = (d: (typeof defects)[number]) => `
<div class="defect ${d.outcome}">
  <strong class="num">${escape(d.itemNumber)}</strong> · ${escape(d.typeName)} · ${escape(d.location)}
  · <span class="t-${d.outcome}"><span class="dot s-${d.outcome}"></span>${SEVERITY_TEXT[d.outcome]}</span>
  <div>${escape(d.defectDescription ?? '')}</div>
  ${d.photos.length ? `<div class="photos">${d.photos.map((p) => `<img src="${p}" alt="">`).join('')}</div>` : ''}
</div>`;

  const photoPages =
    defects.length || data.overviewPhotos.length
      ? `<div class="photo-pages">
${serious.length ? `<h2>Závažné závady (${serious.length})</h2>${serious.map(defectCard).join('')}` : ''}
${other.length ? `<h2>Závady (${other.length})</h2>${other.map(defectCard).join('')}` : ''}
${
  data.overviewPhotos.length
    ? `<h2>Fotodokumentace kontroly</h2><div class="photos">${data.overviewPhotos.map((p) => `<img src="${p}" alt="">`).join('')}</div>`
    : ''
}
</div>`
      : '';

  return `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><title>Protokol ${escape(data.number)}</title>
<style>${STYLE}</style></head><body>
<div class="head">
  <div>${c.logo ? `<img src="${c.logo}" alt="">` : `<strong style="font-size:14pt">${escape(c.name)}</strong>`}</div>
  <div class="company"><strong>${escape(c.name)}</strong><br>${companyLines.map(escape).join('<br>')}</div>
</div>
${data.final ? '' : '<div class="draft">PŘEDBĚŽNÝ PROTOKOL – kontrola ještě není uzavřena, údaje se mohou změnit.</div>'}
<h1>Protokol o kontrole technického vybavení</h1>
<table class="info">
  <tr><td>Číslo protokolu</td><td>${escape(data.number)}</td></tr>
  <tr><td>Zákazník</td><td><strong>${escape(data.customer.name)}</strong>${
    data.customer.companyId ? `, IČO ${escape(data.customer.companyId)}` : ''
  }${data.customer.address ? `<br>${escape(data.customer.address)}` : ''}</td></tr>
  <tr><td>Provozovna</td><td>${escape(data.site.name)}${data.site.address ? `<br>${escape(data.site.address)}` : ''}</td></tr>
  <tr><td>Datum kontroly</td><td>${czechDate(data.inspectionDate)}</td></tr>
  <tr><td>Příští kontrola</td><td>${czechDate(data.nextInspectionDate)}</td></tr>
  <tr><td>Kontrolu provedli</td><td>${escape(data.inspectors.join(', '))}</td></tr>
  ${data.note ? `<tr><td>Poznámka</td><td>${escape(data.note)}</td></tr>` : ''}
</table>
<div class="summary">
  <div><b>${sum.total - sum.unchecked} / ${sum.total}</b>zkontrolováno</div>
  <div><b class="t-green">${sum.ok}</b>vyhovuje</div>
  <div><b class="t-red">${sum.red}</b>závažné závady</div>
  <div><b class="t-amber">${sum.amber + sum.green}</b>ostatní závady</div>
</div>
${sections}
<div class="signatures">
  <div>Kontrolu provedl: ${escape(data.leadInspector)}${c.certification ? `<br>${escape(c.certification)}` : ''}</div>
  <div>Za zákazníka převzal (jméno, podpis, datum)</div>
</div>
${c.footer ? `<div class="footer">${paragraphs(c.footer)}</div>` : ''}
${photoPages}
</body></html>`;
}

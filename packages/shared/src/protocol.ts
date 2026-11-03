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

/** Replaces `{{key}}` tokens; unknown tokens stay visible so that typos are noticed. */
export function fillProtocolText(
  template: string,
  values: Partial<Record<ProtocolPlaceholder, string>>,
): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (token, key: string) =>
    key in values ? (values[key as ProtocolPlaceholder] ?? '') : token,
  );
}

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
  /** Selected field values, e.g. "Alve · Opěrný · 8 příček". */
  details: string;
  outcome: 'ok' | 'defect' | 'out_of_service' | 'unchecked';
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

const OUTCOME_TEXT: Record<ProtocolItem['outcome'], string> = {
  ok: 'V pořádku',
  defect: 'Závada',
  out_of_service: 'Vyřazeno z provozu',
  unchecked: 'Nezkontrolováno',
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

function counts(sections: ProtocolSection[]) {
  const all = sections.flatMap((s) => s.items);
  const by = (o: ProtocolItem['outcome']) => all.filter((i) => i.outcome === o).length;
  return {
    total: all.length,
    ok: by('ok'),
    defect: by('defect'),
    out: by('out_of_service'),
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
.summary div { flex: 1; border: 1px solid #d4d9df; border-radius: 2mm; padding: 2mm; text-align: center; }
.summary b { display: block; font-size: 14pt; }
.items th { text-align: left; background: #eef2f6; padding: 1.5mm 2mm; font-size: 8.5pt; border-bottom: 1px solid #c9d1da; }
.items td { padding: 1.3mm 2mm; border-bottom: 1px solid #e3e6ea; vertical-align: top; }
.items tr { page-break-inside: avoid; }
.num { font-family: 'Noto Sans Mono', 'DejaVu Sans Mono', monospace; font-weight: 700; white-space: nowrap; }
.r-ok { color: #15803d; font-weight: 600; } .r-defect { color: #c2410c; font-weight: 700; }
.r-out_of_service { color: #b91c1c; font-weight: 700; } .r-unchecked { color: #6b7280; }
.defect { page-break-inside: avoid; border: 1px solid #e3e6ea; border-left: 3px solid #c2410c; padding: 2mm 3mm; margin-bottom: 3mm; }
.defect.out_of_service { border-left-color: #b91c1c; }
.photos { display: flex; flex-wrap: wrap; gap: 2mm; margin-top: 2mm; }
.photos img { width: 42mm; height: 32mm; object-fit: cover; border: 1px solid #d4d9df; }
.signatures { display: flex; gap: 12mm; margin-top: 14mm; page-break-inside: avoid; }
.signatures div { flex: 1; border-top: 1px solid #1a1a1a; padding-top: 1.5mm; font-size: 8.5pt; }
.footer { margin-top: 8mm; font-size: 8pt; color: #555; }
`;

/** The protocol as a complete HTML document (A4, print styles). */
export function renderProtocolHtml(data: ProtocolData): string {
  const c = data.company;
  const sum = counts(data.sections);
  const defects = data.sections.flatMap((s) =>
    s.items
      .filter((i) => i.outcome === 'defect' || i.outcome === 'out_of_service')
      .map((i) => ({ ...i, typeName: s.typeName })),
  );
  const companyLines = [
    c.address,
    c.companyId && `IČO: ${c.companyId}`,
    [c.phone, c.email].filter(Boolean).join(' · '),
    c.web,
  ].filter(Boolean) as string[];

  const sections = data.sections
    .map(
      (s) => `
<h2>${escape(s.typeName)}</h2>
${paragraphs(s.text)}
<table class="items">
  <thead><tr><th>Číslo</th><th>Umístění</th><th>Údaje</th><th>Výsledek</th><th>Závada / poznámka</th></tr></thead>
  <tbody>${s.items
    .map(
      (i) =>
        `<tr><td class="num">${escape(i.itemNumber)}</td><td>${escape(i.location)}</td><td>${escape(
          i.details,
        )}</td><td class="r-${i.outcome}">${OUTCOME_TEXT[i.outcome]}</td><td>${escape(
          i.defectDescription ?? '',
        )}</td></tr>`,
    )
    .join('')}</tbody>
</table>`,
    )
    .join('');

  const defectList = defects.length
    ? `<h2>Zjištěné závady (${defects.length})</h2>${defects
        .map(
          (d) => `
<div class="defect ${d.outcome}">
  <strong class="num">${escape(d.itemNumber)}</strong> · ${escape(d.typeName)} · ${escape(d.location)}
  · <span class="r-${d.outcome}">${OUTCOME_TEXT[d.outcome]}</span>
  <div>${escape(d.defectDescription ?? '')}</div>
  ${d.photos.length ? `<div class="photos">${d.photos.map((p) => `<img src="${p}" alt="">`).join('')}</div>` : ''}
</div>`,
        )
        .join('')}`
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
  <div><b class="r-ok">${sum.ok}</b>v pořádku</div>
  <div><b class="r-defect">${sum.defect}</b>se závadou</div>
  <div><b class="r-out_of_service">${sum.out}</b>vyřazeno z provozu</div>
</div>
${sections}
${defectList}
${
  data.overviewPhotos.length
    ? `<h2>Fotodokumentace kontroly</h2><div class="photos">${data.overviewPhotos.map((p) => `<img src="${p}" alt="">`).join('')}</div>`
    : ''
}
<div class="signatures">
  <div>Kontrolu provedl: ${escape(data.leadInspector)}${c.certification ? `<br>${escape(c.certification)}` : ''}</div>
  <div>Za zákazníka převzal (jméno, podpis, datum)</div>
</div>
${c.footer ? `<div class="footer">${paragraphs(c.footer)}</div>` : ''}
</body></html>`;
}

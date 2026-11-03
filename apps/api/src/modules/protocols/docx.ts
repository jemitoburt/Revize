import {
  APPENDIX_REFERENCE,
  APPENDIX_TITLE,
  photoBox,
  PROTOCOL_STATEMENTS,
  companyLine,
  formatDate,
  parseProtocolText,
  defectCardTitle,
  protocolDefectGroups,
  protocolLayout,
  SEVERITY_GROUP_TITLE,
  SEVERITY_LABELS,
  protocolNoteLines,
  protocolTexts,
  safeToOperate,
  type ProtocolData,
  type ProtocolDefect,
  type ProtocolItem,
} from '@revize/shared';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  SectionType,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlign,
  WidthType,
  type ParagraphChild,
} from 'docx';

/**
 * The protocol as a Word document (.docx) with the same content and layout as the PDF (the
 * company's form, ADR-0016): page header with document control and page numbers, the tables,
 * statements, the types' texts and the defect photos. It stays editable in Word.
 */

const mm = (value: number) => Math.round(value * 56.693); // twips
const px = (value: number) => Math.round(value * 3.7795); // image size at 96 dpi
const RED = 'E00000';
const GREY = 'F2F2F2';
const FONT = 'Arial';
/** A4 portrait minus 14 mm margins. */
const CONTENT_WIDTH = mm(210 - 28);
/** A4 landscape minus margins (the appendix). */
const LANDSCAPE_WIDTH = mm(297 - 28);

const border = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
const borders = { top: border, bottom: border, left: border, right: border };

function run(
  text: string,
  options: { bold?: boolean; size?: number; color?: string; strike?: boolean } = {},
) {
  return new TextRun({
    text,
    font: FONT,
    bold: options.bold,
    color: options.color,
    strike: options.strike,
    size: (options.size ?? 9) * 2,
  });
}

/** Lines of text as one paragraph with line breaks. */
function lines(
  texts: string[],
  options: Parameters<typeof run>[1] & {
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  } = {},
) {
  const children: ParagraphChild[] = [];
  texts.forEach((text, i) => {
    children.push(
      new TextRun({
        text,
        font: FONT,
        bold: options.bold,
        color: options.color,
        strike: options.strike,
        size: (options.size ?? 9) * 2,
        break: i > 0 ? 1 : undefined,
      }),
    );
  });
  return new Paragraph({ children, alignment: options.align });
}

function cell(
  content: Paragraph | Paragraph[],
  options: { width?: number; grey?: boolean; span?: number; center?: boolean } = {},
) {
  return new TableCell({
    children: Array.isArray(content) ? content : [content],
    borders,
    columnSpan: options.span,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: mm(0.8), bottom: mm(0.8), left: mm(1.5), right: mm(1.5) },
    ...(options.width ? { width: { size: options.width, type: WidthType.DXA } } : {}),
    ...(options.grey ? { shading: { fill: GREY, type: ShadingType.CLEAR, color: 'auto' } } : {}),
  });
}

function table(widths: number[], rows: TableRow[]) {
  return new Table({
    rows,
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
  });
}

/** data: URL → bytes, type and pixel size (JPEG and PNG). */
function image(dataUrl: string) {
  const match = /^data:image\/(jpeg|png);base64,(.*)$/.exec(dataUrl);
  if (!match) return null;
  const bytes = new Uint8Array(Buffer.from(match[2]!, 'base64'));
  const type = match[1] === 'png' ? ('png' as const) : ('jpg' as const);
  return { bytes, type, size: imageSize(bytes, type) };
}

function imageSize(bytes: Uint8Array, type: 'jpg' | 'png'): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === 'png' && bytes.byteLength > 24) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // JPEG: the first SOFn marker carries the size.
  for (let i = 2; i + 9 < bytes.byteLength;) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1]!;
    const length = view.getUint16(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
    }
    i += 2 + length;
  }
  return { width: 4, height: 3 };
}

/** An image fitted into a box (mm), keeping its proportions. */
function imageRun(dataUrl: string, boxWidth: number, boxHeight: number): ImageRun | null {
  const img = image(dataUrl);
  if (!img) return null;
  const scale = Math.min(boxWidth / img.size.width, boxHeight / img.size.height);
  return new ImageRun({
    type: img.type,
    data: img.bytes,
    transformation: { width: px(img.size.width * scale), height: px(img.size.height * scale) },
  });
}

function pageHeader(data: ProtocolData) {
  const c = data.company;
  const widths = [mm(28), mm(28), mm(30), mm(18), mm(14), mm(34), mm(30)];
  const logo = c.logo ? imageRun(c.logo, 26, 11) : null;
  const pageNumber = new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      run('Stránka', { size: 7 }),
      new TextRun({ font: FONT, size: 14, break: 1, children: [PageNumber.CURRENT] }),
      run(' z ', { size: 7 }),
      new TextRun({ font: FONT, size: 14, children: [PageNumber.TOTAL_PAGES] }),
    ],
  });
  const label = (a: string, b: string) => lines([a, b], { bold: true, size: 7 });
  const centered = (text: string, bold = false) =>
    lines([text], { size: 7, bold, align: AlignmentType.CENTER });
  return table(widths, [
    new TableRow({
      children: [
        new TableCell({
          children: [
            new Paragraph({ alignment: AlignmentType.CENTER, children: logo ? [logo] : [] }),
          ],
          borders,
          rowSpan: 3,
          verticalAlign: VerticalAlign.CENTER,
          width: { size: widths[0]!, type: WidthType.DXA },
        }),
        cell(centered(companyLine(c)), { span: 6 }),
      ],
    }),
    new TableRow({
      children: [cell(centered('Protokol o kontrole technického vybavení', true), { span: 6 })],
    }),
    new TableRow({
      children: [
        cell(label('Datum vydání:', 'Date of publication:')),
        cell(centered(c.issueDate)),
        cell(label('Verze:', 'Version:')),
        cell(centered(c.version)),
        cell(label('Počet stránek:', 'Number of pages:'), { span: 2 }),
        cell(pageNumber),
      ],
    }),
  ]);
}

function pageFooter(data: ProtocolData, width: number) {
  return new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: '000000', space: 2 } },
    tabStops: [{ type: TabStopType.RIGHT, position: width }],
    children: [
      run(data.company.pageFooter, { bold: true, size: 7 }),
      ...(data.company.web
        ? [
            new TextRun({ text: '\t', font: FONT }),
            new TextRun({
              text: ` ${data.company.web} `,
              font: FONT,
              bold: true,
              size: 18,
              shading: { fill: 'FFEB00', type: ShadingType.CLEAR, color: 'auto' },
            }),
          ]
        : []),
    ],
  });
}

const heading = (
  text: string,
  options: { size?: number; pageBreak?: boolean; keepNext?: boolean } = {},
) =>
  new Paragraph({
    keepNext: options.keepNext,
    alignment: AlignmentType.CENTER,
    spacing: { before: mm(3), after: mm(2) },
    children: [
      ...(options.pageBreak ? [new PageBreak()] : []),
      run(text, { bold: true, size: options.size ?? 15, color: RED }),
    ],
  });

function infoTable(data: ProtocolData) {
  const customer = [
    data.customer.name,
    data.customer.companyId && `IČ: ${data.customer.companyId}`,
    data.customer.address,
  ].filter(Boolean) as string[];
  const site = [data.site.name, data.site.address].filter(Boolean) as string[];
  const rows: [string, string][] = [
    ['Provozovatel', customer.join(', ')],
    ['Pracoviště/objekt/umístění', site.join(', ')],
    ['Kontrolu provedl', data.inspectors.join(', ') || data.leadInspector],
    ['Kontrola provedena dne', formatDate(data.inspectionDate)],
    ['Následnou kontrolu provést nejpozději do', formatDate(data.nextInspectionDate)],
    ...(data.note ? ([['Poznámka', data.note]] as [string, string][]) : []),
  ];
  const widths = [mm(47), CONTENT_WIDTH - mm(47)];
  return table(
    widths,
    rows.map(
      ([label, value]) =>
        new TableRow({
          height: { value: mm(10), rule: 'atLeast' },
          children: [cell(lines([label], { bold: true }), { grey: true }), cell(lines([value]))],
        }),
    ),
  );
}

function itemRow(i: ProtocolItem) {
  const yes = safeToOperate(i.outcome);
  const answer = (text: string, struck: boolean) =>
    cell(lines([text], { bold: true, strike: struck, align: AlignmentType.CENTER }));
  const description: ParagraphChild[] = [
    ...(i.designation ? [run(`${i.designation} `, { bold: true })] : []),
    run(i.details),
    ...(i.location ? [new TextRun({ text: i.location, font: FONT, size: 16, break: 1 })] : []),
  ];
  return new TableRow({
    cantSplit: true,
    height: { value: mm(9), rule: 'atLeast' },
    children: [
      cell(lines([i.itemNumber])),
      cell(new Paragraph({ children: description })),
      answer('ANO', yes === false),
      answer('NE', yes === true),
      cell(lines(protocolNoteLines(i))),
    ],
  });
}

function itemsTable(typeName: string, items: ProtocolItem[]) {
  const widths = [mm(19), CONTENT_WIDTH - mm(19 + 11 + 11 + 70), mm(11), mm(11), mm(70)];
  const head = (text: string[], span?: number) =>
    cell(lines(text, { bold: true }), { grey: true, span });
  return table(widths, [
    new TableRow({
      tableHeader: true,
      children: [head([`Kontrolované technické vybavení – ${typeName}`], 5)],
    }),
    new TableRow({
      tableHeader: true,
      children: [
        head(['Kontrolní', 'číslo']),
        head(['Popis']),
        head(['Schopno bezpečného', 'provozu*'], 2),
        head(['Poznámka', '(popis zjištění, závady, doporučení atd.)']),
      ],
    }),
    ...items.map(itemRow),
  ]);
}

function protocolText(text: string): Paragraph[] {
  return parseProtocolText(text).flatMap((block) => {
    if (block.kind === 'h')
      return [
        new Paragraph({ spacing: { before: mm(2) }, children: [run(block.text, { bold: true })] }),
      ];
    if (block.kind === 'p') return [lines(block.text.split('\n'))];
    return block.items.flatMap((item) => [
      new Paragraph({
        bullet: { level: 0 },
        alignment: AlignmentType.BOTH,
        children: [run(item.text)],
      }),
      ...item.sub.map(
        (sub) =>
          new Paragraph({
            bullet: { level: 1 },
            alignment: AlignmentType.BOTH,
            children: [run(sub)],
          }),
      ),
    ]);
  });
}

/** A compact defect card (8 pt): number · designation · location, description, photos. */
function defectBlock(d: ProtocolDefect, photoHeight: number, columns: 1 | 2 | 3): Paragraph[] {
  const { width } = photoBox(columns, photoHeight, d.photos.length);
  const photos = d.photos
    .map((p) => imageRun(p, width, photoHeight))
    .filter((r): r is ImageRun => r !== null)
    .flatMap((r) => [r, new TextRun({ text: ' ', font: FONT })]);
  return [
    new Paragraph({ keepNext: true, children: [run(defectCardTitle(d), { bold: true, size: 8 })] }),
    ...(d.defectDescription
      ? [new Paragraph({ keepNext: true, children: [run(d.defectDescription, { size: 8 })] })]
      : []),
    ...(photos.length ? [new Paragraph({ children: photos })] : []),
  ];
}

/** One defect card: a one-cell table with a thin border that never splits between pages. */
function defectCard(d: ProtocolDefect, photoHeight: number, columns: 1 | 2 | 3): Table {
  const width = Math.floor((CONTENT_WIDTH - (columns - 1) * mm(2)) / columns);
  const thin = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
  return table(
    [width],
    [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            children: defectBlock(d, photoHeight, columns),
            borders: { top: thin, bottom: thin, left: thin, right: thin },
            margins: { top: mm(0.8), bottom: mm(0.8), left: mm(1), right: mm(1) },
            width: { size: width, type: WidthType.DXA },
          }),
        ],
      }),
    ],
  );
}
/** Space below a card (a table needs a paragraph to separate it from the next one). */
const gap = () =>
  new Paragraph({ spacing: { before: 0, after: 0 }, children: [run('', { size: 4 })] });

export async function renderProtocolDocx(
  data: ProtocolData,
  part: 'all' | 'appendix' = 'all',
): Promise<Uint8Array> {
  const layout = protocolLayout(data);
  const groups = protocolDefectGroups(data);
  const texts = protocolTexts(data);
  const c = data.company;
  const children: (Paragraph | Table)[] = [
    ...(data.final
      ? []
      : [
          lines(['PŘEDBĚŽNÝ PROTOKOL – kontrola ještě není uzavřena, údaje se mohou změnit.'], {
            bold: true,
            align: AlignmentType.CENTER,
          }),
        ]),
    heading('Protokol o kontrole technického vybavení'),
    infoTable(data),
    ...(layout.useAppendix
      ? [
          new Paragraph({
            spacing: { before: mm(6), after: mm(6) },
            children: [run(APPENDIX_REFERENCE, { bold: true })],
          }),
        ]
      : [
          ...data.sections.flatMap((s) => [
            new Paragraph({ children: [] }),
            itemsTable(s.typeName, s.items),
          ]),
          lines(['*nehodící se škrtněte'], { size: 8 }),
        ]),
    heading('PŘI VÝSLEDKU KONTROLY NEVYHOVUJE', { size: 13, pageBreak: layout.warningOnNewPage }),
    heading('MUSÍ BÝT TECHNICKÉ VYBAVENÍ OKAMŽITĚ VYŘAZENO Z UŽÍVÁNÍ', { size: 13 }),
    table(
      [mm(47), CONTENT_WIDTH - mm(47)],
      [
        new TableRow({
          height: { value: mm(20), rule: 'atLeast' },
          children: [
            cell(lines(['Kontrolu provedl'], { bold: true }), { grey: true }),
            cell(lines([data.leadInspector, c.certification].filter(Boolean))),
          ],
        }),
        new TableRow({
          height: { value: mm(20), rule: 'atLeast' },
          children: [
            cell(lines(['S výsledkem kontroly byl seznámen'], { bold: true }), { grey: true }),
            cell(lines([''])),
          ],
        }),
      ],
    ),
    ...PROTOCOL_STATEMENTS.map(
      (t) =>
        new Paragraph({ bullet: { level: 0 }, alignment: AlignmentType.BOTH, children: [run(t)] }),
    ),
    ...(c.footer ? protocolText(c.footer) : []),
    ...(texts.length
      ? [heading('Pokyny k provádění kontrol'), ...texts.flatMap(protocolText)]
      : []),
  ];
  // Defects by severity, then workplace, in newspaper columns (their own continuous section,
  // the same decisions as the PDF).
  const defects: (Paragraph | Table)[] = [];
  for (const group of groups) {
    defects.push(
      new Paragraph({
        keepNext: true,
        spacing: { before: mm(3), after: mm(1) },
        children: [
          run(`${SEVERITY_GROUP_TITLE[group.severity]} (${group.count})`, {
            bold: true,
            size: 11,
            color: RED,
          }),
          run(`  ${SEVERITY_LABELS[group.severity].protocol.replace(/^[^–]*–\s*/, '')}`, {
            size: 8,
          }),
        ],
      }),
    );
    for (const place of group.places) {
      if (place.place) {
        defects.push(
          new Paragraph({
            keepNext: true,
            spacing: { before: mm(1), after: mm(0.5) },
            children: [run(place.place, { bold: true, size: 8.5 })],
          }),
        );
      }
      for (const d of place.defects) {
        defects.push(defectCard(d, layout.photoHeight, layout.defectColumns), gap());
      }
    }
  }
  const overview: (Paragraph | Table)[] = [];
  if (data.overviewPhotos.length) {
    overview.push(
      heading('Fotodokumentace', { keepNext: true }),
      new Paragraph({
        children: data.overviewPhotos
          .map((p) =>
            imageRun(
              p,
              photoBox(1, layout.photoHeight, data.overviewPhotos.length).width,
              layout.photoHeight,
            ),
          )
          .filter((r): r is ImageRun => r !== null)
          .flatMap((r) => [r, new TextRun({ text: ' ', font: FONT })]),
      }),
    );
  }

  // Appendix for the customer: its own landscape section (long texts in the last column).
  const appendix: (Paragraph | Table)[] = [];
  if (data.appendix?.columns.length && (layout.useAppendix || part === 'appendix')) {
    const { columns, rows } = data.appendix;
    const last = columns.length > 1 ? Math.round(LANDSCAPE_WIDTH * 0.3) : LANDSCAPE_WIDTH;
    const other =
      columns.length > 1 ? Math.floor((LANDSCAPE_WIDTH - last) / (columns.length - 1)) : 0;
    const widths = columns.map((_, i) => (i === columns.length - 1 ? last : other));
    appendix.push(
      heading(APPENDIX_TITLE, { size: 13 }),
      table(widths, [
        new TableRow({
          tableHeader: true,
          children: columns.map((h) => cell(lines([h], { bold: true, size: 8 }), { grey: true })),
        }),
        ...rows.map(
          (row) =>
            new TableRow({
              cantSplit: true,
              children: row.cells.map((v) =>
                cell(
                  lines([v], {
                    size: 8,
                    // Not fit for safe operation: bold and red.
                    ...(row.unsafe ? { bold: true, color: RED } : {}),
                  }),
                ),
              ),
            }),
        ),
      ]),
    );
  }
  const margin = {
    top: mm(10),
    bottom: mm(12),
    left: mm(14),
    right: mm(14),
    header: mm(8),
    footer: mm(8),
  };
  const headers = {
    default: new Header({ children: [pageHeader(data), new Paragraph({ children: [] })] }),
  };

  const document = new Document({
    creator: c.name,
    title: `Protokol ${data.number}`,
    styles: { default: { document: { run: { font: FONT, size: 18 } } } },
    sections: [
      ...(part === 'appendix'
        ? []
        : [
            {
              properties: { page: { size: { width: mm(210), height: mm(297) }, margin } },
              headers,
              footers: { default: new Footer({ children: [pageFooter(data, CONTENT_WIDTH)] }) },
              children,
            },
            ...(defects.length
              ? [
                  {
                    properties: {
                      type: SectionType.CONTINUOUS,
                      page: { size: { width: mm(210), height: mm(297) }, margin },
                      column: {
                        count: layout.defectColumns,
                        space: mm(2),
                        equalWidth: true,
                      },
                    },
                    headers,
                    footers: {
                      default: new Footer({ children: [pageFooter(data, CONTENT_WIDTH)] }),
                    },
                    children: defects,
                  },
                ]
              : []),
            ...(overview.length
              ? [
                  {
                    properties: {
                      type: SectionType.CONTINUOUS,
                      page: { size: { width: mm(210), height: mm(297) }, margin },
                    },
                    headers,
                    footers: {
                      default: new Footer({ children: [pageFooter(data, CONTENT_WIDTH)] }),
                    },
                    children: overview,
                  },
                ]
              : []),
          ]),
      ...(appendix.length
        ? [
            {
              properties: {
                page: {
                  // docx swaps width and height itself for landscape.
                  size: {
                    width: mm(210),
                    height: mm(297),
                    orientation: PageOrientation.LANDSCAPE,
                  },
                  margin,
                },
              },
              headers,
              footers: { default: new Footer({ children: [pageFooter(data, LANDSCAPE_WIDTH)] }) },
              children: appendix,
            },
          ]
        : []),
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(document));
}

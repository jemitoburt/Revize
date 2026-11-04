import { PDFDocument } from 'pdf-lib';

/** A4 landscape in PDF points. */
const SHEET = { width: 841.89, height: 595.28 };

/**
 * "Dvě strany na list": the portrait A4 pages of a PDF scaled side by side onto landscape A4
 * sheets (pages 1+2 on the first sheet, 3+4 on the second, …). A landscape page (Příloha 1, the
 * equipment table) keeps a whole sheet to itself at full size – halved it would lose the point
 * of printing it landscape. The pages are embedded as vector graphics, so text stays sharp.
 */
export async function twoPagesPerSheet(pdf: Uint8Array): Promise<Uint8Array> {
  const source = await PDFDocument.load(pdf);
  const out = await PDFDocument.create();
  out.setTitle(source.getTitle() ?? 'Protokol');
  const pages = await out.embedPdf(source, source.getPageIndices());
  const half = SHEET.width / 2;
  type Page = (typeof pages)[number];
  const draw = (sheet: ReturnType<typeof out.addPage>, page: Page, x: number, boxWidth: number) => {
    const scale = Math.min(boxWidth / page.width, SHEET.height / page.height);
    const width = page.width * scale;
    const height = page.height * scale;
    sheet.drawPage(page, {
      x: x + (boxWidth - width) / 2,
      y: (SHEET.height - height) / 2,
      width,
      height,
    });
  };
  let pending: Page | null = null;
  const flush = () => {
    if (!pending) return;
    draw(out.addPage([SHEET.width, SHEET.height]), pending, 0, half);
    pending = null;
  };
  for (const page of pages) {
    if (page.width > page.height) {
      flush();
      draw(out.addPage([SHEET.width, SHEET.height]), page, 0, SHEET.width);
    } else if (pending) {
      const sheet = out.addPage([SHEET.width, SHEET.height]);
      draw(sheet, pending, 0, half);
      draw(sheet, page, half, half);
      pending = null;
    } else {
      pending = page;
    }
  }
  flush();
  return out.save();
}

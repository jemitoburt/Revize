import { PDFDocument } from 'pdf-lib';

/** A4 landscape in PDF points. */
const SHEET = { width: 841.89, height: 595.28 };

/**
 * "Dvě strany na list": the A4 pages of a PDF scaled side by side onto landscape A4 sheets
 * (pages 1+2 on the first sheet, 3+4 on the second, …). The pages are embedded as vector
 * graphics, so text stays sharp.
 */
export async function twoPagesPerSheet(pdf: Uint8Array): Promise<Uint8Array> {
  const source = await PDFDocument.load(pdf);
  const out = await PDFDocument.create();
  out.setTitle(source.getTitle() ?? 'Protokol');
  const pages = await out.embedPdf(source, source.getPageIndices());
  const half = SHEET.width / 2;
  for (let i = 0; i < pages.length; i += 2) {
    const sheet = out.addPage([SHEET.width, SHEET.height]);
    for (const [slot, page] of [pages[i], pages[i + 1]].entries()) {
      if (!page) continue;
      const scale = Math.min(half / page.width, SHEET.height / page.height);
      const width = page.width * scale;
      const height = page.height * scale;
      sheet.drawPage(page, {
        x: slot * half + (half - width) / 2,
        y: (SHEET.height - height) / 2,
        width,
        height,
      });
    }
  }
  return out.save();
}

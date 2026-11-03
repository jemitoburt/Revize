/** HTML → PDF (ADR-0007/M7). Server: headless Chromium; the browser demo prints instead. */
export interface PdfRenderer {
  /** `footer` is printed at the bottom left of every page, next to "Strana X z Y". */
  render(html: string, footer: string): Promise<Uint8Array>;
  close(): Promise<void>;
}

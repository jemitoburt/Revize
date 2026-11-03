/** HTML → PDF (ADR-0007/M7). Server: headless Chromium; the browser demo prints instead. */
export interface PdfPageOptions {
  /** HTML printed at the top / bottom of every page; `<span class="pageNumber">` and
   * `<span class="totalPages">` are filled in. */
  header: string;
  footer: string;
  margin: { top: string; bottom: string; left: string; right: string };
}

export interface PdfRenderer {
  render(html: string, page: PdfPageOptions): Promise<Uint8Array>;
  close(): Promise<void>;
}

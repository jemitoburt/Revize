import { chromium, type Browser } from 'playwright-core';
import type { PdfRenderer } from './pdf-renderer.js';

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Prints HTML with headless Chromium (playwright-core, no bundled browser). The browser is
 * started on the first protocol and reused; `executablePath` comes from CHROMIUM_PATH (the
 * API image installs Alpine's chromium), otherwise Playwright's own browser is used (dev).
 */
export class ChromiumPdfRenderer implements PdfRenderer {
  private browser: Promise<Browser> | null = null;

  constructor(private readonly executablePath?: string) {}

  private launch(): Promise<Browser> {
    this.browser ??= chromium
      .launch({
        ...(this.executablePath ? { executablePath: this.executablePath } : {}),
        // The API container runs as an unprivileged user without the Chromium sandbox setup.
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
      })
      .then((browser) => {
        browser.on('disconnected', () => (this.browser = null));
        return browser;
      })
      .catch((error: unknown) => {
        this.browser = null;
        throw error;
      });
    return this.browser;
  }

  async render(html: string, footer: string): Promise<Uint8Array> {
    const browser = await this.launch();
    const page = await browser.newPage();
    try {
      // The protocol is self-contained (images as data URLs): no network access needed.
      await page.route('**/*', (route) =>
        route.request().url().startsWith('data:') ? route.continue() : route.abort(),
      );
      await page.setContent(html, { waitUntil: 'load' });
      return await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `<div style="width:100%;margin:0 14mm;font-size:7pt;color:#555;font-family:'Noto Sans','DejaVu Sans',sans-serif;display:flex;justify-content:space-between"><span>${escape(
          footer,
        )}</span><span>Strana <span class="pageNumber"></span> z <span class="totalPages"></span></span></div>`,
        margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
      });
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    const browser = await this.browser?.catch(() => null);
    this.browser = null;
    await browser?.close();
  }
}

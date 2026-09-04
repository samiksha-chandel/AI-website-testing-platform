import { chromium } from 'playwright';

/**
 * Shared browser manager for a single scan execution.
 * Launches ONE Chromium instance and provides isolated BrowserContexts.
 * Ensures cleanup on success or failure.
 */
export class ScanBrowser {
  constructor() {
    this.browser = null;
    this.contexts = new Set();
    this.pages = new Set();
  }

  async launch() {
    if (this.browser) return this.browser;
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
        '--disable-dev-shm-usage', '--disable-extensions',
        '--disable-background-networking', '--disable-default-apps',
        '--disable-sync', '--no-first-run',
      ],
    });
    return this.browser;
  }

  async newContext(options = {}) {
    if (!this.browser) await this.launch();
    const context = await this.browser.newContext({
      userAgent: 'SitePulse/1.0 Website Testing Platform',
      ...options,
    });
    this.contexts.add(context);
    context.on('close', () => this.contexts.delete(context));
    return context;
  }

  async newPage(context) {
    const ctx = context || await this.newContext();
    const page = await ctx.newPage();
    this.pages.add(page);
    page.on('close', () => this.pages.delete(page));
    return page;
  }

  async cleanup() {
    for (const page of this.pages) { try { await page.close(); } catch (e) {} }
    this.pages.clear();
    for (const context of this.contexts) { try { await context.close(); } catch (e) {} }
    this.contexts.clear();
    if (this.browser) { try { await this.browser.close(); } catch (e) {} this.browser = null; }
  }

  getStats() {
    return { browserAlive: !!this.browser, contextsCount: this.contexts.size, pagesCount: this.pages.size };
  }
}

/**
 * Resource limits — optimized for speed while maintaining correctness.
 */
export const LIMITS = {
  httpConcurrency: parseInt(process.env.HTTP_CONCURRENCY || '10'),
  navigationTimeout: parseInt(process.env.NAVIGATION_TIMEOUT || '15000'),
  requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || '8000'),
  maxLinksToCheck: parseInt(process.env.MAX_LINKS_TO_CHECK || '150'),
};

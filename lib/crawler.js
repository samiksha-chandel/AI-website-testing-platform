import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { createModuleResult, updateModuleResult } from './db.js';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export async function crawlWebsite(url, runId, io) {
  const result = createModuleResult(runId, 'crawler');
  updateModuleResult(result.id, { status: 'running', started_at: new Date().toISOString() });
  io?.to(runId).emit('module:start', { module: 'crawler', resultId: result.id });

  const startTime = Date.now();

  try {
    const browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context = await browser.newContext({
      userAgent: 'SitePulse/1.0 Website Testing Platform'
    });
    const page = await context.newPage();

    io?.to(runId).emit('module:progress', { module: 'crawler', message: 'Fetching main page...' });
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    const html = await page.content();
    const $ = cheerio.load(html);
    
    // Extract title
    const title = $('title').text().trim() || '';
    
    // Extract meta tags
    const meta = {};
    $('meta').each((_, el) => {
      const name = $(el).attr('name') || $(el).attr('property') || '';
      const content = $(el).attr('content') || '';
      if (name && content) meta[name] = content;
    });
    
    // Extract all links
    const links = [];
    const internalLinks = new Set();
    const externalLinks = new Set();
    
    $('a[href]').each((_, el) => {
      let href = $(el).attr('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      
      try {
        const resolved = new URL(href, url).href;
        const parsed = new URL(resolved);
        links.push({
          text: $(el).text().trim().substring(0, 100),
          href: resolved,
          isInternal: parsed.hostname === new URL(url).hostname
        });
        
        if (parsed.hostname === new URL(url).hostname) {
          internalLinks.add(resolved.split('#')[0].split('?')[0]);
        } else {
          externalLinks.add(resolved);
        }
      } catch (e) {}
    });
    
    // Extract headings
    const headings = {};
    for (let i = 1; i <= 6; i++) {
      const h = [];
      $(`h${i}`).each((_, el) => {
        h.push($(el).text().trim().substring(0, 200));
      });
      if (h.length > 0) headings[`h${i}`] = h;
    }
    
    // Extract forms
    const forms = [];
    $('form').each((_, el) => {
      const formAction = $(el).attr('action') || '';
      const method = ($(el).attr('method') || 'GET').toUpperCase();
      const inputs = [];
      $(el).find('input, select, textarea').each((_, inp) => {
        inputs.push({
          type: $(inp).attr('type') || 'text',
          name: $(inp).attr('name') || '',
          id: $(inp).attr('id') || '',
          required: $(inp).attr('required') !== undefined
        });
      });
      forms.push({ action: formAction, method, inputs });
    });
    
    // Extract images
    const images = [];
    $('img').each((_, el) => {
      const src = $(el).attr('src') || '';
      const alt = $(el).attr('alt') || '';
      if (src) {
        try {
          images.push({ src: new URL(src, url).href, alt });
        } catch (e) {}
      }
    });

    // Extract scripts and styles
    const scripts = [];
    $('script[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (src) {
        try { scripts.push(new URL(src, url).href); } catch (e) {}
      }
    });

    const styles = [];
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        try { styles.push(new URL(href, url).href); } catch (e) {}
      }
    });

    // Extract navigation
    const navigation = [];
    $('nav a, header a, .nav a, .navbar a, .menu a').each((_, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href');
      if (text && href) {
        try {
          navigation.push({ text: text.substring(0, 100), href: new URL(href, url).href });
        } catch (e) {}
      }
    });

    // Crawl a few internal pages for richer data
    io?.to(runId).emit('module:progress', { module: 'crawler', message: 'Crawling internal pages...' });
    
    const pages = [];
    const maxPages = Math.min(internalLinks.size, 10);
    let crawled = 0;
    
    for (const link of [...internalLinks].slice(0, maxPages)) {
      try {
        crawled++;
        io?.to(runId).emit('module:progress', { 
          module: 'crawler', 
          message: `Crawling page ${crawled}/${maxPages}...` 
        });
        
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const pageHtml = await page.content();
        const page$ = cheerio.load(pageHtml);
        
        pages.push({
          url: link,
          title: page$('title').text().trim(),
          status: 'ok',
          headings: (() => {
            const h = [];
            for (let i = 1; i <= 3; i++) {
              page$(`h${i}`).each((_, el) => h.push(page$(el).text().trim().substring(0, 100)));
            }
            return h;
          })(),
          links: page$('a[href]').length,
          images: page$('img').length
        });
      } catch (e) {
        pages.push({ url: link, title: '', status: 'error', error: e.message });
      }
    }

    await browser.close();

    // Save crawl data
    const crawlData = {
      url,
      title,
      meta,
      links: links.slice(0, 500),
      internalLinks: [...internalLinks],
      externalLinks: [...externalLinks],
      headings,
      forms,
      images: images.slice(0, 200),
      scripts,
      styles,
      navigation: navigation.slice(0, 50),
      pages,
      stats: {
        totalLinks: links.length,
        internalLinkCount: internalLinks.size,
        externalLinkCount: externalLinks.size,
        totalImages: images.length,
        totalForms: forms.length,
        totalScripts: scripts.length,
        totalPages: pages.length
      },
      crawledAt: new Date().toISOString()
    };

    // Persist crawl data
    const runsDir = join(__dirname, '..', 'runs', runId);
    if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, 'crawl.json'), JSON.stringify(crawlData, null, 2));

    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'completed',
      score: 100,
      metrics: JSON.stringify(crawlData.stats),
      raw_output: JSON.stringify(crawlData),
      completed_at: new Date().toISOString(),
      duration_ms: duration
    });

    io?.to(runId).emit('module:complete', { module: 'crawler', resultId: result.id, duration });

    return crawlData;

  } catch (error) {
    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'error',
      score: 0,
      error: error.message,
      completed_at: new Date().toISOString(),
      duration_ms: duration
    });
    io?.to(runId).emit('module:error', { module: 'crawler', error: error.message });
    throw error;
  }
}

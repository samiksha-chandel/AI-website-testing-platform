import * as cheerio from 'cheerio';
import { createModuleResult, updateModuleResult } from './db.js';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { LIMITS } from './browserManager.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ═══════════════════════════════════════════════
// URL NORMALIZATION
// ═══════════════════════════════════════════════

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', '_ga', '_gl',
  'yclid', 'msclkid', 'twclid', 'li_fat_id', 'igshid',
  'sessionId', 'session_id', 'sid', 'phpsessid', 'asp.sessionid',
  'jsessionid', 'connect.sid', '_hsenc', '_hsmi', 'hsa_cam',
  'hsa_grp', 'hsa_mt', 'hsa_src', 'hsa_ad', 'hsa_acc', 'hsa_net',
  'hsa_ver', 'hsa_la', 'hsa_ol', 'hsa_kw', 'hsa_tgt', 'hsa_tl',
]);

const SKIP_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.bmp', '.tiff', '.avif',
  '.mp4', '.webm', '.ogg', '.mp3', '.wav', '.avi', '.mov', '.wmv', '.flv',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods',
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',
  '.css', '.js', '.mjs', '.cjs',
  '.woff', '.woff2', '.ttf', '.eot', '.otf', '.afm',
  '.json', '.rss', '.atom', '.xml',
  '.exe', '.dmg', '.apk', '.deb', '.rpm',
]);

function normalizeUrl(rawUrl, base) {
  try {
    const url = new URL(rawUrl, base);
    if (!['http:', 'https:'].includes(url.protocol)) return null;

    const pathname = url.pathname.toLowerCase();
    const ext = pathname.match(/\.([a-z0-9]+)$/)?.[1];
    if (ext && SKIP_EXTENSIONS.has(`.${ext}`)) return null;

    for (const param of TRACKING_PARAMS) {
      url.searchParams.delete(param);
    }

    if (!pathname.includes('.') && !pathname.endsWith('/')) {
      url.pathname += '/';
    }

    url.hash = '';

    if ((url.protocol === 'https:' && url.port === '443') ||
        (url.protocol === 'http:' && url.port === '80')) {
      url.port = '';
    }

    return url.href;
  } catch (e) {
    return null;
  }
}

function detectTemplates(urls) {
  const templates = new Map();
  for (const url of urls) {
    try {
      const u = new URL(url);
      const segments = u.pathname.split('/').filter(Boolean);
      const template = '/' + segments.map(s => {
        if (/^\d+$/.test(s)) return '{id}';
        if (/^[0-9a-f]{8}-[0-9a-f]{4}/.test(s)) return '{uuid}';
        if (s.length > 30) return '{slug}';
        return s;
      }).join('/');
      const key = u.hostname + template;
      if (!templates.has(key)) {
        templates.set(key, { pattern: template, hostname: u.hostname, count: 0, urls: [] });
      }
      const t = templates.get(key);
      t.count++;
      t.urls.push(url);
    } catch (e) { /* skip malformed */ }
  }
  return templates;
}

function selectDeepTestPages(crawlData, maxDeepTestPages) {
  const allUrls = (crawlData.pages || []).map(p => p.url).filter(Boolean);
  if (allUrls.length <= maxDeepTestPages) {
    return { selected: allUrls, skipped: [], reason: 'all-pages-within-limit' };
  }

  const templates = detectTemplates(allUrls);
  const selected = new Set();
  const skipped = [];

  const homepage = crawlData.url;
  if (homepage) selected.add(homepage);

  for (const nav of (crawlData.navigation || []).slice(0, 10)) {
    if (nav.href && allUrls.includes(nav.href)) selected.add(nav.href);
  }

  const templateEntries = [...templates.entries()].sort((a, b) => b[1].count - a[1].count);
  const perTemplateBudget = Math.max(2, Math.floor((maxDeepTestPages - selected.size) / Math.max(1, templateEntries.length)));

  for (const [key, template] of templateEntries) {
    const templateUrls = template.urls;
    const step = Math.max(1, Math.floor(templateUrls.length / perTemplateBudget));
    for (let i = 0; i < templateUrls.length && selected.size < maxDeepTestPages; i += step) {
      selected.add(templateUrls[i]);
    }
    for (const u of templateUrls) {
      if (!selected.has(u)) skipped.push({ url: u, pattern: template.pattern, reason: 'template-sampled' });
    }
  }

  for (const url of allUrls) {
    if (selected.size >= maxDeepTestPages) break;
    if (!selected.has(url)) selected.add(url);
  }

  return { selected: [...selected], skipped, reason: 'representative-sampling' };
}

function extractPageData(html, url) {
  const $ = cheerio.load(html);

  const meta = {};
  $('meta').each((_, el) => {
    const name = $(el).attr('name') || $(el).attr('property') || '';
    const content = $(el).attr('content') || '';
    if (name && content) meta[name] = content;
  });

  const links = [];
  const hostname = new URL(url).hostname;

  $('a[href]').each((_, el) => {
    let href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') ||
        href.startsWith('mailto:') || href.startsWith('tel:')) return;
    try {
      const resolved = new URL(href, url).href;
      links.push({
        text: $(el).text().trim().substring(0, 100),
        href: resolved,
        isInternal: new URL(resolved).hostname === hostname,
      });
    } catch (e) { /* skip malformed */ }
  });

  const headings = {};
  for (let i = 1; i <= 6; i++) {
    const h = [];
    $(`h${i}`).each((_, el) => {
      h.push($(el).text().trim().substring(0, 200));
    });
    if (h.length > 0) headings[`h${i}`] = h;
  }

  const forms = [];
  $('form').each((_, el) => {
    const inputs = [];
    $(el).find('input, select, textarea').each((_, inp) => {
      inputs.push({
        type: $(inp).attr('type') || 'text',
        name: $(inp).attr('name') || '',
        id: $(inp).attr('id') || '',
        required: $(inp).attr('required') !== undefined,
      });
    });
    forms.push({
      action: $(el).attr('action') || '',
      method: ($(el).attr('method') || 'GET').toUpperCase(),
      inputs,
    });
  });

  const images = [];
  $('img').each((_, el) => {
    const src = $(el).attr('src') || '';
    const alt = $(el).attr('alt') || '';
    if (src) {
      try { images.push({ src: new URL(src, url).href, alt }); } catch (e) {}
    }
  });

  const scripts = [];
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) { try { scripts.push(new URL(src, url).href); } catch (e) {} }
  });

  const styles = [];
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) { try { styles.push(new URL(href, url).href); } catch (e) {} }
  });

  const navigation = [];
  $('nav a, header a, .nav a, .navbar a, .menu a').each((_, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    if (text && href) {
      try { navigation.push({ text: text.substring(0, 100), href: new URL(href, url).href }); } catch (e) {}
    }
  });

  return { title: $('title').text().trim() || '', meta, links, headings, forms, images, scripts, styles, navigation };
}

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeout || LIMITS.requestTimeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SitePulse/1.0 Website Crawler', ...opts.headers },
      redirect: 'follow',
      ...opts,
    });
    clearTimeout(timeout);
    return response;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

async function discoverFromSitemap(url) {
  const discovered = [];
  const hostname = new URL(url).hostname;
  const baseUrl = new URL(url).origin;

  const sitemapUrls = [
    `${baseUrl}/sitemap.xml`,
    `${baseUrl}/sitemap_index.xml`,
    `${baseUrl}/sitemap-index.xml`,
  ];

  const visited = new Set();

  async function parseSitemap(sitemapUrl) {
    if (visited.has(sitemapUrl)) return;
    visited.add(sitemapUrl);

    try {
      const response = await fetchWithTimeout(sitemapUrl);
      if (!response.ok) return;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('xml') && !contentType.includes('text')) return;

      const text = await response.text();
      const $ = cheerio.load(text, { xmlMode: true });

      const childSitemaps = [];
      $('sitemap > loc').each((_, el) => {
        const loc = $(el).text().trim();
        if (loc) {
          try {
            const childUrl = new URL(loc);
            if (childUrl.hostname === hostname) childSitemaps.push(loc);
          } catch (e) {}
        }
      });

      for (const childSitemap of childSitemaps) {
        await parseSitemap(childSitemap);
      }

      $('url > loc').each((_, el) => {
        const loc = $(el).text().trim();
        if (loc) {
          try {
            const u = new URL(loc);
            if (u.hostname === hostname) discovered.push(loc);
          } catch (e) {}
        }
      });
    } catch (e) { /* sitemap not available */ }
  }

  for (const sitemapUrl of sitemapUrls) {
    await parseSitemap(sitemapUrl);
  }

  return discovered;
}

async function discoverFromRobotsTxt(url) {
  const baseUrl = new URL(url).origin;
  const discovered = [];

  try {
    const response = await fetchWithTimeout(`${baseUrl}/robots.txt`);
    if (!response.ok) return discovered;
    const text = await response.text();

    const lines = text.split('\n');
    for (const line of lines) {
      const match = line.match(/^sitemap:\s*(.+)/i);
      if (match) discovered.push(match[1].trim());
    }
  } catch (e) { /* robots.txt not available */ }

  return discovered;
}

async function fetchPageData(url) {
  const response = await fetchWithTimeout(url);
  const contentType = response.headers.get('content-type') || '';
  const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml');

  let body = '';
  if (isHtml && response.status < 400) {
    body = await response.text();
  }

  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    finalUrl: response.url,
    isHtml,
  };
}

// ═══════════════════════════════════════════════
// MAIN CRAWLER
// ═══════════════════════════════════════════════

export async function crawlWebsite(url, runId, io, scanBrowser) {
  const result = createModuleResult(runId, 'crawler');
  updateModuleResult(result.id, { status: 'running', started_at: new Date().toISOString() });
  io?.to(runId).emit('module:start', { module: 'crawler', resultId: result.id });

  const startTime = Date.now();
  const hostname = new URL(url).hostname;
  const maxDepth = parseInt(process.env.MAX_CRAWL_DEPTH || '5');
  const maxRequests = parseInt(process.env.MAX_CRAWL_REQUESTS || '100');
  const concurrency = parseInt(process.env.MAX_CRAWL_CONCURRENCY || '8');
  const maxDeepTestPages = parseInt(process.env.MAX_DEEP_TEST_PAGES || '25');

  const discovered = new Map();
  const queue = [];
  const visited = new Set();
  const linkCounts = new Map();
  let requestCount = 0;
  let maxDepthReached = 0;
  let stoppedByLimit = false;

  try {
    io?.to(runId).emit('module:progress', { module: 'crawler', message: 'Discovering URLs from sitemap and robots.txt...' });

    const [sitemapUrls, robotsUrls] = await Promise.all([
      discoverFromSitemap(url).catch(() => []),
      discoverFromRobotsTxt(url).catch(() => []),
    ]);

    const seedUrl = normalizeUrl(url, url);
    if (seedUrl) {
      discovered.set(seedUrl, { status: 'discovered', depth: 0, data: null, priority: 100, source: 'seed' });
      queue.push({ url: seedUrl, depth: 0, priority: 100 });
    }

    for (const sUrl of [...sitemapUrls, ...robotsUrls]) {
      const normalized = normalizeUrl(sUrl, url);
      if (normalized && !discovered.has(normalized)) {
        discovered.set(normalized, { status: 'discovered', depth: 0, data: null, priority: 90, source: 'sitemap' });
        queue.push({ url: normalized, depth: 0, priority: 90 });
      }
    }

    io?.to(runId).emit('module:progress', {
      module: 'crawler',
      message: `Discovered ${sitemapUrls.length} URLs from sitemap, starting recursive crawl...`,
    });

    while (queue.length > 0 && requestCount < maxRequests) {
      queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      const batch = queue.splice(0, concurrency);

      const promises = batch.map(async ({ url: pageUrl, depth }) => {
        if (visited.has(pageUrl)) return;
        if (requestCount >= maxRequests) { stoppedByLimit = true; return; }

        visited.add(pageUrl);
        requestCount++;

        if (depth > maxDepthReached) maxDepthReached = depth;

        try {
          const response = await fetchPageData(pageUrl);

          if (!response.isHtml || response.status >= 400) {
            discovered.set(pageUrl, {
              ...discovered.get(pageUrl),
              status: response.status >= 400 ? 'error' : 'skipped',
              depth,
              data: null,
              httpStatus: response.status,
            });
            return;
          }

          const pageData = extractPageData(response.body, response.finalUrl || pageUrl);

          let priority = 50;
          if (depth === 0) priority = 100;
          else if (depth === 1) priority = 80;
          else if (depth === 2) priority = 60;

          const incomingLinks = linkCounts.get(pageUrl) || 0;
          if (incomingLinks > 3) priority += 10;
          if (incomingLinks > 10) priority += 10;

          discovered.set(pageUrl, {
            status: 'crawled',
            depth,
            priority,
            data: {
              url: pageUrl,
              finalUrl: response.finalUrl,
              httpStatus: response.status,
              headers: response.headers,
              ...pageData,
            },
          });

          if (depth < maxDepth) {
            for (const link of pageData.links) {
              const linkNorm = normalizeUrl(link.href, pageUrl);
              if (linkNorm) linkCounts.set(linkNorm, (linkCounts.get(linkNorm) || 0) + 1);
              if (!link.isInternal) continue;
              const normalized = normalizeUrl(link.href, pageUrl);
              if (!normalized || discovered.has(normalized) || visited.has(normalized)) continue;
              if (requestCount + queue.length >= maxRequests) { stoppedByLimit = true; break; }

              const childPriority = Math.max(10, priority - 10);
              discovered.set(normalized, { status: 'discovered', depth: depth + 1, data: null, priority: childPriority, source: 'link' });
              queue.push({ url: normalized, depth: depth + 1, priority: childPriority });
            }
          }
        } catch (e) {
          discovered.set(pageUrl, {
            ...discovered.get(pageUrl),
            status: 'error', depth, data: null, error: e.message,
          });
        }
      });

      await Promise.all(promises);

      const crawled = [...discovered.values()].filter(d => d.status === 'crawled').length;
      io?.to(runId).emit('module:progress', {
        module: 'crawler',
        message: `Crawled ${crawled}/${discovered.size} pages (${requestCount} requests, depth ${maxDepthReached})...`,
      });
    }

    const crawlComplete = !stoppedByLimit && queue.length === 0;

    const crawledPages = [];
    const allLinks = [];
    const internalLinkSet = new Set();
    const externalLinkSet = new Set();

    for (const [pageUrl, info] of discovered) {
      if (info.status === 'crawled' && info.data) {
        crawledPages.push(info.data);
        for (const link of info.data.links) {
          allLinks.push(link);
          if (link.isInternal) internalLinkSet.add(normalizeUrl(link.href, pageUrl) || link.href);
          else externalLinkSet.add(link.href);
        }
      }
    }

    const rootPage = crawledPages[0] || {};

    const allDiscoveredUrls = [...discovered.keys()];
    const templates = detectTemplates(allDiscoveredUrls);
    const templateSummary = [...templates.entries()].map(([key, t]) => ({
      pattern: t.pattern,
      hostname: t.hostname,
      count: t.count,
      examples: t.urls.slice(0, 5),
      totalUrls: t.urls.length,
    })).sort((a, b) => b.count - a.count);

    const { selected: deepTestPages, skipped: sampledOut, reason: samplingReason } =
      selectDeepTestPages({ url, pages: crawledPages, navigation: rootPage.navigation }, maxDeepTestPages);

    const crawlData = {
      url,
      title: rootPage.title || '',
      meta: rootPage.meta || {},
      links: allLinks,
      internalLinks: [...internalLinkSet],
      externalLinks: [...externalLinkSet],
      headings: rootPage.headings || {},
      forms: rootPage.forms || [],
      images: rootPage.images || [],
      scripts: rootPage.scripts || [],
      styles: rootPage.styles || [],
      navigation: rootPage.navigation || [],
      pages: crawledPages,
      deepTestPages,
      templates: templateSummary,
      stats: {
        urlsDiscovered: discovered.size,
        urlsFromSitemap: sitemapUrls.length + robotsUrls.length,
        urlsCrawled: crawledPages.length,
        urlsSkipped: [...discovered.values()].filter(d => d.status === 'skipped').length,
        urlsFailed: [...discovered.values()].filter(d => d.status === 'error').length,
        internalLinkCount: internalLinkSet.size,
        externalLinkCount: externalLinkSet.size,
        uniqueInternalUrls: internalLinkSet.size,
        maxDepthReached,
        totalRequests: requestCount,
        totalImages: crawledPages.reduce((sum, p) => sum + (p.images?.length || 0), 0),
        totalForms: crawledPages.reduce((sum, p) => sum + (p.forms?.length || 0), 0),
        totalScripts: crawledPages.reduce((sum, p) => sum + (p.scripts?.length || 0), 0),
        crawlComplete,
        stoppedByLimit,
        requestLimit: maxRequests,
        depthLimit: maxDepth,
        deepTestPageCount: deepTestPages.length,
        sampledOutCount: sampledOut.length,
        samplingReason,
        templatesDetected: templateSummary.length,
        coverageNote: stoppedByLimit
          ? `Crawl stopped by request limit (${maxRequests}). Discovered ${discovered.size} URLs but only crawled ${crawledPages.length}. Representative sampling was applied to ${deepTestPages.length} pages.`
          : `Full crawl completed. ${crawledPages.length} pages crawled, ${deepTestPages.length} pages selected for deep testing.`,
      },
      crawledAt: new Date().toISOString(),
    };

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
      duration_ms: duration,
    });

    io?.to(runId).emit('module:complete', { module: 'crawler', resultId: result.id, duration });

    return crawlData;

  } catch (error) {
    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'error', score: 0, error: error.message,
      completed_at: new Date().toISOString(), duration_ms: duration,
    });
    io?.to(runId).emit('module:error', { module: 'crawler', error: error.message });
    throw error;
  }
}

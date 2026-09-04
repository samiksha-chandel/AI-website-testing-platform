import { createModuleResult, updateModuleResult } from './db.js';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export async function runSEOCheck(crawlData, runId, io) {
  const result = createModuleResult(runId, 'seo');
  updateModuleResult(result.id, { status: 'running', started_at: new Date().toISOString() });
  io?.to(runId).emit('module:start', { module: 'seo', resultId: result.id });

  const startTime = Date.now();

  try {
    const findings = [];
    const metrics = {};

    // ═══════════════════════════════════════
    // MULTI-PAGE ANALYSIS — use all crawled pages
    // ═══════════════════════════════════════
    const allPages = crawlData.pages || [];
    const rootPage = allPages[0] || {};
    const pagesWithHttpStatus = allPages.filter(p => p.httpStatus && p.httpStatus >= 200 && p.httpStatus < 400);
    metrics.pagesAnalyzed = pagesWithHttpStatus.length;
    metrics.totalPagesDiscovered = allPages.length;

    // ═══════════════════════════════════════
    // ROOT PAGE SEO (using root page data)
    // ═══════════════════════════════════════
    const title = crawlData.title || rootPage.title || '';
    if (!title) {
      findings.push({ ruleId: 'missing-title', severity: 'HIGH', description: 'Page is missing a title tag', category: 'meta' });
    } else if (title.length < 10) {
      findings.push({ ruleId: 'short-title', severity: 'MEDIUM', description: `Title is too short (${title.length} chars): "${title}"`, category: 'meta' });
    } else if (title.length > 60) {
      findings.push({ ruleId: 'long-title', severity: 'LOW', description: `Title is too long (${title.length} chars) - may be truncated in SERPs`, category: 'meta' });
    }
    metrics.titleLength = title.length;

    // Meta description check
    const description = (crawlData.meta || rootPage.meta || {})['description'] || '';
    if (!description) {
      findings.push({ ruleId: 'missing-description', severity: 'HIGH', description: 'Page is missing meta description', category: 'meta' });
    } else if (description.length < 50) {
      findings.push({ ruleId: 'short-description', severity: 'MEDIUM', description: `Meta description is too short (${description.length} chars)`, category: 'meta' });
    } else if (description.length > 160) {
      findings.push({ ruleId: 'long-description', severity: 'LOW', description: `Meta description is too long (${description.length} chars)`, category: 'meta' });
    }
    metrics.descriptionLength = description.length;

    // Keywords meta (deprecated but still relevant for analysis)
    const meta = crawlData.meta || rootPage.meta || {};
    metrics.hasKeywords = !!meta['keywords'];

    // Heading structure
    const rootHeadings = crawlData.headings || rootPage.headings || {};
    const h1s = rootHeadings.h1 || [];
    if (h1s.length === 0) {
      findings.push({ ruleId: 'missing-h1', severity: 'HIGH', description: 'No H1 tag found on page', category: 'headings' });
    } else if (h1s.length > 1) {
      findings.push({ ruleId: 'multiple-h1', severity: 'MEDIUM', description: `Multiple H1 tags found (${h1s.length})`, category: 'headings' });
    }
    metrics.h1Count = h1s.length;

    // Check heading hierarchy
    const headingLevels = Object.keys(rootHeadings).map(h => parseInt(h.replace('h', ''))).filter(n => !isNaN(n)).sort((a, b) => a - b);
    if (headingLevels.length > 1) {
      for (let i = 1; i < headingLevels.length; i++) {
        if (headingLevels[i] - headingLevels[i - 1] > 1) {
          findings.push({
            ruleId: 'heading-hierarchy',
            severity: 'LOW',
            description: `Heading hierarchy skips levels: H${headingLevels[i - 1]} to H${headingLevels[i]}`,
            category: 'headings'
          });
          break;
        }
      }
    }
    metrics.headingLevels = Object.keys(rootHeadings).join(', ');

    // Canonical URL
    const canonical = meta['og:url'] || meta['canonical'];
    metrics.hasCanonical = !!canonical;
    if (!canonical) {
      findings.push({ ruleId: 'missing-canonical', severity: 'MEDIUM', description: 'No canonical URL specified', category: 'meta' });
    }

    // Open Graph tags
    const ogTags = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'];
    const missingOg = ogTags.filter(t => !meta[t]);
    metrics.ogTagsPresent = ogTags.length - missingOg.length;
    metrics.ogTagsTotal = ogTags.length;
    if (missingOg.length > 0) {
      findings.push({
        ruleId: 'missing-og-tags',
        severity: 'LOW',
        description: `Missing Open Graph tags: ${missingOg.join(', ')}`,
        category: 'social'
      });
    }

    // Twitter card tags
    const twitterTags = ['twitter:card', 'twitter:title', 'twitter:description'];
    const missingTwitter = twitterTags.filter(t => !meta[t]);
    metrics.twitterTagsPresent = twitterTags.length - missingTwitter.length;
    if (missingTwitter.length > twitterTags.length / 2) {
      findings.push({
        ruleId: 'missing-twitter-tags',
        severity: 'LOW',
        description: 'Most Twitter Card tags are missing',
        category: 'social'
      });
    }

    // ═══════════════════════════════════════
    // MULTI-PAGE IMAGE ANALYSIS
    // ═══════════════════════════════════════
    let totalImages = 0;
    let imagesWithoutAlt = 0;
    for (const page of pagesWithHttpStatus) {
      const pageImages = page.images || [];
      totalImages += pageImages.length;
      imagesWithoutAlt += pageImages.filter(img => !img.alt || img.alt.trim() === '').length;
    }
    // Also count root page images if not in pagesWithHttpStatus
    if (rootPage.images && pagesWithHttpStatus.length === 0) {
      totalImages = rootPage.images.length;
      imagesWithoutAlt = rootPage.images.filter(img => !img.alt || img.alt.trim() === '').length;
    }
    metrics.imagesTotal = totalImages;
    metrics.imagesWithoutAlt = imagesWithoutAlt;
    if (imagesWithoutAlt > 0 && totalImages > 0) {
      const pct = Math.round((imagesWithoutAlt / totalImages) * 100);
      if (pct > 50) {
        findings.push({ ruleId: 'images-no-alt', severity: 'MEDIUM', description: `${imagesWithoutAlt} images (${pct}%) missing alt text across ${pagesWithHttpStatus.length} pages`, category: 'content' });
      } else {
        findings.push({ ruleId: 'images-no-alt', severity: 'LOW', description: `${imagesWithoutAlt} images missing alt text`, category: 'content' });
      }
    }

    // ═══════════════════════════════════════
    // MULTI-PAGE HEADING ANALYSIS
    // ═══════════════════════════════════════
    let pagesMissingH1 = 0;
    for (const page of pagesWithHttpStatus) {
      const pH1s = page.headings?.h1 || [];
      if (pH1s.length === 0) pagesMissingH1++;
    }
    if (pagesMissingH1 > 0 && pagesWithHttpStatus.length > 1) {
      findings.push({
        ruleId: 'pages-missing-h1',
        severity: 'MEDIUM',
        description: `${pagesMissingH1} of ${pagesWithHttpStatus.length} pages missing H1 tag`,
        category: 'headings'
      });
    }
    metrics.pagesMissingH1 = pagesMissingH1;

    // Link analysis — aggregate across all pages
    let totalInternalLinks = 0;
    let totalExternalLinks = 0;
    for (const page of pagesWithHttpStatus) {
      totalInternalLinks += (page.links || []).filter(l => l.isInternal).length;
      totalExternalLinks += (page.links || []).filter(l => !l.isInternal).length;
    }
    metrics.internalLinks = totalInternalLinks || (crawlData.internalLinks?.length || 0);
    metrics.externalLinks = totalExternalLinks || (crawlData.externalLinks?.length || 0);
    if (metrics.internalLinks === 0) {
      findings.push({ ruleId: 'no-internal-links', severity: 'MEDIUM', description: 'No internal links found', category: 'links' });
    }

    // Word count from pages
    const wordCounts = pagesWithHttpStatus.map(p => {
      const headingText = Object.values(p.headings || {}).flat().join(' ');
      const text = (p.title || '') + ' ' + headingText;
      return text.split(/\s+/).length;
    });
    metrics.averageWordCount = wordCounts.length > 0 ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length) : 0;
    metrics.pagesWithContent = wordCounts.filter(w => w > 10).length;

    // Sitemap check
    const hasSitemap = crawlData.stats?.urlsFromSitemap > 0;
    metrics.hasSitemap = hasSitemap;
    if (!hasSitemap) {
      findings.push({ ruleId: 'no-sitemap', severity: 'LOW', description: 'No sitemap link found', category: 'technical' });
    }

    // Robots.txt
    metrics.hasRobotsMeta = !!(meta['robots'] || meta['googlebot']);

    // ═══════════════════════════════════════
    // SCORE CALCULATION
    // ═══════════════════════════════════════
    const criticalCount = findings.filter(f => f.severity === 'HIGH').length;
    const mediumCount = findings.filter(f => f.severity === 'MEDIUM').length;
    const lowCount = findings.filter(f => f.severity === 'LOW').length;

    let score = 100;
    score -= criticalCount * 12;
    score -= mediumCount * 5;
    score -= lowCount * 2;
    score = Math.max(0, Math.min(100, score));

    const evidence = { findings, metrics, crawlData: { url: crawlData.url, title: crawlData.title } };

    const runsDir = join(__dirname, '..', 'runs', runId);
    if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, 'seo.json'), JSON.stringify(evidence, null, 2));

    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'completed',
      score,
      findings: JSON.stringify(findings),
      metrics: JSON.stringify(metrics),
      evidence: JSON.stringify({ summary: `SEO score: ${score}/100 with ${findings.length} issues (analyzed ${pagesWithHttpStatus.length} pages)` }),
      raw_output: JSON.stringify(evidence),
      completed_at: new Date().toISOString(),
      duration_ms: duration
    });

    io?.to(runId).emit('module:complete', { module: 'seo', resultId: result.id, score, duration });
    return { score, findings, metrics };

  } catch (error) {
    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'error',
      score: null,
      error: `SEO check failed: ${error.message}`,
      completed_at: new Date().toISOString(),
      duration_ms: duration
    });
    io?.to(runId).emit('module:error', { module: 'seo', error: error.message });
    return { score: null, status: 'ERROR', error: error.message };
  }
}

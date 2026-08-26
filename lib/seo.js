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

    // Title check
    const title = crawlData.title;
    if (!title) {
      findings.push({ ruleId: 'missing-title', severity: 'HIGH', description: 'Page is missing a title tag', category: 'meta' });
    } else if (title.length < 10) {
      findings.push({ ruleId: 'short-title', severity: 'MEDIUM', description: `Title is too short (${title.length} chars): "${title}"`, category: 'meta' });
    } else if (title.length > 60) {
      findings.push({ ruleId: 'long-title', severity: 'LOW', description: `Title is too long (${title.length} chars) - may be truncated in SERPs`, category: 'meta' });
    }
    metrics.titleLength = title.length;

    // Meta description check
    const description = crawlData.meta['description'] || '';
    if (!description) {
      findings.push({ ruleId: 'missing-description', severity: 'HIGH', description: 'Page is missing meta description', category: 'meta' });
    } else if (description.length < 50) {
      findings.push({ ruleId: 'short-description', severity: 'MEDIUM', description: `Meta description is too short (${description.length} chars)`, category: 'meta' });
    } else if (description.length > 160) {
      findings.push({ ruleId: 'long-description', severity: 'LOW', description: `Meta description is too long (${description.length} chars)`, category: 'meta' });
    }
    metrics.descriptionLength = description.length;

    // Keywords meta (deprecated but still relevant for analysis)
    metrics.hasKeywords = !!crawlData.meta['keywords'];

    // Heading structure
    const h1s = crawlData.headings.h1 || [];
    if (h1s.length === 0) {
      findings.push({ ruleId: 'missing-h1', severity: 'HIGH', description: 'No H1 tag found on page', category: 'headings' });
    } else if (h1s.length > 1) {
      findings.push({ ruleId: 'multiple-h1', severity: 'MEDIUM', description: `Multiple H1 tags found (${h1s.length})`, category: 'headings' });
    }
    metrics.h1Count = h1s.length;

    // Check heading hierarchy
    const headingLevels = Object.keys(crawlData.headings).map(h => parseInt(h.replace('h', '')));
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
    metrics.headingLevels = Object.keys(crawlData.headings).join(', ');

    // Canonical URL
    const canonical = crawlData.meta['og:url'] || crawlData.meta['canonical'];
    metrics.hasCanonical = !!canonical;
    if (!canonical) {
      findings.push({ ruleId: 'missing-canonical', severity: 'MEDIUM', description: 'No canonical URL specified', category: 'meta' });
    }

    // Open Graph tags
    const ogTags = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'];
    const missingOg = ogTags.filter(t => !crawlData.meta[t]);
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
    const missingTwitter = twitterTags.filter(t => !crawlData.meta[t]);
    metrics.twitterTagsPresent = twitterTags.length - missingTwitter.length;
    if (missingTwitter.length > twitterTags.length / 2) {
      findings.push({
        ruleId: 'missing-twitter-tags',
        severity: 'LOW',
        description: 'Most Twitter Card tags are missing',
        category: 'social'
      });
    }

    // Image alt text check
    const imagesWithoutAlt = crawlData.images.filter(img => !img.alt || img.alt.trim() === '');
    metrics.imagesTotal = crawlData.images.length;
    metrics.imagesWithoutAlt = imagesWithoutAlt.length;
    if (imagesWithoutAlt.length > 0 && crawlData.images.length > 0) {
      const pct = Math.round((imagesWithoutAlt.length / crawlData.images.length) * 100);
      if (pct > 50) {
        findings.push({ ruleId: 'images-no-alt', severity: 'MEDIUM', description: `${imagesWithoutAlt.length} images (${pct}%) missing alt text`, category: 'content' });
      } else {
        findings.push({ ruleId: 'images-no-alt', severity: 'LOW', description: `${imagesWithoutAlt.length} images missing alt text`, category: 'content' });
      }
    }

    // Link analysis
    metrics.internalLinks = crawlData.internalLinks?.length || 0;
    metrics.externalLinks = crawlData.externalLinks?.length || 0;
    if (metrics.internalLinks === 0) {
      findings.push({ ruleId: 'no-internal-links', severity: 'MEDIUM', description: 'No internal links found', category: 'links' });
    }

    // Word count from pages
    const wordCounts = crawlData.pages?.map(p => {
      const text = (p.title || '') + ' ' + (p.headings || []).join(' ');
      return text.split(/\s+/).length;
    }) || [];
    metrics.averageWordCount = wordCounts.length > 0 ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length) : 0;

    // Sitemap check
    const hasSitemap = crawlData.links?.some(l => 
      l.href.includes('sitemap') || l.text.toLowerCase().includes('sitemap')
    ) || false;
    metrics.hasSitemap = hasSitemap;
    if (!hasSitemap) {
      findings.push({ ruleId: 'no-sitemap', severity: 'LOW', description: 'No sitemap link found', category: 'technical' });
    }

    // Robots.txt (check if robots-related meta exists)
    metrics.hasRobotsMeta = !!(crawlData.meta['robots'] || crawlData.meta['googlebot']);

    // Content quality indicators
    const contentPages = crawlData.pages?.filter(p => p.status === 'ok') || [];
    metrics.pagesAnalyzed = contentPages.length;

    // Calculate score
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
      evidence: JSON.stringify({ summary: `SEO score: ${score}/100 with ${findings.length} issues` }),
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

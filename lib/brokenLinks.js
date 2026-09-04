import { createModuleResult, updateModuleResult } from './db.js';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { LIMITS } from './browserManager.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function normalizeLinkUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', '_ga', '_gl', 'mc_cid', 'mc_eid'];
    for (const p of trackingParams) url.searchParams.delete(p);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
      url.port = '';
    }
    return url.href;
  } catch (e) {
    return rawUrl;
  }
}

function shouldSkipUrl(url) {
  try {
    const u = new URL(url);
    if (u.pathname.startsWith('/cdn-cgi/')) return true;
    if (url.startsWith('#')) return true;
    if (/^(javascript|mailto|tel|data):/i.test(url)) return true;
    return false;
  } catch (e) {
    return false;
  }
}

async function checkLink(url, timeout) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeout);

    let response;
    try {
      response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'SitePulse/1.0 Link Checker' },
      });
    } catch (headError) {
      clearTimeout(t);
      const controller2 = new AbortController();
      const t2 = setTimeout(() => controller2.abort(), timeout);
      try {
        response = await fetch(url, {
          method: 'GET',
          signal: controller2.signal,
          redirect: 'follow',
          headers: { 'User-Agent': 'SitePulse/1.0 Link Checker' },
        });
        clearTimeout(t2);
      } catch (getError) {
        clearTimeout(t2);
        const status = getError.name === 'AbortError' ? 'TIMEOUT' : 'ERROR';
        return { url, status, finalUrl: url, isBroken: true, isRedirect: false, error: getError.message, method: 'GET' };
      }
    }
    clearTimeout(t);

    const finalUrl = response.url;
    const status = response.status;
    const isRedirect = finalUrl !== url;

    return { url, status, finalUrl, isBroken: status >= 400, isRedirect, error: null, method: 'HEAD' };
  } catch (error) {
    const status = error.name === 'AbortError' ? 'TIMEOUT' : 'ERROR';
    return { url, status, finalUrl: url, isBroken: true, isRedirect: false, error: error.message, method: 'HEAD' };
  }
}

export async function runBrokenLinksCheck(crawlData, runId, io) {
  const result = createModuleResult(runId, 'brokenLinks');
  updateModuleResult(result.id, { status: 'running', started_at: new Date().toISOString() });
  io?.to(runId).emit('module:start', { module: 'brokenLinks', resultId: result.id });

  const startTime = Date.now();

  try {
    const crawledUrls = (crawlData.pages || []).map(p => p.url || p.finalUrl).filter(Boolean);
    const allLinks = crawlData.links || [];
    const internalUrls = allLinks.filter(l => l.isInternal).map(l => l.href);
    const externalUrls = allLinks.filter(l => !l.isInternal).map(l => l.href);

    const seen = new Set();
    const allUniqueUrls = [];
    for (const url of [...crawledUrls, ...internalUrls, ...externalUrls]) {
      const normalized = normalizeLinkUrl(url);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        allUniqueUrls.push({ original: url, normalized });
      }
    }

    const filteredUrls = allUniqueUrls.filter(u => !shouldSkipUrl(u.original));

    const crawledUrlSet = new Set(crawledUrls.map(u => normalizeLinkUrl(u)));
    const targetHostname = (() => { try { return new URL(crawlData.url).hostname; } catch { return ''; } })();
    const priorityBuckets = { high: [], medium: [], low: [] };

    for (const u of filteredUrls) {
      const isCrawled = crawledUrlSet.has(u.normalized);
      try {
        const hostname = new URL(u.normalized).hostname;
        if (hostname === targetHostname) {
          if (isCrawled) priorityBuckets.medium.push(u);
          else priorityBuckets.high.push(u);
        } else {
          priorityBuckets.low.push(u);
        }
      } catch (e) {
        priorityBuckets.medium.push(u);
      }
    }

    const prioritizedUrls = [...priorityBuckets.high, ...priorityBuckets.medium, ...priorityBuckets.low];

    const maxLinks = parseInt(process.env.MAX_LINKS_TO_CHECK || '150');
    const capped = prioritizedUrls.length > maxLinks;
    const linksToCheck = capped ? prioritizedUrls.slice(0, maxLinks) : prioritizedUrls;
    const skippedCount = filteredUrls.length - linksToCheck.length;

    io?.to(runId).emit('module:progress', {
      module: 'brokenLinks',
      message: capped
        ? `Checking ${linksToCheck.length} of ${filteredUrls.length} discovered links (priority-sampled, ${skippedCount} skipped)...`
        : `Checking ${filteredUrls.length} unique links...`,
    });

    const results = [];
    const brokenLinks = [];
    const redirectLinks = [];
    let checked = 0;
    const totalToCheck = linksToCheck.length;

    const batchSize = parseInt(process.env.LINK_CHECK_CONCURRENCY || '25');
    for (let i = 0; i < totalToCheck; i += batchSize) {
      const batch = linksToCheck.slice(i, i + batchSize);

      const promises = batch.map(async (urlEntry) => {
        const linkResult = await checkLink(urlEntry.original, LIMITS.requestTimeout);
        checked++;

        if (linkResult.isBroken) {
          brokenLinks.push({ url: linkResult.url, status: linkResult.status, error: linkResult.error });
        } else if (linkResult.isRedirect) {
          redirectLinks.push({ url: linkResult.url, status: linkResult.status, finalUrl: linkResult.finalUrl });
        }

        return linkResult;
      });

      const batchResults = await Promise.all(promises);
      results.push(...batchResults);

      if (checked % 50 === 0 || checked === totalToCheck) {
        io?.to(runId).emit('module:progress', {
          module: 'brokenLinks',
          message: `Checked ${checked}/${totalToCheck} links (${brokenLinks.length} broken)...`,
        });
      }
    }

    const brokenCount = brokenLinks.length;
    const redirectCount = redirectLinks.length;
    const totalChecked = results.length;

    let score = 100;
    if (totalChecked > 0) {
      const brokenPct = brokenCount / totalChecked;
      const redirectPct = redirectCount / totalChecked;
      score -= brokenPct * 60;
      score -= redirectPct * 5;
      score = Math.max(0, Math.round(score));
    }

    const findings = [
      ...brokenLinks.map(l => ({
        ruleId: 'broken-link',
        title: 'Broken Link',
        severity: (l.status === 'TIMEOUT' || l.status === 'ERROR' || (typeof l.status === 'number' && l.status >= 500)) ? 'HIGH' : 'MEDIUM',
        url: l.url,
        description: `Broken link: ${l.url} (Status: ${l.status}${l.error ? ', ' + l.error : ''})`,
        category: 'Links',
        source: 'link-checker',
      })),
      ...redirectLinks.map(l => ({
        ruleId: 'redirect-link',
        title: 'Redirect',
        severity: 'LOW',
        url: l.url,
        description: `Redirect: ${l.url} → ${l.finalUrl}`,
        category: 'Links',
        source: 'link-checker',
      })),
    ];

    const metrics = {
      totalDiscovered: filteredUrls.length,
      totalChecked,
      sampled: capped,
      brokenCount,
      redirectCount,
      workingCount: totalChecked - brokenCount - redirectCount,
      skippedByLimit: capped ? skippedCount : 0,
      skippedByFilter: allUniqueUrls.length - filteredUrls.length,
      externalLinks: crawlData.externalLinks?.length || 0,
      internalLinks: crawlData.internalLinks?.length || 0,
      coverageNote: capped
        ? `Priority-sampled ${totalChecked} of ${filteredUrls.length} discovered URLs. ${skippedCount} URLs were not checked.`
        : `All ${totalChecked} discovered URLs were checked.`,
    };

    const evidence = { results, brokenLinks, redirectLinks };

    const runsDir = join(__dirname, '..', 'runs', runId);
    if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, 'brokenLinks.json'), JSON.stringify(evidence, null, 2));

    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'completed',
      score,
      findings: JSON.stringify(findings),
      metrics: JSON.stringify(metrics),
      evidence: JSON.stringify({ summary: `${brokenCount} broken, ${redirectCount} redirects out of ${totalChecked} checked` }),
      raw_output: JSON.stringify(evidence),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
    });

    io?.to(runId).emit('module:complete', { module: 'brokenLinks', resultId: result.id, score, duration });
    return { score, findings, metrics };

  } catch (error) {
    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'error', score: null,
      error: `Broken links check failed: ${error.message}`,
      completed_at: new Date().toISOString(), duration_ms: duration,
    });
    io?.to(runId).emit('module:error', { module: 'brokenLinks', error: error.message });
    return { score: null, status: 'ERROR', error: error.message };
  }
}

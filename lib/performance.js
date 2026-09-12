import { createModuleResult, updateModuleResult } from './db.js';
import { mkdirSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { LIMITS } from './browserManager.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Run Lighthouse audit using the Node.js API with chrome-launcher.
 * Returns null if Lighthouse is unavailable or fails.
 */
async function runLighthouse(url, io, runId) {
  let chrome = null;
  let profileDir = null;
  try {
    const lighthouse = (await import('lighthouse/core/index.js')).default;
    const { launch: launchChrome } = await import('chrome-launcher');

    profileDir = mkdtempSync(join(tmpdir(), 'lh-profile-'));

    chrome = await launchChrome({
      chromeFlags: [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-background-networking',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        `--user-data-dir=${profileDir}`,
      ],
      logLevel: 'silent',
      port: 0,
    });

    const lhResult = await lighthouse(url, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance'],
      maxWaitForLoad: 40000,
    });

    if (!lhResult || !lhResult.report) {
      console.error('Lighthouse returned empty result for', url);
      return null;
    }

    const result = JSON.parse(lhResult.report);

    const perfScore = Math.round((result.categories.performance.score || 0) * 100);
    const audits = result.audits || {};

    function parseMs(displayValue) {
      if (!displayValue) return null;
      const match = displayValue.match(/([\d.]+)\s*s/);
      if (match) return Math.round(parseFloat(match[1]) * 1000);
      const msMatch = displayValue.match(/([\d.]+)\s*ms/);
      if (msMatch) return Math.round(parseFloat(msMatch[1]));
      return null;
    }

    const metrics = {
      performanceScore: perfScore,
      fcp: audits['first-contentful-paint']?.displayValue || 'N/A',
      fcpMs: parseMs(audits['first-contentful-paint']?.displayValue),
      lcp: audits['largest-contentful-paint']?.displayValue || 'N/A',
      lcpMs: parseMs(audits['largest-contentful-paint']?.displayValue),
      totalBlockingTime: audits['total-blocking-time']?.displayValue || 'N/A',
      totalBlockingTimeMs: parseMs(audits['total-blocking-time']?.displayValue),
      cls: audits['cumulative-layout-shift']?.displayValue || 'N/A',
      clsValue: audits['cumulative-layout-shift']?.numericValue ?? null,
      speedIndex: audits['speed-index']?.displayValue || 'N/A',
      speedIndexMs: parseMs(audits['speed-index']?.displayValue),
      tti: audits['interactive']?.displayValue || 'N/A',
      ttiMs: parseMs(audits['interactive']?.displayValue),
      ttfb: audits['server-response-time']?.displayValue || 'N/A',
      ttfbMs: audits['server-response-time']?.numericValue ?? null,
      source: 'lighthouse',
      lighthouseVersion: result.lighthouseVersion || 'unknown',
      url,
    };

    const networkSummary = audits['network-requests']?.details?.items;
    if (networkSummary) {
      metrics.requestCount = networkSummary.length;
    }
    const networkBytes = audits['total-byte-weight']?.displayValue;
    if (networkBytes) {
      metrics.totalByteWeight = networkBytes;
    }

    return { score: perfScore, metrics };
  } catch (error) {
    console.error('Lighthouse failed for', url, ':', error.message);
    return null;
  } finally {
    if (chrome) {
      try { await chrome.kill(); } catch (e) { /* Windows cleanup errors are expected */ }
    }
    if (profileDir) {
      try { rmSync(profileDir, { recursive: true, force: true }); } catch (e) { /* cleanup is best-effort */ }
    }
  }
}

/**
 * Fallback: Use Playwright timing to estimate performance.
 * Clearly marked as playwright-fallback.
 */
async function runPlaywrightFallback(url) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: LIMITS.navigationTimeout });

      const perfTimings = await page.evaluate(() => {
        const t = performance.timing;
        const nav = performance.getEntriesByType('navigation')[0];
        return {
          dns: t.domainLookupEnd - t.domainLookupStart,
          connect: t.connectEnd - t.connectStart,
          ttfb: t.responseStart - t.requestStart,
          download: t.responseEnd - t.responseStart,
          domInteractive: t.domInteractive - t.navigationStart,
          domComplete: t.domComplete - t.navigationStart,
          loadEvent: t.loadEventEnd - t.navigationStart,
          transferSize: nav?.transferSize || 0,
          encodedBodySize: nav?.encodedBodySize || 0,
          decodedBodySize: nav?.decodedBodySize || 0,
        };
      });

      const metrics = {
        ...perfTimings,
        source: 'playwright-fallback',
        fcpMs: null,
        lcpMs: null,
        totalBlockingTimeMs: null,
        clsValue: null,
        speedIndexMs: null,
        ttiMs: null,
        ttfbMs: perfTimings.ttfb,
      };

      let score = 100;
      if (perfTimings.ttfb > 600) score -= 15;
      else if (perfTimings.ttfb > 300) score -= 5;
      if (perfTimings.domInteractive > 3000) score -= 20;
      else if (perfTimings.domInteractive > 1500) score -= 10;
      if (perfTimings.loadEvent > 5000) score -= 20;
      else if (perfTimings.loadEvent > 3000) score -= 10;
      if (perfTimings.transferSize > 5000000) score -= 15;
      score = Math.max(0, Math.min(100, score));

      return { score, metrics };
    } finally {
      try { await page.close(); } catch (e) { /* ignore */ }
    }
  } finally {
    await browser.close();
  }
}

/**
 * Main performance check: Lighthouse first, Playwright fallback.
 */
export async function runPerformanceCheck(crawlData, runId, io) {
  const result = createModuleResult(runId, 'performance');
  updateModuleResult(result.id, { status: 'running', started_at: new Date().toISOString() });
  io?.to(runId).emit('module:start', { module: 'performance', resultId: result.id });

  const startTime = Date.now();

  try {
    io?.to(runId).emit('module:progress', { module: 'performance', message: 'Running Lighthouse audit...' });

    // Try Lighthouse on the homepage first
    let score;
    let metrics;

    const lighthouseResult = await runLighthouse(crawlData.url, io, runId);

    if (lighthouseResult) {
      score = lighthouseResult.score;
      metrics = lighthouseResult.metrics;
      console.log(`⚡ Lighthouse score: ${score}/100 (source: lighthouse)`);
    } else {
      // Fallback to Playwright timing
      io?.to(runId).emit('module:progress', { module: 'performance', message: 'Lighthouse unavailable, using Playwright fallback...' });
      const fallbackResult = await runPlaywrightFallback(crawlData.url);
      score = fallbackResult.score;
      metrics = fallbackResult.metrics;
      console.log(`⚡ Fallback score: ${score}/100 (source: playwright-fallback)`);
    }

    // Generate findings based on metrics
    const findings = [];
    if (metrics.ttfbMs && metrics.ttfbMs > 600) {
      findings.push({ severity: 'HIGH', description: `Slow TTFB: ${metrics.ttfb}`, metric: 'TTFB', url: crawlData.url });
    } else if (metrics.ttfbMs && metrics.ttfbMs > 300) {
      findings.push({ severity: 'MEDIUM', description: `Moderate TTFB: ${metrics.ttfb}`, metric: 'TTFB', url: crawlData.url });
    }
    if (metrics.lcpMs && metrics.lcpMs > 2500) {
      findings.push({ severity: 'HIGH', description: `Poor LCP: ${metrics.lcp}`, metric: 'LCP', url: crawlData.url });
    }
    if (metrics.clsValue !== null && metrics.clsValue !== undefined) {
      if (metrics.clsValue > 0.1) {
        findings.push({ severity: 'HIGH', description: `High CLS: ${metrics.cls}`, metric: 'CLS', url: crawlData.url });
      } else if (metrics.clsValue > 0.05) {
        findings.push({ severity: 'MEDIUM', description: `Moderate CLS: ${metrics.cls}`, metric: 'CLS', url: crawlData.url });
      }
    }
    if (metrics.fcpMs && metrics.fcpMs > 3000) {
      findings.push({ severity: 'HIGH', description: `Slow FCP: ${metrics.fcp}`, metric: 'FCP', url: crawlData.url });
    }
    if (metrics.totalBlockingTimeMs && metrics.totalBlockingTimeMs > 300) {
      findings.push({ severity: 'MEDIUM', description: `High TBT: ${metrics.totalBlockingTime}`, metric: 'TBT', url: crawlData.url });
    }

    // Save evidence
    const evidence = { metrics, findings };
    const runsDir = join(__dirname, '..', 'runs', runId);
    if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, 'performance.json'), JSON.stringify(evidence, null, 2));

    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'completed',
      score,
      findings: JSON.stringify(findings),
      metrics: JSON.stringify(metrics),
      evidence: JSON.stringify({ summary: `Performance score: ${score}/100 (${metrics.source})` }),
      raw_output: JSON.stringify(evidence),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
    });

    io?.to(runId).emit('module:complete', { module: 'performance', resultId: result.id, score, duration });
    return { score, findings, metrics };

  } catch (error) {
    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'error',
      score: null,
      error: `Performance check failed: ${error.message}`,
      completed_at: new Date().toISOString(),
      duration_ms: duration,
    });
    io?.to(runId).emit('module:error', { module: 'performance', error: error.message });
    return { score: null, status: 'ERROR', error: error.message };
  }
}

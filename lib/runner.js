import { crawlWebsite } from './crawler.js';
import { runAccessibilityCheck } from './accessibility.js';
import { runPerformanceCheck } from './performance.js';
import { runSecurityCheck } from './security.js';
import { runSEOCheck } from './seo.js';
import { runBrokenLinksCheck } from './brokenLinks.js';
import { runFunctionalTest } from './functional.js';
import { runSSLTlsCheck } from './sslTls.js';
import { calculateOverallScore } from './scorer.js';
import { createRun, updateRun, getRun, getOrCreateWebsite } from './db.js';
import store from './db.js';
import { ScanBrowser, LIMITS } from './browserManager.js';

const activeRuns = new Map();

export function cancelRun(runId) {
  const runState = activeRuns.get(runId);
  if (runState) {
    runState.aborted = true;
    runState.abortController.abort();
    console.log(`🛑 Cancellation requested for run ${runId}`);
    return true;
  }
  return false;
}

export function isRunActive(runId) {
  return activeRuns.has(runId);
}

export function getActiveRuns() {
  return [...activeRuns.keys()];
}

/**
 * Reconcile stale runs on startup — mark any running/crawling runs as errored.
 */
export function reconcileStaleRuns() {
  const activeRunIds = getActiveRuns();
  try {
    const allRuns = store.getAll('runs');
    const staleRuns = allRuns.filter(r => (r.status === 'running' || r.status === 'crawling') && !activeRunIds.includes(r.id));
    for (const run of staleRuns) {
      console.log(`⚠️ Reconciling stale run ${run.id} (was ${run.status}) → error`);
      updateRun(run.id, {
        status: 'error',
        error: 'Run was active when server restarted — marked as failed',
        completed_at: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.error('Reconciliation error:', e.message);
  }
}

export async function executeRun(url, io) {
  const website = getOrCreateWebsite(url);
  const run = createRun(website.id, url);

  const abortController = new AbortController();
  const runState = { abortController, aborted: false, browser: null };
  activeRuns.set(run.id, runState);

  io?.emit('run:create', { runId: run.id, url, status: 'crawling' });

  const scanBrowser = new ScanBrowser();
  runState.browser = scanBrowser;

  try {
    // ═══════════════════════════════════════════════
    // PHASE 1: Crawl (HTTP-based, no Playwright)
    // ═══════════════════════════════════════════════
    io?.to(run.id).emit('run:progress', { phase: 'crawl', message: 'Starting website crawl...' });
    if (runState.aborted) throw new Error('Scan cancelled');

    let crawlData;
    try {
      crawlData = await crawlWebsite(url, run.id, io, scanBrowser);
    } catch (error) {
      if (runState.aborted) { await cancelCleanup(run, runState, scanBrowser, io); return getRun(run.id); }
      updateRun(run.id, { status: 'error', error: `Crawl failed: ${error.message}`, completed_at: new Date().toISOString() });
      io?.emit('run:complete', { runId: run.id, status: 'error', error: error.message });
      return getRun(run.id);
    }

    updateRun(run.id, { status: 'running' });

    // ═══════════════════════════════════════════════
    // PHASE 2: Lightweight HTTP-only modules (parallel)
    // All consume shared crawlData — no re-fetching
    // ═══════════════════════════════════════════════
    if (runState.aborted) throw new Error('Scan cancelled');
    io?.emit('run:progress', { phase: 'lightweight', message: 'Running SEO, Security, SSL/TLS, Broken Links...' });

    await Promise.allSettled([
      runSEOCheck(crawlData, run.id, io),
      runSecurityCheck(crawlData, run.id, io, abortController.signal),
      runSSLTlsCheck(crawlData, run.id, io, abortController.signal),
      runBrokenLinksCheck(crawlData, run.id, io),
    ]);

    // ═══════════════════════════════════════════════
    // PHASE 3: Browser-heavy modules (sequential, shared browser)
    // ═══════════════════════════════════════════════
    if (runState.aborted) throw new Error('Scan cancelled');

    io?.emit('run:progress', { phase: 'functional', message: 'Running functional tests...' });
    await runFunctionalTest(crawlData, run.id, io, scanBrowser).catch(e => {
      if (!runState.aborted) console.error('Functional test error:', e.message);
    });

    if (runState.aborted) throw new Error('Scan cancelled');

    io?.emit('run:progress', { phase: 'accessibility', message: 'Running accessibility checks...' });
    await runAccessibilityCheck(crawlData, run.id, io, scanBrowser).catch(e => {
      if (!runState.aborted) console.error('Accessibility check error:', e.message);
    });

    // ═══════════════════════════════════════════════
    // PHASE 4: Lighthouse (isolated Chrome process)
    // ═══════════════════════════════════════════════
    if (runState.aborted) throw new Error('Scan cancelled');
    io?.emit('run:progress', { phase: 'performance', message: 'Running Lighthouse audit...' });
    await runPerformanceCheck(crawlData, run.id, io).catch(e => {
      if (!runState.aborted) console.error('Performance check error:', e.message);
    });

    // ═══════════════════════════════════════════════
    // PHASE 5: Cleanup + scoring
    // ═══════════════════════════════════════════════
    await scanBrowser.cleanup();

    const updatedRun = getRun(run.id);
    const overallScore = calculateOverallScore(updatedRun.modules);
    const durationMs = updatedRun.modules.reduce((sum, m) => sum + (m.duration_ms || 0), 0);

    updateRun(run.id, {
      status: 'completed',
      overall_score: overallScore,
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
    });

    io?.emit('run:complete', { runId: run.id, status: 'completed', overallScore, duration: durationMs });
    return getRun(run.id);

  } catch (error) {
    if (runState.aborted) { await cancelCleanup(run, runState, scanBrowser, io); return getRun(run.id); }
    await scanBrowser.cleanup();
    updateRun(run.id, { status: 'error', error: error.message, completed_at: new Date().toISOString() });
    io?.emit('run:complete', { runId: run.id, status: 'error', error: error.message });
    return getRun(run.id);
  } finally {
    activeRuns.delete(run.id);
  }
}

async function cancelCleanup(run, runState, scanBrowser, io) {
  try { await scanBrowser.cleanup(); } catch (e) {}
  const updatedRun = getRun(run.id);
  const completedModules = (updatedRun.modules || []).filter(m => m.status === 'completed');
  let partialScore = null;
  if (completedModules.length > 0) partialScore = calculateOverallScore(completedModules);

  updateRun(run.id, {
    status: 'cancelled',
    overall_score: partialScore,
    error: 'Scan was cancelled by user',
    completed_at: new Date().toISOString(),
  });

  io?.emit('run:complete', { runId: run.id, status: 'cancelled', overallScore: partialScore, error: 'Scan was cancelled by user' });
  console.log(`🛑 Run ${run.id} cancelled. ${completedModules.length} modules completed before cancellation.`);
}

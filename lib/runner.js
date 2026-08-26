import { crawlWebsite } from './crawler.js';
import { runAccessibilityCheck } from './accessibility.js';
import { runPerformanceCheck } from './performance.js';
import { runSecurityCheck } from './security.js';
import { runSEOCheck } from './seo.js';
import { runBrokenLinksCheck } from './brokenLinks.js';
import { runFunctionalTest } from './functional.js';
import { calculateOverallScore } from './scorer.js';
import { createRun, updateRun, getRun } from './db.js';

export async function executeRun(url, io) {
  // Get or create website record
  const { getOrCreateWebsite } = await import('./db.js');
  const website = getOrCreateWebsite(url);
  
  // Create run record
  const run = createRun(website.id, url);
  
  io?.emit('run:create', { runId: run.id, url, status: 'crawling' });

  try {
    // Phase 1: Crawl the website (must complete before other modules)
    io?.to(run.id).emit('run:progress', { phase: 'crawl', message: 'Starting website crawl...' });
    
    let crawlData;
    try {
      crawlData = await crawlWebsite(url, run.id, io);
    } catch (error) {
      updateRun(run.id, { 
        status: 'error', 
        error: `Crawl failed: ${error.message}`,
        completed_at: new Date().toISOString()
      });
      io?.emit('run:complete', { runId: run.id, status: 'error', error: error.message });
      return getRun(run.id);
    }

    // Update run status
    updateRun(run.id, { status: 'running' });
    io?.to(run.id).emit('run:progress', { phase: 'validation', message: 'Starting validation modules...' });

    // Phase 2: Run validation modules concurrently
    const modulePromises = [
      runFunctionalTest(crawlData, run.id, io).catch(e => ({ score: null, status: 'ERROR', error: e.message })),
      runAccessibilityCheck(crawlData, run.id, io).catch(e => ({ score: null, status: 'UNAVAILABLE', error: e.message })),
      runPerformanceCheck(crawlData, run.id, io).catch(e => ({ score: null, status: 'UNAVAILABLE', error: e.message })),
      runSecurityCheck(crawlData, run.id, io).catch(e => ({ score: null, status: 'UNAVAILABLE', error: e.message })),
      runSEOCheck(crawlData, run.id, io).catch(e => ({ score: null, status: 'ERROR', error: e.message })),
      runBrokenLinksCheck(crawlData, run.id, io).catch(e => ({ score: null, status: 'ERROR', error: e.message })),
    ];

    await Promise.allSettled(modulePromises);

    // Phase 3: Calculate overall score
    const updatedRun = getRun(run.id);
    const overallScore = calculateOverallScore(updatedRun.modules);
    
    const durationMs = updatedRun.modules.reduce((sum, m) => sum + (m.duration_ms || 0), 0);

    updateRun(run.id, {
      status: 'completed',
      overall_score: overallScore,
      completed_at: new Date().toISOString(),
      duration_ms: durationMs
    });

    io?.emit('run:complete', { 
      runId: run.id, 
      status: 'completed', 
      overallScore,
      duration: durationMs
    });

    return getRun(run.id);

  } catch (error) {
    updateRun(run.id, {
      status: 'error',
      error: error.message,
      completed_at: new Date().toISOString()
    });
    io?.emit('run:complete', { runId: run.id, status: 'error', error: error.message });
    return getRun(run.id);
  }
}

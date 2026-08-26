import { chromium } from 'playwright';
import { createModuleResult, updateModuleResult } from './db.js';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export async function runAccessibilityCheck(crawlData, runId, io) {
  const result = createModuleResult(runId, 'accessibility');
  updateModuleResult(result.id, { status: 'running', started_at: new Date().toISOString() });
  io?.to(runId).emit('module:start', { module: 'accessibility', resultId: result.id });

  const startTime = Date.now();

  try {
    const browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context = await browser.newContext();
    
    const allViolations = [];
    const allPasses = [];
    const allIncomplete = [];
    const pagesChecked = [];

    const AxeBuilder = (await import('@axe-core/playwright')).default;

    // Check main URL and up to 5 internal pages
    const urlsToCheck = [crawlData.url, ...crawlData.internalLinks.slice(0, 5)];

    for (const url of urlsToCheck) {
      try {
        io?.to(runId).emit('module:progress', { 
          module: 'accessibility', 
          message: `Checking accessibility: ${new URL(url).pathname || '/'}` 
        });

        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(1000);

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
          .analyze();

        pagesChecked.push(url);
        allViolations.push(...results.violations.map(v => ({
          ...v,
          checkedUrl: url,
          nodes: v.nodes?.slice(0, 5)
        })));
        allPasses.push(...results.passes.map(p => ({
          id: p.id,
          description: p.description,
          impact: p.impact,
          tags: p.tags
        })));
        allIncomplete.push(...results.incomplete.map(i => ({
          id: i.id,
          description: i.description,
          impact: i.impact,
          tags: i.tags,
          nodes: i.nodes?.slice(0, 3)
        })));

        await page.close();
      } catch (e) {
        // Continue with other pages
      }
    }

    await browser.close();

    // Calculate score
    const violationCount = allViolations.length;
    const criticalCount = allViolations.filter(v => v.impact === 'critical').length;
    const seriousCount = allViolations.filter(v => v.impact === 'serious').length;
    const moderateCount = allViolations.filter(v => v.impact === 'moderate').length;
    const minorCount = allViolations.filter(v => v.impact === 'minor').length;

    let score = 100;
    score -= criticalCount * 15;
    score -= seriousCount * 10;
    score -= moderateCount * 5;
    score -= minorCount * 2;
    score = Math.max(0, Math.min(100, score));

    const findings = allViolations.map(v => ({
      ruleId: v.id,
      description: v.description,
      help: v.help,
      helpUrl: v.helpUrl,
      impact: v.impact,
      severity: v.impact === 'critical' ? 'CRITICAL' : 
                v.impact === 'serious' ? 'HIGH' : 
                v.impact === 'moderate' ? 'MEDIUM' : 'LOW',
      affectedElements: v.nodes?.length || 0,
      checkedUrl: v.checkedUrl,
      tags: v.tags
    }));

    const metrics = {
      totalViolations: violationCount,
      critical: criticalCount,
      serious: seriousCount,
      moderate: moderateCount,
      minor: minorCount,
      totalPasses: allPasses.length,
      incompleteChecks: allIncomplete.length,
      pagesChecked: pagesChecked.length
    };

    const evidence = {
      violations: allViolations,
      passes: allPasses.slice(0, 50),
      incomplete: allIncomplete,
      pagesChecked
    };

    // Save evidence
    const runsDir = join(__dirname, '..', 'runs', runId);
    if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, 'accessibility.json'), JSON.stringify(evidence, null, 2));

    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'completed',
      score,
      findings: JSON.stringify(findings),
      metrics: JSON.stringify(metrics),
      evidence: JSON.stringify({ summary: `${violationCount} violations found across ${pagesChecked.length} pages` }),
      raw_output: JSON.stringify(evidence),
      completed_at: new Date().toISOString(),
      duration_ms: duration
    });

    io?.to(runId).emit('module:complete', { module: 'accessibility', resultId: result.id, score, duration });
    return { score, findings, metrics };

  } catch (error) {
    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'unavailable',
      score: null,
      error: `axe-core unavailable: ${error.message}`,
      completed_at: new Date().toISOString(),
      duration_ms: duration
    });
    io?.to(runId).emit('module:error', { module: 'accessibility', error: error.message });
    return { score: null, status: 'UNAVAILABLE', error: error.message };
  }
}

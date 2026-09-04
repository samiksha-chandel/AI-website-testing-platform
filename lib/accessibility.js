import { createModuleResult, updateModuleResult } from './db.js';
import { mkdirSync, writeFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { LIMITS } from './browserManager.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const IMPACT_TO_SEVERITY = {
  critical: 'CRITICAL',
  serious: 'HIGH',
  moderate: 'MEDIUM',
  minor: 'LOW',
};

const SEVERITY_WEIGHTS = {
  CRITICAL: 20,
  HIGH: 10,
  MEDIUM: 4,
  LOW: 1,
};

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL'];

export async function runAccessibilityCheck(crawlData, runId, io, scanBrowser) {
  const result = createModuleResult(runId, 'accessibility');
  updateModuleResult(result.id, { status: 'running', started_at: new Date().toISOString() });
  io?.to(runId).emit('module:start', { module: 'accessibility', resultId: result.id });

  const startTime = Date.now();
  let ownBrowser = null;

  try {
    let context;
    if (scanBrowser) {
      await scanBrowser.launch();
      context = await scanBrowser.newContext();
    } else {
      const { chromium } = await import('playwright');
      ownBrowser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
      });
      context = await ownBrowser.newContext();
    }

    const allViolations = [];
    const allPasses = [];
    const allIncomplete = [];
    const pagesChecked = [];

    const AxeBuilder = (await import('@axe-core/playwright')).default;

    const maxA11yPages = parseInt(process.env.MAX_A11Y_PAGES || '8');
    const allDeepTestPages = crawlData.deepTestPages || [];
    const rootUrl = crawlData.url;

    const pagesForA11y = [rootUrl];
    for (const url of allDeepTestPages) {
      if (pagesForA11y.length >= maxA11yPages) break;
      if (url && url !== rootUrl && !pagesForA11y.includes(url)) {
        pagesForA11y.push(url);
      }
    }
    const urlsToCheck = pagesForA11y.slice(0, maxA11yPages);

    io?.to(runId).emit('module:progress', {
      module: 'accessibility',
      message: `Checking accessibility on ${urlsToCheck.length} representative pages...`
    });

    for (const url of urlsToCheck) {
      let page;
      try {
        io?.to(runId).emit('module:progress', {
          module: 'accessibility',
          message: `Checking: ${(() => { try { return new URL(url).pathname || '/'; } catch { return url; } })()}`
        });

        page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: LIMITS.navigationTimeout });
        await page.waitForTimeout(500);

        const axeResults = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
          .analyze();

        pagesChecked.push(url);

        for (const v of axeResults.violations) {
          const enrichedViolation = {
            ...v,
            checkedUrl: url,
            nodes: v.nodes?.slice(0, 5),
            _screenshot: null,
          };

          if (v.impact === 'critical' || v.impact === 'serious') {
            try {
              const selector = v.nodes?.[0]?.target?.[0];
              if (selector) {
                const el = await page.$(selector);
                if (el) {
                  const evidenceDir = join(__dirname, '..', 'runs', runId, 'evidence');
                  if (!existsSync(evidenceDir)) mkdirSync(evidenceDir, { recursive: true });
                  const filename = `a11y-${v.id}.png`;
                  try {
                    await el.screenshot({ path: join(evidenceDir, filename) });
                  } catch (e) {
                    await page.screenshot({ path: join(evidenceDir, filename), fullPage: false });
                  }

                  try {
                    const stat = statSync(join(evidenceDir, filename));
                    if (stat.size < 5000) {
                      await page.screenshot({ path: join(evidenceDir, filename), fullPage: true }).catch(() => {});
                    }
                  } catch (e) {}

                  enrichedViolation._screenshot = `evidence/${filename}`;
                }
              }
            } catch (e) {}
          }

          allViolations.push(enrichedViolation);
        }

        allPasses.push(...axeResults.passes.map(p => ({
          id: p.id,
          description: p.description,
          impact: p.impact,
          tags: p.tags
        })));
        allIncomplete.push(...axeResults.incomplete.map(i => ({
          id: i.id,
          description: i.description,
          impact: i.impact,
          tags: i.tags,
          nodes: i.nodes?.slice(0, 3)
        })));
      } catch (e) {
        // Continue with other pages
      } finally {
        if (page) {
          try { await page.close(); } catch (e) {}
        }
      }
    }

    const deduplicatedViolations = [];
    const seenRules = new Set();
    for (const v of allViolations) {
      if (!seenRules.has(v.id)) {
        seenRules.add(v.id);
        deduplicatedViolations.push(v);
      }
    }

    const violationCount = deduplicatedViolations.length;
    const criticalCount = deduplicatedViolations.filter(v => v.impact === 'critical').length;
    const seriousCount = deduplicatedViolations.filter(v => v.impact === 'serious').length;
    const moderateCount = deduplicatedViolations.filter(v => v.impact === 'moderate').length;
    const minorCount = deduplicatedViolations.filter(v => v.impact === 'minor').length;

    const totalChecks = allPasses.length + violationCount;
    let score;
    let weightedImpact = 0;
    if (totalChecks === 0) {
      score = 0;
    } else {
      weightedImpact =
        criticalCount * SEVERITY_WEIGHTS.CRITICAL +
        seriousCount * SEVERITY_WEIGHTS.HIGH +
        moderateCount * SEVERITY_WEIGHTS.MEDIUM +
        minorCount * SEVERITY_WEIGHTS.LOW;

      const maxImpact = totalChecks * SEVERITY_WEIGHTS.CRITICAL;
      const passRatio = allPasses.length / totalChecks;
      const impactRatio = maxImpact > 0 ? weightedImpact / maxImpact : 0;

      score = Math.round((passRatio * 70 + (1 - impactRatio) * 30) * 100) / 100;
      score = Math.max(0, Math.min(100, Math.round(score)));
    }

    const findings = deduplicatedViolations.map(v => ({
      ruleId: v.id,
      title: v.help || v.id,
      description: v.description,
      help: v.help,
      helpUrl: v.helpUrl,
      impact: v.impact,
      severity: IMPACT_TO_SEVERITY[v.impact] || 'LOW',
      affectedElements: v.nodes?.length || 0,
      url: v.checkedUrl,
      tags: v.tags,
      category: 'Accessibility',
      source: 'axe-core',
      screenshot: v._screenshot || null,
    }));

    findings.sort((a, b) => {
      const orderA = SEVERITY_ORDER.indexOf(a.severity);
      const orderB = SEVERITY_ORDER.indexOf(b.severity);
      if (orderA !== orderB) return orderA - orderB;
      return (b.affectedElements || 0) - (a.affectedElements || 0);
    });

    const metrics = {
      totalViolations: violationCount,
      critical: criticalCount,
      serious: seriousCount,
      moderate: moderateCount,
      minor: minorCount,
      totalPasses: allPasses.length,
      incompleteChecks: allIncomplete.length,
      pagesChecked: pagesChecked.length,
      totalPagesAvailable: (crawlData.deepTestPages || []).length + 1,
      totalChecks,
      scoringMethod: 'pass-ratio-weighted',
      scoringBreakdown: {
        passRatio: totalChecks > 0 ? Math.round(allPasses.length / totalChecks * 100) : 0,
        weightedImpact,
      },
    };

    const evidence = {
      violations: deduplicatedViolations.map(v => ({ ...v, _screenshot: undefined })),
      passes: allPasses.slice(0, 50),
      incomplete: allIncomplete,
      pagesChecked
    };

    const runsDir = join(__dirname, '..', 'runs', runId);
    if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, 'accessibility.json'), JSON.stringify(evidence, null, 2));

    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'completed',
      score,
      findings: JSON.stringify(findings),
      metrics: JSON.stringify(metrics),
      evidence: JSON.stringify({
        summary: `${violationCount} violations found across ${pagesChecked.length} pages. ` +
                 `${allPasses.length} rules passed. Score: ${score}/100 (pass-ratio-weighted).`
      }),
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
  } finally {
    if (ownBrowser) {
      try { await ownBrowser.close(); } catch (e) {}
    }
  }
}

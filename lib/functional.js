import { createModuleResult, updateModuleResult } from './db.js';
import { mkdirSync, writeFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { LIMITS } from './browserManager.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const NON_NAVIGABLE_SCHEMES = new Set(['javascript:', 'mailto:', 'tel:', 'data:']);

function classifyUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { navigable: false, reason: 'empty/null url', classifyAs: 'skip' };
  }
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('#')) {
    return { navigable: false, reason: 'anchor-only link', classifyAs: 'anchor' };
  }
  for (const scheme of NON_NAVIGABLE_SCHEMES) {
    if (trimmed.toLowerCase().startsWith(scheme)) {
      return { navigable: false, reason: `${scheme} pseudo-link`, classifyAs: 'interaction' };
    }
  }
  if (/^javascript\s*:/i.test(trimmed)) {
    return { navigable: false, reason: 'javascript pseudo-link', classifyAs: 'interaction' };
  }
  return { navigable: true, reason: 'valid URL', classifyAs: 'navigation' };
}

function generateTestCases(crawlData) {
  const tests = [];
  const baseUrl = crawlData.url;

  // 1. Homepage load test
  tests.push({
    id: 'func-homepage-load',
    name: 'Homepage loads correctly',
    description: 'Verify the homepage loads within reasonable time',
    type: 'navigation',
    url: baseUrl,
    classification: 'navigation',
    steps: [
      { action: 'navigate', target: baseUrl },
      { action: 'assertVisible', target: 'body' }
    ]
  });

  // 2. Navigation link tests — limit to 6 for speed
  if (crawlData.navigation && crawlData.navigation.length > 0) {
    for (const nav of crawlData.navigation.slice(0, 6)) {
      const urlClassification = classifyUrl(nav.href);
      if (urlClassification.classifyAs === 'skip') continue;

      if (urlClassification.classifyAs === 'interaction') {
        tests.push({
          id: `func-nav-${tests.length}`,
          name: `Interaction: ${nav.text.substring(0, 50)}`,
          description: `Verify interactive control "${nav.text}" (${urlClassification.reason})`,
          type: 'interaction',
          url: nav.href,
          classification: 'interaction',
          steps: [
            { action: 'navigate', target: baseUrl },
            { action: 'clickByText', target: nav.text.substring(0, 50) },
            { action: 'assertPageStable' }
          ]
        });
      } else {
        tests.push({
          id: `func-nav-${tests.length}`,
          name: `Navigate to: ${nav.text.substring(0, 50)}`,
          description: `Verify navigation link "${nav.text}" works`,
          type: 'navigation',
          url: nav.href,
          classification: 'navigation',
          steps: [
            { action: 'navigate', target: nav.href },
            { action: 'assertVisible', target: 'body' }
          ]
        });
      }
    }
  }

  // 3. Internal page loads — limit to 4 for speed
  const pagesToTest = crawlData.deepTestPages || (crawlData.pages || []).map(p => p.url);
  for (const pageUrl of pagesToTest.slice(0, 4)) {
    if (pageUrl && classifyUrl(pageUrl).navigable) {
      tests.push({
        id: `func-page-${tests.length}`,
        name: `Page loads: ${(() => { try { return new URL(pageUrl).pathname; } catch { return pageUrl; } })()}`,
        description: `Verify page loads correctly`,
        type: 'navigation',
        url: pageUrl,
        classification: 'navigation',
        steps: [
          { action: 'navigate', target: pageUrl },
          { action: 'assertVisible', target: 'body' },
        ]
      });
    }
  }

  // 4. Image loading test (homepage only)
  tests.push({
    id: 'func-images-load',
    name: 'Images load correctly',
    description: 'Verify images on the page load without errors',
    type: 'resource',
    url: baseUrl,
    classification: 'navigation',
    steps: [
      { action: 'navigate', target: baseUrl },
      { action: 'assertImagesLoaded' }
    ]
  });

  // 5. Console error check
  tests.push({
    id: 'func-console-errors',
    name: 'No JavaScript errors',
    description: 'Verify no critical JavaScript errors on page load',
    type: 'console',
    url: baseUrl,
    classification: 'navigation',
    steps: [
      { action: 'navigate', target: baseUrl },
      { action: 'checkConsoleErrors' }
    ]
  });

  // 6. Responsive check
  tests.push({
    id: 'func-responsive',
    name: 'Responsive layout check',
    description: 'Verify page renders at mobile viewport',
    type: 'responsive',
    url: baseUrl,
    classification: 'navigation',
    steps: [
      { action: 'setViewport', width: 375, height: 812 },
      { action: 'navigate', target: baseUrl },
      { action: 'assertVisible', target: 'body' }
    ]
  });

  return tests;
}

export async function runFunctionalTest(crawlData, runId, io, scanBrowser) {
  const result = createModuleResult(runId, 'functional');
  updateModuleResult(result.id, { status: 'running', started_at: new Date().toISOString() });
  io?.to(runId).emit('module:start', { module: 'functional', resultId: result.id });

  const startTime = Date.now();
  let ownBrowser = null;

  try {
    const testCases = generateTestCases(crawlData);
    io?.to(runId).emit('module:progress', {
      module: 'functional',
      message: `Generated ${testCases.length} test cases, executing...`
    });

    let context;
    if (scanBrowser) {
      await scanBrowser.launch();
      context = await scanBrowser.newContext({
        viewport: { width: 1280, height: 720 }
      });
    } else {
      const { chromium } = await import('playwright');
      ownBrowser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
      });
      context = await ownBrowser.newContext({
        viewport: { width: 1280, height: 720 }
      });
    }

    const testResults = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const screenshots = [];

    // Group tests by URL to reuse pages where possible
    const testsByUrl = new Map();
    for (const test of testCases) {
      const key = test.steps[0]?.target || 'unknown';
      if (!testsByUrl.has(key)) testsByUrl.set(key, []);
      testsByUrl.get(key).push(test);
    }

    for (let i = 0; i < testCases.length; i++) {
      const test = testCases[i];
      io?.to(runId).emit('module:progress', {
        module: 'functional',
        message: `Running test ${i + 1}/${testCases.length}: ${test.name}`
      });

      const page = await context.newPage();
      const consoleErrors = [];
      page.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      page.on('pageerror', err => consoleErrors.push(err.message));

      const testResult = {
        id: test.id,
        name: test.name,
        description: test.description,
        type: test.type,
        status: 'PASSED',
        error: null,
        duration: 0,
        screenshot: null
      };

      const testStart = Date.now();

      try {
        for (const step of test.steps) {
          switch (step.action) {
            case 'navigate':
              await page.goto(step.target, {
                waitUntil: 'domcontentloaded',
                timeout: step.timeout || LIMITS.navigationTimeout
              });
              break;
            case 'assertVisible':
              const el = await page.$(step.target);
              if (!el) throw new Error(`Element not found: ${step.target}`);
              break;
            case 'clickByText': {
              const text = step.target;
              const clicked = await page.evaluate((searchText) => {
                const elements = [...document.querySelectorAll('a, button, [role="button"], [onclick]')];
                const el = elements.find(e => e.textContent?.trim().includes(searchText));
                if (el) { el.click(); return true; }
                return false;
              }, text);
              if (!clicked) throw new Error(`Element with text "${text}" not found for click`);
              await page.waitForTimeout(500);
              break;
            }
            case 'assertPageStable': {
              const stable = await page.evaluate(() => {
                return document.readyState === 'complete' || document.readyState === 'interactive';
              });
              if (!stable) throw new Error('Page became unstable after interaction');
              break;
            }
            case 'assertImagesLoaded':
              const brokenImages = await page.evaluate(() => {
                return [...document.querySelectorAll('img')].filter(img => !img.complete || img.naturalWidth === 0).length;
              });
              if (brokenImages > 0) {
                testResult.status = 'WARNING';
                testResult.error = `${brokenImages} broken images found`;
              }
              break;
            case 'checkConsoleErrors':
              if (consoleErrors.length > 2) {
                testResult.status = 'FAILED';
                testResult.error = `${consoleErrors.length} console errors: ${consoleErrors[0].substring(0, 200)}`;
              }
              break;
            case 'setViewport':
              await page.setViewportSize({ width: step.width, height: step.height });
              break;
          }
        }
      } catch (error) {
        testResult.status = 'FAILED';
        testResult.error = error.message.substring(0, 500);
      }

      // Screenshot only for failures
      if (testResult.status === 'FAILED') {
        try {
          const evidenceDir = join(__dirname, '..', 'runs', runId, 'evidence');
          if (!existsSync(evidenceDir)) mkdirSync(evidenceDir, { recursive: true });
          const filename = `${test.id}.png`;
          await page.waitForTimeout(300).catch(() => {});
          await page.screenshot({ path: join(evidenceDir, filename), fullPage: false });

          try {
            const stat = statSync(join(evidenceDir, filename));
            if (stat.size < 5000) {
              await page.screenshot({ path: join(evidenceDir, filename), fullPage: true }).catch(() => {});
            }
          } catch (e) {}

          testResult.screenshot = filename;
          screenshots.push(filename);
        } catch (e) {}
      }

      testResult.duration = Date.now() - testStart;

      if (testResult.status === 'PASSED') passed++;
      else if (testResult.status === 'FAILED') failed++;
      else if (testResult.status === 'WARNING') passed++;
      else skipped++;

      testResults.push(testResult);

      try { await page.close(); } catch (e) {}
    }

    const screenshotsDir = join(__dirname, '..', 'runs', runId, 'screenshots');
    if (existsSync(screenshotsDir)) {
      writeFileSync(join(screenshotsDir, 'manifest.json'), JSON.stringify(screenshots));
    }

    const totalTests = testResults.length;
    const score = totalTests > 0 ? Math.round((passed / totalTests) * 100) : 0;

    const findings = testResults
      .filter(t => t.status !== 'PASSED')
      .map(t => ({
        ruleId: t.id,
        title: t.name,
        severity: t.status === 'FAILED' ? 'HIGH' : 'MEDIUM',
        description: t.error || `${t.name} - ${t.status}`,
        category: t.type,
        source: 'playwright',
        url: testCases.find(tc => tc.id === t.id)?.url || crawlData.url,
        screenshot: t.screenshot ? `evidence/${t.screenshot}` : null,
      }));

    const metrics = {
      totalTests,
      passed,
      failed,
      skipped,
      warnings: testResults.filter(t => t.status === 'WARNING').length,
      averageDuration: Math.round(testResults.reduce((a, t) => a + t.duration, 0) / totalTests),
      testTypes: [...new Set(testCases.map(t => t.type))]
    };

    const evidence = { testResults, screenshots };

    const runsDir = join(__dirname, '..', 'runs', runId);
    if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, 'functional.json'), JSON.stringify(evidence, null, 2));

    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'completed',
      score,
      findings: JSON.stringify(findings),
      metrics: JSON.stringify(metrics),
      evidence: JSON.stringify({ summary: `${passed}/${totalTests} tests passed` }),
      raw_output: JSON.stringify(evidence),
      completed_at: new Date().toISOString(),
      duration_ms: duration
    });

    io?.to(runId).emit('module:complete', { module: 'functional', resultId: result.id, score, duration });
    return { score, findings, metrics, testResults };

  } catch (error) {
    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'error',
      score: null,
      error: `Functional test failed: ${error.message}`,
      completed_at: new Date().toISOString(),
      duration_ms: duration
    });
    io?.to(runId).emit('module:error', { module: 'functional', error: error.message });
    return { score: null, status: 'ERROR', error: error.message };
  } finally {
    if (ownBrowser) {
      try { await ownBrowser.close(); } catch (e) {}
    }
  }
}

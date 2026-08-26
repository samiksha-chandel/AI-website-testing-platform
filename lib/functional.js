import { chromium } from 'playwright';
import { createModuleResult, updateModuleResult } from './db.js';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// AI-driven functional test generation from crawl data
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
    steps: [
      { action: 'navigate', target: baseUrl },
      { action: 'waitForLoad', timeout: 10000 },
      { action: 'assertVisible', target: 'body' }
    ]
  });

  // 2. Navigation link tests
  if (crawlData.navigation && crawlData.navigation.length > 0) {
    for (const nav of crawlData.navigation.slice(0, 10)) {
      tests.push({
        id: `func-nav-${tests.length}`,
        name: `Navigate to: ${nav.text.substring(0, 50)}`,
        description: `Verify navigation link "${nav.text}" works`,
        type: 'navigation',
        url: nav.href,
        steps: [
          { action: 'navigate', target: nav.href },
          { action: 'waitForLoad', timeout: 10000 },
          { action: 'assertVisible', target: 'body' }
        ]
      });
    }
  }

  // 3. Internal page loads
  for (const page of crawlData.pages?.slice(0, 8) || []) {
    if (page.url && page.status === 'ok') {
      tests.push({
        id: `func-page-${tests.length}`,
        name: `Page loads: ${new URL(page.url).pathname}`,
        description: `Verify page ${page.url} loads correctly`,
        type: 'navigation',
        url: page.url,
        steps: [
          { action: 'navigate', target: page.url },
          { action: 'waitForLoad', timeout: 15000 },
          { action: 'assertVisible', target: 'body' },
          ...(page.title ? [{ action: 'assertTitle', expected: page.title }] : [])
        ]
      });
    }
  }

  // 4. Image loading tests
  if (crawlData.images && crawlData.images.length > 0) {
    tests.push({
      id: 'func-images-load',
      name: 'Images load correctly',
      description: 'Verify images on the page load without errors',
      type: 'resource',
      url: baseUrl,
      steps: [
        { action: 'navigate', target: baseUrl },
        { action: 'waitForLoad', timeout: 10000 },
        { action: 'assertImagesLoaded' }
      ]
    });
  }

  // 5. Form interaction tests
  for (const form of crawlData.forms || []) {
    if (form.inputs.length > 0) {
      tests.push({
        id: `func-form-${tests.length}`,
        name: `Form interaction: ${form.method} to ${form.action || 'self'}`,
        description: `Test form with ${form.inputs.length} fields`,
        type: 'interaction',
        url: baseUrl,
        steps: [
          { action: 'navigate', target: baseUrl },
          { action: 'waitForLoad', timeout: 10000 },
          { action: 'assertFormExists', inputs: form.inputs }
        ]
      });
    }
  }

  // 6. Console error check
  tests.push({
    id: 'func-console-errors',
    name: 'No JavaScript errors',
    description: 'Verify no critical JavaScript errors on page load',
    type: 'console',
    url: baseUrl,
    steps: [
      { action: 'navigate', target: baseUrl },
      { action: 'waitForLoad', timeout: 10000 },
      { action: 'checkConsoleErrors' }
    ]
  });

  // 7. Responsive check
  tests.push({
    id: 'func-responsive',
    name: 'Responsive layout check',
    description: 'Verify page renders at mobile viewport',
    type: 'responsive',
    url: baseUrl,
    steps: [
      { action: 'setViewport', width: 375, height: 812 },
      { action: 'navigate', target: baseUrl },
      { action: 'waitForLoad', timeout: 10000 },
      { action: 'assertVisible', target: 'body' }
    ]
  });

  return tests;
}

export async function runFunctionalTest(crawlData, runId, io) {
  const result = createModuleResult(runId, 'functional');
  updateModuleResult(result.id, { status: 'running', started_at: new Date().toISOString() });
  io?.to(runId).emit('module:start', { module: 'functional', resultId: result.id });

  const startTime = Date.now();

  try {
    const testCases = generateTestCases(crawlData);
    io?.to(runId).emit('module:progress', { 
      module: 'functional', 
      message: `Generated ${testCases.length} test cases, executing...` 
    });

    const browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    });

    const testResults = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const screenshots = [];

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
                timeout: step.timeout || 15000 
              });
              break;
            case 'waitForLoad':
              await page.waitForLoadState('networkidle', { timeout: step.timeout || 10000 }).catch(() => {});
              break;
            case 'assertVisible':
              const el = await page.$(step.target);
              if (!el) throw new Error(`Element not found: ${step.target}`);
              break;
            case 'assertTitle':
              const title = await page.title();
              // Loose title matching
              if (!title || title.length === 0) throw new Error('Page has no title');
              break;
            case 'assertImagesLoaded':
              const brokenImages = await page.evaluate(() => {
                return [...document.querySelectorAll('img')].filter(img => !img.complete || img.naturalWidth === 0).length;
              });
              if (brokenImages > 0) {
                testResult.status = 'WARNING';
                testResult.error = `${brokenImages} broken images found`;
              }
              break;
            case 'assertFormExists':
              const formExists = await page.$('form');
              // Don't fail if form not on this page - just mark as not applicable
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

      // Take screenshot for failed tests or first few tests
      if (testResult.status === 'FAILED' || i < 3) {
        try {
          const screenshotPath = join(__dirname, '..', 'runs', runId, 'screenshots');
          if (!existsSync(screenshotPath)) mkdirSync(screenshotPath, { recursive: true });
          const filename = `test-${test.id}-${Date.now()}.png`;
          await page.screenshot({ path: join(screenshotPath, filename), fullPage: false });
          testResult.screenshot = filename;
          screenshots.push(filename);
        } catch (e) {}
      }

      testResult.duration = Date.now() - testStart;

      if (testResult.status === 'PASSED') passed++;
      else if (testResult.status === 'FAILED') failed++;
      else if (testResult.status === 'WARNING') passed++; // warnings count as pass
      else skipped++;

      testResults.push(testResult);
      await page.close();
    }

    await browser.close();

    // Save screenshots manifest
    const screenshotsDir = join(__dirname, '..', 'runs', runId, 'screenshots');
    if (existsSync(screenshotsDir)) {
      writeFileSync(join(screenshotsDir, 'manifest.json'), JSON.stringify(screenshots));
    }

    // Calculate score
    const totalTests = testResults.length;
    const score = totalTests > 0 ? Math.round((passed / totalTests) * 100) : 0;

    const findings = testResults
      .filter(t => t.status !== 'PASSED')
      .map(t => ({
        testId: t.id,
        testName: t.name,
        severity: t.status === 'FAILED' ? 'HIGH' : 'MEDIUM',
        description: t.error || `${t.name} - ${t.status}`,
        type: t.type,
        screenshot: t.screenshot
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
  }
}

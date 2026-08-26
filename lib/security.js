import { createModuleResult, updateModuleResult } from './db.js';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const SECURITY_HEADERS = [
  { name: 'strict-transport-security', label: 'HSTS', severity: 'HIGH' },
  { name: 'content-security-policy', label: 'CSP', severity: 'HIGH' },
  { name: 'x-content-type-options', label: 'X-Content-Type-Options', severity: 'MEDIUM' },
  { name: 'x-frame-options', label: 'X-Frame-Options', severity: 'MEDIUM' },
  { name: 'x-xss-protection', label: 'X-XSS-Protection', severity: 'LOW' },
  { name: 'referrer-policy', label: 'Referrer-Policy', severity: 'LOW' },
  { name: 'permissions-policy', label: 'Permissions-Policy', severity: 'LOW' },
];

export async function runSecurityCheck(crawlData, runId, io) {
  const result = createModuleResult(runId, 'security');
  updateModuleResult(result.id, { status: 'running', started_at: new Date().toISOString() });
  io?.to(runId).emit('module:start', { module: 'security', resultId: result.id });

  const startTime = Date.now();

  try {
    const browser = await chromium.launch({ 
      headless: true, 
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    io?.to(runId).emit('module:progress', { module: 'security', message: 'Analyzing security headers...' });

    // Check main URL
    const response = await page.goto(crawlData.url, { 
      waitUntil: 'domcontentloaded', 
      timeout: 20000 
    });

    const headers = response?.headers() || {};
    const findings = [];

    // Check security headers
    for (const header of SECURITY_HEADERS) {
      const value = headers[header.name];
      if (!value) {
        findings.push({
          type: 'missing_header',
          header: header.label,
          severity: header.severity,
          description: `Missing ${header.label} header`,
          recommendation: `Add ${header.name} header to improve security`,
          url: crawlData.url
        });
      } else {
        // Validate specific headers
        if (header.name === 'x-content-type-options' && value.toLowerCase() !== 'nosniff') {
          findings.push({
            type: 'weak_header',
            header: header.label,
            severity: 'MEDIUM',
            description: `${header.label} should be 'nosniff', got '${value}'`,
            url: crawlData.url
          });
        }
        if (header.name === 'x-frame-options' && !['DENY', 'SAMEORIGIN'].includes(value.toUpperCase())) {
          findings.push({
            type: 'weak_header',
            header: header.label,
            severity: 'MEDIUM',
            description: `${header.label} has unexpected value: '${value}'`,
            url: crawlData.url
          });
        }
      }
    }

    // Check for mixed content
    io?.to(runId).emit('module:progress', { module: 'security', message: 'Checking for mixed content...' });
    const currentUrl = page.url();
    if (currentUrl.startsWith('https://')) {
      // Check for HTTP resources on HTTPS page
      const httpResources = await page.evaluate(() => {
        const resources = performance.getEntriesByType('resource');
        return resources.filter(r => r.name.startsWith('http://')).map(r => r.name);
      });
      
      if (httpResources.length > 0) {
        findings.push({
          type: 'mixed_content',
          severity: 'HIGH',
          description: `Found ${httpResources.length} HTTP resources on HTTPS page`,
          affectedElements: httpResources.slice(0, 5),
          url: crawlData.url
        });
      }
    } else {
      findings.push({
        type: 'no_https',
        severity: 'HIGH',
        description: 'Website does not use HTTPS',
        recommendation: 'Enable HTTPS for secure communication',
        url: crawlData.url
      });
    }

    // Check for sensitive data in URLs
    const sensitivePatterns = ['password', 'token', 'secret', 'key', 'auth'];
    for (const link of crawlData.links.slice(0, 50)) {
      const urlLower = link.href.toLowerCase();
      for (const pattern of sensitivePatterns) {
        if (urlLower.includes(pattern)) {
          findings.push({
            type: 'sensitive_url',
            severity: 'MEDIUM',
            description: `URL may contain sensitive data: ${link.href.substring(0, 100)}`,
            url: link.href
          });
          break;
        }
      }
    }

    // Check forms for security
    for (const form of crawlData.forms) {
      if (form.method === 'GET' && form.inputs.some(i => i.type === 'password')) {
        findings.push({
          type: 'insecure_form',
          severity: 'HIGH',
          description: 'Password field found in GET form - data will be visible in URL',
          url: crawlData.url
        });
      }
    }

    // Check cookie security
    const cookies = await context.cookies();
    const insecureCookies = cookies.filter(c => !c.secure || !c.httpOnly);
    if (insecureCookies.length > 0) {
      findings.push({
        type: 'insecure_cookies',
        severity: 'MEDIUM',
        description: `${insecureCookies.length} cookie(s) missing Secure or HttpOnly flag`,
        affectedElements: insecureCookies.map(c => c.name),
        url: crawlData.url
      });
    }

    // SSL certificate check
    let sslInfo = { valid: false, expiry: null, issuer: null };
    try {
      const sslResponse = await context.request.head(crawlData.url);
      const sslHeaders = sslResponse.headers();
      sslInfo.valid = true;
    } catch (e) {}

    await browser.close();

    // Calculate score
    const criticalCount = findings.filter(f => f.severity === 'CRITICAL').length;
    const highCount = findings.filter(f => f.severity === 'HIGH').length;
    const mediumCount = findings.filter(f => f.severity === 'MEDIUM').length;
    const lowCount = findings.filter(f => f.severity === 'LOW').length;

    let score = 100;
    score -= criticalCount * 20;
    score -= highCount * 12;
    score -= mediumCount * 5;
    score -= lowCount * 2;
    score = Math.max(0, Math.min(100, score));

    const metrics = {
      headersChecked: SECURITY_HEADERS.length,
      totalFindings: findings.length,
      critical: criticalCount,
      high: highCount,
      medium: mediumCount,
      low: lowCount,
      hasHTTPS: !findings.some(f => f.type === 'no_https'),
      mixedContent: findings.some(f => f.type === 'mixed_content')
    };

    const evidence = { headers, findings, sslInfo };

    const runsDir = join(__dirname, '..', 'runs', runId);
    if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, 'security.json'), JSON.stringify(evidence, null, 2));

    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'completed',
      score,
      findings: JSON.stringify(findings),
      metrics: JSON.stringify(metrics),
      evidence: JSON.stringify({ summary: `${findings.length} security findings` }),
      raw_output: JSON.stringify(evidence),
      completed_at: new Date().toISOString(),
      duration_ms: duration
    });

    io?.to(runId).emit('module:complete', { module: 'security', resultId: result.id, score, duration });
    return { score, findings, metrics };

  } catch (error) {
    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'unavailable',
      score: null,
      error: `Security check failed: ${error.message}`,
      completed_at: new Date().toISOString(),
      duration_ms: duration
    });
    io?.to(runId).emit('module:error', { module: 'security', error: error.message });
    return { score: null, status: 'UNAVAILABLE', error: error.message };
  }
}

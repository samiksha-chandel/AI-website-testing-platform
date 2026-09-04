import { createModuleResult, updateModuleResult } from './db.js';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import { LIMITS } from './browserManager.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Configurable ZAP path
const ZAP_PATH = process.env.ZAP_PATH || '';
const ZAP_PORT = parseInt(process.env.ZAP_PORT || '8090');
const ZAP_TIMEOUT = parseInt(process.env.ZAP_TIMEOUT || '120000');
const ZAP_START_TIMEOUT = parseInt(process.env.ZAP_START_TIMEOUT || '60000');

const SECURITY_HEADERS = [
  { name: 'strict-transport-security', label: 'HSTS', severity: 'HIGH', owaspRef: 'WASC-15' },
  { name: 'content-security-policy', label: 'CSP', severity: 'HIGH', owaspRef: 'WASC-15' },
  { name: 'x-content-type-options', label: 'X-Content-Type-Options', severity: 'MEDIUM', owaspRef: 'WASC-15' },
  { name: 'x-frame-options', label: 'X-Frame-Options', severity: 'MEDIUM', owaspRef: 'WASC-10' },
  { name: 'x-xss-protection', label: 'X-XSS-Protection', severity: 'LOW', owaspRef: 'WASC-15' },
  { name: 'referrer-policy', label: 'Referrer-Policy', severity: 'LOW', owaspRef: 'WASC-15' },
  { name: 'permissions-policy', label: 'Permissions-Policy', severity: 'LOW', owaspRef: 'WASC-15' },
];

/**
 * Kill any existing ZAP process on the configured port.
 */
function killStaleZap() {
  try {
    if (process.platform === 'win32') {
      // Find processes listening on the ZAP port
      const result = execSync(`netstat -ano 2>nul | findstr ":${ZAP_PORT}" | findstr "LISTENING"`, {
        encoding: 'utf-8', timeout: 5000
      }).trim();
      if (result) {
        const lines = result.split('\n').filter(l => l.trim());
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && pid !== '0') {
            try { execSync(`taskkill /F /PID ${pid}`, { timeout: 5000 }); } catch (e) {}
          }
        }
      }
    }
  } catch (e) { /* no stale process */ }
}

/**
 * Detect OWASP ZAP installation.
 */
function detectZap() {
  if (ZAP_PATH) {
    try {
      if (existsSync(ZAP_PATH)) {
        if (existsSync(join(ZAP_PATH, 'zap-2.17.0.jar'))) {
          return { zapDir: ZAP_PATH, jarPath: join(ZAP_PATH, 'zap-2.17.0.jar') };
        }
        if (ZAP_PATH.endsWith('.jar') && existsSync(ZAP_PATH)) {
          return { zapDir: dirname(ZAP_PATH), jarPath: ZAP_PATH };
        }
        if (ZAP_PATH.endsWith('.bat') && existsSync(ZAP_PATH)) {
          const dir = dirname(ZAP_PATH);
          const jar = join(dir, 'zap-2.17.0.jar');
          if (existsSync(jar)) return { zapDir: dir, jarPath: jar };
          return { zapDir: dir, jarPath: ZAP_PATH };
        }
      }
    } catch (e) { /* ignore */ }
  }

  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const autoPaths = [join(homeDir, 'zap')];

  for (const baseDir of autoPaths) {
    try {
      if (!existsSync(baseDir)) continue;
      const entries = readdirSync(baseDir);
      for (const entry of entries) {
        if (entry.startsWith('ZAP_')) {
          const zapDir = join(baseDir, entry);
          const jarPath = join(zapDir, 'zap-2.17.0.jar');
          if (existsSync(jarPath)) return { zapDir, jarPath };
          const batPath = join(zapDir, 'zap.bat');
          if (existsSync(batPath)) return { zapDir, jarPath: batPath };
        }
      }
    } catch (e) { /* ignore */ }
  }

  const commonPaths = [
    'C:/Program Files/OWASP/Zed Attack Proxy',
    'C:/Program Files (x86)/OWASP/Zed Attack Proxy',
  ];

  for (const dir of commonPaths) {
    try {
      if (!existsSync(dir)) continue;
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (entry.startsWith('ZAP_')) {
          const zapDir = join(dir, entry);
          const jarPath = join(zapDir, 'zap-2.17.0.jar');
          if (existsSync(jarPath)) return { zapDir, jarPath };
        }
      }
    } catch (e) { /* ignore */ }
  }

  try {
    const result = execSync('where zap.bat 2>nul || where zap.cmd 2>nul', {
      encoding: 'utf-8', timeout: 3000
    }).trim();
    if (result) {
      const batPath = result.split('\n')[0].trim();
      const zapDir = dirname(batPath);
      const jarPath = join(zapDir, 'zap-2.17.0.jar');
      return { zapDir, jarPath: existsSync(jarPath) ? jarPath : batPath };
    }
  } catch (e) { /* not found */ }

  return null;
}

/**
 * Start ZAP in daemon/headless mode.
 */
function startZapDaemon(zapInfo) {
  return new Promise((resolve, reject) => {
    const { zapDir, jarPath } = zapInfo;
    
    let javaCmd = 'java';
    try {
      const javaHome = process.env.JAVA_HOME || '';
      if (javaHome && existsSync(join(javaHome, 'bin', 'java.exe'))) {
        javaCmd = join(javaHome, 'bin', 'java.exe');
      } else {
        const adoptiumDir = 'C:/Program Files/Eclipse Adoptium';
        if (existsSync(adoptiumDir)) {
          const entries = readdirSync(adoptiumDir);
          for (const entry of entries) {
            if (entry.startsWith('jdk-')) {
              const jdkBin = join(adoptiumDir, entry, 'bin', 'java.exe');
              if (existsSync(jdkBin)) { javaCmd = jdkBin; break; }
            }
          }
        }
      }
    } catch (e) { /* use default 'java' */ }

    const args = [
      '-Xmx512m',
      '-jar', jarPath,
      '-daemon',
      '-port', String(ZAP_PORT),
      '-config', 'api.disablekey=true',
      '-config', 'api.addrs.addr.name=.*',
      '-config', 'api.addrs.addr.regex=true',
      '-silent',
    ];

    console.log(`🔒 Starting ZAP: ${javaCmd}`);
    console.log(`   JAR: ${jarPath}`);

    const proc = spawn(javaCmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      cwd: zapDir,
    });

    let stderrData = '';
    proc.stderr?.on('data', d => { stderrData += d.toString(); });

    let started = false;
    const apiUrl = `http://localhost:${ZAP_PORT}`;
    const startTimeout = setTimeout(() => {
      if (!started) {
        proc.kill('SIGTERM');
        reject(new Error(`ZAP daemon failed to start within ${ZAP_START_TIMEOUT / 1000}s. Stderr: ${stderrData.slice(-300)}`));
      }
    }, ZAP_START_TIMEOUT);

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${apiUrl}/JSON/core/view/version/`);
        if (res.ok) {
          started = true;
          clearTimeout(startTimeout);
          clearInterval(pollInterval);
          const data = await res.json();
          console.log(`🔒 ZAP daemon started — version: ${data.version}`);
          resolve({ process: proc, apiUrl, version: data.version });
        }
      } catch (e) { /* ZAP not ready yet */ }
    }, 1500);

    proc.on('error', (err) => {
      if (!started) {
        clearTimeout(startTimeout);
        clearInterval(pollInterval);
        reject(new Error(`ZAP process error: ${err.message}`));
      }
    });

    proc.on('exit', (code) => {
      if (!started) {
        clearTimeout(startTimeout);
        clearInterval(pollInterval);
        reject(new Error(`ZAP exited with code ${code} before starting. Stderr: ${stderrData.slice(-300)}`));
      }
    });
  });
}

/**
 * Run ZAP passive scan against the target URL.
 */
async function runZapPassiveScan(apiUrl, targetUrl) {
  await fetch(`${apiUrl}/JSON/core/action/accessUrl/?url=${encodeURIComponent(targetUrl)}&followRedirects=true`);

  const scanComplete = await new Promise((resolve) => {
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${apiUrl}/JSON/pscan/view/recordsToScan/`);
        if (res.ok) {
          const data = await res.json();
          if (data.recordsToScan === '0') {
            clearInterval(poll);
            resolve(true);
          }
        }
      } catch (e) { /* continue polling */ }
    }, 500);

    setTimeout(() => { clearInterval(poll); resolve(false); }, ZAP_TIMEOUT);
  });

  if (!scanComplete) {
    console.log('⚠️ ZAP passive scan timed out, proceeding with partial results');
  }

  const alertsListRes = await fetch(`${apiUrl}/JSON/alert/view/alerts/?baseurl=${encodeURIComponent(targetUrl)}&start=0&count=500`);
  const alertsListData = await alertsListRes.json();

  const highAlerts = [];
  const mediumAlerts = [];
  const lowAlerts = [];
  const infoAlerts = [];

  if (alertsListData.alerts) {
    for (const alert of alertsListData.alerts) {
      const normalized = normalizeZapAlert(alert);
      if (normalized.severity === 'HIGH' || normalized.severity === 'CRITICAL') highAlerts.push(normalized);
      else if (normalized.severity === 'MEDIUM') mediumAlerts.push(normalized);
      else if (normalized.severity === 'LOW') lowAlerts.push(normalized);
      else infoAlerts.push(normalized);
    }
  }

  try {
    await fetch(`${apiUrl}/JSON/core/action/newSession/?name=sitepulse-${Date.now()}`);
  } catch (e) { /* ignore */ }

  return {
    scanComplete,
    alerts: [...highAlerts, ...mediumAlerts, ...lowAlerts, ...infoAlerts],
    counts: {
      high: highAlerts.length,
      medium: mediumAlerts.length,
      low: lowAlerts.length,
      informational: infoAlerts.length,
    }
  };
}

function normalizeZapAlert(alert) {
  const riskString = (alert.risk || '').toLowerCase();
  const riskMap = { 'high': 'HIGH', 'medium': 'MEDIUM', 'low': 'LOW', 'informational': 'INFORMATIONAL' };

  return {
    ruleId: alert.pluginId || alert.alertRef || 'zap-unknown',
    alertName: alert.name || alert.alert || 'Unknown alert',
    severity: riskMap[riskString] || 'LOW',
    confidence: alert.confidence || 'Medium',
    description: alert.desc || '',
    solution: alert.solution || '',
    reference: alert.reference || '',
    cweId: alert.cweid || null,
    wascid: alert.wascid || null,
    url: alert.url || '',
    method: alert.method || '',
    evidence: alert.evidence || '',
    instances: alert.instances || [],
    source: 'owasp-zap',
    type: 'zap-alert',
  };
}

/**
 * HTTP header security analysis.
 */
async function performHeaderAnalysis(url) {
  const findings = [];
  let headers = {};
  let isHTTPS = false;
  let httpStatus = 0;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LIMITS.requestTimeout);
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'SitePulse/1.0 Security Scanner', 'Accept': 'text/html' }
    });
    clearTimeout(timeout);
    httpStatus = response.status;
    isHTTPS = response.url.startsWith('https://');
    headers = Object.fromEntries(response.headers.entries());
  } catch (e) {
    isHTTPS = url.startsWith('https://');
  }

  if (!isHTTPS) {
    findings.push({
      type: 'no_https', severity: 'HIGH',
      description: 'Website does not use HTTPS',
      recommendation: 'Enable HTTPS for secure communication',
      url, source: 'header-analysis', ruleId: 'no-https', category: 'Transport Security',
    });
  }

  for (const header of SECURITY_HEADERS) {
    const value = headers[header.name];
    if (!value) {
      findings.push({
        type: 'missing_header', header: header.label, severity: header.severity,
        description: `Missing ${header.label} header`,
        recommendation: `Add ${header.name} header to improve security`,
        url, source: 'header-analysis', ruleId: `missing-${header.label.toLowerCase()}`,
        owaspRef: header.owaspRef, category: 'Security Headers',
      });
    } else {
      if (header.name === 'x-content-type-options' && value.toLowerCase() !== 'nosniff') {
        findings.push({
          type: 'weak_header', header: header.label, severity: 'MEDIUM',
          description: `${header.label} should be 'nosniff', got '${value}'`,
          url, source: 'header-analysis', ruleId: `weak-${header.label.toLowerCase()}`,
          category: 'Security Headers',
        });
      }
      if (header.name === 'x-frame-options' && !['DENY', 'SAMEORIGIN'].includes(value.toUpperCase())) {
        findings.push({
          type: 'weak_header', header: header.label, severity: 'MEDIUM',
          description: `${header.label} has unexpected value: '${value}'`,
          url, source: 'header-analysis', ruleId: `weak-${header.label.toLowerCase()}`,
          category: 'Security Headers',
        });
      }
      if (header.name === 'strict-transport-security') {
        const maxAgeMatch = value.match(/max-age=(\d+)/i);
        if (maxAgeMatch && parseInt(maxAgeMatch[1]) < 31536000) {
          findings.push({
            type: 'weak_header', header: header.label, severity: 'LOW',
            description: `HSTS max-age is ${maxAgeMatch[1]}s — recommended ≥ 31536000s (1 year)`,
            url, source: 'header-analysis', ruleId: 'weak-hsts-maxage', category: 'Transport Security',
          });
        }
      }
    }
  }

  return { findings, headers, isHTTPS, httpStatus };
}

/**
 * Main security check entry point.
 */
export async function runSecurityCheck(crawlData, runId, io, abortSignal) {
  const result = createModuleResult(runId, 'security');
  updateModuleResult(result.id, { status: 'running', started_at: new Date().toISOString() });
  io?.to(runId).emit('module:start', { module: 'security', resultId: result.id });

  const startTime = Date.now();
  let zapProc = null;

  try {
    io?.to(runId).emit('module:progress', { module: 'security', message: 'Analyzing security headers...' });
    const headerResult = await performHeaderAnalysis(crawlData.url);

    if (abortSignal?.aborted) throw new Error('Scan cancelled');

    io?.to(runId).emit('module:progress', { module: 'security', message: 'Checking URL patterns and forms...' });
    const crawlFindings = analyzeCrawlData(crawlData);

    // Kill any stale ZAP processes before starting
    killStaleZap();

    // Try OWASP ZAP
    let zapResult = null;
    const zapInfo = detectZap();

    if (zapInfo) {
      try {
        io?.to(runId).emit('module:progress', { module: 'security', message: 'Starting OWASP ZAP...' });
        const { process: proc, apiUrl, version } = await startZapDaemon(zapInfo);
        zapProc = proc;

        if (abortSignal?.aborted) throw new Error('Scan cancelled');

        io?.to(runId).emit('module:progress', { module: 'security', message: `Running ZAP v${version} passive scan...` });
        zapResult = await runZapPassiveScan(apiUrl, crawlData.url);
        zapResult.version = version;
        console.log(`🔒 ZAP passive scan complete: ${zapResult.alerts.length} alerts (v${version})`);
      } catch (zapError) {
        console.error('❌ ZAP scan failed:', zapError.message);
        io?.to(runId).emit('module:progress', { module: 'security', message: `ZAP failed: ${zapError.message}` });
      }
    } else {
      console.log('⚠️ ZAP not detected on this system');
      io?.to(runId).emit('module:progress', { module: 'security', message: 'ZAP not detected — running header analysis only' });
    }

    // Merge all findings
    const allFindings = [];
    if (zapResult && zapResult.alerts.length > 0) {
      allFindings.push(...zapResult.alerts);
    }
    allFindings.push(...headerResult.findings);
    allFindings.push(...crawlFindings);

    // De-duplicate
    const seen = new Set();
    const dedupedFindings = allFindings.filter(f => {
      const key = `${f.ruleId || f.type}-${f.url || ''}-${f.header || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by severity
    const sevWeight = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFORMATIONAL: 4 };
    dedupedFindings.sort((a, b) => (sevWeight[a.severity] ?? 5) - (sevWeight[b.severity] ?? 5));

    // Score
    const criticalCount = dedupedFindings.filter(f => f.severity === 'CRITICAL').length;
    const highCount = dedupedFindings.filter(f => f.severity === 'HIGH').length;
    const mediumCount = dedupedFindings.filter(f => f.severity === 'MEDIUM').length;
    const lowCount = dedupedFindings.filter(f => f.severity === 'LOW').length;
    const infoCount = dedupedFindings.filter(f => f.severity === 'INFORMATIONAL').length;

    let score = 100;
    score -= criticalCount * 20;
    score -= highCount * 10;
    score -= mediumCount * 4;
    score -= lowCount * 1;
    score = Math.max(0, Math.min(100, score));

    const metrics = {
      source: zapResult ? 'owasp-zap + header-analysis' : 'header-analysis',
      zapAvailable: !!zapInfo,
      zapUsed: !!zapResult,
      zapVersion: zapResult?.version || null,
      zapAlertCount: zapResult ? zapResult.alerts.length : 0,
      headersChecked: SECURITY_HEADERS.length,
      totalFindings: dedupedFindings.length,
      critical: criticalCount,
      high: highCount,
      medium: mediumCount,
      low: lowCount,
      informational: infoCount,
      hasHTTPS: headerResult.isHTTPS,
      httpStatus: headerResult.httpStatus,
    };

    const evidence = {
      headers: headerResult.headers,
      zapAlerts: zapResult?.alerts || [],
      findings: dedupedFindings,
      isHTTPS: headerResult.isHTTPS,
      httpStatus: headerResult.httpStatus,
    };

    const runsDir = join(__dirname, '..', 'runs', runId);
    if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, 'security.json'), JSON.stringify(evidence, null, 2));

    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'completed',
      score,
      findings: JSON.stringify(dedupedFindings),
      metrics: JSON.stringify(metrics),
      evidence: JSON.stringify({
        summary: `${dedupedFindings.length} security findings${zapResult ? ' (ZAP: ' + zapResult.alerts.length + ' alerts)' : ''}`
      }),
      raw_output: JSON.stringify(evidence),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
    });

    io?.to(runId).emit('module:complete', { module: 'security', resultId: result.id, score, duration });
    return { score, findings: dedupedFindings, metrics };

  } catch (error) {
    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'error', score: null,
      error: `Security check failed: ${error.message}`,
      completed_at: new Date().toISOString(), duration_ms: duration,
    });
    io?.to(runId).emit('module:error', { module: 'security', error: error.message });
    return { score: null, status: 'ERROR', error: error.message };
  } finally {
    if (zapProc) {
      try {
        zapProc.kill('SIGTERM');
        setTimeout(() => { try { zapProc.kill('SIGKILL'); } catch (e) {} }, 3000);
      } catch (e) {}
    }
  }
}

function analyzeCrawlData(crawlData) {
  const findings = [];
  const sensitivePatterns = ['password', 'token', 'secret', 'key', 'auth', 'session'];
  for (const link of (crawlData.links || []).slice(0, 100)) {
    const urlLower = link.href.toLowerCase();
    for (const pattern of sensitivePatterns) {
      if (urlLower.includes(pattern)) {
        findings.push({
          type: 'sensitive_url', severity: 'MEDIUM',
          description: `URL may contain sensitive data: ${link.href.substring(0, 100)}`,
          url: link.href, source: 'crawl-analysis', ruleId: 'sensitive-url', category: 'Information Exposure',
        });
        break;
      }
    }
  }

  for (const form of crawlData.forms || []) {
    if (form.method === 'GET' && form.inputs.some(i => i.type === 'password')) {
      findings.push({
        type: 'insecure_form', severity: 'HIGH',
        description: 'Password field found in GET form — data will be visible in URL',
        url: crawlData.url, source: 'crawl-analysis', ruleId: 'insecure-form', category: 'Data Exposure',
      });
    }
  }

  return findings;
}

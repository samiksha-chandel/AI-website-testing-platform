import { createModuleResult, updateModuleResult } from './db.js';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { execFile, execFileSync } from 'child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function findSslyze() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const candidates = [
    join(home, 'AppData', 'Roaming', 'Python', 'Python314', 'Scripts', 'sslyze.exe'),
    join(home, 'AppData', 'Roaming', 'Python', 'Python313', 'Scripts', 'sslyze.exe'),
    join(home, 'AppData', 'Roaming', 'Python', 'Python312', 'Scripts', 'sslyze.exe'),
    '/usr/local/bin/sslyze',
    '/usr/bin/sslyze',
  ];
  for (const p of candidates) {
    try { if (existsSync(p)) return p; } catch (e) {}
  }
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const result = execFileSync(cmd, ['sslyze'], { encoding: 'utf-8', timeout: 3000, shell: true }).trim();
    if (result) return result.split('\n')[0].trim();
  } catch (e) {}
  return null;
}

async function runSslyze(target) {
  const sslyzePath = findSslyze();
  if (!sslyzePath) throw new Error('SSLyze not found on this system. Install with: pip install sslyze');
  
  return new Promise((resolve, reject) => {
    const proc = execFile(sslyzePath, [
      '--json_out', '-', '--certinfo', '--reneg', '--compression',
      '--heartbleed', '--tlsv1_3', '--tlsv1_2', '--tlsv1_1', '--tlsv1', '--sslv3',
      target,
    ], { timeout: 90000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(err);
      try { resolve(JSON.parse(stdout)); }
      catch (e) { reject(new Error(`Failed to parse SSLyze output: ${e.message}`)); }
    });
  });
}

/**
 * Normalize SSLyze 6.x JSON output into unified findings.
 * SSLyze 6.x uses: server_scan_results[].scan_result.{plugin_name}.result
 * SSLyze 5.x used: results.{host}.scan_commands_results.{plugin_name}
 */
function normalizeSslyzeResults(sslyzeData, targetUrl) {
  const findings = [];
  const hostname = new URL(targetUrl).hostname;
  
  // SSLyze 6.x: server_scan_results is an array
  // SSLyze 5.x: results is an object keyed by host
  const serverResults = sslyzeData.server_scan_results || [];
  const legacyResults = sslyzeData.results || {};
  
  // Normalize both formats into a single processing loop
  const scanEntries = [];
  
  for (const sr of serverResults) {
    const info = sr.server_scan_info || {};
    const scanResult = sr.scan_result || {};
    const connectivity = sr.connectivity_result || {};
    scanEntries.push({
      hostname: info.hostname || hostname,
      port: info.port || 443,
      connectivity,
      // SSLyze 6.x: scan_result.{plugin}.result
      getCommand: (name) => {
        const entry = scanResult[name];
        if (entry?.result) return entry.result;
        return null;
      },
      getCommandStatus: (name) => scanResult[name]?.status || 'NOT_SCHEDULED',
    });
  }
  
  // Fallback for SSLyze 5.x format
  for (const [key, sr] of Object.entries(legacyResults)) {
    if (sr?.scan_commands_results) {
      const cmds = sr.scan_commands_results;
      scanEntries.push({
        hostname: hostname,
        port: 443,
        connectivity: {},
        getCommand: (name) => {
          // Map SSLyze 6.x names to 5.x names
          const nameMap = {
            'session_renegotiation': 'renegotiation',
            'tls_compression': 'compression',
            'heartbleed': 'heartbleed',
            'tls_1_0_cipher_suites': 'tls_1_0',
            'tls_1_1_cipher_suites': 'tls_1_1',
            'tls_1_2_cipher_suites': 'tls_1_2',
            'tls_1_3_cipher_suites': 'tls_1_3',
          };
          const mapped = nameMap[name] || name;
          // 5.x has results directly
          const cmd = cmds[mapped];
          if (cmd?.result) return cmd.result;
          if (cmd?.certificate_deployments) return cmd;
          return cmd || null;
        },
        getCommandStatus: (name) => {
          const nameMap = {
            'session_renegotiation': 'renegotiation',
            'tls_compression': 'compression',
          };
          const mapped = nameMap[name] || name;
          return cmds[mapped]?.status || 'NOT_SCHEDULED';
        },
      });
    }
  }

  for (const scan of scanEntries) {
    // ─── Certificate Info ───
    const certInfo = scan.getCommand('certificate_info');
    if (certInfo?.certificate_deployments) {
      for (const deployment of certInfo.certificate_deployments) {
        const leafCert = deployment.leaf_certificate;
        
        // Certificate expiry
        if (leafCert?.not_after) {
          const expiryDate = new Date(leafCert.not_after);
          const daysUntil = Math.floor((expiryDate - new Date()) / 86400000);
          if (daysUntil < 0) {
            findings.push({
              ruleId: 'ssl-cert-expired', severity: 'CRITICAL',
              title: 'SSL Certificate Expired',
              description: `Certificate expired ${Math.abs(daysUntil)} days ago`,
              url: targetUrl, evidence: `Not After: ${leafCert.not_after}`,
              category: 'SSL/TLS', source: 'sslyze',
              recommendation: 'Renew the SSL certificate immediately.',
            });
          } else if (daysUntil < 30) {
            findings.push({
              ruleId: 'ssl-cert-expiring', severity: 'HIGH',
              title: 'SSL Certificate Expiring Soon',
              description: `Certificate expires in ${daysUntil} days`,
              url: targetUrl, evidence: `Not After: ${leafCert.not_after}`,
              category: 'SSL/TLS', source: 'sslyze',
              recommendation: 'Renew the SSL certificate before expiration.',
            });
          }
        }

        // Hostname mismatch
        const sans = leafCert?.subject_alternative_names || [];
        const match = sans.some(san => {
          if (san.startsWith('*.')) return hostname.endsWith(san.substring(2));
          return san === hostname;
        });
        if (!match && sans.length > 0) {
          findings.push({
            ruleId: 'ssl-cert-hostname-mismatch', severity: 'CRITICAL',
            title: 'SSL Certificate Hostname Mismatch',
            description: `Certificate SANs don't match ${hostname}: ${sans.join(', ')}`,
            url: targetUrl, category: 'SSL/TLS', source: 'sslyze',
            recommendation: 'Ensure the certificate covers the target hostname.',
          });
        }

        // Chain errors
        const chainErrors = deployment.pathsVerificationRuntimeErrors || [];
        if (chainErrors.length > 0) {
          findings.push({
            ruleId: 'ssl-cert-chain-error', severity: 'HIGH',
            title: 'SSL Certificate Chain Error',
            description: `Chain verification failed: ${chainErrors.join(', ')}`,
            url: targetUrl, category: 'SSL/TLS', source: 'sslyze',
            recommendation: 'Fix the certificate chain configuration.',
          });
        }
      }
    }

    // ─── Insecure TLS versions ───
    // SSLyze 6.x: tls_1_1_cipher_suites, etc.
    // Check is_tls_version_supported
    const insecureVersions = {
      'tls_1_1_cipher_suites': 'TLS 1.1',
      'tls_1_0_cipher_suites': 'TLS 1.0',
      'ssl_3_0_cipher_suites': 'SSL 3.0',
      'ssl_2_0_cipher_suites': 'SSL 2.0',
    };
    for (const [key, name] of Object.entries(insecureVersions)) {
      const result = scan.getCommand(key);
      if (result?.is_tls_version_supported === true) {
        findings.push({
          ruleId: `ssl-insecure-${key.replace(/_cipher_suites$/, '')}`, severity: 'HIGH',
          title: `Insecure ${name} Supported`,
          description: `Server supports ${name} — known vulnerabilities`,
          url: targetUrl, category: 'SSL/TLS', source: 'sslyze',
          recommendation: `Disable ${name}. Use TLS 1.2+.`,
        });
      }
    }

    // ─── Secure Renegotiation ───
    const reneg = scan.getCommand('session_renegotiation');
    if (reneg?.supports_secure_renegotiation === false) {
      findings.push({
        ruleId: 'ssl-insecure-renegotiation', severity: 'HIGH',
        title: 'Insecure TLS Renegotiation',
        description: 'Server does not support secure renegotiation',
        url: targetUrl, category: 'SSL/TLS', source: 'sslyze',
        recommendation: 'Enable secure renegotiation.',
      });
    }

    // ─── TLS Compression ───
    const compression = scan.getCommand('tls_compression');
    if (compression?.supports_compression === true) {
      findings.push({
        ruleId: 'ssl-compression', severity: 'HIGH',
        title: 'TLS Compression Enabled (CRIME)',
        description: 'TLS compression vulnerable to CRIME attack',
        url: targetUrl, category: 'SSL/TLS', source: 'sslyze',
        recommendation: 'Disable TLS compression.',
      });
    }

    // ─── Heartbleed ───
    const heartbleed = scan.getCommand('heartbleed');
    if (heartbleed?.is_vulnerable_to_heartbleed === true) {
      findings.push({
        ruleId: 'ssl-heartbleed', severity: 'CRITICAL',
        title: 'Heartbleed Vulnerability (CVE-2014-0160)',
        description: 'Server is vulnerable to Heartbleed',
        url: targetUrl, category: 'SSL/TLS', source: 'sslyze',
        recommendation: 'Patch OpenSSL immediately.',
      });
    }

    // ─── Weak Cipher Suites (scan TLS 1.2 for weak ciphers) ───
    const tls12 = scan.getCommand('tls_1_2_cipher_suites');
    if (tls12?.accepted_cipher_suites) {
      const weakCiphers = tls12.accepted_cipher_suites.filter(c =>
        c.name?.includes('RC4') || c.name?.includes('DES') ||
        c.name?.includes('NULL') || c.name?.includes('EXPORT')
      );
      if (weakCiphers.length > 0) {
        findings.push({
          ruleId: 'ssl-weak-ciphers', severity: 'MEDIUM',
          title: 'Weak Cipher Suites',
          description: `${weakCiphers.length} weak cipher(s): ${weakCiphers.map(c => c.name).join(', ')}`,
          url: targetUrl, category: 'SSL/TLS', source: 'sslyze',
          recommendation: 'Remove weak cipher suites.',
        });
      }
    }
    
    // ─── Connectivity info ───
    if (scan.connectivity?.highest_tls_version_supported) {
      // Good info — not a finding, but useful for the metrics
    }
  }
  
  return findings;
}

export async function runSSLTlsCheck(crawlData, runId, io, abortSignal) {
  const result = createModuleResult(runId, 'sslTls');
  updateModuleResult(result.id, { status: 'running', started_at: new Date().toISOString() });
  io?.to(runId).emit('module:start', { module: 'sslTls', resultId: result.id });
  
  const startTime = Date.now();
  
  try {
    const targetUrl = crawlData.url;
    io?.to(runId).emit('module:progress', { module: 'sslTls', message: 'Running SSLyze SSL/TLS analysis...' });
    
    let findings = [];
    let sslyzeAvailable = false;
    let sslyzeVersion = null;
    
    try {
      const hostname = new URL(targetUrl).hostname;
      // Check for cancellation before starting SSLyze
      if (abortSignal?.aborted) throw new Error('Scan cancelled');
      const sslyzeData = await runSslyze(`${hostname}:443`);
      sslyzeAvailable = true;
      sslyzeVersion = sslyzeData.__version || sslyzeData.version || 'detected';
      findings = normalizeSslyzeResults(sslyzeData, targetUrl);
      
      console.log(`🔐 SSLyze completed: ${findings.length} findings (v${sslyzeVersion})`);
      
      const runsDir = join(__dirname, '..', 'runs', runId);
      if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });
      writeFileSync(join(runsDir, 'sslTls.json'), JSON.stringify({ findings, sslyzeData }, null, 2));
    } catch (e) {
      console.error('SSLyze scan failed:', e.message);
      io?.to(runId).emit('module:progress', { module: 'sslTls', message: `SSLyze unavailable: ${e.message}` });
    }
    
    const criticalCount = findings.filter(f => f.severity === 'CRITICAL').length;
    const highCount = findings.filter(f => f.severity === 'HIGH').length;
    const mediumCount = findings.filter(f => f.severity === 'MEDIUM').length;
    const lowCount = findings.filter(f => f.severity === 'LOW').length;
    
    let score = 100;
    score -= criticalCount * 25;
    score -= highCount * 12;
    score -= mediumCount * 5;
    score -= lowCount * 1;
    score = Math.max(0, Math.min(100, score));
    
    const metrics = {
      source: sslyzeAvailable ? 'sslyze' : 'unavailable',
      sslyzeAvailable,
      sslyzeVersion: sslyzeVersion || null,
      totalFindings: findings.length,
      critical: criticalCount,
      high: highCount,
      medium: mediumCount,
      low: lowCount,
    };
    
    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: sslyzeAvailable ? 'completed' : 'unavailable',
      score: sslyzeAvailable ? score : null,
      findings: JSON.stringify(findings),
      metrics: JSON.stringify(metrics),
      evidence: JSON.stringify({ summary: sslyzeAvailable ? `${findings.length} SSL/TLS findings (SSLyze v${sslyzeVersion})` : 'SSLyze unavailable' }),
      raw_output: JSON.stringify({ findings, sslyzeAvailable, sslyzeVersion }),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
    });
    
    io?.to(runId).emit('module:complete', { module: 'sslTls', resultId: result.id, score, duration });
    return { score, findings, metrics };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    updateModuleResult(result.id, { status: 'error', score: null, error: `SSL/TLS check failed: ${error.message}`, completed_at: new Date().toISOString(), duration_ms: duration });
    io?.to(runId).emit('module:error', { module: 'sslTls', error: error.message });
    return { score: null, status: 'ERROR', error: error.message };
  }
}

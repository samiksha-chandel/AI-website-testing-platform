import { getRun } from './db.js';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function getScoreBadge(score) {
  if (score === null || score === undefined) return '<span class="badge gray">N/A</span>';
  if (score >= 90) return `<span class="badge green">${score}</span>`;
  if (score >= 70) return `<span class="badge yellow">${score}</span>`;
  return `<span class="badge red">${score}</span>`;
}

function getStatusBadge(status) {
  const cls = status?.toLowerCase() || 'unknown';
  return `<span class="badge ${cls}">${status}</span>`;
}

function renderFindings(findings, runId, evidenceDir) {
  if (!findings || findings.length === 0) return '<p class="empty">No findings</p>';
  
  return `<div class="findings-list">
    ${findings.map(f => {
      let screenshotHtml = '';
      if (f.screenshot) {
        // Try to embed screenshot as data URL for standalone report
        let imgSrc = `/api/runs/${runId}/screenshots/${f.screenshot.replace('evidence/', '')}`;
        if (evidenceDir) {
          try {
            const filePath = join(evidenceDir, f.screenshot.replace('evidence/', ''));
            if (existsSync(filePath)) {
              const buf = readFileSync(filePath);
              imgSrc = `data:image/png;base64,${buf.toString('base64')}`;
            }
          } catch (e) { /* fall back to API URL */ }
        }
        screenshotHtml = `<div style="margin-top: 8px;"><img src="${imgSrc}" style="max-height: 200px; border-radius: 6px; border: 1px solid #e2e8f0;" onerror="this.style.display='none'" /></div>`;
      }
      return `
      <div class="finding-item" style="padding: 12px; margin-bottom: 8px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
          <span class="severity ${f.severity?.toLowerCase()}">${f.severity || 'N/A'}</span>
          ${f.ruleId ? `<code style="font-size: 11px; color: #94a3b8;">${f.ruleId}</code>` : ''}
          ${f.source ? `<span style="font-size: 10px; color: #94a3b8;">via ${f.source}</span>` : ''}
        </div>
        <p style="font-size: 13px; color: #334155; margin: 4px 0;">${f.description || f.help || f.testName || f.alertName || '-'}</p>
        ${f.recommendation ? `<p style="font-size: 12px; color: #64748b; margin-top: 4px;">💡 ${f.recommendation}</p>` : ''}
        ${f.url ? `<p style="font-size: 11px; color: #94a3b8; font-family: monospace; margin-top: 4px; word-break: break-all;">${f.url}</p>` : ''}
        ${screenshotHtml}
      </div>
    `;
    }).join('')}
  </div>`;
}

function renderModuleSection(moduleResult, moduleName, runId, evidenceDir) {
  let findings = [];
  let metrics = {};
  
  try { findings = JSON.parse(moduleResult.findings || '[]'); } catch (e) {}
  try { metrics = JSON.parse(moduleResult.metrics || '{}'); } catch (e) {}

  const metricsHtml = Object.entries(metrics).map(([key, value]) => 
    `<div class="metric"><span class="metric-label">${key}</span><span class="metric-value">${value}</span></div>`
  ).join('');

  return `
    <div class="module-section">
      <div class="module-header">
        <h3>${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}</h3>
        <div class="module-meta">
          ${getStatusBadge(moduleResult.status)}
          ${getScoreBadge(moduleResult.score)}
          <span class="duration">${moduleResult.duration_ms ? (moduleResult.duration_ms / 1000).toFixed(1) + 's' : '-'}</span>
        </div>
      </div>
      ${moduleResult.error ? `<div class="error-box">${moduleResult.error}</div>` : ''}
      ${metricsHtml ? `<div class="metrics-grid">${metricsHtml}</div>` : ''}
      ${renderFindings(findings, runId, evidenceDir)}
    </div>`;
}

export function buildReportContext(runId) {
  const run = getRun(runId);
  if (!run) throw new Error('Run not found');

  let crawlData = {};
  try { crawlData = JSON.parse(run.crawl_data || '{}'); } catch (e) {}
  
  const modules = run.modules || [];
  const moduleOrder = ['functional', 'accessibility', 'performance', 'security', 'sslTls', 'seo', 'brokenLinks'];
  
  // Count findings by severity
  let allFindings = [];
  for (const mod of modules) {
    try {
      const f = JSON.parse(mod.findings || '[]');
      allFindings.push(...f.map(find => ({ ...find, module: mod.module_name })));
    } catch (e) {}
  }

  const severityCounts = {
    critical: allFindings.filter(f => f.severity === 'CRITICAL').length,
    high: allFindings.filter(f => f.severity === 'HIGH').length,
    medium: allFindings.filter(f => f.severity === 'MEDIUM').length,
    low: allFindings.filter(f => f.severity === 'LOW').length,
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SitePulse Report — ${crawlData.url || run.target_url}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; background: #f8fafc; line-height: 1.6; }
    .container { max-width: 1000px; margin: 0 auto; padding: 40px 24px; }
    .header { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: white; padding: 48px 40px; border-radius: 16px; margin-bottom: 32px; }
    .header h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    .header .subtitle { color: #94a3b8; font-size: 14px; }
    .header .meta { display: flex; gap: 24px; margin-top: 16px; color: #cbd5e1; font-size: 13px; }
    .score-hero { text-align: center; padding: 40px; background: white; border-radius: 16px; margin-bottom: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .score-hero .score { font-size: 72px; font-weight: 800; }
    .score-hero .label { color: #64748b; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
    .score-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 32px; }
    .score-card { background: white; padding: 24px; border-radius: 12px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .score-card .name { font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
    .score-card .value { font-size: 36px; font-weight: 700; margin: 8px 0; }
    .section { background: white; border-radius: 12px; padding: 32px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .section h2 { font-size: 20px; font-weight: 600; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; }
    .module-section { padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 16px; }
    .module-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .module-header h3 { font-size: 16px; font-weight: 600; }
    .module-meta { display: flex; gap: 12px; align-items: center; }
    .badge { padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .badge.green { background: #dcfce7; color: #166534; }
    .badge.yellow { background: #fef9c3; color: #854d0e; }
    .badge.red { background: #fee2e2; color: #991b1b; }
    .badge.gray { background: #f1f5f9; color: #64748b; }
    .badge.completed { background: #dcfce7; color: #166534; }
    .badge.error { background: #fee2e2; color: #991b1b; }
    .badge.unavailable { background: #f1f5f9; color: #64748b; }
    .badge.running { background: #dbeafe; color: #1e40af; }
    .badge.queued { background: #f1f5f9; color: #64748b; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .metric { padding: 12px; background: #f8fafc; border-radius: 8px; }
    .metric-label { display: block; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
    .metric-value { display: block; font-size: 16px; font-weight: 600; color: #1e293b; }
    .findings-table table { width: 100%; border-collapse: collapse; }
    .findings-table th { text-align: left; padding: 10px 12px; font-size: 12px; color: #64748b; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; }
    .findings-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
    .severity { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .severity.critical { background: #fecaca; color: #991b1b; }
    .severity.high { background: #fed7aa; color: #9a3412; }
    .severity.medium { background: #fef08a; color: #854d0e; }
    .severity.low { background: #e2e8f0; color: #475569; }
    .error-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 16px; color: #991b1b; font-size: 13px; margin-bottom: 16px; }
    .empty { color: #94a3b8; font-size: 13px; font-style: italic; }
    .duration { color: #94a3b8; font-size: 12px; }
    .severity-summary { display: flex; gap: 16px; margin-bottom: 24px; }
    .severity-item { display: flex; align-items: center; gap: 8px; font-size: 14px; }
    .severity-dot { width: 10px; height: 10px; border-radius: 50%; }
    .severity-dot.critical { background: #ef4444; }
    .severity-dot.high { background: #f97316; }
    .severity-dot.medium { background: #eab308; }
    .severity-dot.low { background: #94a3b8; }
    .footer { text-align: center; color: #94a3b8; font-size: 12px; padding: 32px 0; }
    @media print { .container { padding: 20px; } body { background: white; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>SitePulse — Website Audit Report</h1>
      <div class="subtitle">Comprehensive website quality and security analysis</div>
      <div class="meta">
        <span>🔗 ${run.target_url}</span>
        <span>📅 ${new Date(run.started_at).toLocaleString()}</span>
        <span>⏱️ ${run.duration_ms ? (run.duration_ms / 1000).toFixed(1) + 's total' : 'N/A'}</span>
      </div>
    </div>

    <div class="score-hero">
      <div class="label">Overall Score</div>
      <div class="score" style="color: ${run.overall_score >= 80 ? '#22c55e' : run.overall_score >= 60 ? '#eab308' : '#ef4444'}">
        ${run.overall_score || 'N/A'}
      </div>
    </div>

    <div class="score-grid">
      ${modules.map(m => `
        <div class="score-card">
          <div class="name">${m.module_name}</div>
          <div class="value" style="color: ${m.score >= 80 ? '#22c55e' : m.score >= 60 ? '#eab308' : m.score !== null ? '#ef4444' : '#94a3b8'}">
            ${m.score !== null ? m.score : 'N/A'}
          </div>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <h2>Findings Summary</h2>
      <div class="severity-summary">
        ${severityCounts.critical > 0 ? `<div class="severity-item"><div class="severity-dot critical"></div> Critical: ${severityCounts.critical}</div>` : ''}
        ${severityCounts.high > 0 ? `<div class="severity-item"><div class="severity-dot high"></div> High: ${severityCounts.high}</div>` : ''}
        ${severityCounts.medium > 0 ? `<div class="severity-item"><div class="severity-dot medium"></div> Medium: ${severityCounts.medium}</div>` : ''}
        ${severityCounts.low > 0 ? `<div class="severity-item"><div class="severity-dot low"></div> Low: ${severityCounts.low}</div>` : ''}
      </div>
    </div>

    ${moduleOrder.map(name => {
      const mod = modules.find(m => m.module_name === name);
      return mod ? renderModuleSection(mod, name, runId, join(__dirname, '..', 'runs', runId, 'evidence')) : '';
    }).join('')}

    <div class="section">
      <h2>Recommendations</h2>
      <ul style="padding-left: 20px;">
        ${allFindings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').slice(0, 10).map(f => 
          `<li style="margin-bottom: 8px;"><strong>${f.severity}:</strong> ${f.description || f.help || ''}</li>`
        ).join('')}
        ${allFindings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').length === 0 ? 
          '<li>No critical issues found. Great job! 🎉</li>' : ''}
      </ul>
    </div>

    <div class="footer">
      Generated by SitePulse — AI-Powered Website Testing Platform<br>
      Report generated: ${new Date().toLocaleString()}
    </div>
  </div>
</body>
</html>`;

  // Save report
  const runsDir = join(__dirname, '..', 'runs', runId);
  if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });
  const reportPath = join(runsDir, 'report.html');
  writeFileSync(reportPath, html);

  return { html, reportPath, context: { run, modules, allFindings, severityCounts, crawlData, moduleOrder } };
}

/**
 * Generate and save the standard HTML report for a run.
 * Returns { html, reportPath }.
 */
export function generateHTMLReport(runId) {
  const { html, reportPath } = buildReportContext(runId);
  return { html, reportPath };
}

/**
 * Insert AI explanations into the existing HTML report without modifying the original finding cards.
 * Returns the full AI-enhanced HTML string.
 */
export function injectAiExplanations({ run, modules, allFindings, severityCounts, crawlData, moduleOrder }, explanations) {
  const explanationMap = (explanations && typeof explanations === 'object') ? explanations : {};

  function renderFindingsWithAi(findings, runId, evidenceDir, moduleName) {
    if (!findings || findings.length === 0) return '<p class="empty">No findings</p>';

    return `<div class="findings-list">
      ${findings.map((f, idx) => {
        const severity = (f.severity || '').toUpperCase();
        const needsAi = severity === 'CRITICAL' || severity === 'HIGH' || severity === 'MEDIUM';
        const findingId = `finding-${moduleName || f.module || ''}-${f.ruleId || 'n/a'}-${severity}-${f.url || 'n/a'}-${idx}`;
        const ai = (explanationMap[findingId] && typeof explanationMap[findingId] === 'object') ? explanationMap[findingId] : null;

        let screenshotHtml = '';
        if (f.screenshot) {
          let imgSrc = `/api/runs/${runId}/screenshots/${f.screenshot.replace('evidence/', '')}`;
          if (evidenceDir) {
            try {
              const filePath = join(evidenceDir, f.screenshot.replace('evidence/', ''));
              if (existsSync(filePath)) {
                const buf = readFileSync(filePath);
                imgSrc = `data:image/png;base64,${buf.toString('base64')}`;
              }
            } catch (e) { /* fall back to API URL */ }
          }
          screenshotHtml = `<div style="margin-top: 8px;"><img src="${imgSrc}" style="max-height: 200px; border-radius: 6px; border: 1px solid #e2e8f0;" onerror="this.style.display='none'" /></div>`;
        }

        const baseCard = `
        <div class="finding-item" style="padding: 12px; margin-bottom: 8px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <span class="severity ${severity.toLowerCase()}">${severity || 'N/A'}</span>
            ${f.ruleId ? `<code style="font-size: 11px; color: #94a3b8;">${f.ruleId}</code>` : ''}
            ${f.source ? `<span style="font-size: 10px; color: #94a3b8;">via ${f.source}</span>` : ''}
          </div>
          <p style="font-size: 13px; color: #334155; margin: 4px 0;">${f.description || f.help || f.testName || f.alertName || '-'}</p>
          ${f.recommendation ? `<p style="font-size: 12px; color: #64748b; margin-top: 4px;">💡 ${f.recommendation}</p>` : ''}
          ${f.url ? `<p style="font-size: 11px; color: #94a3b8; font-family: monospace; margin-top: 4px; word-break: break-all;">${f.url}</p>` : ''}
          ${screenshotHtml}
        </div>`;

        if (!needsAi || !ai) return baseCard;

        return baseCard + `
        <div class="ai-explanation" style="margin-top: 10px; padding: 12px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #0369a1;">✨ AI Explanation</span>
            <span style="font-size: 10px; color: #64748b;">for ${severity} — ${f.ruleId || 'finding'}</span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr; gap: 8px; font-size: 13px; color: #1e293b;">
            <div>
              <span style="font-weight: 600; color: #0c4a6e;">What it means</span>
              <p style="margin: 2px 0 0 0; color: #334155;">${escapeHtml(ai.whatItMeans)}</p>
            </div>
            <div>
              <span style="font-weight: 600; color: #0c4a6e;">Why it matters</span>
              <p style="margin: 2px 0 0 0; color: #334155;">${escapeHtml(ai.whyItMatters)}</p>
            </div>
            <div>
              <span style="font-weight: 600; color: #0c4a6e;">Recommended fix</span>
              <p style="margin: 2px 0 0 0; color: #334155;">${escapeHtml(ai.recommendedFix)}</p>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  function renderModuleSectionWithAi(moduleResult, moduleName, runId, evidenceDir) {
    let findings = [];
    let metrics = {};
    try { findings = JSON.parse(moduleResult.findings || '[]'); } catch (e) {}
    try { metrics = JSON.parse(moduleResult.metrics || '{}'); } catch (e) {}

    const metricsHtml = Object.entries(metrics).map(([key, value]) => 
      `<div class="metric"><span class="metric-label">${key}</span><span class="metric-value">${value}</span></div>`
    ).join('');

    return `
      <div class="module-section">
        <div class="module-header">
          <h3>${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}</h3>
          <div class="module-meta">
            ${getStatusBadge(moduleResult.status)}
            ${getScoreBadge(moduleResult.score)}
            <span class="duration">${moduleResult.duration_ms ? (moduleResult.duration_ms / 1000).toFixed(1) + 's' : '-'}</span>
          </div>
        </div>
        ${moduleResult.error ? `<div class="error-box">${moduleResult.error}</div>` : ''}
        ${metricsHtml ? `<div class="metrics-grid">${metricsHtml}</div>` : ''}
        ${renderFindingsWithAi(findings, runId, evidenceDir, moduleName)}
      </div>`;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SitePulse AI Report — ${crawlData.url || run.target_url}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; background: #f8fafc; line-height: 1.6; }
    .container { max-width: 1000px; margin: 0 auto; padding: 40px 24px; }
    .header { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: white; padding: 48px 40px; border-radius: 16px; margin-bottom: 32px; }
    .header h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    .header .subtitle { color: #94a3b8; font-size: 14px; }
    .header .meta { display: flex; gap: 24px; margin-top: 16px; color: #cbd5e1; font-size: 13px; }
    .score-hero { text-align: center; padding: 40px; background: white; border-radius: 16px; margin-bottom: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .score-hero .score { font-size: 72px; font-weight: 800; }
    .score-hero .label { color: #64748b; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
    .score-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 32px; }
    .score-card { background: white; padding: 24px; border-radius: 12px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .score-card .name { font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
    .score-card .value { font-size: 36px; font-weight: 700; margin: 8px 0; }
    .section { background: white; border-radius: 12px; padding: 32px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .section h2 { font-size: 20px; font-weight: 600; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; }
    .module-section { padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 16px; }
    .module-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .module-header h3 { font-size: 16px; font-weight: 600; }
    .module-meta { display: flex; gap: 12px; align-items: center; }
    .badge { padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .badge.green { background: #dcfce7; color: #166534; }
    .badge.yellow { background: #fef9c3; color: #854d0e; }
    .badge.red { background: #fee2e2; color: #991b1b; }
    .badge.gray { background: #f1f5f9; color: #64748b; }
    .badge.completed { background: #dcfce7; color: #166534; }
    .badge.error { background: #fee2e2; color: #991b1b; }
    .badge.unavailable { background: #f1f5f9; color: #64748b; }
    .badge.running { background: #dbeafe; color: #1e40af; }
    .badge.queued { background: #f1f5f9; color: #64748b; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .metric { padding: 12px; background: #f8fafc; border-radius: 8px; }
    .metric-label { display: block; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
    .metric-value { display: block; font-size: 16px; font-weight: 600; color: #1e293b; }
    .findings-table table { width: 100%; border-collapse: collapse; }
    .findings-table th { text-align: left; padding: 10px 12px; font-size: 12px; color: #64748b; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; }
    .findings-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
    .severity { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .severity.critical { background: #fecaca; color: #991b1b; }
    .severity.high { background: #fed7aa; color: #9a3412; }
    .severity.medium { background: #fef08a; color: #854d0e; }
    .severity.low { background: #e2e8f0; color: #475569; }
    .error-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 16px; color: #991b1b; font-size: 13px; margin-bottom: 16px; }
    .empty { color: #94a3b8; font-size: 13px; font-style: italic; }
    .duration { color: #94a3b8; font-size: 12px; }
    .severity-summary { display: flex; gap: 16px; margin-bottom: 24px; }
    .severity-item { display: flex; align-items: center; gap: 8px; font-size: 14px; }
    .severity-dot { width: 10px; height: 10px; border-radius: 50%; }
    .severity-dot.critical { background: #ef4444; }
    .severity-dot.high { background: #f97316; }
    .severity-dot.medium { background: #eab308; }
    .severity-dot.low { background: #94a3b8; }
    .footer { text-align: center; color: #94a3b8; font-size: 12px; padding: 32px 0; }
    .ai-explanation { margin-top: 10px; padding: 12px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; }
    @media print { .container { padding: 20px; } body { background: white; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>SitePulse — AI Explained Audit Report</h1>
      <div class="subtitle">Comprehensive website quality and security analysis with AI explanations</div>
      <div class="meta">
        <span>🔗 ${run.target_url}</span>
        <span>📅 ${new Date(run.started_at).toLocaleString()}</span>
        <span>⏱️ ${run.duration_ms ? (run.duration_ms / 1000).toFixed(1) + 's total' : 'N/A'}</span>
      </div>
    </div>

    <div class="score-hero">
      <div class="label">Overall Score</div>
      <div class="score" style="color: ${run.overall_score >= 80 ? '#22c55e' : run.overall_score >= 60 ? '#eab308' : '#ef4444'}">
        ${run.overall_score || 'N/A'}
      </div>
    </div>

    <div class="score-grid">
      ${modules.map(m => `
        <div class="score-card">
          <div class="name">${m.module_name}</div>
          <div class="value" style="color: ${m.score >= 80 ? '#22c55e' : m.score >= 60 ? '#eab308' : m.score !== null ? '#ef4444' : '#94a3b8'}">
            ${m.score !== null ? m.score : 'N/A'}
          </div>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <h2>Findings Summary</h2>
      <div class="severity-summary">
        ${severityCounts.critical > 0 ? `<div class="severity-item"><div class="severity-dot critical"></div> Critical: ${severityCounts.critical}</div>` : ''}
        ${severityCounts.high > 0 ? `<div class="severity-item"><div class="severity-dot high"></div> High: ${severityCounts.high}</div>` : ''}
        ${severityCounts.medium > 0 ? `<div class="severity-item"><div class="severity-dot medium"></div> Medium: ${severityCounts.medium}</div>` : ''}
        ${severityCounts.low > 0 ? `<div class="severity-item"><div class="severity-dot low"></div> Low: ${severityCounts.low}</div>` : ''}
      </div>
    </div>

    ${moduleOrder.map(name => {
      const mod = modules.find(m => m.module_name === name);
      return mod ? renderModuleSectionWithAi(mod, name, run.id, join(__dirname, '..', 'runs', run.id, 'evidence')) : '';
    }).join('')}

    <div class="section">
      <h2>Recommendations</h2>
      <ul style="padding-left: 20px;">
        ${allFindings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').slice(0, 10).map(f => 
          `<li style="margin-bottom: 8px;"><strong>${f.severity}:</strong> ${f.description || f.help || ''}</li>`
        ).join('')}
        ${allFindings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').length === 0 ? 
          '<li>No critical issues found. Great job! 🎉</li>' : ''}
      </ul>
    </div>

    <div class="footer">
      Generated by SitePulse — AI-Powered Website Testing Platform<br>
      AI report generated: ${new Date().toLocaleString()}<br>
      AI explanations provided by Groq (openai/gpt-oss-20b).
    </div>
  </div>
</body>
</html>`;

  return html;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build compact finding context for AI.
 * Only includes CRITICAL/HIGH/MEDIUM findings, with stable identity.
 */
export function buildFindingContext(runId) {
  const run = getRun(runId);
  if (!run) throw new Error('Run not found');

  const modules = run.modules || [];
  const enabledModules = modules.filter(m => m.status === 'completed');
  const context = [];

  for (const mod of enabledModules) {
    let findings = [];
    try { findings = JSON.parse(mod.findings || '[]'); } catch (e) {}
    for (let i = 0; i < findings.length; i++) {
      const f = findings[i];
      const severity = (f.severity || '').toUpperCase();
      if (severity !== 'CRITICAL' && severity !== 'HIGH' && severity !== 'MEDIUM') continue;

      context.push({
        id: `finding-${mod.module_name}-${f.ruleId || 'n/a'}-${severity}-${f.url || 'n/a'}-${i}`,
        module: mod.module_name,
        moduleLabel: moduleLabel(mod.module_name),
        severity,
        ruleId: f.ruleId || null,
        title: f.description || f.help || f.testName || f.alertName || '(no description)',
        description: f.description || null,
        recommendation: f.recommendation || null,
        url: f.url || run.target_url,
        source: f.source || null,
        metrics: extractRelevantMetrics(mod, f),
      });
    }
  }

  return context;
}

function moduleLabel(name) {
  const map = {
    functional: 'Functional Testing',
    accessibility: 'Accessibility',
    performance: 'Performance',
    security: 'Security',
    seo: 'SEO',
    brokenLinks: 'Broken Links',
    sslTls: 'SSL/TLS',
  };
  return map[name] || name;
}

function extractRelevantMetrics(mod, finding) {
  let metrics = {};
  try { metrics = JSON.parse(mod.metrics || '{}'); } catch (e) {}
  if (!metrics || typeof metrics !== 'object') return {};

  const metric = (finding.metric || '').toLowerCase();
  const out = {};

  if (metric === 'ttfb') {
    out.ttfb = metrics.ttfb ?? null;
    out.ttfbMs = metrics.ttfbMs ?? null;
  } else if (metric === 'lcp') {
    out.lcp = metrics.lcp ?? null;
    out.lcpMs = metrics.lcpMs ?? null;
  } else if (metric === 'cls') {
    out.cls = metrics.cls ?? null;
    out.clsValue = metrics.clsValue ?? null;
  } else if (metric === 'fcp') {
    out.fcp = metrics.fcp ?? null;
    out.fcpMs = metrics.fcpMs ?? null;
  } else if (metric === 'tbt') {
    out.totalBlockingTime = metrics.totalBlockingTime ?? null;
    out.totalBlockingTimeMs = metrics.totalBlockingTimeMs ?? null;
  } else if (mod.module_name === 'performance') {
    // Include full perf metrics for performance findings without a specific metric tag
    out.performanceScore = metrics.performanceScore ?? null;
    out.fcp = metrics.fcp ?? null;
    out.lcp = metrics.lcp ?? null;
    out.cls = metrics.cls ?? null;
    out.ttfb = metrics.ttfb ?? null;
    out.speedIndex = metrics.speedIndex ?? null;
    out.tti = metrics.tti ?? null;
    out.totalBlockingTime = metrics.totalBlockingTime ?? null;
  } else if (mod.module_name === 'accessibility') {
    out.affectedElements = finding.affectedElements ?? null;
    out.impact = finding.impact ?? null;
  }

  return out;
}

/**
 * Build a sanitized prompt fragment for a single finding.
 */
function findingToPromptFragment(f) {
  const parts = [
    `**Module:** ${f.moduleLabel}`,
    `**Severity:** ${f.severity}`,
    `**Finding:** ${f.title}`,
  ];
  if (f.ruleId) parts.push(`**Rule ID:** ${f.ruleId}`);
  if (f.description) parts.push(`**Details:** ${f.description}`);
  if (f.recommendation) parts.push(`**Existing recommendation:** ${f.recommendation}`);
  if (f.url) parts.push(`**URL:** ${f.url}`);
  if (Object.keys(f.metrics).length > 0) {
    const metricPairs = Object.entries(f.metrics)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    if (metricPairs) parts.push(`**Relevant metrics:** ${metricPairs}`);
  }
  return parts.join('\n');
}

/**
 * Split findings into batches to stay well within prompt budget.
 */
export function splitFindingsForAi(context) {
  // Reasoning model (openai/gpt-oss-20b) uses hidden reasoning tokens that count toward TPM.
  // With 8000 TPM free tier, keep batches very small to avoid rate limits.
  // Do NOT cap findings — every eligible CRITICAL/HIGH/MEDIUM finding must be processed.
  const BATCH = 3;
  const batches = [];
  for (let i = 0; i < context.length; i += BATCH) {
    batches.push(context.slice(i, i + BATCH));
  }
  return batches;
}

/**
 * Build the system prompt for a single batch.
 */
function buildSystemPrompt() {
  return `You are SitePulse AI Explainability Assistant.

You will be given a list of website audit findings. For each finding, output a JSON object with exactly these fields:
- id: the exact finding id provided (string)
- whatItMeans: a plain-English explanation of what the finding means (2-4 sentences).
- whyItMatters: why this matters for the site owner / users (2-4 sentences).
- recommendedFix: concrete recommended fix, aligned with the module and finding (2-4 sentences).

Rules:
- Base your answer ONLY on the supplied finding context. Do NOT invent findings, URLs, scores, severities, screenshots, evidence, or claim tests were run when they were not.
- Do NOT change the finding title, severity, score, or module.
- Do NOT fabricate technical evidence or metrics you were not given.
- Keep explanations factual, professional, and concise.
- Output must be a JSON object whose keys are finding ids and whose values are explanation objects.
- Output ONLY valid JSON. No markdown, no commentary.`;
}

/**
 * Build the user prompt for a single batch.
 */
function buildUserPrompt(batch) {
  const lines = batch.map(f => {
    return [
      `--- FINDING ${f.id} ---`,
      findingToPromptFragment(f),
    ].join('\n');
  });
  return [
    `Here are ${batch.length} finding(s). For each one, produce a JSON entry keyed by its id.`,
    ...lines,
    '',
    `Output JSON mapping id -> { whatItMeans, whyItMatters, recommendedFix }.`,
  ].join('\n');
}

/**
 * Call the Groq API with JSON-mode request.
 */
async function callGroq(messages, maxTokens = 4096) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not configured');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b',
      messages,
      max_tokens: maxTokens,
      temperature: 0,
      top_p: 1,
    }),
  });

  if (res.status === 429) {
    const errorBody = await res.text().catch(() => '');
    // Check for daily token limit exhaustion (TPD) - cannot retry, must give up
    if (errorBody.includes('tokens per day') || errorBody.includes('TPD')) {
      console.log('[AI] Groq daily token limit exhausted — saving partial results');
      throw new Error('GROQ_DAILY_LIMIT');
    }
    // TPM (per-minute) rate limit - wait and retry once
    const retryAfter = parseInt(res.headers.get('retry-after') || '60', 10);
    const waitMs = Math.min(retryAfter * 1000, 120000);
    console.log(`Groq rate limited (TPM), waiting ${Math.round(waitMs / 1000)}s...`);
    await new Promise(r => setTimeout(r, waitMs));
    const res2 = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai/gpt-oss-20b', messages, max_tokens: maxTokens, temperature: 0, top_p: 1 }),
    });
    if (!res2.ok) {
      const text2 = await res2.text().catch(() => '');
      if (text2.includes('tokens per day') || text2.includes('TPD')) {
        throw new Error('GROQ_DAILY_LIMIT');
      }
      throw new Error(`Groq request failed after retry: ${res2.status} ${res2.statusText}`);
    }
    const json2 = await res2.json();
    const content2 = json2.choices?.[0]?.message?.content;
    if (!content2) throw new Error('Groq returned no response content after retry');
    return content2;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Groq request failed: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 500)}` : ''}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('Groq returned no response content');
  return content;
}

/**
 * Validate that parsed JSON matches the expected shape for all ids.
 * Returns { ok: true, partial: [...] } even when some ids are missing,
 * so that partial results from a batch are still kept.
 */
function validateExplanationMap(data, expectedIds) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'Top-level value must be a JSON object', partial: [] };
  }

  // Filter to only entries that are valid explanation objects
  const partial = [];
  for (const id of expectedIds) {
    const entry = data[id];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    let valid = true;
    for (const field of ['whatItMeans', 'whyItMatters', 'recommendedFix']) {
      if (typeof entry[field] !== 'string' || entry[field].trim().length === 0) {
        valid = false;
        break;
      }
    }
    if (valid) partial.push(id);
  }

  const missing = expectedIds.filter(id => !partial.includes(id));
  if (missing.length > 0) {
    console.log(`[AI] Batch partial response: ${partial.length}/${expectedIds.length} valid, missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`);
  }

  // Accept if at least some valid entries were returned
  if (partial.length > 0) {
    return { ok: true, partial };
  }

  return { ok: false, reason: 'No valid explanation entries found in response', partial: [] };
}

/**
 * Generate AI explanations for a run.
 * Retries once with a stricter prompt if the first response is invalid.
 */
export async function generateAiExplanations(runId) {
  // Total timeout: 10 minutes max to prevent indefinite hangs
  const TOTAL_TIMEOUT_MS = 10 * 60 * 1000;
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;

  const context = buildFindingContext(runId);
  if (context.length === 0) {
    return { explanations: {}, generatedAt: new Date().toISOString(), findingCount: 0 };
  }

  console.log(`[AI] Eligible findings: ${context.length}`);
  const expectedIds = context.map(f => f.id);
  const batches = splitFindingsForAi(context);
  console.log(`[AI] Split into ${batches.length} batches`);
  const merged = {};

  for (let attempt = 0; attempt < 2; attempt++) {
    merged.length = 0;
    const keys = Object.keys(merged);
    for (const k of keys) delete merged[k];

    let lastError = null;
    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      // Check total deadline
      if (Date.now() > deadline) {
        console.log('[AI] Generation timed out (10 min limit)');
        break;
      }
      try {
        console.log(`[AI] Sending batch ${bi + 1}/${batches.length} to Groq (attempt ${attempt + 1})`);
        const system = attempt === 0 ? buildSystemPrompt() : buildStricterSystemPrompt();
        const content = await callGroq([
          { role: 'system', content: system },
          { role: 'user', content: buildUserPrompt(batch) },
        ], 4096);

        let parsed;
        try { parsed = JSON.parse(content); } catch (e) {
          throw new Error(`Groq response was not valid JSON: ${e.message}`);
        }

        const validation = validateExplanationMap(parsed, batch.map(f => f.id));
        if (!validation.ok) {
          throw new Error(`AI JSON validation failed: ${validation.reason}`);
        }

        // Keep partial results — even if Groq dropped some ids from the batch
        if (validation.partial && validation.partial.length > 0) {
          for (const id of validation.partial) {
            merged[id] = parsed[id];
          }
        }
        console.log(`[AI] Batch ${bi + 1}/${batches.length} completed (${validation.partial?.length || 0}/${batch.length} valid)`);
        // Pause between batches to respect rate limits (8000 TPM for reasoning model)
        if (bi < batches.length - 1) {
          await new Promise(r => setTimeout(r, 35000));
        }
      } catch (err) {
        console.log(`[AI] Batch ${bi + 1}/${batches.length} failed: ${err.message}`);
        lastError = err;
        // Daily limit exhausted — no point continuing to next batches
        if (err.message === 'GROQ_DAILY_LIMIT') break;
        // Other errors: continue to next batch to accumulate partial results
      }
    }

    const mergedCount = Object.keys(merged).length;
    if (mergedCount > 0) {
      // Safety sweep: ensure every merged entry has all required fields
      for (const id of Object.keys(merged)) {
        const entry = merged[id];
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          merged[id] = {
            whatItMeans: 'No AI explanation available for this finding.',
            whyItMatters: 'No AI explanation available for this finding.',
            recommendedFix: 'No AI explanation available for this finding.',
          };
          continue;
        }
        for (const field of ['whatItMeans', 'whyItMatters', 'recommendedFix']) {
          if (typeof entry[field] !== 'string' || entry[field].trim().length === 0) {
            entry[field] = 'No AI explanation available for this field.';
          }
        }
      }

      const missingIds = expectedIds.filter(id => !(id in merged));
      console.log(`[AI] Explanations received: ${mergedCount}/${expectedIds.length}`);
      if (missingIds.length > 0) {
        console.log(`[AI] Missing explanations: ${missingIds.length}`);
        for (const id of missingIds) console.log(`[AI]   - ${id}`);
      } else {
        console.log('[AI] Missing explanations: 0');
      }

      return {
        explanations: merged,
        generatedAt: new Date().toISOString(),
        findingCount: mergedCount,
        totalCount: expectedIds.length,
      };
    }

    // Don't retry if daily limit is exhausted or no partial results
    if (lastError && lastError.message !== 'GROQ_DAILY_LIMIT' && attempt === 0) {
      continue;
    }

    throw lastError || new Error('AI generation produced no explanations');
  }

  // Should not reach here, but keep the compiler happy
  throw new Error('AI generation failed');
}

function buildStricterSystemPrompt() {
  return `You are SitePulse AI Explainability Assistant.

Output rules:
- Output MUST be a single JSON object.
- The JSON object MUST map finding id strings to explanation objects.
- Every explanation object MUST contain exactly these string fields: whatItMeans, whyItMatters, recommendedFix.
- Each string field MUST be non-empty.
- Do NOT include any other top-level keys.
- Do NOT include markdown formatting, code fences, or any text outside the JSON object.
- Base your answer ONLY on the supplied finding context. Do NOT invent findings, URLs, scores, severities, screenshots, evidence, or claim tests were run when they were not.
- Do NOT change the finding title, severity, score, or module.
- Do NOT fabricate technical evidence or metrics you were not given.
- Keep explanations factual, professional, and concise.`;
}

export async function generatePDFReport(runId) {
  const { reportPath } = generateHTMLReport(runId);
  
  try {
    const { default: puppeteer } = await import('puppeteer');
    const browser = await puppeteer.launch({ 
      headless: true, 
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    
    const htmlContent = readFileSync(reportPath, 'utf-8');
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    const pdfPath = join(reportPath, '..', 'report.pdf');
    await page.pdf({ 
      path: pdfPath, 
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
    });
    
    await browser.close();
    return pdfPath;
  } catch (error) {
    console.error('PDF generation failed:', error.message);
    return null;
  }
}

/**
 * Save the AI-enhanced HTML report for a run.
 * Does not touch the original report.html.
 */
export function saveAiReport(runId, html) {
  const runsDir = join(__dirname, '..', 'runs', runId);
  if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });
  const aiPath = join(runsDir, 'ai-report.html');
  writeFileSync(aiPath, html, 'utf-8');
  return aiPath;
}

/**
 * Read the saved AI report for a run, if it exists.
 */
export function readAiReport(runId) {
  const aiPath = join(__dirname, '..', 'runs', runId, 'ai-report.html');
  if (!existsSync(aiPath)) return null;
  return readFileSync(aiPath, 'utf-8');
}

/**
 * Mark a run as having an AI report in-memory is not persisted here;
 * the presence of ai-report.html on disk is the source of truth.
 */
export function aiReportExists(runId) {
  const aiPath = join(__dirname, '..', 'runs', runId, 'ai-report.html');
  return existsSync(aiPath);
}

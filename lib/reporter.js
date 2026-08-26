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

function renderFindings(findings) {
  if (!findings || findings.length === 0) return '<p class="empty">No findings</p>';
  
  return `<div class="findings-table">
    <table>
      <thead>
        <tr>
          <th>Severity</th>
          <th>Category</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        ${findings.map(f => `
          <tr>
            <td><span class="severity ${f.severity?.toLowerCase()}">${f.severity || 'N/A'}</span></td>
            <td>${f.category || f.type || '-'}</td>
            <td>${f.description || f.help || f.testName || '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>`;
}

function renderModuleSection(moduleResult, moduleName) {
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
      ${renderFindings(findings)}
    </div>`;
}

export function generateHTMLReport(runId) {
  const run = getRun(runId);
  if (!run) throw new Error('Run not found');

  let crawlData = {};
  try { crawlData = JSON.parse(run.crawl_data || '{}'); } catch (e) {}
  
  const modules = run.modules || [];
  const moduleOrder = ['functional', 'accessibility', 'performance', 'security', 'seo', 'brokenLinks'];
  
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
      return mod ? renderModuleSection(mod, name) : '';
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

  return { html, reportPath };
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

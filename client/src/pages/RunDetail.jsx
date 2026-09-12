import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useSocket } from '../App';
import ScoreRing from '../components/ScoreRing';

const API_BASE = '/api';

const MODULE_LABELS = {
  crawler: { label: 'Crawl4AI', icon: '🕷️', desc: 'Website structure discovery and data extraction' },
  functional: { label: 'Functional Testing', icon: '⚡', desc: 'AI-generated functional test cases' },
  accessibility: { label: 'Accessibility', icon: '♿', desc: 'WCAG compliance with axe-core' },
  performance: { label: 'Performance', icon: '🚀', desc: 'Lighthouse metrics and timing analysis' },
  security: { label: 'Security', icon: '🔒', desc: 'OWASP ZAP and security header analysis' },
  seo: { label: 'SEO', icon: '📊', desc: 'Search engine optimization analysis' },
  brokenLinks: { label: 'Broken Links', icon: '🔗', desc: 'HTTP link verification' },
  sslTls: { label: 'SSL/TLS', icon: '🔐', desc: 'SSL/TLS certificate and protocol analysis' },
};

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL'];
const SEVERITY_COLORS = {
  CRITICAL: 'bg-red-500/20 text-red-400',
  HIGH: 'bg-orange-500/20 text-orange-400',
  MEDIUM: 'bg-yellow-500/20 text-yellow-400',
  LOW: 'bg-slate-500/20 text-slate-400',
  INFORMATIONAL: 'bg-blue-500/20 text-blue-400',
};

function sortFindings(findings) {
  return [...findings].sort((a, b) => {
    const orderA = SEVERITY_ORDER.indexOf(a.severity);
    const orderB = SEVERITY_ORDER.indexOf(b.severity);
    if (orderA !== orderB) return orderA - orderB;
    // Secondary: by confidence if available
    const conf = { High: 0, Medium: 1, Low: 2 };
    const confA = conf[a.confidence] ?? 1;
    const confB = conf[b.confidence] ?? 1;
    if (confA !== confB) return confA - confB;
    // Tertiary: by affected URL / name
    return (a.url || a.ruleId || '').localeCompare(b.url || b.ruleId || '');
  });
}

export default function RunDetail() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const socket = useSocket();
  const [run, setRun] = useState(null);
  const [expandedModule, setExpandedModule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [aiStatus, setAiStatus] = useState({ exists: false, generating: false });
  const [aiGenerating, setAiGenerating] = useState(false);

  // Check AI report status on load
  useEffect(() => {
    if (!runId) return;
    fetch(`${API_BASE}/runs/${runId}/ai-report/status`)
      .then(r => r.json())
      .then(data => setAiStatus(data))
      .catch(() => {});
  }, [runId]);

  const handleGenerateAi = async () => {
    if (aiGenerating) return;
    setAiGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/runs/${runId}/ai-report/generate`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to generate AI report');
        setAiGenerating(false);
        return;
      }
      // Move to the dedicated AI report page for polling and display
      navigate(`/run/${runId}/ai`);
    } catch (err) {
      alert('Failed to generate AI report');
      setAiGenerating(false);
    }
  };

  const fetchRun = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/runs/${runId}`);
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      setRun(data);
    } catch (err) {
      console.error('Failed to fetch run:', err);
    }
    setLoading(false);
  }, [runId]);

  useEffect(() => { fetchRun(); }, [fetchRun]);

  useEffect(() => {
    if (!socket) return;
    socket.emit('join:run', runId);
    
    const handleUpdate = () => fetchRun();
    socket.on('run:complete', handleUpdate);
    socket.on('module:complete', handleUpdate);
    
    const interval = setInterval(() => {
      if (run?.status === 'running' || run?.status === 'crawling') {
        fetchRun();
      }
    }, 2000);

    return () => {
      socket.off('run:complete', handleUpdate);
      socket.off('module:complete', handleUpdate);
      clearInterval(interval);
    };
  }, [socket, runId, run?.status, fetchRun]);

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to stop this scan?')) return;
    setCancelling(true);
    try {
      await fetch(`${API_BASE}/runs/${runId}/cancel`, { method: 'POST' });
      // Poll until cancelled
      setTimeout(fetchRun, 500);
    } catch (err) {
      console.error('Failed to cancel:', err);
    }
    setCancelling(false);
  };

  const handleDelete = async () => {
    if (!confirm('Delete this scan and all its results? This cannot be undone.')) return;
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/runs/${runId}`, { method: 'DELETE' });
      if (res.ok) {
        navigate('/reports');
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete');
      }
    } catch (err) {
      console.error('Failed to delete:', err);
      alert('Failed to delete scan');
    }
    setDeleting(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 py-12">
        <p className="text-slate-500">Run not found</p>
        <Link to="/" className="text-brand-400 hover:text-brand-300 text-sm mt-4 inline-block">← Back to Dashboard</Link>
      </div>
    );
  }

  const isRunning = run.status === 'running' || run.status === 'crawling';
  const isCancelled = run.status === 'cancelled';
  const modules = run.modules || [];

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-300 transition-colors inline-flex items-center gap-1 mb-4">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>
        
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Scan Results</h1>
            <p className="text-sm text-slate-500">{run.target_url}</p>
            <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
              <span>Run ID: <code className="font-mono text-slate-400">{run.id.substring(0, 8)}</code></span>
              <span>{run.started_at ? new Date(run.started_at).toLocaleString() : ''}</span>
              {run.duration_ms && <span>{(run.duration_ms / 1000).toFixed(1)}s</span>}
            </div>
            {isCancelled && (
              <div className="mt-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 inline-flex items-center gap-2">
                <span className="w-2 h-2 bg-amber-400 rounded-full" />
                <span className="text-xs text-amber-400 font-medium">Scan cancelled — partial results shown</span>
              </div>
            )}
            {run.error && (
              <div className="mt-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">
                <span className="text-xs text-red-400">{run.error}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {isRunning && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-all flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
                {cancelling ? 'Cancelling...' : 'Stop Scan'}
              </button>
            )}
            {!isRunning && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-all"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            )}
            <a 
              href={`/api/runs/${runId}/report`} 
              target="_blank" 
              className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all"
            >
              HTML Report
            </a>
            <a 
              href={`/api/runs/${runId}/report/pdf`} 
              target="_blank"
              className="px-4 py-2 rounded-lg bg-brand-600/20 border border-brand-500/20 text-sm text-brand-400 hover:bg-brand-600/30 transition-all"
            >
              PDF Report
            </a>

            {!isRunning && (
              aiStatus?.status === 'completed' ? (
                <a 
                  href={`/run/${runId}/ai`} 
                  className="px-4 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/20 text-sm text-emerald-400 hover:bg-emerald-500/30 transition-all"
                >
                  ✨ AI Explained Report
                </a>
              ) : aiStatus?.status === 'generating' || aiGenerating ? (
                <button
                  onClick={() => navigate(`/run/${runId}/ai`)}
                  className="px-4 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm text-blue-400 hover:bg-blue-500/20 transition-all flex items-center gap-2"
                >
                  <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                  Generating AI Report…
                </button>
              ) : (
                <button
                  onClick={handleGenerateAi}
                  className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all"
                >
                  ✨ Generate AI Report
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* Overall Score + Module Scores */}
      <div className="rounded-2xl glass p-8 mb-6">
        <div className="flex items-center justify-center gap-8 flex-wrap">
          <ScoreRing score={run.overall_score} size={160} strokeWidth={10} label="Overall Score" />
          <div className="h-[100px] w-px bg-white/10 hidden md:block" />
          {modules.filter(m => m.module_name !== 'crawler').map(mod => (
            <ScoreRing
              key={mod.id}
              score={mod.score}
              size={90}
              strokeWidth={5}
              label={MODULE_LABELS[mod.module_name]?.label || mod.module_name}
            />
          ))}
        </div>
      </div>

      {/* Module Results */}
      <div className="space-y-4">
        {modules.map(mod => {
          const info = MODULE_LABELS[mod.module_name] || { label: mod.module_name, icon: '⚙️', desc: '' };
          const isExpanded = expandedModule === mod.id;
          let findings = [];
          let metrics = {};
          try { findings = JSON.parse(mod.findings || '[]'); } catch (e) {}
          try { metrics = JSON.parse(mod.metrics || '{}'); } catch (e) {}

          // Sort findings by severity (critical first)
          const sortedFindings = sortFindings(findings);

          // Calculate severity counts (conditional display)
          const severityCounts = {};
          for (const f of sortedFindings) {
            const sev = f.severity || 'LOW';
            severityCounts[sev] = (severityCounts[sev] || 0) + 1;
          }

          return (
            <div key={mod.id} className="rounded-2xl glass overflow-hidden">
              <button
                onClick={() => setExpandedModule(isExpanded ? null : mod.id)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-4">
                  <span className="text-xl">{info.icon}</span>
                  <div className="text-left">
                    <h3 className="text-base font-semibold text-white">{info.label}</h3>
                    <p className="text-xs text-slate-500">{info.desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {mod.duration_ms && (
                    <span className="text-xs text-slate-500 font-mono">{(mod.duration_ms / 1000).toFixed(1)}s</span>
                  )}
                  <StatusBadge status={mod.status} />
                  <ScoreBadge score={mod.score} />
                  {findings.length > 0 && (
                    <span className="text-xs text-slate-500">{findings.length} findings</span>
                  )}
                  <svg 
                    className={`w-5 h-5 text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {isExpanded && (
                <div className="px-6 pb-6 border-t border-white/5">
                  {/* Error */}
                  {mod.error && (
                    <div className="mt-4 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                      {mod.error}
                    </div>
                  )}

                  {/* Metrics */}
                  {Object.keys(metrics).length > 0 && (
                    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                      {Object.entries(metrics).map(([key, value]) => (
                        <div key={key} className="p-3 rounded-lg bg-white/[0.02]">
                          <span className="text-[11px] text-slate-500 uppercase tracking-wider block">
                            {key.replace(/([A-Z])/g, ' $1').trim()}
                          </span>
                          <span className="text-sm font-semibold text-slate-200">
                            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Findings Severity Summary — only show non-zero counts */}
                  {sortedFindings.length > 0 && (
                    <div className="mt-4 flex items-center gap-3 flex-wrap">
                      {SEVERITY_ORDER.filter(sev => (severityCounts[sev] || 0) > 0).map(sev => (
                        <span
                          key={sev}
                          className={`text-[11px] px-2.5 py-1 rounded-full font-semibold ${SEVERITY_COLORS[sev]}`}
                        >
                          {sev}: {severityCounts[sev]}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Findings */}
                  {sortedFindings.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-sm font-semibold text-slate-300 mb-3">
                        Findings ({sortedFindings.length})
                      </h4>
                      <div className="space-y-2">
                        {sortedFindings.map((finding, i) => (
                          <div key={i} className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <SeverityBadge severity={finding.severity} />
                              {finding.ruleId && (
                                <code className="text-[11px] text-slate-500 font-mono">{finding.ruleId}</code>
                              )}
                              {finding.confidence && (
                                <span className="text-[10px] text-slate-600">({finding.confidence})</span>
                              )}
                              {finding.source && (
                                <span className="text-[10px] text-slate-600">via {finding.source}</span>
                              )}
                              {finding.module && (
                                <span className="text-[10px] text-slate-600">via {finding.module}</span>
                              )}
                            </div>
                            <p className="text-sm text-slate-300">{finding.description || finding.help || finding.testName || finding.alertName || '-'}</p>
                            {finding.recommendation && (
                              <p className="text-xs text-slate-400 mt-1">💡 {finding.recommendation}</p>
                            )}
                            {finding.url && (
                              <p className="text-xs text-slate-500 mt-1 font-mono truncate">{finding.url}</p>
                            )}
                            {finding.screenshot && (
                              <div className="mt-2">
                                <img
                                  src={`/api/runs/${runId}/screenshots/${finding.screenshot.replace('evidence/', '')}`}
                                  alt={`Evidence: ${finding.title || finding.ruleId}`}
                                  className="rounded-lg border border-white/10 max-h-48 object-contain cursor-pointer hover:border-white/30 transition-all"
                                  onError={(e) => { e.target.style.display = 'none'; }}
                                />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {sortedFindings.length === 0 && Object.keys(metrics).length === 0 && !mod.error && (
                    <p className="text-sm text-slate-500 text-center py-6">No findings</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    completed: 'bg-emerald-500/10 text-emerald-400',
    running: 'bg-blue-500/10 text-blue-400',
    error: 'bg-red-500/10 text-red-400',
    unavailable: 'bg-slate-500/10 text-slate-400',
    queued: 'bg-slate-500/10 text-slate-500',
    timeout: 'bg-amber-500/10 text-amber-400',
    cancelled: 'bg-amber-500/10 text-amber-400',
  };
  
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${styles[status?.toLowerCase()] || styles.queued}`}>
      {status}
    </span>
  );
}

function ScoreBadge({ score }) {
  if (score === null || score === undefined) return <span className="text-xs text-slate-600">—</span>;
  const color = score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-amber-400' : 'text-red-400';
  return <span className={`text-sm font-bold ${color}`}>{score}</span>;
}

function SeverityBadge({ severity }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${SEVERITY_COLORS[severity] || SEVERITY_COLORS.LOW}`}>
      {severity}
    </span>
  );
}

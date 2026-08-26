import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useSocket } from '../App';
import ScoreRing from '../components/ScoreRing';
import ScoreChart from '../components/ScoreChart';
import FindingsChart from '../components/FindingsChart';
import ModuleTrendChart from '../components/ModuleTrendChart';

const API_BASE = '/api';

const MODULE_LABELS = {
  crawler: { label: 'Crawl4AI', icon: '🕷️' },
  functional: { label: 'Functional', icon: '⚡' },
  accessibility: { label: 'Accessibility', icon: '♿' },
  performance: { label: 'Performance', icon: '🚀' },
  security: { label: 'Security', icon: '🔒' },
  seo: { label: 'SEO', icon: '📊' },
  brokenLinks: { label: 'Broken Links', icon: '🔗' },
};

const STATUS_STYLES = {
  healthy: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', label: 'Healthy' },
  warning: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', label: 'Warning' },
  critical: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20', label: 'Critical' },
  running: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', label: 'Running' },
  paused: { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/20', label: 'Paused' },
  failed: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20', label: 'Failed' },
};

export default function MonitorDetail() {
  const { monitorId } = useParams();
  const socket = useSocket();
  const [monitor, setMonitor] = useState(null);
  const [history, setHistory] = useState([]);
  const [runs, setRuns] = useState([]);
  const [moduleStatuses, setModuleStatuses] = useState({});
  const [loading, setLoading] = useState(true);
  const [expandedModule, setExpandedModule] = useState(null);

  const fetchMonitor = useCallback(async () => {
    try {
      const [monRes, histRes, runsRes] = await Promise.all([
        fetch(`${API_BASE}/monitors/${monitorId}`),
        fetch(`${API_BASE}/monitors/${monitorId}/history?limit=100`),
        fetch(`${API_BASE}/monitors/${monitorId}/runs?limit=20`)
      ]);
      const monData = await monRes.json();
      const histData = await histRes.json();
      const runsData = await runsRes.json();
      
      setMonitor(monData);
      // history should be chronological (oldest first for charts)
      setHistory([...histData].reverse());
      setRuns(runsData);
    } catch (err) {
      console.error('Failed to fetch monitor:', err);
    }
    setLoading(false);
  }, [monitorId]);

  useEffect(() => {
    fetchMonitor();
  }, [fetchMonitor]);

  // Socket.IO live updates
  useEffect(() => {
    if (!socket) return;

    socket.emit('join:monitor', monitorId);

    const handleStarted = (data) => {
      if (data.monitorId !== monitorId) return;
      setMonitor(prev => prev ? { ...prev, status: 'running' } : prev);
      setModuleStatuses({});
    };

    const handleModuleStarted = (data) => {
      if (data.monitorId !== monitorId) return;
      setModuleStatuses(prev => ({
        ...prev,
        [data.module]: { status: 'running', score: null }
      }));
    };

    const handleModuleCompleted = (data) => {
      if (data.monitorId !== monitorId) return;
      setModuleStatuses(prev => ({
        ...prev,
        [data.module]: { 
          status: data.status || 'completed', 
          score: data.score 
        }
      }));
    };

    const handleCompleted = (data) => {
      if (data.monitorId !== monitorId) return;
      fetchMonitor();
      setModuleStatuses({});
    };

    const handleFailed = (data) => {
      if (data.monitorId !== monitorId) return;
      fetchMonitor();
      setModuleStatuses({});
    };

    socket.on('monitor:started', handleStarted);
    socket.on('monitor:module_started', handleModuleStarted);
    socket.on('monitor:module_completed', handleModuleCompleted);
    socket.on('monitor:completed', handleCompleted);
    socket.on('monitor:failed', handleFailed);

    return () => {
      socket.off('monitor:started', handleStarted);
      socket.off('monitor:module_started', handleModuleStarted);
      socket.off('monitor:module_completed', handleModuleCompleted);
      socket.off('monitor:completed', handleCompleted);
      socket.off('monitor:failed', handleFailed);
    };
  }, [socket, monitorId, fetchMonitor]);

  const handleRunNow = async () => {
    try {
      setMonitor(prev => prev ? { ...prev, status: 'running' } : prev);
      setModuleStatuses({});
      await fetch(`${API_BASE}/monitors/${monitorId}/run`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to run monitor:', err);
    }
  };

  const handlePause = async () => {
    try {
      await fetch(`${API_BASE}/monitors/${monitorId}/pause`, { method: 'POST' });
      fetchMonitor();
    } catch (err) {
      console.error('Failed to pause:', err);
    }
  };

  const handleResume = async () => {
    try {
      await fetch(`${API_BASE}/monitors/${monitorId}/resume`, { method: 'POST' });
      fetchMonitor();
    } catch (err) {
      console.error('Failed to resume:', err);
    }
  };

  const scoreColor = (score) => {
    if (score === null || score === undefined) return 'text-slate-600';
    if (score >= 80) return 'text-emerald-400';
    if (score >= 60) return 'text-amber-400';
    return 'text-red-400';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-500">Loading monitor...</span>
        </div>
      </div>
    );
  }

  if (!monitor) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 py-12">
        <p className="text-slate-500">Monitor not found</p>
        <Link to="/monitoring" className="text-brand-400 hover:text-brand-300 text-sm mt-4 inline-block">← Back to Monitoring</Link>
      </div>
    );
  }

  const isRunning = monitor.status === 'running';
  const statusStyle = STATUS_STYLES[monitor.status] || STATUS_STYLES.healthy;
  const latestRun = runs[0] || null;

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link to="/monitoring" className="text-sm text-slate-500 hover:text-slate-300 transition-colors inline-flex items-center gap-1 mb-4">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Monitoring
        </Link>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">{monitor.name}</h1>
              <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
                {isRunning ? 'Running' : statusStyle.label}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-1 font-mono">{monitor.url}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRunNow}
              disabled={isRunning}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-brand-600 to-brand-500 text-white text-sm font-medium hover:from-brand-500 hover:to-brand-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {isRunning ? 'Running...' : 'Run Now'}
            </button>
            {monitor.enabled !== 0 ? (
              <button onClick={handlePause} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-400 hover:text-white hover:bg-white/10 transition-all">
                Pause
              </button>
            ) : (
              <button onClick={handleResume} className="px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400 hover:bg-emerald-500/20 transition-all">
                Resume
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Metrics Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <MetricCard label="Current Score" value={monitor.current_score} suffix="/100" color={scoreColor(monitor.current_score)} />
        <MetricCard label="Score Change" value={monitor.score_change} prefix={monitor.score_change > 0 ? '+' : ''} 
          color={monitor.score_change > 0 ? 'text-emerald-400' : monitor.score_change < 0 ? 'text-red-400' : 'text-slate-500'} 
          isChange />
        <MetricCard label="Total Findings" value={monitor.current_findings_count} color="text-slate-300" />
        <MetricCard label="Total Checks" value={monitor.total_checks} color="text-slate-300" />
      </div>

      {/* Timing & Severity Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Timing */}
        <div className="rounded-2xl glass p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Monitoring Schedule</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-[11px] text-slate-600 uppercase tracking-wider">Last Checked</span>
              <p className="text-sm text-slate-300 mt-1">
                {monitor.last_checked_at ? new Date(monitor.last_checked_at).toLocaleString() : 'Never'}
              </p>
            </div>
            <div>
              <span className="text-[11px] text-slate-600 uppercase tracking-wider">Next Check</span>
              <p className="text-sm text-slate-300 mt-1">
                {monitor.next_check_at && monitor.enabled !== 0 ? new Date(monitor.next_check_at).toLocaleString() : 'N/A'}
              </p>
            </div>
            <div>
              <span className="text-[11px] text-slate-600 uppercase tracking-wider">Interval</span>
              <p className="text-sm text-slate-300 mt-1">
                {monitor.interval_minutes >= 1440 ? `Every ${monitor.interval_minutes / 1440} day(s)` 
                  : monitor.interval_minutes >= 60 ? `Every ${monitor.interval_minutes / 60} hour(s)` 
                  : `Every ${monitor.interval_minutes} minute(s)`}
              </p>
            </div>
            <div>
              <span className="text-[11px] text-slate-600 uppercase tracking-wider">Created</span>
              <p className="text-sm text-slate-300 mt-1">
                {new Date(monitor.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>

        {/* Severity Breakdown */}
        <div className="rounded-2xl glass p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Findings Severity</h3>
          <div className="grid grid-cols-2 gap-4">
            <SeverityCard label="Critical" count={monitor.current_critical || 0} color="red" />
            <SeverityCard label="High" count={monitor.current_high || 0} color="orange" />
            <SeverityCard label="Medium" count={monitor.current_medium || 0} color="yellow" />
            <SeverityCard label="Low" count={monitor.current_low || 0} color="slate" />
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Score Over Time */}
        <div className="rounded-2xl glass p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Score Over Time</h3>
          <ScoreChart history={history} height={260} />
        </div>

        {/* Findings Over Time */}
        <div className="rounded-2xl glass p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Findings Over Time</h3>
          <FindingsChart history={history} height={260} />
        </div>
      </div>

      {/* Module Trend */}
      <div className="rounded-2xl glass p-6 mb-8">
        <h3 className="text-sm font-semibold text-slate-300 mb-4">Module Score Trends</h3>
        <ModuleTrendChart history={history} height={280} />
      </div>

      {/* Current Module Status */}
      {isRunning && Object.keys(moduleStatuses).length > 0 && (
        <div className="rounded-2xl glass p-6 mb-8">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <span className="w-2 h-2 bg-blue-400 rounded-full animate-status-pulse" />
            Live Module Progress
          </h3>
          <div className="space-y-2">
            {Object.entries(MODULE_LABELS).map(([key, info]) => {
              const ms = moduleStatuses[key];
              const status = ms?.status || 'queued';
              return (
                <div key={key} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/[0.02]">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{info.icon}</span>
                    <span className="text-sm font-medium text-slate-200">{info.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {ms?.score !== null && ms?.score !== undefined && (
                      <span className={`text-sm font-bold ${scoreColor(ms.score)}`}>{ms.score}</span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      status === 'running' ? 'bg-blue-500/10 text-blue-400' :
                      status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                      status === 'error' ? 'bg-red-500/10 text-red-400' :
                      'bg-slate-500/10 text-slate-500'
                    }`}>
                      {status === 'running' && '⟳ Running'}
                      {status === 'completed' && '✓ Complete'}
                      {status === 'error' && '✗ Error'}
                      {status === 'queued' && '○ Waiting'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Runs */}
      <div className="rounded-2xl glass p-6">
        <h3 className="text-sm font-semibold text-slate-300 mb-4">Recent Monitoring Checks</h3>
        {runs.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">No monitoring checks yet</p>
        ) : (
          <div className="space-y-2">
            {runs.map(run => (
              <div key={run.id} className="flex items-center justify-between py-3 px-4 rounded-lg hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold
                    ${(run.overall_score || 0) >= 80 ? 'bg-emerald-500/10 text-emerald-400' :
                      (run.overall_score || 0) >= 60 ? 'bg-amber-500/10 text-amber-400' :
                      'bg-red-500/10 text-red-400'}`}>
                    {run.overall_score ?? '—'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-300">
                        {new Date(run.started_at).toLocaleString()}
                      </span>
                      {run.score_change !== null && run.score_change !== undefined && run.score_change !== 0 && (
                        <span className={`text-xs font-medium ${run.score_change > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {run.score_change > 0 ? '↑' : '↓'} {Math.abs(run.score_change)}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-600">
                      {run.findings_count || 0} findings • {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : '—'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {run.run_id && (
                    <Link
                      to={`/run/${run.run_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
                    >
                      View Scan →
                    </Link>
                  )}
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                    run.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                    run.status === 'running' ? 'bg-blue-500/10 text-blue-400' :
                    'bg-red-500/10 text-red-400'
                  }`}>
                    {run.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, suffix = '', prefix = '', color = 'text-white', isChange = false }) {
  let displayValue = '—';
  if (value !== null && value !== undefined) {
    if (isChange) {
      displayValue = `${prefix}${value}`;
    } else {
      displayValue = `${prefix}${value}`;
    }
  }

  return (
    <div className="rounded-xl glass p-4">
      <span className="text-[11px] text-slate-600 uppercase tracking-wider block mb-2">{label}</span>
      <div className={`text-2xl font-bold ${color}`}>
        {displayValue}
        {suffix && <span className="text-sm font-normal text-slate-500 ml-1">{suffix}</span>}
      </div>
    </div>
  );
}

function SeverityCard({ label, count, color }) {
  const colorMap = {
    red: { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
    orange: { text: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
    yellow: { text: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
    slate: { text: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
  };
  const c = colorMap[color] || colorMap.slate;

  return (
    <div className={`p-3 rounded-lg ${c.bg} border ${c.border}`}>
      <span className={`text-2xl font-bold ${c.text}`}>{count}</span>
      <span className="text-xs text-slate-500 ml-2">{label}</span>
    </div>
  );
}

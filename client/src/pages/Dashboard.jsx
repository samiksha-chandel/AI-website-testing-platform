import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSocket } from '../App';
import ScoreRing from '../components/ScoreRing';
import ModuleStatusRow from '../components/ModuleStatusRow';
import EmptyState from '../components/EmptyState';
import RunCard from '../components/RunCard';

const API_BASE = '/api';

const MODULE_ORDER = ['crawler', 'functional', 'accessibility', 'performance', 'security', 'seo', 'brokenLinks'];
const MODULE_LABELS = {
  crawler: 'Crawl4AI',
  functional: 'Functional',
  accessibility: 'Accessibility', 
  performance: 'Performance',
  security: 'Security',
  seo: 'SEO',
  brokenLinks: 'Broken Links'
};

const MONITOR_STATUS_STYLES = {
  healthy: { dot: 'bg-emerald-400', text: 'text-emerald-400' },
  warning: { dot: 'bg-amber-400', text: 'text-amber-400' },
  critical: { dot: 'bg-red-400', text: 'text-red-400' },
  running: { dot: 'bg-blue-400 animate-status-pulse', text: 'text-blue-400' },
  paused: { dot: 'bg-slate-400', text: 'text-slate-400' },
  failed: { dot: 'bg-red-400', text: 'text-red-400' },
};

export default function Dashboard() {
  const socket = useSocket();
  const navigate = useNavigate();
  const [runs, setRuns] = useState([]);
  const [activeRun, setActiveRun] = useState(null);
  const [moduleStatuses, setModuleStatuses] = useState({});
  const [stats, setStats] = useState(null);
  const [monitors, setMonitors] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [runsRes, statsRes, monitorsRes] = await Promise.all([
        fetch(`${API_BASE}/runs?limit=10`),
        fetch(`${API_BASE}/stats`),
        fetch(`${API_BASE}/monitors`)
      ]);
      const runsData = await runsRes.json();
      const statsData = await statsRes.json();
      const monitorsData = await monitorsRes.json();
      setRuns(runsData);
      setStats(statsData);
      setMonitors(monitorsData);
      
      const latest = runsData[0];
      if (latest) {
        setActiveRun(latest);
        loadRunDetail(latest.id);
      }
    } catch (err) {
      console.error('Failed to fetch data:', err);
    }
    setLoading(false);
  }, []);

  const loadRunDetail = async (runId) => {
    try {
      const res = await fetch(`${API_BASE}/runs/${runId}`);
      const data = await res.json();
      setActiveRun(data);
      
      if (data.modules) {
        const statuses = {};
        data.modules.forEach(m => {
          let findings = [];
          try { findings = JSON.parse(m.findings || '[]'); } catch (e) {}
          statuses[m.module_name] = {
            status: m.status,
            score: m.score,
            duration: m.duration_ms,
            findingsCount: findings.length
          };
        });
        setModuleStatuses(statuses);
      }
    } catch (err) {
      console.error('Failed to load run:', err);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Socket.IO events
  useEffect(() => {
    if (!socket) return;

    socket.on('run:create', () => fetchData());
    socket.on('run:complete', () => fetchData());

    socket.on('run:progress', () => {
      setActiveRun(prev => prev ? { ...prev, status: 'running' } : null);
    });

    socket.on('module:start', (data) => {
      setModuleStatuses(prev => ({
        ...prev,
        [data.module]: { ...prev[data.module], status: 'running', score: null }
      }));
    });

    socket.on('module:complete', (data) => {
      setModuleStatuses(prev => ({
        ...prev,
        [data.module]: { 
          ...prev[data.module], 
          status: 'completed', 
          score: data.score,
          duration: data.duration
        }
      }));
    });

    socket.on('module:error', (data) => {
      setModuleStatuses(prev => ({
        ...prev,
        [data.module]: { ...prev[data.module], status: 'error' }
      }));
    });

    // Monitor events - refresh stats when monitors complete
    socket.on('monitor:completed', () => {
      fetchData();
    });

    socket.on('monitor:started', (data) => {
      setMonitors(prev => prev.map(m =>
        m.id === data.monitorId ? { ...m, status: 'running' } : m
      ));
    });

    return () => {
      socket.off('run:create');
      socket.off('run:complete');
      socket.off('run:progress');
      socket.off('module:start');
      socket.off('module:complete');
      socket.off('module:error');
      socket.off('monitor:completed');
      socket.off('monitor:started');
    };
  }, [socket, fetchData]);

  useEffect(() => {
    if (!activeRun) return;
    if (activeRun.status === 'running' || activeRun.status === 'crawling') {
      const interval = setInterval(() => loadRunDetail(activeRun.id), 3000);
      return () => clearInterval(interval);
    }
  }, [activeRun?.id, activeRun?.status]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-500">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  const isRunning = activeRun?.status === 'running' || activeRun?.status === 'crawling';

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8">
      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Scans" value={stats?.totalRuns || 0} icon="🔍" />
        <StatCard label="Completed" value={stats?.completedRuns || 0} icon="✅" />
        <StatCard label="Avg Score" value={stats?.avgScore || 0} icon="📊" suffix="/100" />
        <StatCard 
          label="Monitored" 
          value={stats?.monitoringSites || 0} 
          icon="📡"
          onClick={() => navigate('/monitoring')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content - 2/3 width */}
        <div className="lg:col-span-2 space-y-6">
          {/* Score Overview */}
          {activeRun && (
            <div className="rounded-2xl glass p-6 animate-fade-in-up">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-white">Latest Scan Results</h2>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {activeRun.target_url} • {activeRun.started_at ? new Date(activeRun.started_at).toLocaleString() : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isRunning && (
                    <span className="flex items-center gap-2 text-sm text-blue-400">
                      <span className="w-2 h-2 bg-blue-400 rounded-full animate-status-pulse" />
                      In Progress
                    </span>
                  )}
                  <button
                    onClick={() => navigate(`/run/${activeRun.id}`)}
                    className="text-sm text-brand-400 hover:text-brand-300 transition-colors"
                  >
                    View Details →
                  </button>
                </div>
              </div>

              {/* Score Rings */}
              <div className="flex items-center justify-center gap-6 md:gap-8 flex-wrap">
                <ScoreRing 
                  score={activeRun.overall_score} 
                  size={140} 
                  strokeWidth={8} 
                  label="Overall" 
                />
                <div className="h-[80px] w-px bg-white/10 hidden md:block" />
                {MODULE_ORDER.filter(m => m !== 'crawler').map(mod => {
                  const ms = moduleStatuses[mod];
                  return (
                    <ScoreRing
                      key={mod}
                      score={ms?.score ?? null}
                      size={70}
                      strokeWidth={4}
                      label={MODULE_LABELS[mod]}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {!activeRun && (
            <div className="rounded-2xl glass">
              <EmptyState
                icon="🚀"
                title="No Scans Yet"
                description="Enter a website URL above to start your first AI-powered website audit. You'll get comprehensive results across 6 validation modules."
              />
            </div>
          )}

          {/* Recent Runs */}
          <div className="rounded-2xl glass p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Recent Scans</h2>
              {runs.length > 0 && (
                <span className="text-xs text-slate-500">{runs.length} runs</span>
              )}
            </div>
            
            {runs.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">No scan history yet</p>
            ) : (
              <div className="space-y-2">
                {runs.slice(0, 10).map(run => (
                  <RunCard key={run.id} run={run} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar - 1/3 width */}
        <div className="space-y-6">
          {/* Live Validation Status */}
          <div className="rounded-2xl glass p-6">
            <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-blue-400 animate-status-pulse' : 'bg-slate-600'}`} />
              Validation Modules
            </h3>
            
            <div className="space-y-1">
              {MODULE_ORDER.map(mod => {
                const ms = moduleStatuses[mod] || { status: 'queued' };
                return (
                  <ModuleStatusRow
                    key={mod}
                    moduleName={mod}
                    status={ms.status}
                    score={ms.score}
                    duration={ms.duration}
                    findingsCount={ms.findingsCount}
                  />
                );
              })}
            </div>
          </div>

          {/* Monitoring Summary */}
          <div className="rounded-2xl glass p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <span className="text-lg">📡</span>
                Monitors
              </h3>
              <Link to="/monitoring" className="text-xs text-brand-400 hover:text-brand-300 transition-colors">
                View All →
              </Link>
            </div>
            
            {monitors.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-sm text-slate-500 mb-3">No monitors configured</p>
                <Link 
                  to="/monitoring"
                  className="text-xs px-3 py-1.5 rounded-lg bg-brand-600/20 border border-brand-500/20 text-brand-400 hover:bg-brand-600/30 transition-all inline-block"
                >
                  Add Monitor
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {monitors.slice(0, 5).map(monitor => {
                  const statusStyle = MONITOR_STATUS_STYLES[monitor.status] || MONITOR_STATUS_STYLES.healthy;
                  return (
                    <Link
                      key={monitor.id}
                      to={`/monitoring/${monitor.id}`}
                      className="block p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-2 h-2 rounded-full ${statusStyle.dot} shrink-0`} />
                          <span className="text-sm font-medium text-slate-200 truncate">{monitor.name}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {monitor.current_score !== null && monitor.current_score !== undefined && (
                            <span className={`text-sm font-bold ${
                              monitor.current_score >= 80 ? 'text-emerald-400' :
                              monitor.current_score >= 60 ? 'text-amber-400' : 'text-red-400'
                            }`}>
                              {monitor.current_score}
                            </span>
                          )}
                          {monitor.score_change !== null && monitor.score_change !== undefined && monitor.score_change !== 0 && (
                            <span className={`text-[10px] font-medium ${monitor.score_change > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {monitor.score_change > 0 ? '+' : ''}{monitor.score_change}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-0.5 truncate">{monitor.url}</p>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Issue Summary */}
          {activeRun?.modules && (
            <div className="rounded-2xl glass p-6">
              <h3 className="text-base font-semibold text-white mb-4">Issue Summary</h3>
              <IssueSummary modules={activeRun.modules} />
            </div>
          )}

          {/* Quick Actions */}
          <div className="rounded-2xl glass p-6">
            <h3 className="text-base font-semibold text-white mb-4">Quick Actions</h3>
            <div className="space-y-2">
              <ActionButton onClick={() => navigate('/monitoring')} icon="📡">
                Monitoring
              </ActionButton>
              <ActionButton onClick={() => navigate('/reports')} icon="📋">
                View Reports
              </ActionButton>
              {activeRun && (
                <ActionButton onClick={() => window.open(`/api/runs/${activeRun.id}/report`, '_blank')} icon="📄">
                  Generate HTML Report
                </ActionButton>
              )}
              {activeRun && (
                <ActionButton onClick={() => window.open(`/api/runs/${activeRun.id}/report/pdf`, '_blank')} icon="📑">
                  Download PDF Report
                </ActionButton>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, suffix = '', onClick }) {
  return (
    <div 
      className={`rounded-xl glass p-4 animate-fade-in-up ${onClick ? 'cursor-pointer hover:bg-white/[0.04] transition-all' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xl">{icon}</span>
      </div>
      <div className="text-2xl font-bold text-white">
        {value}{suffix && <span className="text-sm font-normal text-slate-500 ml-1">{suffix}</span>}
      </div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function IssueSummary({ modules }) {
  let allFindings = [];
  modules.forEach(m => {
    try {
      const findings = JSON.parse(m.findings || '[]');
      allFindings.push(...findings);
    } catch (e) {}
  });

  const severityCounts = {
    CRITICAL: allFindings.filter(f => f.severity === 'CRITICAL').length,
    HIGH: allFindings.filter(f => f.severity === 'HIGH').length,
    MEDIUM: allFindings.filter(f => f.severity === 'MEDIUM').length,
    LOW: allFindings.filter(f => f.severity === 'LOW').length,
  };

  const total = allFindings.length;
  if (total === 0) {
    return <p className="text-sm text-slate-500 text-center py-4">No issues found ✨</p>;
  }

  return (
    <div className="space-y-3">
      {Object.entries(severityCounts).filter(([, count]) => count > 0).map(([sev, count]) => {
        const colors = {
          CRITICAL: { bg: 'bg-red-500', bar: 'bg-red-400', text: 'text-red-400' },
          HIGH: { bg: 'bg-orange-500', bar: 'bg-orange-400', text: 'text-orange-400' },
          MEDIUM: { bg: 'bg-yellow-500', bar: 'bg-yellow-400', text: 'text-yellow-400' },
          LOW: { bg: 'bg-slate-500', bar: 'bg-slate-400', text: 'text-slate-400' },
        };
        const c = colors[sev];
        return (
          <div key={sev}>
            <div className="flex items-center justify-between mb-1">
              <span className={`text-xs font-medium ${c.text}`}>{sev}</span>
              <span className="text-xs text-slate-500">{count}</span>
            </div>
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div 
                className={`h-full ${c.bar} rounded-full transition-all duration-700`}
                style={{ width: `${(count / Math.max(total, 1)) * 100}%` }}
              />
            </div>
          </div>
        );
      })}
      <div className="pt-2 border-t border-white/5">
        <span className="text-xs text-slate-500">Total: {total} findings</span>
      </div>
    </div>
  );
}

function ActionButton({ onClick, icon, children }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 hover:border-white/10 transition-all text-sm text-slate-300 hover:text-white"
    >
      <span>{icon}</span>
      {children}
    </button>
  );
}

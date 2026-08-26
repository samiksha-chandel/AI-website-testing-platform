import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../App';
import EmptyState from '../components/EmptyState';

const API_BASE = '/api';

const INTERVAL_OPTIONS = [
  { value: 1, label: 'Every 1 minute', dev: true },
  { value: 5, label: 'Every 5 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Hourly' },
  { value: 1440, label: 'Daily' },
];

const STATUS_STYLES = {
  healthy: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', dot: 'bg-emerald-400' },
  warning: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', dot: 'bg-amber-400' },
  critical: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20', dot: 'bg-red-400' },
  running: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', dot: 'bg-blue-400' },
  paused: { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/20', dot: 'bg-slate-400' },
  failed: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20', dot: 'bg-red-400' },
};

export default function Monitoring() {
  const socket = useSocket();
  const navigate = useNavigate();
  const [monitors, setMonitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingMonitor, setEditingMonitor] = useState(null);
  const [runningStates, setRunningStates] = useState({});

  // Form state
  const [form, setForm] = useState({ name: '', url: '', intervalMinutes: 60 });

  const fetchMonitors = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/monitors`);
      const data = await res.json();
      setMonitors(data);
    } catch (err) {
      console.error('Failed to fetch monitors:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchMonitors();
  }, [fetchMonitors]);

  // Socket.IO events for live updates
  useEffect(() => {
    if (!socket) return;

    const handleStarted = (data) => {
      setMonitors(prev => prev.map(m => 
        m.id === data.monitorId ? { ...m, status: 'running' } : m
      ));
      setRunningStates(prev => ({ ...prev, [data.monitorId]: true }));
    };

    const handleCompleted = (data) => {
      fetchMonitors();
      setRunningStates(prev => {
        const next = { ...prev };
        delete next[data.monitorId];
        return next;
      });
    };

    const handleFailed = (data) => {
      fetchMonitors();
      setRunningStates(prev => {
        const next = { ...prev };
        delete next[data.monitorId];
        return next;
      });
    };

    socket.on('monitor:started', handleStarted);
    socket.on('monitor:completed', handleCompleted);
    socket.on('monitor:failed', handleFailed);

    return () => {
      socket.off('monitor:started', handleStarted);
      socket.off('monitor:completed', handleCompleted);
      socket.off('monitor:failed', handleFailed);
    };
  }, [socket, fetchMonitors]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.url.trim()) return;

    let targetUrl = form.url.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    try {
      if (editingMonitor) {
        await fetch(`${API_BASE}/monitors/${editingMonitor.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, url: targetUrl })
        });
      } else {
        await fetch(`${API_BASE}/monitors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, url: targetUrl })
        });
      }
      setForm({ name: '', url: '', intervalMinutes: 60 });
      setShowCreate(false);
      setEditingMonitor(null);
      fetchMonitors();
    } catch (err) {
      console.error('Failed to save monitor:', err);
    }
  };

  const handleDelete = async (monitorId) => {
    if (!confirm('Delete this monitor? This will remove all its history.')) return;
    try {
      await fetch(`${API_BASE}/monitors/${monitorId}`, { method: 'DELETE' });
      fetchMonitors();
    } catch (err) {
      console.error('Failed to delete monitor:', err);
    }
  };

  const handlePause = async (monitorId) => {
    try {
      await fetch(`${API_BASE}/monitors/${monitorId}/pause`, { method: 'POST' });
      fetchMonitors();
    } catch (err) {
      console.error('Failed to pause monitor:', err);
    }
  };

  const handleResume = async (monitorId) => {
    try {
      await fetch(`${API_BASE}/monitors/${monitorId}/resume`, { method: 'POST' });
      fetchMonitors();
    } catch (err) {
      console.error('Failed to resume monitor:', err);
    }
  };

  const handleRunNow = async (monitorId) => {
    try {
      setRunningStates(prev => ({ ...prev, [monitorId]: true }));
      setMonitors(prev => prev.map(m =>
        m.id === monitorId ? { ...m, status: 'running' } : m
      ));
      await fetch(`${API_BASE}/monitors/${monitorId}/run`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to run monitor:', err);
      setRunningStates(prev => {
        const next = { ...prev };
        delete next[monitorId];
        return next;
      });
    }
  };

  const openEdit = (monitor) => {
    setEditingMonitor(monitor);
    setForm({ name: monitor.name, url: monitor.url, intervalMinutes: monitor.interval_minutes });
    setShowCreate(true);
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
          <span className="text-sm text-slate-500">Loading monitors...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Monitoring</h1>
          <p className="text-sm text-slate-500">Continuous website health monitoring with real-time alerts</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setEditingMonitor(null); setForm({ name: '', url: '', intervalMinutes: 60 }); }}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-brand-600 to-brand-500 text-white text-sm font-medium hover:from-brand-500 hover:to-brand-400 transition-all flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Monitor
        </button>
      </div>

      {/* Create/Edit Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass rounded-2xl p-6 w-full max-w-md mx-4 animate-fade-in-up">
            <h2 className="text-lg font-semibold text-white mb-4">
              {editingMonitor ? 'Edit Monitor' : 'Add Monitor'}
            </h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Monitor Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Production Website"
                  className="w-full h-10 px-4 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Website URL</label>
                <input
                  type="text"
                  value={form.url}
                  onChange={(e) => setForm(prev => ({ ...prev, url: e.target.value }))}
                  placeholder="https://example.com"
                  required
                  className="w-full h-10 px-4 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Check Interval</label>
                <select
                  value={form.intervalMinutes}
                  onChange={(e) => setForm(prev => ({ ...prev, intervalMinutes: parseInt(e.target.value) }))}
                  className="w-full h-10 px-4 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-all appearance-none"
                >
                  {INTERVAL_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value} className="bg-slate-800 text-white">
                      {opt.label}{opt.dev ? ' (Dev Mode)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="flex-1 h-10 rounded-lg bg-gradient-to-r from-brand-600 to-brand-500 text-white text-sm font-medium hover:from-brand-500 hover:to-brand-400 transition-all"
                >
                  {editingMonitor ? 'Save Changes' : 'Create Monitor'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setEditingMonitor(null); }}
                  className="px-4 h-10 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Empty State */}
      {monitors.length === 0 ? (
        <div className="rounded-2xl glass">
          <EmptyState
            icon="📡"
            title="No Monitors Configured"
            description="Set up monitoring for your websites to get continuous health checks, score tracking, and alerting. Click 'Add Monitor' to get started."
            action={
              <button
                onClick={() => setShowCreate(true)}
                className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-brand-600 to-brand-500 text-white text-sm font-medium hover:from-brand-500 hover:to-brand-400 transition-all"
              >
                Add Your First Monitor
              </button>
            }
          />
        </div>
      ) : (
        /* Monitor Grid */
        <div className="space-y-4">
          {monitors.map(monitor => {
            const isRunning = runningStates[monitor.id] || monitor.status === 'running';
            const statusStyle = STATUS_STYLES[monitor.status] || STATUS_STYLES.healthy;

            return (
              <div
                key={monitor.id}
                className="rounded-2xl glass p-6 hover:bg-white/[0.02] transition-all cursor-pointer"
                onClick={() => navigate(`/monitoring/${monitor.id}`)}
              >
                <div className="flex items-start justify-between">
                  {/* Left: Monitor info */}
                  <div className="flex items-start gap-4">
                    {/* Status indicator */}
                    <div className="relative mt-1">
                      <div className={`w-3 h-3 rounded-full ${statusStyle.dot} ${isRunning ? 'animate-status-pulse' : ''}`} />
                    </div>
                    
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-base font-semibold text-white">{monitor.name}</h3>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
                          {isRunning ? 'Running' : monitor.status}
                        </span>
                        {monitor.enabled === 0 && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20 font-medium">
                            Paused
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500 mt-0.5 font-mono">{monitor.url}</p>
                      
                      {/* Metrics row */}
                      <div className="flex items-center gap-6 mt-3">
                        {/* Score */}
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">Score</span>
                          <span className={`text-lg font-bold ${scoreColor(monitor.current_score)}`}>
                            {monitor.current_score !== null && monitor.current_score !== undefined 
                              ? monitor.current_score 
                              : '—'}
                          </span>
                          {monitor.score_change !== null && monitor.score_change !== undefined && monitor.score_change !== 0 && (
                            <span className={`text-xs font-medium ${monitor.score_change > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {monitor.score_change > 0 ? '+' : ''}{monitor.score_change}
                            </span>
                          )}
                        </div>
                        
                        <div className="h-4 w-px bg-white/10" />
                        
                        {/* Findings */}
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">Findings</span>
                          <span className="text-sm font-medium text-slate-300">{monitor.current_findings_count || 0}</span>
                          {(monitor.current_critical || 0) > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">{monitor.current_critical}C</span>
                          )}
                          {(monitor.current_high || 0) > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 font-medium">{monitor.current_high}H</span>
                          )}
                          {(monitor.current_medium || 0) > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-medium">{monitor.current_medium}M</span>
                          )}
                        </div>
                        
                        <div className="h-4 w-px bg-white/10" />
                        
                        {/* Checks */}
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">Checks</span>
                          <span className="text-sm font-medium text-slate-300">{monitor.total_checks || 0}</span>
                        </div>
                      </div>

                      {/* Timing info */}
                      <div className="flex items-center gap-4 mt-2 text-[11px] text-slate-600">
                        {monitor.last_checked_at && (
                          <span>Last: {new Date(monitor.last_checked_at).toLocaleString()}</span>
                        )}
                        {monitor.next_check_at && monitor.enabled !== 0 && (
                          <span>Next: {new Date(monitor.next_check_at).toLocaleString()}</span>
                        )}
                        <span>Every {monitor.interval_minutes >= 1440 ? `${monitor.interval_minutes / 1440}d` : monitor.interval_minutes >= 60 ? `${monitor.interval_minutes / 60}h` : `${monitor.interval_minutes}m`}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleRunNow(monitor.id)}
                      disabled={isRunning}
                      className="px-3 py-1.5 rounded-lg bg-brand-600/20 border border-brand-500/20 text-xs text-brand-400 hover:bg-brand-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      {isRunning ? 'Running...' : 'Run Now'}
                    </button>
                    {monitor.enabled !== 0 ? (
                      <button
                        onClick={() => handlePause(monitor.id)}
                        className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                      >
                        Pause
                      </button>
                    ) : (
                      <button
                        onClick={() => handleResume(monitor.id)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 hover:bg-emerald-500/20 transition-all"
                      >
                        Resume
                      </button>
                    )}
                    <button
                      onClick={() => openEdit(monitor)}
                      className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(monitor.id)}
                      className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 hover:bg-red-500/20 transition-all"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

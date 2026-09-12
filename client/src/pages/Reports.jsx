import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import EmptyState from '../components/EmptyState';

const API_BASE = '/api';

export default function Reports() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState([]);
  const [aiStatusMap, setAiStatusMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);

  const fetchRuns = () => {
    fetch(`${API_BASE}/runs?limit=50`)
      .then(r => r.json())
      .then(data => {
        setRuns(data.filter(r => r.status === 'completed' || r.status === 'cancelled'));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchRuns();
  }, []);

  // Periodically refresh AI-status for runs that are already completed (cheap head request)
  useEffect(() => {
    if (loading) return;
    const interval = setInterval(async () => {
      const ids = runs.map(r => r.id);
      if (ids.length === 0) return;
      const next = { ...aiStatusMap };
      await Promise.allSettled(ids.map(async (id) => {
        try {
          const res = await fetch(`${API_BASE}/runs/${id}/ai-report/status`);
          if (res.ok) {
            const data = await res.json();
            next[id] = data;
          }
        } catch (e) { /* ignore */ }
      }));
      setAiStatusMap(next);
    }, 5000);
    return () => clearInterval(interval);
  }, [runs, loading, aiStatusMap]);

  const [aiGenerating, setAiGenerating] = useState(null);

  const handleDelete = async (runId, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this scan report and all associated data? This cannot be undone.')) return;
    
    setDeleting(runId);
    try {
      const res = await fetch(`${API_BASE}/runs/${runId}`, { method: 'DELETE' });
      if (res.ok) {
        setRuns(prev => prev.filter(r => r.id !== runId));
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete');
      }
    } catch (err) {
      console.error('Failed to delete:', err);
      alert('Failed to delete report');
    }
    setDeleting(null);
  };

  const handleGenerateAi = async (runId) => {
    if (aiGenerating === runId) return;
    setAiGenerating(runId);
    try {
      // Trigger background generation (returns immediately)
      const res = await fetch(`${API_BASE}/runs/${runId}/ai-report/generate`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to generate AI report');
        return;
      }
      // Move to the dedicated AI report page; it will poll until a terminal state is reached
      navigate(`/run/${runId}/ai`);
    } catch (err) {
      alert('Failed to generate AI report');
      setAiGenerating(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Reports</h1>
        <p className="text-sm text-slate-500">View and download audit reports for completed scans</p>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-2xl glass">
          <EmptyState
            icon="📋"
            title="No Reports Available"
            description="Complete a scan to generate reports. Reports include both HTML and PDF formats."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {runs.map(run => {
            const hostname = (() => {
              try { return new URL(run.target_url).hostname; } catch (e) { return run.target_url; }
            })();
            const isCancelled = run.status === 'cancelled';
            
            return (
              <div key={run.id} className="rounded-2xl glass p-5 animate-fade-in-up relative group">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold
                      ${run.overall_score >= 80 ? 'bg-emerald-500/10 text-emerald-400' : 
                        run.overall_score >= 60 ? 'bg-amber-500/10 text-amber-400' : 
                        run.overall_score !== null ? 'bg-red-500/10 text-red-400' : 'bg-slate-500/10 text-slate-400'}`}>
                      {run.overall_score !== null ? run.overall_score : '—'}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{hostname}</p>
                      <p className="text-xs text-slate-500">
                        {run.started_at ? new Date(run.started_at).toLocaleDateString() : ''}
                      </p>
                      {isCancelled && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium">
                          Partial
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Delete button — visible on hover */}
                  <button
                    onClick={(e) => handleDelete(run.id, e)}
                    disabled={deleting === run.id}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40"
                    title="Delete this report"
                  >
                    {deleting === run.id ? (
                      <div className="w-4 h-4 border border-red-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    )}
                  </button>
                </div>
                
                <div className="flex gap-2 mt-4">
                  <Link
                    to={`/run/${run.id}`}
                    className="flex-1 text-center text-xs px-3 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 transition-all"
                  >
                    View Details
                  </Link>
                  <a
                    href={`/api/runs/${run.id}/report`}
                    target="_blank"
                    className="flex-1 text-center text-xs px-3 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 transition-all"
                  >
                    HTML
                  </a>
                  <a
                    href={`/api/runs/${run.id}/report/pdf`}
                    target="_blank"
                    className="flex-1 text-center text-xs px-3 py-2 rounded-lg bg-brand-600/20 hover:bg-brand-600/30 text-brand-400 transition-all"
                  >
                    PDF
                  </a>
                </div>

                {/* AI Report actions */}
                {run.status === 'completed' && (
                  <div className="mt-4 flex gap-2 flex-wrap">
                    {aiStatusMap[run.id]?.status === 'completed' ? (
                      <>
                        <Link
                          to={`/run/${run.id}/ai`}
                          className="flex-1 text-center text-xs px-3 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 transition-all"
                        >
                          ✨ AI Explained Report
                        </Link>
                        <a
                          href={`/api/runs/${run.id}/ai-report/download`}
                          target="_blank"
                          className="flex-1 text-center text-xs px-3 py-2 rounded-lg bg-brand-600/20 hover:bg-brand-600/30 text-brand-400 transition-all"
                        >
                          Download AI Explained Report
                        </a>
                      </>
                    ) : aiStatusMap[run.id]?.status === 'generating' || aiGenerating === run.id ? (
                      <div className="flex-1 text-center text-xs px-3 py-2 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center gap-2">
                        <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                        Generating AI report…
                      </div>
                    ) : aiStatusMap[run.id]?.status === 'failed' || aiStatusMap[run.id]?.status === 'rate_limited' ? (
                      <button
                        onClick={() => handleGenerateAi(run.id)}
                        className="flex-1 text-center text-xs px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all"
                      >
                        {aiStatusMap[run.id]?.status === 'rate_limited' ? 'Groq limit — Retry AI Report' : 'Retry AI Report'}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleGenerateAi(run.id)}
                        className="flex-1 text-center text-xs px-3 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 transition-all"
                      >
                        ✨ Generate AI Explained Report
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

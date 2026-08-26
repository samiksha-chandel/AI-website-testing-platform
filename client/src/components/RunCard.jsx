import React from 'react';
import { Link } from 'react-router-dom';

function getStatusStyle(status) {
  switch (status?.toLowerCase()) {
    case 'completed': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    case 'running': case 'crawling': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    case 'error': return 'bg-red-500/10 text-red-400 border-red-500/20';
    case 'queued': return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    default: return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
  }
}

function getScoreStyle(score) {
  if (score === null || score === undefined) return 'text-slate-600';
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  return 'text-red-400';
}

export default function RunCard({ run }) {
  const hostname = (() => {
    try { return new URL(run.target_url).hostname; } catch (e) { return run.target_url; }
  })();

  return (
    <Link 
      to={`/run/${run.id}`}
      className="block p-4 rounded-xl glass-light hover:bg-white/[0.04] transition-all group"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold
            ${run.overall_score >= 80 ? 'bg-emerald-500/10 text-emerald-400' : 
              run.overall_score >= 60 ? 'bg-amber-500/10 text-amber-400' : 
              run.overall_score !== null ? 'bg-red-500/10 text-red-400' : 'bg-slate-500/10 text-slate-400'}`}>
            {run.overall_score !== null ? run.overall_score : '—'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate group-hover:text-white transition-colors">
              {hostname}
            </p>
            <p className="text-xs text-slate-500 truncate">{run.target_url}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {run.duration_ms && (
            <span className="text-xs text-slate-500 font-mono hidden sm:inline">
              {(run.duration_ms / 1000).toFixed(1)}s
            </span>
          )}
          <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${getStatusStyle(run.status)}`}>
            {run.status}
          </span>
          <svg className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
      
      {run.started_at && (
        <div className="mt-2 text-xs text-slate-600">
          {new Date(run.started_at).toLocaleString()}
        </div>
      )}
    </Link>
  );
}

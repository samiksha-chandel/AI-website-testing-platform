import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';

const API_BASE = '/api';

export default function Reports() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/runs?limit=50`)
      .then(r => r.json())
      .then(data => {
        setRuns(data.filter(r => r.status === 'completed'));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

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
            
            return (
              <div key={run.id} className="rounded-2xl glass p-5 animate-fade-in-up">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold
                      ${run.overall_score >= 80 ? 'bg-emerald-500/10 text-emerald-400' : 
                        run.overall_score >= 60 ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'}`}>
                      {run.overall_score || '—'}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{hostname}</p>
                      <p className="text-xs text-slate-500">
                        {run.started_at ? new Date(run.started_at).toLocaleDateString() : ''}
                      </p>
                    </div>
                  </div>
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

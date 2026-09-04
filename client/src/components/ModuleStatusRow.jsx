import React from 'react';

const MODULE_LABELS = {
  crawler: { label: 'Crawl4AI', icon: '🕷️' },
  functional: { label: 'Functional', icon: '⚡' },
  accessibility: { label: 'Accessibility', icon: '♿' },
  performance: { label: 'Performance', icon: '🚀' },
  security: { label: 'Security', icon: '🔒' },
  seo: { label: 'SEO', icon: '📊' },
  brokenLinks: { label: 'Broken Links', icon: '🔗' },
  sslTls: { label: 'SSL/TLS', icon: '🔐' },
};

const STATUS_ICONS = {
  queued: { icon: '○', color: 'text-slate-600' },
  running: { icon: '●', color: 'text-blue-400 animate-status-pulse' },
  completed: { icon: '✓', color: 'text-emerald-400' },
  error: { icon: '✗', color: 'text-red-400' },
  unavailable: { icon: '⊘', color: 'text-slate-500' },
  timeout: { icon: '◷', color: 'text-amber-400' },
  cancelled: { icon: '⊘', color: 'text-amber-400' },
};

export default function ModuleStatusRow({ moduleName, status, score, duration, findingsCount }) {
  const moduleInfo = MODULE_LABELS[moduleName] || { label: moduleName, icon: '⚙️' };
  const statusInfo = STATUS_ICONS[status?.toLowerCase()] || STATUS_ICONS.queued;

  const getScoreColor = (s) => {
    if (s === null || s === undefined) return 'text-slate-600';
    if (s >= 80) return 'text-emerald-400';
    if (s >= 60) return 'text-amber-400';
    return 'text-red-400';
  };

  return (
    <div className="flex items-center justify-between py-3 px-4 rounded-lg hover:bg-white/[0.02] transition-colors">
      <div className="flex items-center gap-3">
        <span className={`text-lg ${statusInfo.color}`}>{statusInfo.icon}</span>
        <span className="text-lg">{moduleInfo.icon}</span>
        <div>
          <span className="text-sm font-medium text-slate-200">{moduleInfo.label}</span>
          <span className="text-xs text-slate-500 ml-2">
            {status?.toLowerCase() === 'running' ? 'Running...' : 
             status?.toLowerCase() === 'completed' ? 'Complete' :
             status?.toLowerCase() === 'queued' ? 'Queued' :
             status?.toLowerCase() === 'unavailable' ? 'Unavailable' :
             status?.toLowerCase() === 'cancelled' ? 'Cancelled' :
             status?.toLowerCase() || ''}
          </span>
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        {duration !== undefined && duration !== null && (
          <span className="text-xs text-slate-500 font-mono">
            {(duration / 1000).toFixed(1)}s
          </span>
        )}
        {findingsCount !== undefined && findingsCount !== null && (
          <span className="text-xs text-slate-500">
            {findingsCount} findings
          </span>
        )}
        {score !== null && score !== undefined && (
          <span className={`text-sm font-bold ${getScoreColor(score)}`}>
            {score}
          </span>
        )}
      </div>
    </div>
  );
}

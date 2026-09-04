// Scoring engine for the platform
export function calculateOverallScore(moduleResults) {
  const weights = {
    crawler: 0,       // Crawler is infrastructure, not scored
    functional: 0.25,
    accessibility: 0.20,
    performance: 0.20,
    security: 0.20,
    seo: 0.15,
    brokenLinks: 0.10,
    sslTls: 0.05,
  };

  let totalWeight = 0;
  let weightedSum = 0;

  for (const [module, weight] of Object.entries(weights)) {
    if (module === 'crawler') continue;
    
    const result = moduleResults.find(m => m.module_name === module);
    if (result && result.status === 'completed' && result.score !== null) {
      weightedSum += result.score * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight === 0) return null;
  return Math.round(weightedSum / totalWeight);
}

export function getScoreGrade(score) {
  if (score === null || score === undefined) return { grade: 'N/A', color: 'gray' };
  if (score >= 90) return { grade: 'A', color: '#22c55e' };
  if (score >= 80) return { grade: 'B', color: '#84cc16' };
  if (score >= 70) return { grade: 'C', color: '#eab308' };
  if (score >= 60) return { grade: 'D', color: '#f97316' };
  return { grade: 'F', color: '#ef4444' };
}

export function getStatusColor(status) {
  const colors = {
    'queued': '#64748b',
    'running': '#3b82f6',
    'crawling': '#8b5cf6',
    'completed': '#22c55e',
    'passed': '#22c55e',
    'cancelled': '#f97316',
    'error': '#ef4444',
    'failed': '#ef4444',
    'timeout': '#f97316',
    'unavailable': '#64748b',
    'skipped': '#94a3b8',
    'warning': '#eab308',
  };
  return colors[status?.toLowerCase()] || '#64748b';
}

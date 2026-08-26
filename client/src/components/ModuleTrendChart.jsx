import React, { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

const MODULE_COLORS = {
  functional: { border: '#818cf8', bg: 'rgba(129, 140, 248, 0.1)' },
  accessibility: { border: '#34d399', bg: 'rgba(52, 211, 153, 0.1)' },
  performance: { border: '#fbbf24', bg: 'rgba(251, 191, 36, 0.1)' },
  security: { border: '#f87171', bg: 'rgba(248, 113, 113, 0.1)' },
  seo: { border: '#a78bfa', bg: 'rgba(167, 139, 250, 0.1)' },
  brokenLinks: { border: '#38bdf8', bg: 'rgba(56, 189, 248, 0.1)' },
};

const MODULE_LABELS = {
  functional: 'Functional',
  accessibility: 'Accessibility',
  performance: 'Performance',
  security: 'Security',
  seo: 'SEO',
  brokenLinks: 'Broken Links',
};

export default function ModuleTrendChart({ history, height = 280 }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !history || history.length === 0) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const labels = history.map(h => {
      const d = new Date(h.started_at || h.completed_at);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });

    // Build datasets for each module
    const modules = ['functional', 'accessibility', 'performance', 'security', 'seo', 'brokenLinks'];
    const datasets = modules.map(mod => {
      const colors = MODULE_COLORS[mod];
      return {
        label: MODULE_LABELS[mod],
        data: history.map(h => {
          const ms = h.module_scores || {};
          const modData = ms[mod];
          return modData?.score ?? null;
        }),
        borderColor: colors.border,
        backgroundColor: colors.bg,
        fill: false,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: colors.border,
        pointBorderColor: 'transparent',
        spanGaps: true,
      };
    });

    const ctx = canvasRef.current.getContext('2d');

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index',
        },
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              color: '#94a3b8',
              font: { size: 11 },
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 12,
            },
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#e2e8f0',
            bodyColor: '#94a3b8',
            borderColor: 'rgba(148, 163, 184, 0.2)',
            borderWidth: 1,
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y ?? 'N/A'}`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(148, 163, 184, 0.06)' },
            ticks: { color: '#64748b', font: { size: 10 }, maxRotation: 0 },
          },
          y: {
            min: 0,
            max: 100,
            grid: { color: 'rgba(148, 163, 184, 0.06)' },
            ticks: { color: '#64748b', font: { size: 10 }, stepSize: 25 },
          },
        },
        animation: {
          duration: 800,
          easing: 'easeInOutQuart',
        },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [history, height]);

  if (!history || history.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <p className="text-sm text-slate-600">No module data yet</p>
      </div>
    );
  }

  return (
    <div style={{ height }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

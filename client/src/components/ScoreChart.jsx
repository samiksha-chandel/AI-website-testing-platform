import React, { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

function getScoreColor(score) {
  if (score >= 90) return '#22c55e';
  if (score >= 75) return '#84cc16';
  if (score >= 60) return '#eab308';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}

export default function ScoreChart({ history, height = 280 }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !history || history.length === 0) return;

    // Destroy previous chart
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const labels = history.map(h => {
      const d = new Date(h.started_at || h.completed_at);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });

    const scores = history.map(h => h.overall_score);
    const prevScores = history.map(h => h.previous_score);

    const ctx = canvasRef.current.getContext('2d');

    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.3)');
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Score',
            data: scores,
            borderColor: '#818cf8',
            backgroundColor: gradient,
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: scores.map(s => getScoreColor(s)),
            pointBorderColor: 'transparent',
            pointHoverBackgroundColor: scores.map(s => getScoreColor(s)),
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 2,
          },
          ...(prevScores.some(s => s !== null) ? [{
            label: 'Previous',
            data: prevScores,
            borderColor: 'rgba(148, 163, 184, 0.3)',
            borderDash: [5, 5],
            borderWidth: 1,
            pointRadius: 0,
            fill: false,
            tension: 0.4,
          }] : [])
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index',
        },
        plugins: {
          legend: {
            display: prevScores.some(s => s !== null),
            position: 'top',
            align: 'end',
            labels: {
              color: '#94a3b8',
              font: { size: 11 },
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 16,
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
            displayColors: true,
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
        <p className="text-sm text-slate-600">No monitoring data yet</p>
      </div>
    );
  }

  return (
    <div style={{ height }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

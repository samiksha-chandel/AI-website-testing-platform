import React, { useEffect, useState } from 'react';

const circumference = 2 * Math.PI * 45;

function getScoreColor(score) {
  if (score === null || score === undefined) return '#475569';
  if (score >= 90) return '#22c55e';
  if (score >= 75) return '#84cc16';
  if (score >= 60) return '#eab308';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}

export default function ScoreRing({ score, size = 120, strokeWidth = 6, label, sublabel }) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const radius = (size - strokeWidth) / 2;
  const color = getScoreColor(score);
  const offset = circumference - (animatedScore / 100) * circumference;

  useEffect(() => {
    if (score !== null && score !== undefined) {
      const timer = setTimeout(() => setAnimatedScore(score), 100);
      return () => clearTimeout(timer);
    }
  }, [score]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={strokeWidth}
          />
          {/* Progress circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.3s ease' }}
          />
        </svg>
        {/* Score text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold" style={{ color }}>
            {score !== null && score !== undefined ? score : '—'}
          </span>
          {sublabel && (
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">{sublabel}</span>
          )}
        </div>
      </div>
      {label && (
        <span className="text-xs font-medium text-slate-400 text-center">{label}</span>
      )}
    </div>
  );
}

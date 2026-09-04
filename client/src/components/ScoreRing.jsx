import React, { useEffect, useState, useMemo } from 'react';

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
  const color = getScoreColor(score);
  
  // SVG geometry — all derived from props
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (animatedScore / 100) * circumference;
  
  // Font size scales with ring size, never overlapping the stroke
  const fontSize = Math.max(10, Math.round(size * 0.22));
  const subFontSize = Math.max(7, Math.round(size * 0.08));
  const labelFontSize = Math.max(9, Math.round(size * 0.09));

  useEffect(() => {
    if (score !== null && score !== undefined) {
      const timer = setTimeout(() => setAnimatedScore(score), 100);
      return () => clearTimeout(timer);
    }
  }, [score]);

  const displayScore = score !== null && score !== undefined ? score : '—';
  const isThreeDigit = typeof score === 'number' && score >= 100;

  return (
    <div className="flex flex-col items-center gap-2">
      <div style={{ width: size, height: size, position: 'relative' }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
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
            style={{
              transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.3s ease'
            }}
          />
        </svg>
        {/* Score text — perfectly centered via absolute positioning with flexbox */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: strokeWidth,
          }}
        >
          <span
            style={{
              fontSize: `${fontSize}px`,
              fontWeight: 700,
              color,
              lineHeight: 1,
              fontFamily: 'Inter, system-ui, sans-serif',
              letterSpacing: isThreeDigit ? '-0.5px' : '0',
            }}
          >
            {displayScore}
          </span>
          {sublabel && (
            <span
              style={{
                fontSize: `${subFontSize}px`,
                color: '#64748b',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginTop: '2px',
                lineHeight: 1,
              }}
            >
              {sublabel}
            </span>
          )}
        </div>
      </div>
      {label && (
        <span
          style={{
            fontSize: `${labelFontSize}px`,
            fontWeight: 500,
            color: '#94a3b8',
            textAlign: 'center',
            lineHeight: 1.2,
            maxWidth: size,
            wordBreak: 'break-word',
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

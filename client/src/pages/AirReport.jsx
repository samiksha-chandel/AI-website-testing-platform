import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useSocket } from '../App';

const API_BASE = '/api';

export default function AirReport() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const socket = useSocket();
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiStatus, setAiStatus] = useState(null);
  const [polling, setPolling] = useState(false);
  const [aiHtml, setAiHtml] = useState(null);
  const [aiHtmlError, setAiHtmlError] = useState(null);
  const animRef = useRef(null);
  const animFrameRef = useRef(null);

  // Fetch the run metadata
  useEffect(() => {
    if (!runId) return;
    fetch(`${API_BASE}/runs/${runId}`)
      .then(r => r.json())
      .then(data => setRun(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [runId]);

  // Fetch AI status and start polling only while generating
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/runs/${runId}/ai-report/status`);
        if (!res.ok) return null;
        const data = await res.json();
        if (cancelled) return;
        setAiStatus(data);

        // Terminal states: not_started, completed, failed, rate_limited
        if (data.status !== 'generating') {
          if (polling) setPolling(false);
          // Stop the document-scanning overlay animation the moment any
          // terminal state is reached (completed, failed, or rate-limited).
          if (animFrameRef.current) {
            cancelAnimationFrame(animFrameRef.current);
            animFrameRef.current = null;
          }
          if (data.status === 'completed' && !aiHtml && !aiHtmlError) {
            fetchAiHtml();
          }
        } else if (!polling) {
          setPolling(true);
        }
      } catch (e) {
        if (polling) {
          setAiStatus(prev => ({ ...prev, status: 'failed', error: 'Failed to fetch AI report status' }));
        }
      }
    };

    fetchStatus();
    if (aiStatus?.status === 'generating') {
      const interval = setInterval(fetchStatus, 5000);
      return () => {
        cancelled = true;
        clearInterval(interval);
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = null;
        }
      };
    }
  }, [runId, polling, aiStatus, aiHtml, aiHtmlError]);

  const fetchAiHtml = async () => {
    try {
      const res = await fetch(`${API_BASE}/runs/${runId}/ai-report`);
      if (!res.ok) {
        setAiHtmlError('Failed to load the AI explained report');
        return;
      }
      const html = await res.text();
      setAiHtml(html);
    } catch (e) {
      setAiHtmlError('Failed to load the AI explained report');
    }
  };

  // If run is missing or loading failed early, bail out
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 py-12">
        <p className="text-slate-500">Run not found</p>
        <Link to="/reports" className="text-brand-400 hover:text-brand-300 text-sm mt-4 inline-block">← Back to Reports</Link>
      </div>
    );
  }

  const targetHostname = (() => {
    try { return new URL(run.target_url).hostname; } catch (e) { return run.target_url; }
  })();

  const isTerminal = aiStatus && (aiStatus.status === 'completed' || aiStatus.status === 'failed' || aiStatus.status === 'rate_limited');

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          to={`/run/${runId}`}
          className="text-sm text-slate-500 hover:text-slate-300 transition-colors inline-flex items-center gap-1 mb-4"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          ← Back to Original Report
        </Link>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">AI Explained Audit Report</h1>
            <p className="text-sm text-slate-500">{run.target_url}</p>
            <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
              <span>Run ID: <code className="font-mono text-slate-400">{runId?.substring(0, 8)}</code></span>
              <span>{targetHostname}</span>
              {run.started_at ? <span>{new Date(run.started_at).toLocaleString()}</span> : null}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {aiStatus?.status === 'completed' && (
              <>
                <a
                  href={`/api/runs/${runId}/ai-report/download`}
                  target="_blank"
                  rel="noopener"
                  className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all"
                >
                  Download AI Explained Report
                </a>
                <a
                  href={`/api/runs/${runId}/ai-report/pdf`}
                  target="_blank"
                  rel="noopener"
                  className="px-4 py-2 rounded-lg bg-brand-600/20 border border-brand-500/20 text-sm text-brand-400 hover:bg-brand-600/30 transition-all"
                >
                  Download AI Report (PDF)
                </a>
              </>
            )}
          </div>
        </div>
      </div>

      {/* not_started — report has not been generated */}
      {aiStatus?.status === 'not_started' && (
        <div className="rounded-2xl glass p-8">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold text-lg mb-1">AI report not generated</p>
              <p className="text-sm text-slate-400 mb-3">
                An AI-enhanced report has not been generated for this audit run yet.
                Generate one to get AI explanations for your findings.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => navigate(`/run/${runId}`)}
                  className="text-xs px-3 py-2 rounded-lg bg-brand-600/20 border border-brand-500/20 text-brand-400 hover:bg-brand-600/30 transition-all inline-flex items-center gap-1"
                >
                  View Original Report
                </button>
                <a
                  href={`/api/runs/${runId}/report`}
                  target="_blank"
                  className="text-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 transition-all inline-flex items-center gap-1"
                >
                  Download HTML Report
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Generating — scanning overlay */}
      {aiStatus?.status === 'generating' && (
        <AiScanningOverlay totalFindings={aiStatus?.totalFindings ?? 0} />
      )}

      {/* Completed — iframe with saved report */}
      {aiStatus?.status === 'completed' && (
        aiHtml ? (
          <div className="relative">
            <iframe
              srcDoc={aiHtml}
              title="AI explained report"
              className="w-full h-[70vh] rounded-xl border border-white/10 bg-white"
              style={{ minHeight: '600px' }}
            />
          </div>
        ) : (
          <div className="rounded-2xl glass p-8">
            <p className="text-slate-500">Loading AI report…</p>
          </div>
        )
      )}

      {/* Failed */}
      {aiStatus?.status === 'failed' && (
        <div className="rounded-2xl glass p-8">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.858c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5L13.732 16.5c.77.833-.192 2.5-1.732 2.5L4.082 16.5C2.5 16.5 1.5 14.833 2.3 13.5L12 9z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold text-lg mb-1">AI report generation failed</p>
              <p className="text-sm text-slate-400 mb-3">
                The AI report could not be generated. The original SitePulse report remains available.
              </p>
              {aiStatus?.error ? (
                <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                  {aiStatus.error}
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to={`/run/${runId}`}
                  className="text-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 transition-all inline-flex items-center gap-1"
                >
                  ← Back to Original Report
                </Link>
                <a
                  href={`/api/runs/${runId}/report`}
                  target="_blank"
                  className="text-xs px-3 py-2 rounded-lg bg-brand-600/20 hover:bg-brand-600/30 text-brand-400 transition-all inline-flex items-center gap-1"
                >
                  View Original HTML Report
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rate limited */}
      {aiStatus?.status === 'rate_limited' && (
        <div className="rounded-2xl glass p-8">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold text-lg mb-1">Groq daily limit reached</p>
              <p className="text-sm text-slate-400 mb-3">
                The AI explanation daily limit has been reached. Generation cannot continue until the limit resets.
              </p>
              {aiStatus?.partialCount != null && aiStatus.totalFindings != null && aiStatus.totalFindings > 0 ? (
                <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-400">
                  Partial AI explanations generated: {aiStatus.partialCount}/{aiStatus.totalFindings} findings.
                </div>
              ) : null}
              {aiStatus?.error && aiStatus.error !== 'Groq daily token limit reached' ? (
                <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                  {aiStatus.error}
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to={`/run/${runId}`}
                  className="text-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 transition-all inline-flex items-center gap-1"
                >
                  ← Back to Original Report
                </Link>
                <a
                  href={`/api/runs/${runId}/report`}
                  target="_blank"
                  className="text-xs px-3 py-2 rounded-lg bg-brand-600/20 hover:bg-brand-600/30 text-brand-400 transition-all inline-flex items-center gap-1"
                >
                  View Original HTML Report
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Polished document-scanning overlay shown while the AI report is genuinely
 * being generated. It runs a CSS/JS scanning line across a document card and
 * stops the moment any terminal state (completed / failed / rate_limited) is
 * reached by the parent component.
 */
function AiScanningOverlay({ totalFindings }) {
  const [scanY, setScanY] = useState(0);
  const cardRef = useRef(null);
  const animFrameRef = useRef(null);

  useEffect(() => {
    const cardEl = cardRef.current;
    if (!cardEl) return;

    const CARD_TOP = 0;
    const CARD_BOTTOM = cardEl.scrollHeight - 4;
    let start = null;
    const DURATION = 2600; // ms for one full top-to-bottom pass

    function frame(ts) {
      if (start === null) start = ts;
      const elapsed = ts - start;
      const progress = Math.min(elapsed / DURATION, 1);
      const y = CARD_TOP + (CARD_BOTTOM - CARD_TOP) * easeInOutCubic(progress);
      setScanY(y);
      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(frame);
      } else {
        // Loop the scan: restart at the top for a continuous scanning feel.
        start = null;
        animFrameRef.current = requestAnimationFrame(frame);
      }
    }

    animFrameRef.current = requestAnimationFrame(frame);
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, []);

  return (
    <div className="rounded-2xl glass p-8">
      <div className="animate-fade-in-up">
        <div className="flex items-start gap-5">
          {/* Document / report card illustration */}
          <div className="w-44 shrink-0 flex flex-col items-center">
            <div ref={cardRef} className="relative w-44 rounded-lg overflow-hidden ring-1 ring-white/10">
              {/* Paper */}
              <div className="bg-white/5 border border-white/10 rounded-lg p-4 pt-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-3 h-3 rounded-full bg-brand-500/40" />
                  <div className="w-3 h-3 rounded-full bg-blue-400/40" />
                  <div className="w-3 h-3 rounded-full bg-slate-500/30" />
                </div>
                {/* Simulated report lines */}
                {Array.from({ length: 7 }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-2.5 rounded-full bg-white/5 mb-2 last:mb-0 ${i < 2 ? 'w-3/4' : i === 2 ? 'w-4/5' : 'w-5/6'}`}
                  />
                ))}
                {/* Scanning line */}
                <div
                  className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-brand-400/70 to-transparent shadow-[0_0_8px_rgba(59,130,246,0.6)]"
                  style={{
                    top: scanY,
                    boxShadow: '0 0 10px rgba(59,130,246,0.55)',
                  }}
                />
                {/* Tiny analysis chips that fade in as the scan passes */}
                {totalFindings > 0 && scanY > 60 && (
                  <div className="absolute bottom-3 right-3 flex gap-1.5">
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">
                      CRITICAL
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">
                      HIGH
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/20">
                      MEDIUM
                    </span>
                  </div>
                )}
              </div>
              {/* Subtle scan glow */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: `linear-gradient(to bottom, transparent 0%, rgba(59,130,246,0.06) ${Math.min(100, (scanY / 112) * 100)}%, transparent 100%)`,
                }}
              />
            </div>
            {/* Small detail chips below the document */}
            {totalFindings > 0 && (
              <div className="mt-3 flex gap-1.5 flex-wrap justify-center">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-400">
                  {totalFindings} findings
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/15 text-amber-400">
                  AI reviewing
                </span>
              </div>
            )}
          </div>

          {/* Text */}
          <div className="min-w-0 flex-1">
            <p className="text-white font-semibold text-lg mb-1">Generating AI Explained Report</p>
            <p className="text-sm text-slate-400 mb-1">
              SitePulse AI is analyzing the important findings from your completed scan and adding explanations and remediation guidance. <br> This may take a while.</br>
            </p>
            <p className="text-sm text-slate-500 mb-3">
              Contacting Groq for explanations&hellip;
            </p>
            <div className="mt-3 text-xs text-slate-500 flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                <span className="font-mono">groq · gpt-oss-20b</span>
              </div>
              {totalFindings > 0 && (
                <span className="text-slate-500">
                  scanning {totalFindings} applicable findings
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

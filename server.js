import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { existsSync, readFileSync, mkdirSync, rmSync, readdirSync } from 'fs';

import store, {
  getAllWebsites, getOrCreateWebsite, getRecentRuns, getRun,
  getWebsiteRuns, getMonitoringHistory, updateRun,
  createMonitor, getAllMonitors, getMonitor, updateMonitor, deleteMonitor,
  pauseMonitor, resumeMonitor,
  createMonitoringRun, updateMonitoringRun, getMonitorRuns, getMonitorRunHistory, getLatestMonitorRun
} from './lib/db.js';
import { executeRun, cancelRun, isRunActive, getActiveRuns, reconcileStaleRuns } from './lib/runner.js';
import { generateHTMLReport, generatePDFReport } from './lib/reporter.js';
import { startMonitoring, runMonitorNow, executeMonitorCheck, getRunningMonitors } from './lib/monitor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT === '0' || !process.env.PORT ? 3001 : parseInt(process.env.PORT);
const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// ============ SECURITY: Basic input validation helpers ============
function isValidUrl(str) {
  try { new URL(str); return true; } catch { return false; }
}

function sanitizeId(id) {
  // UUID format only
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  socket.on('join:run', (runId) => {
    if (sanitizeId(runId)) socket.join(runId);
  });

  socket.on('join:monitor', (monitorId) => {
    if (sanitizeId(monitorId)) socket.join(`monitor:${monitorId}`);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// ============ API Routes ============

app.get('/api/websites', (req, res) => {
  try {
    res.json(getAllWebsites());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start a new validation run
app.post('/api/runs', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' });

    let parsedUrl;
    try { parsedUrl = new URL(url); } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const website = getOrCreateWebsite(parsedUrl.href);

    res.json({
      status: 'started',
      url: parsedUrl.href,
      message: 'Validation run started. Connect via WebSocket for real-time updates.'
    });

    executeRun(parsedUrl.href, io).catch(err => {
      console.error('Run error:', err);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stop/cancel a running scan
app.post('/api/runs/:runId/cancel', (req, res) => {
  try {
    const runId = sanitizeId(req.params.runId);
    if (!runId) return res.status(400).json({ error: 'Invalid run ID' });

    const cancelled = cancelRun(runId);
    if (cancelled) {
      res.json({ status: 'cancelled', message: 'Scan cancellation requested' });
    } else {
      // Run might not be active or might already be finished
      const run = getRun(runId);
      if (!run) return res.status(404).json({ error: 'Run not found' });
      if (run.status !== 'running' && run.status !== 'crawling') {
        return res.json({ status: 'already_finished', message: 'Run already finished' });
      }
      // If run is tracked but not cancellable, mark it
      res.json({ status: 'not_trackable', message: 'Run is not currently cancellable' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all runs
app.get('/api/runs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    res.json(getRecentRuns(limit));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get specific run with module results
app.get('/api/runs/:runId', (req, res) => {
  try {
    const runId = sanitizeId(req.params.runId);
    if (!runId) return res.status(400).json({ error: 'Invalid run ID' });
    const run = getRun(runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json(run);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a run and its associated data
app.delete('/api/runs/:runId', (req, res) => {
  try {
    const runId = sanitizeId(req.params.runId);
    if (!runId) return res.status(400).json({ error: 'Invalid run ID' });

    // Don't allow deletion of active runs
    if (isRunActive(runId)) {
      return res.status(409).json({ error: 'Cannot delete an active scan. Stop it first.' });
    }

    const run = store.getById('runs', runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    // Delete associated module results
    const modules = store.getAll('moduleResults').filter(m => m.run_id === runId);
    for (const mod of modules) {
      store.delete('moduleResults', mod.id);
    }

    // Delete the run
    store.delete('runs', runId);

    // Delete evidence directory
    const evidenceDir = join(__dirname, 'runs', runId);
    if (existsSync(evidenceDir)) {
      try {
        rmSync(evidenceDir, { recursive: true, force: true });
      } catch (e) {
        console.error('Failed to clean evidence directory:', e.message);
      }
    }

    res.json({ status: 'deleted', message: `Run ${runId} and ${modules.length} module results deleted` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get run evidence files
app.get('/api/runs/:runId/evidence/:file', (req, res) => {
  try {
    const runId = sanitizeId(req.params.runId);
    if (!runId) return res.status(400).json({ error: 'Invalid run ID' });
    const filePath = join(__dirname, 'runs', runId, req.params.file);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    const content = readFileSync(filePath, 'utf-8');
    try { res.json(JSON.parse(content)); } catch (e) {
      res.type('text/plain').send(content);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get run screenshot (from screenshots/ or evidence/ directory)
app.get('/api/runs/:runId/screenshots/:filename', (req, res) => {
  try {
    const runId = sanitizeId(req.params.runId);
    if (!runId) return res.status(400).json({ error: 'Invalid run ID' });
    const filename = req.params.filename;
    // Try evidence/ first, then screenshots/
    const evidencePath = join(__dirname, 'runs', runId, 'evidence', filename);
    const screenshotsPath = join(__dirname, 'runs', runId, 'screenshots', filename);
    if (existsSync(evidencePath)) return res.sendFile(evidencePath);
    if (existsSync(screenshotsPath)) return res.sendFile(screenshotsPath);
    return res.status(404).json({ error: 'Screenshot not found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate HTML report
app.get('/api/runs/:runId/report', (req, res) => {
  try {
    const runId = sanitizeId(req.params.runId);
    if (!runId) return res.status(400).json({ error: 'Invalid run ID' });
    const { reportPath } = generateHTMLReport(runId);
    res.sendFile(reportPath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate PDF report
app.get('/api/runs/:runId/report/pdf', async (req, res) => {
  try {
    const runId = sanitizeId(req.params.runId);
    if (!runId) return res.status(400).json({ error: 'Invalid run ID' });
    const pdfPath = await generatePDFReport(runId);
    if (!pdfPath) return res.status(500).json({ error: 'PDF generation failed' });
    res.sendFile(pdfPath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Legacy monitoring endpoints
app.get('/api/monitoring/:websiteId', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    res.json(getMonitoringHistory(req.params.websiteId, limit));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ MONITOR CRUD API ============

app.get('/api/monitors', (req, res) => {
  try { res.json(getAllMonitors()); } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/monitors/:monitorId', (req, res) => {
  try {
    const monitor = getMonitor(req.params.monitorId);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
    res.json(monitor);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/monitors', (req, res) => {
  try {
    const { name, url, intervalMinutes } = req.body;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' });
    if (!isValidUrl(url)) return res.status(400).json({ error: 'Invalid URL format' });

    const validIntervals = [1, 5, 15, 30, 60, 1440];
    const interval = validIntervals.includes(intervalMinutes) ? intervalMinutes : 60;

    const monitor = createMonitor({ name, url, intervalMinutes: interval });
    updateMonitor(monitor.id, { next_check_at: new Date().toISOString() });

    res.json(monitor);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/monitors/:monitorId', (req, res) => {
  try {
    const monitor = getMonitor(req.params.monitorId);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });

    const { name, url, intervalMinutes, enabled } = req.body;
    const updates = {};
    if (name !== undefined && typeof name === 'string') updates.name = name;
    if (url !== undefined) {
      if (!isValidUrl(url)) return res.status(400).json({ error: 'Invalid URL format' });
      updates.url = url;
    }
    if (intervalMinutes !== undefined) {
      const validIntervals = [1, 5, 15, 30, 60, 1440];
      updates.interval_minutes = validIntervals.includes(intervalMinutes) ? intervalMinutes : intervalMinutes;
    }
    if (enabled !== undefined) updates.enabled = enabled ? 1 : 0;

    const updated = updateMonitor(req.params.monitorId, updates);
    res.json(updated);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/monitors/:monitorId', (req, res) => {
  try {
    const monitor = getMonitor(req.params.monitorId);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
    deleteMonitor(req.params.monitorId);
    res.json({ status: 'deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/monitors/:monitorId/pause', (req, res) => {
  try {
    const monitor = pauseMonitor(req.params.monitorId);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
    res.json(monitor);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/monitors/:monitorId/resume', (req, res) => {
  try {
    const monitor = resumeMonitor(req.params.monitorId);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
    updateMonitor(req.params.monitorId, { next_check_at: new Date().toISOString() });
    res.json(monitor);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/monitors/:monitorId/run', async (req, res) => {
  try {
    const monitor = getMonitor(req.params.monitorId);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
    res.json({ status: 'started', monitorId: monitor.id });
    executeMonitorCheck(monitor, io).catch(err => console.error('Monitor run error:', err));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/monitors/:monitorId/runs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    res.json(getMonitorRuns(req.params.monitorId, limit));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/monitors/:monitorId/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    res.json(getMonitorRunHistory(req.params.monitorId, limit));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/monitoring-runs/:runId', (req, res) => {
  try {
    const run = store.getById('monitoringRuns', req.params.runId);
    if (!run) return res.status(404).json({ error: 'Monitoring run not found' });
    res.json(run);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/monitors/status/running', (req, res) => {
  try { res.json(getRunningMonitors()); } catch (error) { res.status(500).json({ error: error.message }); }
});

// Dashboard stats
app.get('/api/stats', (req, res) => {
  try {
    const totalRuns = store.count('runs');
    const completedRuns = store.count('runs', r => r.status === 'completed');
    const avgScore = store.avg('runs', 'overall_score', r => r.overall_score != null);
    const websites = store.count('websites');
    const activeMonitors = store.count('monitors', m => m.enabled === 1 || m.enabled === true);

    res.json({
      totalRuns,
      completedRuns,
      avgScore: avgScore ? Math.round(avgScore) : 0,
      websites,
      monitoringSites: activeMonitors
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============ HEALTH CHECK ============
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Serve static frontend (production build)
const clientDist = join(__dirname, 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(join(clientDist, 'index.html'));
    }
  });
}

// ============ GRACEFUL SHUTDOWN ============
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);

  // Cancel any active runs
  for (const runId of getActiveRuns()) {
    console.log(`  Cancelling run ${runId}...`);
    cancelRun(runId);
  }

  // Close HTTP server
  server.close(() => {
    console.log('✅ HTTP server closed.');
  });

  // Close Socket.IO
  io.close(() => {
    console.log('✅ Socket.IO closed.');
  });

  setTimeout(() => {
    console.log('👋 SitePulse shutdown complete.');
    process.exit(0);
  }, 3000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============ START SERVER ============
server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║          🚀 SitePulse v1.1.0             ║
  ║   AI Website Testing Platform             ║
  ║                                           ║
  ║   Server: http://localhost:${PORT}          ║
  ║   Status: Running ✓                       ║
  ╚═══════════════════════════════════════════╝
  `);

  // Reconcile stale runs from previous crashed sessions
  try { reconcileStaleRuns(); } catch (e) { console.error('Startup reconciliation error:', e.message); }

  startMonitoring(io);
});

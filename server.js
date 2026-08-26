import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { existsSync, readFileSync, mkdirSync } from 'fs';

import store, { 
  getAllWebsites, getOrCreateWebsite, getRecentRuns, getRun, 
  getWebsiteRuns, getMonitoringHistory, updateRun,
  createMonitor, getAllMonitors, getMonitor, updateMonitor, deleteMonitor,
  pauseMonitor, resumeMonitor,
  createMonitoringRun, updateMonitoringRun, getMonitorRuns, getMonitorRunHistory, getLatestMonitorRun
} from './lib/db.js';
import { executeRun } from './lib/runner.js';
import { generateHTMLReport, generatePDFReport } from './lib/reporter.js';
import { startMonitoring, runMonitorNow, executeMonitorCheck, getRunningMonitors } from './lib/monitor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT === '0' || !process.env.PORT ? 3001 : parseInt(process.env.PORT);
const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  
  socket.on('join:run', (runId) => {
    socket.join(runId);
  });

  socket.on('join:monitor', (monitorId) => {
    socket.join(`monitor:${monitorId}`);
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// ============ API Routes ============

// Get all websites
app.get('/api/websites', (req, res) => {
  try {
    const websites = getAllWebsites();
    res.json(websites);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start a new validation run
app.post('/api/runs', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    
    // Validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Execute run asynchronously
    const website = getOrCreateWebsite(parsedUrl.href);
    
    res.json({ 
      status: 'started', 
      url: parsedUrl.href,
      message: 'Validation run started. Connect via WebSocket for real-time updates.' 
    });

    // Run in background
    executeRun(parsedUrl.href, io).catch(err => {
      console.error('Run error:', err);
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all runs
app.get('/api/runs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const runs = getRecentRuns(limit);
    res.json(runs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get specific run with module results
app.get('/api/runs/:runId', (req, res) => {
  try {
    const run = getRun(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json(run);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get run evidence files
app.get('/api/runs/:runId/evidence/:file', (req, res) => {
  try {
    const filePath = join(__dirname, 'runs', req.params.runId, req.params.file);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    
    const content = readFileSync(filePath, 'utf-8');
    try {
      res.json(JSON.parse(content));
    } catch (e) {
      res.type('text/plain').send(content);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get run screenshot
app.get('/api/runs/:runId/screenshots/:filename', (req, res) => {
  try {
    const filePath = join(__dirname, 'runs', req.params.runId, 'screenshots', req.params.filename);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'Screenshot not found' });
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate HTML report
app.get('/api/runs/:runId/report', (req, res) => {
  try {
    const { reportPath } = generateHTMLReport(req.params.runId);
    res.sendFile(reportPath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate PDF report
app.get('/api/runs/:runId/report/pdf', async (req, res) => {
  try {
    const pdfPath = await generatePDFReport(req.params.runId);
    if (!pdfPath) return res.status(500).json({ error: 'PDF generation failed' });
    res.sendFile(pdfPath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Legacy monitoring endpoints (keep for backward compat)
app.get('/api/monitoring/:websiteId', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const history = getMonitoringHistory(req.params.websiteId, limit);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ MONITOR CRUD API ============

// List all monitors
app.get('/api/monitors', (req, res) => {
  try {
    const monitors = getAllMonitors();
    res.json(monitors);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a single monitor
app.get('/api/monitors/:monitorId', (req, res) => {
  try {
    const monitor = getMonitor(req.params.monitorId);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
    res.json(monitor);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new monitor
app.post('/api/monitors', (req, res) => {
  try {
    const { name, url, intervalMinutes } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // Validate URL
    try { new URL(url); } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const validIntervals = [1, 5, 15, 30, 60, 1440]; // 1min (dev), 5m, 15m, 30m, 1hr, 24hr
    const interval = validIntervals.includes(intervalMinutes) ? intervalMinutes : 60;

    const monitor = createMonitor({ name, url, intervalMinutes: interval });
    
    // Set initial next check time
    updateMonitor(monitor.id, {
      next_check_at: new Date().toISOString() // run immediately
    });

    res.json(monitor);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a monitor
app.put('/api/monitors/:monitorId', (req, res) => {
  try {
    const monitor = getMonitor(req.params.monitorId);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });

    const { name, url, intervalMinutes, enabled } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (url !== undefined) {
      try { new URL(url); } catch (e) {
        return res.status(400).json({ error: 'Invalid URL format' });
      }
      updates.url = url;
    }
    if (intervalMinutes !== undefined) {
      const validIntervals = [1, 5, 15, 30, 60, 1440];
      updates.interval_minutes = validIntervals.includes(intervalMinutes) ? intervalMinutes : intervalMinutes;
    }
    if (enabled !== undefined) updates.enabled = enabled ? 1 : 0;

    const updated = updateMonitor(req.params.monitorId, updates);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a monitor
app.delete('/api/monitors/:monitorId', (req, res) => {
  try {
    const monitor = getMonitor(req.params.monitorId);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });

    deleteMonitor(req.params.monitorId);
    res.json({ status: 'deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Pause a monitor
app.post('/api/monitors/:monitorId/pause', (req, res) => {
  try {
    const monitor = pauseMonitor(req.params.monitorId);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
    res.json(monitor);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resume a monitor
app.post('/api/monitors/:monitorId/resume', (req, res) => {
  try {
    const monitor = resumeMonitor(req.params.monitorId);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
    // Set next check to now
    updateMonitor(req.params.monitorId, { next_check_at: new Date().toISOString() });
    res.json(monitor);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Run monitor immediately
app.post('/api/monitors/:monitorId/run', async (req, res) => {
  try {
    const monitor = getMonitor(req.params.monitorId);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });

    res.json({ status: 'started', monitorId: monitor.id });

    // Execute in background
    executeMonitorCheck(monitor, io).catch(err => {
      console.error('Monitor run error:', err);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get monitoring runs for a monitor
app.get('/api/monitors/:monitorId/runs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const runs = getMonitorRuns(req.params.monitorId, limit);
    res.json(runs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get monitoring run history (for charts)
app.get('/api/monitors/:monitorId/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const history = getMonitorRunHistory(req.params.monitorId, limit);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a specific monitoring run
app.get('/api/monitoring-runs/:runId', (req, res) => {
  try {
    const run = getMonitorRunHistory ? 
      store.getById('monitoringRuns', req.params.runId) : null;
    if (!run) return res.status(404).json({ error: 'Monitoring run not found' });
    res.json(run);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get running monitors status
app.get('/api/monitors/status/running', (req, res) => {
  try {
    res.json(getRunningMonitors());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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

// Start server
server.listen(PORT, () => {
  console.log(`\n  ╔═══════════════════════════════════════════╗\n  ║          🚀 SitePulse v1.0.0             ║\n  ║   AI Website Testing Platform             ║\n  ║                                           ║\n  ║   Server: http://localhost:${PORT}          ║\n  ║   Status: Running ✓                       ║\n  ╚═══════════════════════════════════════════╝\n  `);
  
  // Start monitoring service
  startMonitoring(io);
});

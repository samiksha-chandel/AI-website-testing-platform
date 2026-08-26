import cron from 'node-cron';
import { 
  getAllMonitors, getMonitor, updateMonitor, 
  createMonitoringRun, updateMonitoringRun, getLatestMonitorRun,
  getOrCreateWebsite
} from './db.js';
import { executeRun } from './runner.js';

// Map of monitor ID -> cron job
const cronJobs = new Map();
// Map of monitor ID -> boolean (currently running)
const runningMonitors = new Map();

export function startMonitoring(io) {
  // Master cron that checks every 30 seconds for monitors needing execution
  cron.schedule('* * * * *', () => {
    checkAndRunMonitors(io);
  });

  console.log('📊 Monitoring scheduler started');
}

export async function checkAndRunMonitors(io) {
  const monitors = getAllMonitors().filter(m => m.enabled === 1 || m.enabled === true);
  const now = Date.now();

  for (const monitor of monitors) {
    // Skip if already running
    if (runningMonitors.get(monitor.id)) continue;

    // Check if it's time for a new check
    if (monitor.next_check_at) {
      const nextCheck = new Date(monitor.next_check_at).getTime();
      if (now < nextCheck) continue;
    } else {
      // First check - run immediately
      // But check if last check was recent enough
      if (monitor.last_checked_at) {
        const lastCheck = new Date(monitor.last_checked_at).getTime();
        const intervalMs = (monitor.interval_minutes || 60) * 60 * 1000;
        if (now - lastCheck < intervalMs) {
          // Set next check time
          updateMonitor(monitor.id, {
            next_check_at: new Date(lastCheck + intervalMs).toISOString()
          });
          continue;
        }
      }
    }

    // Execute monitoring check
    executeMonitorCheck(monitor, io);
  }
}

export async function executeMonitorCheck(monitor, io) {
  if (runningMonitors.get(monitor.id)) return;
  
  runningMonitors.set(monitor.id, true);
  
  try {
    // Update monitor status
    updateMonitor(monitor.id, { status: 'running' });

    // Emit monitoring started
    io?.emit('monitor:started', { 
      monitorId: monitor.id, 
      monitorName: monitor.name,
      url: monitor.url,
      startedAt: new Date().toISOString() 
    });

    // Get previous score
    const prevRun = getLatestMonitorRun(monitor.id);
    const previousScore = prevRun?.overall_score || null;

    // Create monitoring run record
    const monitorRun = createMonitoringRun(monitor.id);
    updateMonitoringRun(monitorRun.id, { previous_score: previousScore });

    // Execute the full scan pipeline
    const startTime = Date.now();

    // Emit module start events for each module
    const modules = ['crawler', 'functional', 'accessibility', 'performance', 'security', 'seo', 'brokenLinks'];
    for (const mod of modules) {
      io?.emit('monitor:module_started', { 
        monitorId: monitor.id, 
        module: mod,
        monitorRunId: monitorRun.id
      });
    }

    // Run the actual scan
    const completedRun = await executeRun(monitor.url, io);

    if (!completedRun) {
      throw new Error('Scan execution failed');
    }

    const durationMs = Date.now() - startTime;

    // Calculate findings counts
    let totalFindings = 0, critical = 0, high = 0, medium = 0, low = 0;
    const moduleScores = {};

    if (completedRun.modules) {
      for (const mod of completedRun.modules) {
        moduleScores[mod.module_name] = {
          score: mod.score,
          status: mod.status,
          duration_ms: mod.duration_ms
        };

        // Emit module completion events
        io?.emit('monitor:module_completed', {
          monitorId: monitor.id,
          module: mod.module_name,
          score: mod.score,
          status: mod.status,
          monitorRunId: monitorRun.id
        });

        if (mod.findings) {
          try {
            const findings = JSON.parse(mod.findings);
            totalFindings += findings.length;
            for (const f of findings) {
              const sev = (f.severity || '').toUpperCase();
              if (sev === 'CRITICAL') critical++;
              else if (sev === 'HIGH') high++;
              else if (sev === 'MEDIUM') medium++;
              else if (sev === 'LOW') low++;
            }
          } catch (e) {}
        }
      }
    }

    const scoreChange = (previousScore !== null && completedRun.overall_score !== null) 
      ? completedRun.overall_score - previousScore 
      : null;

    // Determine health status based on score
    let healthStatus = 'healthy';
    if (completedRun.overall_score !== null) {
      if (completedRun.overall_score < 50) healthStatus = 'critical';
      else if (completedRun.overall_score < 70) healthStatus = 'warning';
      else healthStatus = 'healthy';
    }

    // Update monitoring run
    updateMonitoringRun(monitorRun.id, {
      run_id: completedRun.id,
      status: 'completed',
      overall_score: completedRun.overall_score,
      previous_score: previousScore,
      score_change: scoreChange,
      module_scores: moduleScores,
      findings_count: totalFindings,
      critical_count: critical,
      high_count: high,
      medium_count: medium,
      low_count: low,
      duration_ms: durationMs,
      completed_at: new Date().toISOString()
    });

    // Calculate next check time
    const intervalMs = (monitor.interval_minutes || 60) * 60 * 1000;
    const nextCheck = new Date(Date.now() + intervalMs);

    // Update monitor
    updateMonitor(monitor.id, {
      status: healthStatus,
      current_score: completedRun.overall_score,
      previous_score: previousScore,
      score_change: scoreChange,
      last_checked_at: new Date().toISOString(),
      next_check_at: nextCheck.toISOString(),
      last_run_id: completedRun.id,
      total_checks: (monitor.total_checks || 0) + 1,
      current_findings_count: totalFindings,
      current_critical: critical,
      current_high: high,
      current_medium: medium,
      current_low: low
    });

    // Emit completion
    io?.emit('monitor:completed', {
      monitorId: monitor.id,
      monitorRunId: monitorRun.id,
      runId: completedRun.id,
      overallScore: completedRun.overall_score,
      previousScore,
      scoreChange,
      findingsCount: totalFindings,
      duration: durationMs,
      status: healthStatus,
      completedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error(`Monitor check failed for ${monitor.id}:`, error.message);

    // Update monitor status
    updateMonitor(monitor.id, { status: 'failed' });

    // Try to update the monitoring run if it exists
    const latestRuns = getAllMonitors(); // just to ensure no stale state

    io?.emit('monitor:failed', {
      monitorId: monitor.id,
      error: error.message,
      failedAt: new Date().toISOString()
    });
  } finally {
    runningMonitors.set(monitor.id, false);
  }
}

export async function runMonitorNow(monitorId, io) {
  const monitor = getMonitor(monitorId);
  if (!monitor) throw new Error('Monitor not found');
  
  // Force execute regardless of schedule
  return executeMonitorCheck(monitor, io);
}

export function getRunningMonitors() {
  const result = {};
  for (const [id, running] of runningMonitors) {
    result[id] = running;
  }
  return result;
}

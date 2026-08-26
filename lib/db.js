import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DB_FILE = join(DATA_DIR, 'sitepulse.json');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// Simple JSON file store
class Store {
  constructor() {
    this.data = this.load();
  }

  load() {
    try {
      if (existsSync(DB_FILE)) {
        return JSON.parse(readFileSync(DB_FILE, 'utf-8'));
      }
    } catch (e) {}
    return { websites: [], runs: [], moduleResults: [], monitoringChecks: [], monitors: [], monitoringRuns: [] };
  }

  save() {
    writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2));
  }

  // Generic CRUD
  getAll(collection) {
    return this.data[collection] || [];
  }

  getById(collection, id) {
    return (this.data[collection] || []).find(item => item.id === id);
  }

  insert(collection, record) {
    if (!this.data[collection]) this.data[collection] = [];
    this.data[collection].push(record);
    this.save();
    return record;
  }

  update(collection, id, updates) {
    const items = this.data[collection] || [];
    const idx = items.findIndex(item => item.id === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...updates };
    this.save();
    return items[idx];
  }

  delete(collection, id) {
    const items = this.data[collection] || [];
    const idx = items.findIndex(item => item.id === id);
    if (idx === -1) return false;
    items.splice(idx, 1);
    this.save();
    return true;
  }

  query(collection, filter, limit) {
    let items = this.data[collection] || [];
    if (filter) {
      items = items.filter(filter);
    }
    if (limit) {
      items = items.slice(-limit);
    }
    return items;
  }

  count(collection, filter) {
    if (filter) return this.getAll(collection).filter(filter).length;
    return (this.data[collection] || []).length;
  }

  avg(collection, field, filter) {
    let items = this.getAll(collection);
    if (filter) items = items.filter(filter);
    const valid = items.filter(i => i[field] != null);
    if (valid.length === 0) return null;
    return valid.reduce((sum, i) => sum + i[field], 0) / valid.length;
  }
}

const store = new Store();

// Ensure new collections exist
if (!store.data.monitors) store.data.monitors = [];
if (!store.data.monitoringRuns) store.data.monitoringRuns = [];
if (!store.data.monitoringChecks) store.data.monitoringChecks = [];

// Database API functions
export default store;

export function getOrCreateWebsite(url) {
  const existing = store.getAll('websites').find(w => w.url === url);
  if (existing) return existing;
  
  const id = crypto.randomUUID();
  const name = (() => { try { return new URL(url).hostname; } catch (e) { return url; } })();
  const website = {
    id,
    url,
    name,
    created_at: new Date().toISOString(),
    last_scan_at: null,
    monitoring_enabled: 0,
    monitoring_interval_minutes: 60
  };
  store.insert('websites', website);
  return website;
}

export function createRun(websiteId, targetUrl) {
  const id = crypto.randomUUID();
  const run = {
    id,
    website_id: websiteId,
    target_url: targetUrl,
    status: 'queued',
    overall_score: null,
    started_at: new Date().toISOString(),
    completed_at: null,
    duration_ms: null,
    error: null,
    crawl_data: null
  };
  store.insert('runs', run);
  return run;
}

export function updateRun(runId, updates) {
  return store.update('runs', runId, updates);
}

export function createModuleResult(runId, moduleName) {
  const id = crypto.randomUUID();
  const result = {
    id,
    run_id: runId,
    module_name: moduleName,
    status: 'queued',
    score: null,
    findings: null,
    metrics: null,
    evidence: null,
    raw_output: null,
    started_at: null,
    completed_at: null,
    duration_ms: null,
    error: null
  };
  store.insert('moduleResults', result);
  return result;
}

export function updateModuleResult(resultId, updates) {
  return store.update('moduleResults', resultId, updates);
}

export function getRun(runId) {
  const run = store.getById('runs', runId);
  if (!run) return null;
  const modules = store.query('moduleResults', m => m.run_id === runId);
  return { ...run, modules };
}

export function getRecentRuns(limit = 20) {
  return store.getAll('runs').slice(-limit).reverse();
}

export function getWebsiteRuns(websiteId, limit = 50) {
  return store.query('runs', r => r.website_id === websiteId, limit).reverse();
}

export function createMonitoringCheck(data) {
  const id = crypto.randomUUID();
  const check = {
    id,
    website_id: data.websiteId,
    check_type: data.checkType,
    status: data.status,
    response_time_ms: data.responseTimeMs,
    ssl_valid: data.sslValid ? 1 : 0,
    ssl_expiry: data.sslExpiry,
    http_status: data.httpStatus,
    uptime: data.uptime,
    checked_at: new Date().toISOString(),
    details: JSON.stringify(data.details || {})
  };
  store.insert('monitoringChecks', check);
  return id;
}

export function getMonitoringHistory(websiteId, limit = 100) {
  return store.query('monitoringChecks', c => c.website_id === websiteId, limit).reverse();
}

export function getAllWebsites() {
  return store.getAll('websites').reverse();
}

export function getStore() {
  return store;
}

// ============ MONITOR CRUD ============

export function createMonitor({ name, url, intervalMinutes }) {
  const id = crypto.randomUUID();
  const website = getOrCreateWebsite(url);
  const monitor = {
    id,
    name: name || new URL(url).hostname,
    url,
    website_id: website.id,
    status: 'healthy',
    enabled: 1,
    interval_minutes: intervalMinutes || 60,
    current_score: null,
    previous_score: null,
    score_change: null,
    last_checked_at: null,
    next_check_at: null,
    last_run_id: null,
    total_checks: 0,
    current_findings_count: 0,
    current_critical: 0,
    current_high: 0,
    current_medium: 0,
    current_low: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  store.insert('monitors', monitor);
  return monitor;
}

export function getAllMonitors() {
  return store.getAll('monitors').reverse();
}

export function getMonitor(monitorId) {
  return store.getById('monitors', monitorId);
}

export function updateMonitor(monitorId, updates) {
  return store.update('monitors', monitorId, { ...updates, updated_at: new Date().toISOString() });
}

export function deleteMonitor(monitorId) {
  // Also delete monitoring runs for this monitor
  const runs = store.getAll('monitoringRuns').filter(r => r.monitor_id === monitorId);
  for (const r of runs) {
    store.delete('monitoringRuns', r.id);
  }
  return store.delete('monitors', monitorId);
}

export function pauseMonitor(monitorId) {
  return updateMonitor(monitorId, { status: 'paused', enabled: 0 });
}

export function resumeMonitor(monitorId) {
  const monitor = getMonitor(monitorId);
  if (!monitor) return null;
  return updateMonitor(monitorId, { status: 'healthy', enabled: 1 });
}

// ============ MONITORING RUNS ============

export function createMonitoringRun(monitorId) {
  const id = crypto.randomUUID();
  const run = {
    id,
    monitor_id: monitorId,
    run_id: null, // will be linked after scan completes
    status: 'running',
    overall_score: null,
    previous_score: null,
    score_change: null,
    module_scores: {},
    findings_count: 0,
    critical_count: 0,
    high_count: 0,
    medium_count: 0,
    low_count: 0,
    duration_ms: null,
    started_at: new Date().toISOString(),
    completed_at: null,
    error: null
  };
  store.insert('monitoringRuns', run);
  return run;
}

export function updateMonitoringRun(runId, updates) {
  return store.update('monitoringRuns', runId, updates);
}

export function getMonitoringRun(runId) {
  return store.getById('monitoringRuns', runId);
}

export function getMonitorRuns(monitorId, limit = 50) {
  return store.query('monitoringRuns', r => r.monitor_id === monitorId, limit).reverse();
}

export function getLatestMonitorRun(monitorId) {
  const runs = store.query('monitoringRuns', r => r.monitor_id === monitorId && r.status === 'completed', 1);
  return runs[0] || null;
}

export function getMonitorRunHistory(monitorId, limit = 100) {
  return store.query('monitoringRuns', r => r.monitor_id === monitorId, limit).reverse();
}

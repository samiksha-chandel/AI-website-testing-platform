import { createModuleResult, updateModuleResult } from './db.js';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export async function runBrokenLinksCheck(crawlData, runId, io) {
  const result = createModuleResult(runId, 'brokenLinks');
  updateModuleResult(result.id, { status: 'running', started_at: new Date().toISOString() });
  io?.to(runId).emit('module:start', { module: 'brokenLinks', resultId: result.id });

  const startTime = Date.now();

  try {
    const allLinks = crawlData.links || [];
    const uniqueLinks = [...new Set(allLinks.map(l => l.href))];
    const linksToCheck = uniqueLinks.slice(0, 100); // Limit to 100 links

    io?.to(runId).emit('module:progress', { 
      module: 'brokenLinks', 
      message: `Checking ${linksToCheck.length} links...` 
    });

    const results = [];
    const brokenLinks = [];
    const redirectLinks = [];
    let checked = 0;

    // Check links in batches
    const batchSize = 10;
    for (let i = 0; i < linksToCheck.length; i += batchSize) {
      const batch = linksToCheck.slice(i, i + batchSize);
      
      const promises = batch.map(async (url) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          
          const response = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
            redirect: 'follow',
            headers: {
              'User-Agent': 'SitePulse/1.0 Link Checker'
            }
          });
          clearTimeout(timeout);
          
          const finalUrl = response.url;
          const status = response.status;
          const isRedirect = finalUrl !== url;
          
          checked++;
          
          if (status >= 400) {
            brokenLinks.push({ url, status, finalUrl });
            return { url, status, finalUrl, isBroken: true, isRedirect: false };
          } else if (isRedirect) {
            redirectLinks.push({ url, status, finalUrl });
            return { url, status, finalUrl, isBroken: false, isRedirect: true };
          } else {
            return { url, status, finalUrl, isBroken: false, isRedirect: false };
          }
        } catch (error) {
          checked++;
          const status = error.name === 'AbortError' ? 'TIMEOUT' : 'ERROR';
          brokenLinks.push({ url, status: status, error: error.message });
          return { url, status: status, isBroken: true, isRedirect: false, error: error.message };
        }
      });

      const batchResults = await Promise.all(promises);
      results.push(...batchResults);

      if (checked % 20 === 0 || checked === linksToCheck.length) {
        io?.to(runId).emit('module:progress', { 
          module: 'brokenLinks', 
          message: `Checked ${checked}/${linksToCheck.length} links...` 
        });
      }
    }

    // Calculate score
    const brokenCount = brokenLinks.length;
    const redirectCount = redirectLinks.length;
    const totalChecked = results.length;

    let score = 100;
    if (totalChecked > 0) {
      const brokenPct = brokenCount / totalChecked;
      const redirectPct = redirectCount / totalChecked;
      score -= brokenPct * 60;
      score -= redirectPct * 10;
      score = Math.max(0, Math.round(score));
    }

    const findings = [
      ...brokenLinks.map(l => ({
        type: 'broken',
        severity: l.status >= 500 ? 'HIGH' : 'MEDIUM',
        url: l.url,
        status: l.status,
        error: l.error,
        description: `Broken link: ${l.url} (Status: ${l.status})`
      })),
      ...redirectLinks.map(l => ({
        type: 'redirect',
        severity: 'LOW',
        url: l.url,
        status: l.status,
        redirectUrl: l.finalUrl,
        description: `Redirect: ${l.url} → ${l.finalUrl}`
      }))
    ];

    const metrics = {
      totalChecked,
      brokenCount,
      redirectCount,
      workingCount: totalChecked - brokenCount - redirectCount,
      externalLinks: crawlData.externalLinks?.length || 0,
      internalLinks: crawlData.internalLinks?.length || 0
    };

    const evidence = { results, brokenLinks, redirectLinks };

    const runsDir = join(__dirname, '..', 'runs', runId);
    if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, 'brokenLinks.json'), JSON.stringify(evidence, null, 2));

    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'completed',
      score,
      findings: JSON.stringify(findings),
      metrics: JSON.stringify(metrics),
      evidence: JSON.stringify({ summary: `${brokenCount} broken links, ${redirectCount} redirects out of ${totalChecked} checked` }),
      raw_output: JSON.stringify(evidence),
      completed_at: new Date().toISOString(),
      duration_ms: duration
    });

    io?.to(runId).emit('module:complete', { module: 'brokenLinks', resultId: result.id, score, duration });
    return { score, findings, metrics };

  } catch (error) {
    const duration = Date.now() - startTime;
    updateModuleResult(result.id, {
      status: 'error',
      score: null,
      error: `Broken links check failed: ${error.message}`,
      completed_at: new Date().toISOString(),
      duration_ms: duration
    });
    io?.to(runId).emit('module:error', { module: 'brokenLinks', error: error.message });
    return { score: null, status: 'ERROR', error: error.message };
  }
}

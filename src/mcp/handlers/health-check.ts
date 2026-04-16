import { textResponse } from '../helpers';
import { toolDefinitions } from '../tools';

const startTime = Date.now();

/**
 * Health check handler — returns server status, uptime, memory usage,
 * active browser count, and available tools.
 */
export async function handleHealthCheck(_rawArgs: unknown) {
  const mem = process.memoryUsage();

  const result = {
    status: 'ok',
    version: '1.0.3',
    uptimeSeconds: Math.round((Date.now() - startTime) / 1000),
    memory: {
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      rssMB: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
    },
    activeBrowserInstances: getActiveBrowserCount(),
    toolsAvailable: toolDefinitions.map((t) => t.name),
    toolCount: toolDefinitions.length,
  };

  return textResponse(result);
}

/**
 * Count active Playwright browser instances by checking child processes.
 * This is a best-effort heuristic — counts chromium/firefox/webkit child processes.
 */
function getActiveBrowserCount(): number {
  try {
    const { execSync } = require('child_process');
    const output = execSync(
      'pgrep -f "chromium|firefox|webkit" 2>/dev/null | wc -l',
      { encoding: 'utf-8', timeout: 2000 },
    ).trim();
    return parseInt(output, 10) || 0;
  } catch {
    return 0;
  }
}

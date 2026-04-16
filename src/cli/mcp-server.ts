#!/usr/bin/env node
/**
 * MCP Server — Design System Extractor
 *
 * Thin entry point: creates the MCP server, registers tools, routes to handlers.
 *
 * Production features:
 *   - Rate limiting (sliding window, 10 req/min/tool)
 *   - Audit trail logging (~/.liftit/audit.jsonl)
 *   - Graceful shutdown (SIGINT/SIGTERM, 30s hard timeout)
 *   - Health check tool
 *
 * Tools:
 *   - extract_design_system   Full extraction → design system JSON
 *   - extract_component       Targeted component scan → styles, animations, layout
 *   - get_design_tokens       Quick extraction → colors, typography, spacing
 *   - copy_assets             Copy fonts/images/SVGs into rebuild + generate @font-face CSS
 *   - validate_rebuild        Pixel-level rebuild vs original comparison
 *   - validate_site           Site consistency / drift check
 *   - validate_diff           Incremental diff with severity-ranked corrections
 *   - run_pipeline            Full orchestration pipeline (scan → analyze → validate)
 *   - interact                Perform browser interactions and capture state changes
 *   - health_check            Server status, uptime, memory, tools
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { log } from '../core/utils';
import { toolDefinitions } from '../mcp/tools';
import { handleRebuildSite } from '../mcp/handlers/rebuild-site';
import { handleGenerateComponent } from '../mcp/handlers/generate-component';
import { handleExportTokens } from '../mcp/handlers/export-tokens';
import { handleGetDesignTokens } from '../mcp/handlers/get-design-tokens';
import { handleValidate } from '../mcp/handlers/validate';
import { handleMatchComponent } from '../mcp/handlers/match-component';
import { handleGetDisplayPatterns } from '../mcp/handlers/get-display-patterns';
import { handleDescribeExtraction } from '../mcp/handlers/describe-extraction';
import { handleSuggestWorkflow } from '../mcp/handlers/suggest-workflow';
import { handleGetPerformanceReport } from '../mcp/handlers/get-performance-report';
import { handleGetSiteFeatures } from '../mcp/handlers/get-site-features';
import { handleInteract } from '../mcp/handlers/interact';
import { handleExportDesignMd } from '../mcp/handlers/export-design-md';

// ── Rate Limiter ────────────────────────────────────────────────────────────

const RATE_LIMIT_MAX = 10; // requests per window
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

/** Sliding window rate limiter — stores timestamps per tool */
const rateLimitBuckets: Map<string, number[]> = new Map();

function checkRateLimit(toolName: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  let timestamps = rateLimitBuckets.get(toolName) || [];
  // Prune expired entries
  timestamps = timestamps.filter((t) => t > windowStart);
  rateLimitBuckets.set(toolName, timestamps);

  if (timestamps.length >= RATE_LIMIT_MAX) {
    // Earliest timestamp in window — when it expires, a slot opens
    const retryAfterMs = timestamps[0] - windowStart;
    return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000) };
  }

  timestamps.push(now);
  return { allowed: true };
}

// ── Audit Trail ─────────────────────────────────────────────────────────────

const AUDIT_DIR = path.join(os.homedir(), '.liftit');
const AUDIT_FILE = path.join(AUDIT_DIR, 'audit.jsonl');

function ensureAuditDir(): void {
  try {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  } catch {
    // Best effort — don't crash if we can't create the dir
  }
}

/** Sanitize args: remove auth tokens and long string values */
function sanitizeArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (/auth|cookie|token|password|secret|key/i.test(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 200) {
      sanitized[key] = value.slice(0, 50) + '...[truncated]';
    } else {
      sanitized[key] = value;
    }
  }
  return JSON.stringify(sanitized);
}

function hashArgs(args: unknown): string {
  const sanitized = sanitizeArgs(args);
  return crypto.createHash('sha256').update(sanitized).digest('hex').slice(0, 12);
}

interface AuditEntry {
  timestamp: string;
  tool: string;
  argsHash: string;
  durationMs: number;
  status: 'success' | 'error';
  error?: string;
}

function writeAuditEntry(entry: AuditEntry): void {
  try {
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');
  } catch {
    // Best effort — don't crash if audit write fails
  }
}

// ── Active Call Tracking (for graceful shutdown) ────────────────────────────

let activeCallCount = 0;
let isShuttingDown = false;

// ── Server ───────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'liftit', version: '1.0.3' },
  { capabilities: { tools: {} } },
);

// ── Tool list ────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions,
}));

// ── Router ───────────────────────────────────────────────────────────────────

const handlers: Record<string, (args: unknown) => Promise<{ content: { type: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean }>> = {
  rebuild_site: handleRebuildSite,
  generate_component: handleGenerateComponent,
  export_tokens: handleExportTokens,
  export_design_md: handleExportDesignMd,
  get_design_tokens: handleGetDesignTokens,
  validate: handleValidate,
  match_component: handleMatchComponent,
  get_display_patterns: handleGetDisplayPatterns,
  describe_extraction: handleDescribeExtraction,
  suggest_workflow: handleSuggestWorkflow,
  get_performance_report: handleGetPerformanceReport,
  get_site_features: handleGetSiteFeatures,
  interact: handleInteract,
};

server.setRequestHandler(CallToolRequestSchema, async (request, _extra) => {
  const { name, arguments: args } = request.params;
  const handler = handlers[name];
  if (!handler) throw new Error(`Unknown tool: ${name}`);

  // ── Rate limit check ────────────────────────────────────────────────────
  const rateResult = checkRateLimit(name);
  if (!rateResult.allowed) {
    const retryAfterSec = Math.ceil((rateResult.retryAfterMs || 1000) / 1000);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'rate_limit_exceeded',
          message: `Rate limit exceeded for tool "${name}". Max ${RATE_LIMIT_MAX} requests per minute.`,
          retryAfterSeconds: retryAfterSec,
          retryAfterMs: rateResult.retryAfterMs,
        }, null, 2),
      }],
      isError: true,
    };
  }

  // ── Execute with audit + active call tracking ───────────────────────────
  const startMs = Date.now();
  const argsHash = hashArgs(args);
  activeCallCount++;

  try {
    const result = await handler(args || {});

    writeAuditEntry({
      timestamp: new Date().toISOString(),
      tool: name,
      argsHash,
      durationMs: Date.now() - startMs,
      status: 'success',
    });

    return result;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    writeAuditEntry({
      timestamp: new Date().toISOString(),
      tool: name,
      argsHash,
      durationMs: Date.now() - startMs,
      status: 'error',
      error: errorMessage,
    });

    throw err;
  } finally {
    activeCallCount--;
  }
});

// ── Graceful Shutdown ───────────────────────────────────────────────────────

const SHUTDOWN_TIMEOUT_MS = 30_000;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log('MCPServer', 'warn', `Shutting down... (${signal})`);

  // Wait for active calls to complete, polling every 500ms
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
  while (activeCallCount > 0 && Date.now() < deadline) {
    log('MCPServer', 'info', `Waiting for ${activeCallCount} active call(s) to complete...`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (activeCallCount > 0) {
    log('MCPServer', 'warn', `Hard timeout reached with ${activeCallCount} active call(s). Forcing exit.`);
  }

  try {
    await server.close();
    log('MCPServer', 'info', 'Server closed cleanly.');
  } catch (err) {
    log('MCPServer', 'error', `Error closing server: ${err}`);
  }

  process.exit(0);
}

process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });

// ── Start ────────────────────────────────────────────────────────────────────

async function main() {
  ensureAuditDir();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('MCPServer', 'info', 'Liftit server started');
}

main().catch((err) => {
  log('MCPServer', 'error', `Fatal error: ${err}`);
  process.exit(1);
});

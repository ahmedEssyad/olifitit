/**
 * Shared utilities for the design-system-extractor pipeline.
 *
 * Provides:
 *   - withBrowser / withContext — Playwright lifecycle management with guaranteed cleanup
 *   - withRetry — retry wrapper with exponential backoff
 *   - safeReadJSON — JSON file reading with structured errors
 *   - PipelineError — typed error class
 *   - log — structured logger
 */

import { chromium, Browser, BrowserContext } from 'playwright';
import * as fs from 'fs';

// ── Errors (re-exported from errors.ts) ──────────────────────────────────────

import {
  PipelineError as _PipelineError,
  NetworkError as _NetworkError,
  TimeoutError as _TimeoutError,
  BrowserError as _BrowserError,
  ValidationError as _ValidationError,
  ConfigError as _ConfigError,
} from './errors';

export {
  PipelineError,
  NetworkError,
  TimeoutError,
  BrowserError,
  ValidationError,
  ConfigError,
} from './errors';

export type {
  NetworkErrorCode,
  TimeoutErrorCode,
  BrowserErrorCode,
  ValidationErrorCode,
  ConfigErrorCode,
} from './errors';

// ── Logger (re-exported from logger.ts) ──────────────────────────────────────

import { log as _log } from './logger';

export { log, createLogger, Logger } from './logger';
export type { LogLevel, LogFormat } from './logger';

// Local aliases for internal use within this file
const PipelineError = _PipelineError;
const log = _log;

// ── Browser Lifecycle ─────────────────────────────────────────────────────────

export interface BrowserOptions {
  headless?: boolean;
  args?: string[];
}

/**
 * Launches a Chromium browser, passes it to `fn`, and guarantees `browser.close()`
 * on both success and error paths.
 */
export async function withBrowser<T>(
  fn: (browser: Browser) => Promise<T>,
  opts?: BrowserOptions,
): Promise<T> {
  const browser = await chromium.launch({
    headless: opts?.headless ?? true,
    args: opts?.args,
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close().catch((err: Error) =>
      log('utils', 'warn', `browser.close() failed: ${err.message}`),
    );
  }
}

/**
 * Creates a browser context from the given browser, passes it to `fn`, and
 * guarantees `context.close()`.
 */
export async function withContext<T>(
  browser: Browser,
  contextOpts: Parameters<Browser['newContext']>[0],
  fn: (context: BrowserContext) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext(contextOpts);
  try {
    return await fn(context);
  } finally {
    await context.close().catch((err: Error) =>
      log('utils', 'warn', `context.close() failed: ${err.message}`),
    );
  }
}

// ── Retry ─────────────────────────────────────────────────────────────────────

export interface RetryOptions {
  retries?: number;
  backoffMs?: number;
  label?: string;
}

/**
 * Retries `fn` up to `retries` times with exponential backoff.
 * Does NOT retry programmer errors (TypeError, ReferenceError, SyntaxError).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const retries = opts?.retries ?? 2;
  const backoffMs = opts?.backoffMs ?? 1000;
  const label = opts?.label ?? 'operation';

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      // Don't retry programmer errors
      if (
        error instanceof TypeError ||
        error instanceof ReferenceError ||
        error instanceof SyntaxError
      ) {
        throw error;
      }

      lastError = error;

      if (attempt < retries) {
        const delay = backoffMs * Math.pow(2, attempt);
        log('utils', 'warn', `${label} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// ── Safe JSON ─────────────────────────────────────────────────────────────────

/**
 * Reads and parses a JSON file with structured error reporting.
 * Optionally validates the parsed data with a type guard.
 */
export function safeReadJSON<T = unknown>(
  filePath: string,
  validate?: (data: unknown) => data is T,
): T {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    throw new PipelineError(
      `Failed to read file: ${filePath} — ${error.message}`,
      'io',
      'read',
      false,
      'IO_READ_FAILED',
      error,
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    throw new PipelineError(
      `Failed to parse JSON: ${filePath} — ${error.message}`,
      'io',
      'parse',
      false,
      'JSON_PARSE_FAILED',
      error,
    );
  }

  if (validate && !validate(data)) {
    throw new PipelineError(
      `Invalid data format in ${filePath}`,
      'io',
      'validate',
      false,
      'DATA_VALIDATION_FAILED',
    );
  }

  return data as T;
}

// ── CSS Selector Escaping ─────────────────────────────────────────────────────

/**
 * Escapes special characters in a CSS selector string so it is safe to pass to
 * `querySelector` / `querySelectorAll`.
 *
 * Only class-name segments are escaped — tag names, IDs, attribute selectors,
 * combinators (` `, `>`, `~`, `+`), and pseudo-classes written by hand remain
 * untouched.
 *
 * Characters escaped inside each class token:
 *   `[`  `]`  `:` — Tailwind responsive / variant prefixes  (e.g. `md:flex`, `hover:bg-white`)
 *   `.` followed by a digit — decimal values                  (e.g. `py-2.5`)
 *   `/`  `@`  `%`  `!`  `(` `)` — other chars Tailwind uses in JIT classes
 */
export function escapeCSSSelector(selector: string): string {
  // Split on CSS combinators and spaces while keeping the delimiters
  const parts = selector.split(/([\s>~+]+)/);

  return parts.map((part) => {
    // Preserve combinator/whitespace tokens as-is
    if (/^[\s>~+]+$/.test(part)) return part;

    // A simple token is e.g. `div.foo.bar`, `#id`, `[attr="val"]`
    // We only want to escape within class segments (tokens starting with `.`)
    // Strategy: split on `.` but re-join carefully so we only touch class names.
    // Approach: find class portions and escape them.
    return part.replace(
      // Match a dot followed by a class name (not a pseudo-class like :nth-child)
      /\.(-?[_a-zA-Z][^\s.#\[:>~+]*)/g,
      (_match, className: string) => {
        const escaped = className
          .replace(/\[/g, '\\[')
          .replace(/\]/g, '\\]')
          .replace(/:/g, '\\:')
          .replace(/\//g, '\\/')
          .replace(/@/g, '\\@')
          .replace(/%/g, '\\%')
          .replace(/!/g, '\\!')
          .replace(/\(/g, '\\(')
          .replace(/\)/g, '\\)')
          // Escape `.` only when followed by a digit (e.g. `2.5` in `py-2.5`)
          .replace(/\.(?=\d)/g, '\\.');
        return `.${escaped}`;
      }
    );
  }).join('');
}

// ── Schema Validators ─────────────────────────────────────────────────────────

export function isScanResult(data: unknown): data is Record<string, unknown> & {
  url: string;
  domTree: unknown[];
  responsiveSnapshots: unknown[];
} {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.url === 'string' &&
    Array.isArray(d.domTree) &&
    Array.isArray(d.responsiveSnapshots)
  );
}

export function isAnalysisResult(data: unknown): data is Record<string, unknown> & {
  components: unknown[];
} {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.components);
}

// ── Step Result ───────────────────────────────────────────────────────────────

export interface StepResult {
  step: string;
  status: 'success' | 'failed' | 'skipped';
  durationMs: number;
  error?: string;
  outputFiles?: string[];
}

/**
 * Runs a pipeline step function, capturing timing and error info.
 */
export async function runPipelineStep(
  stepName: string,
  fn: () => Promise<unknown>,
  optional: boolean = false,
): Promise<StepResult> {
  log(stepName, 'info', 'Starting...');
  const start = Date.now();

  try {
    await fn();
    const durationMs = Date.now() - start;
    log(stepName, 'info', `Completed in ${(durationMs / 1000).toFixed(1)}s`);
    return { step: stepName, status: 'success', durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err : new Error(String(err));

    if (optional) {
      log(stepName, 'warn', `Failed (optional step, continuing): ${error.message}`);
      return { step: stepName, status: 'failed', durationMs, error: error.message };
    }

    log(stepName, 'error', `FAILED: ${error.message}`);
    return { step: stepName, status: 'failed', durationMs, error: error.message };
  }
}

// ── File Watcher ──────────────────────────────────────────────────────────────

/**
 * Waits for a file to appear, using fs.watch + polling fallback.
 * Returns true if found, false on timeout.
 */
export function waitForFile(filePath: string, timeoutSec: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (fs.existsSync(filePath)) {
      resolve(true);
      return;
    }

    const timeoutMs = timeoutSec * 1000;
    const dir = require('path').dirname(filePath);
    const basename = require('path').basename(filePath);

    let resolved = false;
    const done = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      if (watcher) watcher.close();
      if (timer) clearTimeout(timer);
      if (pollInterval) clearInterval(pollInterval);
      resolve(result);
    };

    // fs.watch for instant detection
    let watcher: fs.FSWatcher | null = null;
    try {
      watcher = fs.watch(dir, (_: string, filename: string | null) => {
        if (filename === basename && fs.existsSync(filePath)) {
          done(true);
        }
      });
    } catch (e) {
      log('Utils', 'debug', `fs.watch unavailable, using polling fallback: ${(e as Error).message}`);
    }

    // Polling fallback every 3 seconds
    const pollInterval = setInterval(() => {
      if (fs.existsSync(filePath)) done(true);
    }, 3000);

    // Timeout
    const timer = setTimeout(() => done(false), timeoutMs);
  });
}

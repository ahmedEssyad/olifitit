/**
 * Enhanced browser utilities with timeout and abort support.
 *
 * Provides:
 *   - withTimeout  — races a promise against a deadline
 *   - withAbort    — cancels a promise when an AbortSignal fires
 *   - withBrowserSafe — upgraded withBrowser with AbortSignal + graceful cleanup
 */

import { chromium, Browser } from 'playwright';
import { TimeoutError } from './errors';
import { log } from './logger';

// ── Timeout ─────────────────────────────────────────────────────────────────

/**
 * Races `fn()` against a timeout. If the timeout fires first, throws a
 * `TimeoutError` with code `OPERATION_TIMEOUT`.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new TimeoutError(
          `${label} timed out after ${ms}ms`,
          'browser',
          label,
          'OPERATION_TIMEOUT',
          ms,
        ),
      );
    }, ms);
  });

  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ── Abort ───────────────────────────────────────────────────────────────────

/**
 * Wraps `fn` so that it rejects when the given `signal` is aborted.
 * If no signal is provided, `fn` runs without abort support.
 */
export async function withAbort<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) {
    const controller = new AbortController();
    return fn(controller.signal);
  }

  if (signal.aborted) {
    throw new TimeoutError(
      'Operation aborted before it started',
      'browser',
      'abort',
      'OPERATION_TIMEOUT',
      0,
    );
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(
        new TimeoutError(
          'Operation aborted',
          'browser',
          'abort',
          'OPERATION_TIMEOUT',
          0,
        ),
      );
    };

    signal.addEventListener('abort', onAbort, { once: true });

    fn(signal).then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

// ── Browser with Abort ──────────────────────────────────────────────────────

export interface BrowserSafeOptions {
  headless?: boolean;
  signal?: AbortSignal;
}

/**
 * Enhanced version of `withBrowser` that supports AbortSignal.
 *
 * - On abort, closes the browser and throws a TimeoutError.
 * - Wraps `browser.close()` errors gracefully (logs warnings instead of throwing).
 */
export async function withBrowserSafe<T>(
  fn: (browser: Browser) => Promise<T>,
  opts?: BrowserSafeOptions,
): Promise<T> {
  const headless = opts?.headless ?? true;
  const signal = opts?.signal;

  // Check abort before launching
  if (signal?.aborted) {
    throw new TimeoutError(
      'Browser launch aborted before it started',
      'browser',
      'launch',
      'OPERATION_TIMEOUT',
      0,
    );
  }

  const browser = await chromium.launch({ headless });

  const closeBrowser = async () => {
    try {
      await browser.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('browser', 'warn', `browser.close() failed: ${message}`);
    }
  };

  // If signal provided, wire up abort listener
  if (signal) {
    if (signal.aborted) {
      await closeBrowser();
      throw new TimeoutError(
        'Browser launch aborted',
        'browser',
        'launch',
        'OPERATION_TIMEOUT',
        0,
      );
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;

      const onAbort = async () => {
        if (settled) return;
        settled = true;
        await closeBrowser();
        reject(
          new TimeoutError(
            'Browser operation aborted',
            'browser',
            'abort',
            'OPERATION_TIMEOUT',
            0,
          ),
        );
      };

      signal.addEventListener('abort', onAbort, { once: true });

      fn(browser).then(
        async (value) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          await closeBrowser();
          resolve(value);
        },
        async (err) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          await closeBrowser();
          reject(err);
        },
      );
    });
  }

  // No signal — same behavior as withBrowser but with graceful close
  try {
    return await fn(browser);
  } finally {
    await closeBrowser();
  }
}

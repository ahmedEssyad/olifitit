/**
 * Input validation and security utilities.
 *
 * Provides:
 *   - validateUrl     — parse + reject dangerous protocols
 *   - normalizePath   — resolve + confine to a base directory
 *   - sanitizeSelector — basic CSS selector sanity check
 */

import * as path from 'path';
import { ValidationError } from './errors';
import { log } from './logger';

// ── URL Validation ──────────────────────────────────────────────────────────

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Parses `url` and rejects non-http(s) protocols.
 * Warns (but allows) plain `http://`.
 * Returns the parsed URL object.
 */
export function validateUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(
      `Invalid URL: ${url}`,
      'security',
      'url-validation',
      'INVALID_URL',
      'url',
      'Could not parse the provided string as a URL',
    );
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new ValidationError(
      `Disallowed protocol "${parsed.protocol}" in URL: ${url}`,
      'security',
      'url-validation',
      'INVALID_URL',
      'url',
      `Only http and https protocols are allowed. Got: ${parsed.protocol}`,
    );
  }

  if (parsed.protocol === 'http:') {
    log(
      'security',
      'warn',
      `URL uses http:// (insecure): ${url} — consider using https://`,
    );
  }

  return parsed;
}

// ── Path Normalization ──────────────────────────────────────────────────────

/**
 * Resolves `requested` relative to `base`, then verifies the result lives
 * inside `base`. Throws `ValidationError` with code `INVALID_PATH` on
 * directory traversal attempts.
 */
export function normalizePath(base: string, requested: string): string {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(resolvedBase, requested);
  const normalized = path.normalize(resolved);

  if (!normalized.startsWith(resolvedBase + path.sep) && normalized !== resolvedBase) {
    throw new ValidationError(
      `Path "${requested}" escapes base directory "${base}"`,
      'security',
      'path-validation',
      'INVALID_PATH',
      'path',
      `Resolved path "${normalized}" is outside base "${resolvedBase}"`,
    );
  }

  return normalized;
}

// ── CSS Selector Sanitization ───────────────────────────────────────────────

/**
 * Basic sanity check for a CSS selector string.
 * Rejects selectors that contain script injection patterns or obviously
 * dangerous content. Returns the selector unchanged if it passes.
 */
export function sanitizeSelector(selector: string): string {
  if (typeof selector !== 'string' || selector.trim().length === 0) {
    throw new ValidationError(
      'CSS selector must be a non-empty string',
      'security',
      'selector-validation',
      'INVALID_INPUT',
      'selector',
      'Empty or non-string selector provided',
    );
  }

  // Reject selectors containing script-injection patterns
  const dangerous = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,      // onclick=, onerror=, etc.
    /expression\s*\(/i, // CSS expression()
    /url\s*\(\s*['"]?javascript:/i,
    /<\/?\w/,           // Any HTML tags
  ];

  for (const pattern of dangerous) {
    if (pattern.test(selector)) {
      throw new ValidationError(
        `CSS selector contains potentially dangerous content: ${selector}`,
        'security',
        'selector-validation',
        'INVALID_INPUT',
        'selector',
        `Matched dangerous pattern: ${pattern.source}`,
      );
    }
  }

  return selector;
}

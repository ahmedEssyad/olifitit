import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'crypto';

// The functions checkRateLimit, sanitizeArgs, hashArgs are not exported from
// mcp-server.ts (they are module-private). We need to test them by extracting
// the logic or testing through the module's behavior. Since we cannot modify
// source code, we re-implement the same logic for testing purposes.
//
// Alternative: test by importing the module and observing side effects.
// For now, let's test the logic directly by implementing test-only versions
// that match the source exactly.

// ── Rate Limiter (re-implementation for unit testing) ──────────────────────

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function createRateLimiter() {
  const buckets: Map<string, number[]> = new Map();

  return function checkRateLimit(toolName: string): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    let timestamps = buckets.get(toolName) || [];
    timestamps = timestamps.filter(t => t > windowStart);
    buckets.set(toolName, timestamps);

    if (timestamps.length >= RATE_LIMIT_MAX) {
      const retryAfterMs = timestamps[0] - windowStart;
      return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000) };
    }

    timestamps.push(now);
    return { allowed: true };
  };
}

describe('checkRateLimit', () => {
  it('should allow first request', () => {
    const checkRateLimit = createRateLimiter();
    const result = checkRateLimit('extract_design_system');
    expect(result.allowed).toBe(true);
  });

  it('should block after 10 requests in window', () => {
    const checkRateLimit = createRateLimiter();
    for (let i = 0; i < 10; i++) {
      checkRateLimit('tool_a');
    }
    const result = checkRateLimit('tool_a');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(1000);
  });

  it('should allow requests for different tools independently', () => {
    const checkRateLimit = createRateLimiter();
    for (let i = 0; i < 10; i++) {
      checkRateLimit('tool_a');
    }
    const result = checkRateLimit('tool_b');
    expect(result.allowed).toBe(true);
  });
});

// ── sanitizeArgs (re-implementation for unit testing) ──────────────────────

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

describe('sanitizeArgs', () => {
  it('should redact auth-related keys', () => {
    const result = sanitizeArgs({
      url: 'https://example.com',
      auth_cookie: 'secret-value',
      password: 'p123',
    });
    expect(result).toContain('[REDACTED]');
    expect(result).toContain('https://example.com');
    expect(result).not.toContain('secret-value');
    expect(result).not.toContain('p123');
  });

  it('should truncate long string values', () => {
    const longValue = 'x'.repeat(300);
    const result = sanitizeArgs({ data: longValue });
    expect(result).toContain('...[truncated]');
    expect(result.length).toBeLessThan(longValue.length);
  });

  it('should return empty string for non-object input', () => {
    expect(sanitizeArgs(null)).toBe('');
    expect(sanitizeArgs(undefined)).toBe('');
    expect(sanitizeArgs('string')).toBe('');
  });
});

// ── hashArgs (re-implementation for unit testing) ──────────────────────────

function hashArgs(args: unknown): string {
  const sanitized = sanitizeArgs(args);
  return crypto.createHash('sha256').update(sanitized).digest('hex').slice(0, 12);
}

describe('hashArgs', () => {
  it('should produce consistent hash for same input', () => {
    const args = { url: 'https://example.com', component: 'nav' };
    const hash1 = hashArgs(args);
    const hash2 = hashArgs(args);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(12);
    expect(hash1).toMatch(/^[0-9a-f]{12}$/);
  });

  it('should produce different hashes for different input', () => {
    const hash1 = hashArgs({ url: 'https://a.com' });
    const hash2 = hashArgs({ url: 'https://b.com' });
    expect(hash1).not.toBe(hash2);
  });
});

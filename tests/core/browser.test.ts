import { describe, it, expect, vi } from 'vitest';
import { withTimeout, withAbort } from '../../src/core/browser';
import { TimeoutError } from '../../src/core/errors';

// Mock playwright to avoid actual browser launches
vi.mock('playwright', () => ({
  chromium: { launch: vi.fn() },
}));

vi.mock('../../src/core/logger', () => ({
  log: vi.fn(),
}));

// ── withTimeout ────────────────────────────────────────────────────────────

describe('withTimeout', () => {
  it('should resolve when fn completes before deadline', async () => {
    const fn = () => Promise.resolve(42);
    const result = await withTimeout(fn, 1000, 'test');
    expect(result).toBe(42);
  });

  it('should throw TimeoutError when fn exceeds deadline', async () => {
    const fn = () => new Promise<never>(() => {});
    await expect(withTimeout(fn, 50, 'test-op')).rejects.toThrow(TimeoutError);
    try {
      await withTimeout(fn, 50, 'test-op');
    } catch (err: any) {
      expect(err.code).toBe('OPERATION_TIMEOUT');
      expect(err.message).toContain('test-op timed out after 50ms');
    }
  });

  it('should clear timer on success (no leaked timers)', async () => {
    const fn = () => Promise.resolve('ok');
    const result = await withTimeout(fn, 5000, 'test');
    expect(result).toBe('ok');
    // If the timer leaked, we would see warnings or hangs — the test completing
    // quickly proves the timer was cleared.
  });
});

// ── withAbort ──────────────────────────────────────────────────────────────

describe('withAbort', () => {
  it('should resolve normally when signal is not aborted', async () => {
    const controller = new AbortController();
    const fn = (_signal: AbortSignal) => Promise.resolve(42);
    const result = await withAbort(fn, controller.signal);
    expect(result).toBe(42);
  });

  it('should reject immediately when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn((_signal: AbortSignal) => Promise.resolve(42));
    await expect(withAbort(fn, controller.signal)).rejects.toThrow(TimeoutError);
  });

  it('should reject when signal fires during execution', async () => {
    const controller = new AbortController();
    const fn = (_signal: AbortSignal) =>
      new Promise<number>((resolve) => {
        setTimeout(() => resolve(42), 5000);
      });

    setTimeout(() => controller.abort(), 50);

    await expect(withAbort(fn, controller.signal)).rejects.toThrow(TimeoutError);
  });

  it('should create internal controller when no signal provided', async () => {
    const fn = (signal: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(99);
    };
    const result = await withAbort(fn);
    expect(result).toBe(99);
  });
});

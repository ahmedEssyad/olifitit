import { describe, it, expect, vi } from 'vitest';
import { escapeCSSSelector, withRetry } from '../../src/core/utils';

describe('escapeCSSSelector', () => {
  it('preserves normal selectors like div.flex.gap-8', () => {
    const result = escapeCSSSelector('div.flex.gap-8');
    expect(result).toBe('div.flex.gap-8');
  });

  it('preserves combinators and whitespace', () => {
    const result = escapeCSSSelector('div.container > span.text');
    expect(result).toContain(' > ');
    expect(result).toContain('div.container');
    expect(result).toContain('span.text');
  });

  it('escapes slashes within class names', () => {
    // Tailwind classes with slashes like w-1/2
    const result = escapeCSSSelector('div.w-1\\/2');
    expect(result).toContain('div.');
  });

  it('handles tag-only selectors', () => {
    expect(escapeCSSSelector('div')).toBe('div');
    expect(escapeCSSSelector('span')).toBe('span');
  });

  it('handles id selectors', () => {
    expect(escapeCSSSelector('#main')).toBe('#main');
  });

  it('handles multiple class selectors', () => {
    const result = escapeCSSSelector('div.foo.bar.baz');
    expect(result).toBe('div.foo.bar.baz');
  });
});

describe('withRetry', () => {
  it('succeeds on first try', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { retries: 3, backoffMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { retries: 3, backoffMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('gives up after max retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(withRetry(fn, { retries: 2, backoffMs: 10 }))
      .rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('does not retry programmer errors (TypeError)', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('bad code'));
    await expect(withRetry(fn, { retries: 3, backoffMs: 10 }))
      .rejects.toThrow(TypeError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

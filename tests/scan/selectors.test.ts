import { describe, it, expect } from 'vitest';
import { escapeClassToken } from '../../src/scan/selectors';

// NOTE: generateStableSelector requires a real DOM (document.querySelectorAll),
// so it cannot be unit-tested without JSDOM or Playwright. Only escapeClassToken
// is a pure function testable in Node context.

describe('escapeClassToken', () => {
  it('escapes Tailwind pseudo-class prefixes (colons)', () => {
    expect(escapeClassToken('hover:text-white')).toBe('hover\\:text-white');
    expect(escapeClassToken('md:flex')).toBe('md\\:flex');
    expect(escapeClassToken('focus:ring-2')).toBe('focus\\:ring-2');
  });

  it('escapes arbitrary value brackets', () => {
    expect(escapeClassToken('max-w-[1600px]')).toBe('max-w-\\[1600px\\]');
    expect(escapeClassToken('bg-[#ff0000]')).toBe('bg-\\[#ff0000\\]');
  });

  it('escapes decimal dots before digits', () => {
    expect(escapeClassToken('py-2.5')).toBe('py-2\\.5');
    expect(escapeClassToken('opacity-0.5')).toBe('opacity-0\\.5');
  });

  it('does not escape dots not followed by digits', () => {
    // A class like "foo.bar" — the dot is NOT before a digit, so no escape
    expect(escapeClassToken('foo.bar')).toBe('foo.bar');
  });

  it('escapes slashes', () => {
    expect(escapeClassToken('w-1/2')).toBe('w-1\\/2');
  });

  it('escapes @ symbols', () => {
    expect(escapeClassToken('@container')).toBe('\\@container');
  });

  it('escapes percent signs', () => {
    expect(escapeClassToken('w-100%')).toBe('w-100\\%');
  });

  it('escapes exclamation marks (important modifier)', () => {
    expect(escapeClassToken('!text-red')).toBe('\\!text-red');
  });

  it('escapes parentheses', () => {
    expect(escapeClassToken('bg-[rgb(0,0,0)]')).toBe('bg-\\[rgb\\(0,0,0\\)\\]');
  });

  it('passes through normal classes unchanged', () => {
    expect(escapeClassToken('flex')).toBe('flex');
    expect(escapeClassToken('mt-4')).toBe('mt-4');
    expect(escapeClassToken('text-gray-700')).toBe('text-gray-700');
    expect(escapeClassToken('container')).toBe('container');
  });

  it('handles multiple special characters in one class', () => {
    expect(escapeClassToken('hover:bg-[#fff]')).toBe('hover\\:bg-\\[#fff\\]');
  });
});

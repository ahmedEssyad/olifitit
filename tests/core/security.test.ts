import { describe, it, expect } from 'vitest';
import { validateUrl, normalizePath, sanitizeSelector } from '../../src/core/security';
import { ValidationError } from '../../src/core/errors';

describe('validateUrl', () => {
  it('accepts https:// URLs', () => {
    const result = validateUrl('https://example.com');
    expect(result).toBeInstanceOf(URL);
    expect(result.protocol).toBe('https:');
  });

  it('accepts http:// URLs (with warning)', () => {
    const result = validateUrl('http://example.com');
    expect(result).toBeInstanceOf(URL);
    expect(result.protocol).toBe('http:');
  });

  it('rejects file:// protocol', () => {
    expect(() => validateUrl('file:///etc/passwd')).toThrow(ValidationError);
  });

  it('rejects javascript: protocol', () => {
    expect(() => validateUrl('javascript:alert(1)')).toThrow(ValidationError);
  });

  it('rejects data: protocol', () => {
    expect(() => validateUrl('data:text/html,<h1>hi</h1>')).toThrow(ValidationError);
  });

  it('rejects ftp:// protocol', () => {
    expect(() => validateUrl('ftp://files.example.com')).toThrow(ValidationError);
  });

  it('rejects invalid strings', () => {
    expect(() => validateUrl('not a url')).toThrow(ValidationError);
  });

  it('rejects empty string', () => {
    expect(() => validateUrl('')).toThrow(ValidationError);
  });
});

describe('normalizePath', () => {
  it('allows paths within base directory', () => {
    const result = normalizePath('/tmp/output', 'subdir/file.json');
    expect(result).toContain('/tmp/output/subdir/file.json');
  });

  it('allows the base directory itself', () => {
    const result = normalizePath('/tmp/output', '.');
    expect(result).toMatch(/\/tmp\/output$/);
  });

  it('rejects directory traversal attempts', () => {
    expect(() => normalizePath('/tmp/output', '../../../etc/passwd')).toThrow(ValidationError);
  });

  it('rejects traversal with intermediate segments', () => {
    expect(() => normalizePath('/tmp/output', 'foo/../../../../../../etc/shadow')).toThrow(ValidationError);
  });
});

describe('sanitizeSelector', () => {
  it('allows normal CSS selectors', () => {
    expect(sanitizeSelector('div.class > a')).toBe('div.class > a');
    expect(sanitizeSelector('#id .foo')).toBe('#id .foo');
    expect(sanitizeSelector('[data-role="button"]')).toBe('[data-role="button"]');
  });

  it('rejects <script', () => {
    expect(() => sanitizeSelector('<script>alert(1)</script>')).toThrow(ValidationError);
  });

  it('rejects javascript:', () => {
    expect(() => sanitizeSelector('a[href="javascript:void(0)"]')).toThrow(ValidationError);
  });

  it('rejects onload=', () => {
    expect(() => sanitizeSelector('img[onload="alert(1)"]')).toThrow(ValidationError);
  });

  it('rejects onclick=', () => {
    expect(() => sanitizeSelector('div[onclick="evil()"]')).toThrow(ValidationError);
  });

  it('rejects empty string', () => {
    expect(() => sanitizeSelector('')).toThrow(ValidationError);
  });

  it('rejects HTML tags', () => {
    expect(() => sanitizeSelector('<div>')).toThrow(ValidationError);
  });
});

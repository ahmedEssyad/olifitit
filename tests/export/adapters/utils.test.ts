import { describe, it, expect } from 'vitest';
import {
  parseRgb,
  rgbToHex,
  rgbToHsl,
  rgbToHslString,
  slugify,
  buildSpacingMap,
  parsePx,
  buildRadiusMap,
  classifyFont,
  parseFontStack,
  dedup,
} from '../../../src/export/adapters/utils';

// ── parseRgb ────────────────────────────────────────────────────────────────

describe('parseRgb', () => {
  it('parses rgb()', () => {
    expect(parseRgb('rgb(255, 0, 128)')).toEqual({ r: 255, g: 0, b: 128, a: 1 });
  });

  it('parses rgba()', () => {
    expect(parseRgb('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
  });

  it('returns null for non-rgb strings', () => {
    expect(parseRgb('#ff0000')).toBeNull();
    expect(parseRgb('hsl(0, 100%, 50%)')).toBeNull();
    expect(parseRgb('red')).toBeNull();
  });

  it('defaults alpha to 1 when omitted', () => {
    const result = parseRgb('rgb(0, 0, 0)');
    expect(result?.a).toBe(1);
  });
});

// ── rgbToHex ────────────────────────────────────────────────────────────────

describe('rgbToHex', () => {
  it('converts rgb to hex', () => {
    expect(rgbToHex('rgb(255, 255, 255)')).toBe('#ffffff');
    expect(rgbToHex('rgb(0, 0, 0)')).toBe('#000000');
    expect(rgbToHex('rgb(255, 0, 0)')).toBe('#ff0000');
  });

  it('includes alpha channel when < 1', () => {
    expect(rgbToHex('rgba(255, 0, 0, 0.5)')).toBe('#ff000080');
  });

  it('returns input unchanged for non-rgb strings', () => {
    expect(rgbToHex('#aabbcc')).toBe('#aabbcc');
    expect(rgbToHex('blue')).toBe('blue');
  });
});

// ── rgbToHsl ────────────────────────────────────────────────────────────────

describe('rgbToHsl', () => {
  it('converts pure red', () => {
    const hsl = rgbToHsl('rgb(255, 0, 0)');
    expect(hsl).toEqual({ h: 0, s: 100, l: 50, a: 1 });
  });

  it('converts pure green', () => {
    const hsl = rgbToHsl('rgb(0, 128, 0)');
    expect(hsl).not.toBeNull();
    expect(hsl!.h).toBe(120);
  });

  it('converts pure blue', () => {
    const hsl = rgbToHsl('rgb(0, 0, 255)');
    expect(hsl).toEqual({ h: 240, s: 100, l: 50, a: 1 });
  });

  it('converts white to 0 saturation, 100 lightness', () => {
    const hsl = rgbToHsl('rgb(255, 255, 255)');
    expect(hsl).toEqual({ h: 0, s: 0, l: 100, a: 1 });
  });

  it('converts black to 0 saturation, 0 lightness', () => {
    const hsl = rgbToHsl('rgb(0, 0, 0)');
    expect(hsl).toEqual({ h: 0, s: 0, l: 0, a: 1 });
  });

  it('preserves alpha', () => {
    const hsl = rgbToHsl('rgba(255, 0, 0, 0.3)');
    expect(hsl?.a).toBe(0.3);
  });

  it('returns null for non-rgb input', () => {
    expect(rgbToHsl('not-a-color')).toBeNull();
  });
});

// ── rgbToHslString ──────────────────────────────────────────────────────────

describe('rgbToHslString', () => {
  it('formats as shadcn HSL string', () => {
    expect(rgbToHslString('rgb(255, 0, 0)')).toBe('0 100% 50%');
  });

  it('returns input for non-rgb', () => {
    expect(rgbToHslString('invalid')).toBe('invalid');
  });
});

// ── slugify ─────────────────────────────────────────────────────────────────

describe('slugify', () => {
  it('lowercases and replaces spaces', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('removes quotes', () => {
    expect(slugify("'Open Sans'")).toBe('open-sans');
  });

  it('strips leading/trailing hyphens', () => {
    expect(slugify('--test--')).toBe('test');
  });

  it('collapses special characters', () => {
    expect(slugify('A & B + C')).toBe('a-b-c');
  });
});

// ── buildSpacingMap ─────────────────────────────────────────────────────────

describe('buildSpacingMap', () => {
  it('maps px values to tailwind keys (px/4)', () => {
    const map = buildSpacingMap([4, 8, 16]);
    expect(map).toEqual({ '1': '4px', '2': '8px', '4': '16px' });
  });

  it('handles half-unit keys', () => {
    const map = buildSpacingMap([6]);
    expect(map).toEqual({ '1.5': '6px' });
  });

  it('uses sp-N fallback for non-clean keys', () => {
    const map = buildSpacingMap([7]);
    expect(map).toEqual({ 'sp-7': '7px' });
  });

  it('deduplicates values', () => {
    const map = buildSpacingMap([4, 4, 4]);
    expect(Object.keys(map)).toHaveLength(1);
  });

  it('skips zero and negative', () => {
    const map = buildSpacingMap([0, -4, 8]);
    expect(map).toEqual({ '2': '8px' });
  });
});

// ── parsePx ─────────────────────────────────────────────────────────────────

describe('parsePx', () => {
  it('parses pixel values', () => {
    expect(parsePx('16px')).toBe(16);
    expect(parsePx('0.5rem')).toBe(0.5);
  });

  it('returns 0 for non-numeric', () => {
    expect(parsePx('auto')).toBe(0);
  });
});

// ── buildRadiusMap ──────────────────────────────────────────────────────────

describe('buildRadiusMap', () => {
  it('maps radius values to named keys', () => {
    const map = buildRadiusMap([{ value: '0px' }, { value: '4px' }, { value: '8px' }]);
    expect(map['none']).toBe('0px');
    expect(Object.keys(map)).toHaveLength(3);
  });

  it('assigns "full" for 9999px', () => {
    const map = buildRadiusMap([{ value: '9999px' }]);
    expect(map['full']).toBe('9999px');
  });

  it('filters out non-px values', () => {
    const map = buildRadiusMap([{ value: '50%' }, { value: '4px' }]);
    expect(Object.keys(map)).toHaveLength(1);
  });

  it('deduplicates same px values', () => {
    const map = buildRadiusMap([{ value: '4px' }, { value: '4px' }]);
    expect(Object.keys(map)).toHaveLength(1);
  });
});

// ── classifyFont ────────────────────────────────────────────────────────────

describe('classifyFont', () => {
  it('classifies monospace fonts', () => {
    expect(classifyFont('JetBrains Mono')).toBe('mono');
    expect(classifyFont('Fira Code')).toBe('mono');
    expect(classifyFont('Consolas')).toBe('mono');
    expect(classifyFont('Courier New')).toBe('mono');
  });

  it('classifies serif fonts', () => {
    expect(classifyFont('Georgia')).toBe('serif');
    expect(classifyFont('Times New Roman')).toBe('serif');
    expect(classifyFont('Playfair Display')).toBe('serif');
    expect(classifyFont('Garamond')).toBe('serif');
  });

  it('classifies display fonts', () => {
    expect(classifyFont('Inter Display')).toBe('display');
  });

  it('defaults to sans', () => {
    expect(classifyFont('Inter')).toBe('sans');
    expect(classifyFont('Helvetica')).toBe('sans');
    expect(classifyFont('Arial')).toBe('sans');
  });
});

// ── parseFontStack ──────────────────────────────────────────────────────────

describe('parseFontStack', () => {
  it('splits a CSS font stack', () => {
    expect(parseFontStack('"Inter", Arial, sans-serif')).toEqual([
      'Inter',
      'Arial',
      'sans-serif',
    ]);
  });

  it('strips quotes from font names', () => {
    expect(parseFontStack("'Open Sans', serif")).toEqual(['Open Sans', 'serif']);
  });
});

// ── dedup ───────────────────────────────────────────────────────────────────

describe('dedup', () => {
  it('removes duplicates', () => {
    expect(dedup([1, 2, 2, 3, 1])).toEqual([1, 2, 3]);
  });

  it('works with strings', () => {
    expect(dedup(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('returns empty for empty', () => {
    expect(dedup([])).toEqual([]);
  });
});

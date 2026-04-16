/**
 * Adapter utilities — color conversion, naming helpers.
 */

// ── Color Parsing ───────────────────────────────────────────────────────────

interface ParsedColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

const RGB_RE = /rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/;

export function parseRgb(value: string): ParsedColor | null {
  const m = value.match(RGB_RE);
  if (!m) return null;
  return {
    r: parseInt(m[1], 10),
    g: parseInt(m[2], 10),
    b: parseInt(m[3], 10),
    a: m[4] !== undefined ? parseFloat(m[4]) : 1,
  };
}

export function rgbToHex(value: string): string {
  const c = parseRgb(value);
  if (!c) return value; // return as-is if unparseable

  const hex = (n: number) => n.toString(16).padStart(2, '0');
  const base = `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
  if (c.a < 1) {
    return `${base}${hex(Math.round(c.a * 255))}`;
  }
  return base;
}

export function rgbToHsl(value: string): { h: number; s: number; l: number; a: number } | null {
  const c = parseRgb(value);
  if (!c) return null;

  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return {
    h: Math.round(h * 360 * 10) / 10,
    s: Math.round(s * 100 * 10) / 10,
    l: Math.round(l * 100 * 10) / 10,
    a: c.a,
  };
}

/** Format as shadcn HSL string: "H S% L%" (no hsl() wrapper) */
export function rgbToHslString(value: string): string {
  const hsl = rgbToHsl(value);
  if (!hsl) return value;
  return `${hsl.h} ${hsl.s}% ${hsl.l}%`;
}

// ── Naming ──────────────────────────────────────────────────────────────────

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Spacing ─────────────────────────────────────────────────────────────────

/**
 * Map a numeric px spacing scale to Tailwind-style keys.
 * Uses the standard Tailwind convention: value / 4 for the key.
 * E.g., 4px → "1", 8px → "2", 16px → "4", 6px → "1.5"
 */
export function buildSpacingMap(scale: number[]): Record<string, string> {
  const map: Record<string, string> = {};
  const sorted = [...new Set(scale)].sort((a, b) => a - b);

  for (const px of sorted) {
    if (px <= 0) continue;
    const key = px / 4;
    // Use clean key if it's a nice number, otherwise use px value
    if (Number.isInteger(key) || key * 2 === Math.round(key * 2)) {
      map[String(key)] = `${px}px`;
    } else {
      map[`sp-${px}`] = `${px}px`;
    }
  }
  return map;
}

// ── Dedup / Sort ────────────────────────────────────────────────────────────

export function dedup<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

export function parsePx(value: string): number {
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}

// ── Border Radius Naming ────────────────────────────────────────────────────

const RADIUS_NAMES = ['none', 'sm', 'DEFAULT', 'md', 'lg', 'xl', '2xl', '3xl', 'full'];

export function buildRadiusMap(values: { value: string; usage?: string }[]): Record<string, string> {
  // If values have semantic names (usage field), use them directly
  const hasUsageNames = values.some(v => v.usage && v.usage !== 'none');
  if (hasUsageNames) {
    const map: Record<string, string> = {};
    for (const v of values) {
      const key = v.usage || `r-${values.indexOf(v)}`;
      map[key] = v.value;
    }
    return map;
  }

  // Fallback: filter to simple px/rem values, deduplicate, sort
  const pxValues = values
    .map(v => v.value)
    .filter(v => (v.endsWith('px') || v.endsWith('rem')) && !v.includes(' '))
    .map(v => ({ raw: v, px: v.endsWith('rem') ? parseFloat(v) * 16 : parsePx(v) }));

  const unique = [...new Map(pxValues.map(v => [v.px, v])).values()]
    .sort((a, b) => a.px - b.px);

  const map: Record<string, string> = {};

  for (let i = 0; i < unique.length; i++) {
    const v = unique[i];
    if (v.px === 0) {
      map['none'] = v.raw;
    } else if (v.px >= 999) {
      map['full'] = v.raw;
    } else if (i < RADIUS_NAMES.length) {
      map[RADIUS_NAMES[i] || `r-${v.px}`] = v.raw;
    } else {
      map[`r-${v.px}`] = v.raw;
    }
  }
  return map;
}

// ── Font Family Helpers ─────────────────────────────────────────────────────

/** Classify a font family into a Tailwind category */
export function classifyFont(name: string): 'sans' | 'serif' | 'mono' | 'display' {
  const lower = name.toLowerCase();
  if (/mono|code|jetbrains|fira\s*code|consolas|courier/i.test(lower)) return 'mono';
  if (/serif|georgia|times|garamond|playfair/i.test(lower)) return 'serif';
  if (/display|inter\s*display/i.test(lower)) return 'display';
  return 'sans';
}

/** Parse a CSS font stack into an array of font names */
export function parseFontStack(stack: string): string[] {
  return stack.split(',').map(f => f.trim().replace(/^["']|["']$/g, ''));
}

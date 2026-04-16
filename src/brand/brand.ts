/**
 * Brand override system for Liftit.
 *
 * Loads a BrandConfig (custom colors, fonts, content replacements),
 * builds intelligent color/font mappings against extracted DesignData,
 * and produces a new DesignData with brand overrides applied.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigError } from '../core/errors';
import type { DesignData } from '../export/adapters/reader';
import { parseRgb, classifyFont } from '../export/adapters/utils';

// ── Zod Schema ──────────────────────────────────────────────────────────────

export const BrandConfigSchema = z.object({
  colors: z.object({
    primary: z.string(),
    secondary: z.string().optional(),
    accent: z.string().optional(),
    background: z.string().optional(),
    surface: z.string().optional(),
    text: z.string().optional(),
    textMuted: z.string().optional(),
    border: z.string().optional(),
  }),
  fonts: z.object({
    body: z.string().optional(),
    heading: z.string().optional(),
    mono: z.string().optional(),
  }).optional(),
  content: z.record(z.string(), z.string()).optional(),
});

export type BrandConfig = z.infer<typeof BrandConfigSchema>;

// ── Internal Color Helpers ──────────────────────────────────────────────────

const HEX_RE = /^#([0-9a-fA-F]{3,8})$/;

interface RGB {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parse any CSS color string (hex or rgb/rgba) into RGB components. */
function parseColor(value: string): RGB | null {
  const trimmed = value.trim();

  // Try rgb/rgba via the adapter utility
  const fromRgb = parseRgb(trimmed);
  if (fromRgb) return fromRgb;

  // Try hex
  const hexMatch = trimmed.match(HEX_RE);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    } else if (hex.length === 4) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  return null;
}

/** Relative luminance per WCAG 2.1. */
function relativeLuminance(c: RGB): number {
  const srgb = [c.r, c.g, c.b].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

/** Convert RGB to HSL (h in [0,360], s/l in [0,100]). */
function rgbToHslComponents(c: RGB): { h: number; s: number; l: number } {
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
  };
}

/** Convert HSL to RGB. */
function hslToRgb(h: number, s: number, l: number): RGB {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let rr = 0, gg = 0, bb = 0;
  if (h < 60) { rr = c; gg = x; }
  else if (h < 120) { rr = x; gg = c; }
  else if (h < 180) { gg = c; bb = x; }
  else if (h < 240) { gg = x; bb = c; }
  else if (h < 300) { rr = x; bb = c; }
  else { rr = c; bb = x; }
  return {
    r: Math.round((rr + m) * 255),
    g: Math.round((gg + m) * 255),
    b: Math.round((bb + m) * 255),
    a: 1,
  };
}

/** Format RGB as a CSS rgb/rgba string. */
function formatRgb(c: RGB): string {
  if (c.a < 1) {
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
  }
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

/** Format RGB as hex. */
function formatHex(c: RGB): string {
  const hex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  const base = `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
  if (c.a < 1) {
    return `${base}${hex(Math.round(c.a * 255))}`;
  }
  return base;
}

/** Check if a string looks like an rgb/rgba value. */
function isRgbFormat(value: string): boolean {
  return /^rgba?\(/.test(value.trim());
}

/** Hue distance on the 360-degree wheel. */
function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

// ── Load Brand Config ───────────────────────────────────────────────────────

const BRAND_FILE = '.liftit-brand.json';

/**
 * Load a BrandConfig from a JSON file.
 *
 * - If `configPath` is provided, reads that file directly.
 * - Otherwise looks for `.liftit-brand.json` in cwd, then home dir.
 * - Validates with Zod schema.
 * - Returns null if no file found.
 * - Throws ConfigError if file exists but is invalid.
 */
export function loadBrandConfig(configPath?: string): BrandConfig | null {
  const candidates: string[] = [];

  if (configPath) {
    candidates.push(path.resolve(configPath));
  } else {
    candidates.push(path.join(process.cwd(), BRAND_FILE));
    candidates.push(path.join(os.homedir(), BRAND_FILE));
  }

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;

    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
    } catch (err) {
      throw new ConfigError(
        `Failed to parse brand config at ${candidate}: ${(err as Error).message}`,
        'brand',
        'load',
        'CONFIG_PARSE_FAILED',
        candidate,
        false,
        err as Error,
      );
    }

    const result = BrandConfigSchema.safeParse(raw);
    if (!result.success) {
      throw new ConfigError(
        `Invalid brand config at ${candidate}: ${result.error.message}`,
        'brand',
        'load',
        'CONFIG_INVALID',
        candidate,
        false,
      );
    }

    return result.data;
  }

  return null;
}

// ── Color Mapping ───────────────────────────────────────────────────────────

/**
 * Build a map from extracted color values to brand color values.
 *
 * Three phases:
 *   1. Semantic — match extracted primary/secondary/accent to brand equivalents.
 *   2. Luminance — dark colors to text, light to background, mid to surface/muted.
 *   3. Shade preservation — group remaining by hue, generate brand shades.
 *
 * Handles hex and rgb/rgba. Preserves original alpha channels.
 */
export function createColorMap(
  extracted: DesignData,
  brand: BrandConfig,
): Map<string, string> {
  const map = new Map<string, string>();

  // Collect every extracted color string
  const allExtracted = new Set<string>(extracted.colors.all);
  if (extracted.colors.primary) allExtracted.add(extracted.colors.primary.value);
  if (extracted.colors.secondary) allExtracted.add(extracted.colors.secondary.value);
  if (extracted.colors.accent) allExtracted.add(extracted.colors.accent.value);
  for (const token of Object.values(extracted.colors.neutral)) allExtracted.add(token.value);
  for (const token of Object.values(extracted.colors.semantic)) allExtracted.add(token.value);
  for (const token of Object.values(extracted.colors.overlays)) allExtracted.add(token.value);

  // Parse brand colors into RGB
  const brandColors: Record<string, RGB> = {};
  for (const [role, value] of Object.entries(brand.colors)) {
    if (!value) continue;
    const parsed = parseColor(value);
    if (parsed) brandColors[role] = parsed;
  }

  if (!brandColors.primary) return map;

  // ── Phase 1: Semantic mapping ─────────────────────────────────────────────

  const semanticPairs: Array<[{ value: string } | undefined, string]> = [
    [extracted.colors.primary, 'primary'],
    [extracted.colors.secondary, 'secondary'],
    [extracted.colors.accent, 'accent'],
  ];

  for (const [token, brandRole] of semanticPairs) {
    if (!token || !brandColors[brandRole]) continue;
    mapColorPreservingAlpha(map, token.value, brandColors[brandRole]);
  }

  // Check semantic / neutral named tokens for known role names
  const semanticNameMap: Record<string, string> = {
    background: 'background',
    bg: 'background',
    surface: 'surface',
    text: 'text',
    'text-muted': 'textMuted',
    'text-secondary': 'textMuted',
    muted: 'textMuted',
    border: 'border',
  };

  for (const [name, token] of Object.entries(extracted.colors.semantic)) {
    const brandRole = semanticNameMap[name.toLowerCase()];
    if (brandRole && brandColors[brandRole]) {
      mapColorPreservingAlpha(map, token.value, brandColors[brandRole]);
    }
  }

  for (const [name, token] of Object.entries(extracted.colors.neutral)) {
    const brandRole = semanticNameMap[name.toLowerCase()];
    if (brandRole && brandColors[brandRole]) {
      mapColorPreservingAlpha(map, token.value, brandColors[brandRole]);
    }
  }

  // ── Phase 2: Luminance-based mapping for unmapped colors ──────────────────

  const unmapped: string[] = [];
  for (const color of allExtracted) {
    if (map.has(color)) continue;
    unmapped.push(color);
  }

  for (const color of unmapped) {
    const parsed = parseColor(color);
    if (!parsed) continue;

    const lum = relativeLuminance(parsed);

    if (lum < 0.1 && brandColors.text) {
      mapColorPreservingAlpha(map, color, brandColors.text);
    } else if (lum > 0.9 && brandColors.background) {
      mapColorPreservingAlpha(map, color, brandColors.background);
    } else if (lum > 0.7 && brandColors.surface) {
      mapColorPreservingAlpha(map, color, brandColors.surface);
    } else if (lum < 0.3 && brandColors.textMuted) {
      mapColorPreservingAlpha(map, color, brandColors.textMuted);
    }
    // Mid-range chromatic colors handled in Phase 3
  }

  // ── Phase 3: Shade preservation ───────────────────────────────────────────
  // Group remaining unmapped chromatic colors by hue, then generate matching
  // brand shades by adjusting lightness proportionally.

  const stillUnmapped: Array<{
    color: string;
    rgb: RGB;
    hsl: { h: number; s: number; l: number };
  }> = [];

  for (const color of allExtracted) {
    if (map.has(color)) continue;
    const parsed = parseColor(color);
    if (!parsed) continue;
    const hsl = rgbToHslComponents(parsed);
    // Only consider chromatic colors (saturation > 5%)
    if (hsl.s > 5) {
      stillUnmapped.push({ color, rgb: parsed, hsl });
    }
  }

  // Group by hue (within 30 degrees = same hue family)
  const hueGroups: Map<number, typeof stillUnmapped> = new Map();
  for (const entry of stillUnmapped) {
    let assigned = false;
    for (const [groupHue, group] of hueGroups) {
      if (hueDist(entry.hsl.h, groupHue) < 30) {
        group.push(entry);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      hueGroups.set(entry.hsl.h, [entry]);
    }
  }

  // Prepare brand HSL entries for hue matching
  const brandHslEntries = Object.entries(brandColors).map(([role, rgb]) => ({
    role,
    rgb,
    hsl: rgbToHslComponents(rgb),
  }));

  for (const [, group] of hueGroups) {
    if (group.length === 0) continue;

    // Find the brand color with the closest hue to this group's average
    const avgHue = group.reduce((sum, e) => sum + e.hsl.h, 0) / group.length;
    let bestBrand = brandHslEntries[0];
    let bestDist = hueDist(avgHue, bestBrand.hsl.h);

    for (const candidate of brandHslEntries) {
      const dist = hueDist(avgHue, candidate.hsl.h);
      if (dist < bestDist) {
        bestDist = dist;
        bestBrand = candidate;
      }
    }

    // Sort group by lightness
    const sorted = [...group].sort((a, b) => a.hsl.l - b.hsl.l);
    const brandHsl = bestBrand.hsl;

    const lightnessMin = sorted[0].hsl.l;
    const lightnessMax = sorted[sorted.length - 1].hsl.l;
    const lightnessRange = lightnessMax - lightnessMin;

    for (const entry of sorted) {
      if (map.has(entry.color)) continue;

      let targetL: number;
      if (lightnessRange > 0 && sorted.length > 1) {
        // Proportional: preserve relative lightness distribution
        const ratio = (entry.hsl.l - lightnessMin) / lightnessRange;
        const outMin = Math.max(brandHsl.l - 30, 5);
        const outMax = Math.min(brandHsl.l + 30, 95);
        targetL = outMin + ratio * (outMax - outMin);
      } else {
        targetL = brandHsl.l;
      }

      const newRgb = hslToRgb(brandHsl.h, brandHsl.s, targetL);
      mapColorPreservingAlpha(map, entry.color, newRgb);
    }
  }

  return map;
}

// ── Content Mapping ────────────────────────────────────────────────────────

/**
 * Build a map from extracted text content to brand replacement text.
 *
 * Matches are case-insensitive. Keys in `brand.content` are matched against
 * extracted text (site name, headings, labels) and replaced with the brand value.
 */
export function createContentMap(brand: BrandConfig): Map<string, string> {
  const map = new Map<string, string>();
  if (!brand.content) return map;

  for (const [key, value] of Object.entries(brand.content)) {
    map.set(key.toLowerCase(), value);
  }

  return map;
}

/**
 * Replace text content using the brand content map.
 * Performs case-insensitive whole-word replacement.
 */
export function applyContentReplacements(text: string, contentMap: Map<string, string>): string {
  if (contentMap.size === 0) return text;

  let result = text;
  for (const [original, replacement] of contentMap) {
    // Case-insensitive replacement of the original text
    const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    result = result.replace(regex, replacement);
  }

  return result;
}

/** Map a color to a brand RGB, preserving the original alpha channel. */
function mapColorPreservingAlpha(
  map: Map<string, string>,
  originalValue: string,
  brandRgb: RGB,
): void {
  const originalParsed = parseColor(originalValue);
  const alpha = originalParsed ? originalParsed.a : 1;
  const useRgb = isRgbFormat(originalValue);
  const target: RGB = { ...brandRgb, a: alpha };

  if (useRgb) {
    map.set(originalValue, formatRgb(target));
  } else {
    map.set(originalValue, formatHex(target));
  }
}

// ── Font Mapping ────────────────────────────────────────────────────────────

/**
 * Build a map from extracted font family names/stacks to brand font names.
 *
 * Detects each font's role using `classifyFont` from adapters/utils:
 *   - display/serif headings -> brand.heading (fallback: brand.body)
 *   - sans/body text -> brand.body
 *   - monospace -> brand.mono
 */
export function createFontMap(
  extracted: DesignData,
  brand: BrandConfig,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!brand.fonts) return map;

  for (const family of extracted.typography.fontFamilies) {
    const classification = classifyFont(family.name);
    let brandFont: string | undefined;

    switch (classification) {
      case 'display':
        brandFont = brand.fonts.heading ?? brand.fonts.body;
        break;
      case 'serif':
        brandFont = brand.fonts.heading ?? brand.fonts.body;
        break;
      case 'mono':
        brandFont = brand.fonts.mono;
        break;
      case 'sans':
      default:
        brandFont = brand.fonts.body;
        break;
    }

    if (brandFont) {
      map.set(family.name, brandFont);
      map.set(
        family.stack,
        `"${brandFont}", ${fallbackForClassification(classification)}`,
      );
    }
  }

  return map;
}

function fallbackForClassification(
  cls: 'sans' | 'serif' | 'mono' | 'display',
): string {
  switch (cls) {
    case 'mono':
      return 'monospace';
    case 'serif':
      return 'serif';
    case 'display':
    case 'sans':
    default:
      return 'sans-serif';
  }
}

// ── Apply Brand to DesignData ───────────────────────────────────────────────

/**
 * Deep clone DesignData and replace all color/font values with brand overrides.
 *
 * Preserved unchanged: spacing, borderRadius, transitions, zIndex, breakpoints.
 * Shadow strings have their color components swapped.
 */
export function applyBrandToDesignData(
  data: DesignData,
  brand: BrandConfig,
): DesignData {
  const cloned: DesignData = JSON.parse(JSON.stringify(data));
  const colorMap = createColorMap(data, brand);
  const fontMap = createFontMap(data, brand);

  // ── Colors ────────────────────────────────────────────────────────────────

  if (cloned.colors.primary) {
    cloned.colors.primary.value = lookupColor(cloned.colors.primary.value, colorMap);
  }
  if (cloned.colors.secondary) {
    cloned.colors.secondary.value = lookupColor(cloned.colors.secondary.value, colorMap);
  }
  if (cloned.colors.accent) {
    cloned.colors.accent.value = lookupColor(cloned.colors.accent.value, colorMap);
  }

  for (const key of Object.keys(cloned.colors.neutral)) {
    cloned.colors.neutral[key].value = lookupColor(cloned.colors.neutral[key].value, colorMap);
  }
  for (const key of Object.keys(cloned.colors.semantic)) {
    cloned.colors.semantic[key].value = lookupColor(cloned.colors.semantic[key].value, colorMap);
  }
  for (const key of Object.keys(cloned.colors.overlays)) {
    cloned.colors.overlays[key].value = lookupColor(cloned.colors.overlays[key].value, colorMap);
  }

  cloned.colors.all = cloned.colors.all.map(c => lookupColor(c, colorMap));

  // ── Typography ────────────────────────────────────────────────────────────

  for (const family of cloned.typography.fontFamilies) {
    if (fontMap.has(family.name)) {
      family.name = fontMap.get(family.name)!;
    }
    if (fontMap.has(family.stack)) {
      family.stack = fontMap.get(family.stack)!;
    }
  }

  for (const entry of cloned.typography.scale) {
    if (fontMap.has(entry.font)) {
      entry.font = fontMap.get(entry.font)!;
    }
  }

  // ── Shadows (swap color components in shadow strings) ─────────────────────

  for (const shadow of cloned.shadows) {
    shadow.value = replaceColorsInShadow(shadow.value, colorMap);
  }

  return cloned;
}

function lookupColor(value: string, colorMap: Map<string, string>): string {
  return colorMap.get(value) ?? value;
}

// ── Style Value Transformer ─────────────────────────────────────────────────

const COLOR_PROPS = new Set([
  'color',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
  'caret-color',
  'column-rule-color',
  'fill',
  'stroke',
  'stop-color',
  'flood-color',
  'lighting-color',
]);

/**
 * Transform a single CSS property value, applying color and font maps.
 *
 * - Color properties: direct map lookup.
 * - font-family: direct map lookup.
 * - box-shadow / text-shadow: parse and replace color components.
 * - background/background-image with gradients: replace color stops.
 * - border / outline shorthands: replace inline colors.
 * - Everything else: returned unchanged.
 */
export function transformStyleValue(
  prop: string,
  value: string,
  colorMap: Map<string, string>,
  fontMap: Map<string, string>,
): string {
  // Color properties — direct lookup
  if (COLOR_PROPS.has(prop)) {
    return colorMap.get(value) ?? value;
  }

  // Font family — direct lookup
  if (prop === 'font-family') {
    return fontMap.get(value) ?? value;
  }

  // Box shadow / text shadow — replace embedded colors
  if (prop === 'box-shadow' || prop === 'text-shadow') {
    return replaceColorsInShadow(value, colorMap);
  }

  // Background with gradient — replace color stops
  if (prop === 'background' || prop === 'background-image') {
    if (/gradient\s*\(/.test(value)) {
      return replaceColorsInGradient(value, colorMap);
    }
    // Plain background color
    return colorMap.get(value) ?? value;
  }

  // Border / outline shorthand (e.g., "1px solid #333")
  if (prop === 'border' || prop === 'outline') {
    return replaceInlineColors(value, colorMap);
  }

  return value;
}

// ── Internal: Color replacement in composite CSS values ─────────────────────

const RGBA_GLOBAL_RE = /rgba?\(\s*\d+,\s*\d+,\s*\d+(?:,\s*[\d.]+)?\s*\)/g;
const HEX_GLOBAL_RE = /#[0-9a-fA-F]{3,8}\b/g;

/** Replace color components in shadow strings. */
function replaceColorsInShadow(
  value: string,
  colorMap: Map<string, string>,
): string {
  let result = value;
  result = result.replace(RGBA_GLOBAL_RE, match => colorMap.get(match) ?? match);
  result = result.replace(HEX_GLOBAL_RE, match => colorMap.get(match) ?? match);
  return result;
}

/** Replace color stops in gradient strings. */
function replaceColorsInGradient(
  value: string,
  colorMap: Map<string, string>,
): string {
  let result = value;
  result = result.replace(RGBA_GLOBAL_RE, match => colorMap.get(match) ?? match);
  result = result.replace(HEX_GLOBAL_RE, match => colorMap.get(match) ?? match);
  return result;
}

/** Replace inline colors in shorthand values like border. */
function replaceInlineColors(
  value: string,
  colorMap: Map<string, string>,
): string {
  let result = value;
  result = result.replace(RGBA_GLOBAL_RE, match => colorMap.get(match) ?? match);
  result = result.replace(HEX_GLOBAL_RE, match => colorMap.get(match) ?? match);
  return result;
}

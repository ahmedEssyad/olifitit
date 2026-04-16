/**
 * Tailwind CSS Config Adapter
 *
 * Generates a tailwind.config.ts from extracted design tokens.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DesignData } from './reader';
import {
  rgbToHex,
  buildSpacingMap,
  buildRadiusMap,
  classifyFont,
  parseFontStack,
  parsePx,
  dedup,
} from './utils';

export interface TailwindOptions {
  outputDir: string;
  filename?: string;
}

export function generateTailwindConfig(data: DesignData, opts: TailwindOptions): string {
  const colors = buildColors(data);
  const fontFamily = buildFontFamily(data);
  const fontSize = buildFontSize(data);
  const spacing = buildSpacingMap(data.spacing.scale);
  const borderRadius = buildRadiusMap(data.borderRadius);
  const boxShadow = buildShadows(data);
  const screens = buildScreens(data);
  const zIndex = buildZIndex(data);

  const config = `import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    colors: ${jsonBlock(colors, 4)},
    fontFamily: ${jsonBlock(fontFamily, 4)},
    fontSize: ${fontSizeBlock(fontSize, 4)},
    spacing: ${jsonBlock(spacing, 4)},
    borderRadius: ${jsonBlock(borderRadius, 4)},
    boxShadow: ${jsonBlock(boxShadow, 4)},
    screens: ${jsonBlock(screens, 4)},
    zIndex: ${jsonBlock(zIndex, 4)},
    extend: {},
  },
  plugins: [],
};

export default config;
`;

  const outputPath = path.join(opts.outputDir, opts.filename || 'tailwind.config.ts');
  fs.mkdirSync(opts.outputDir, { recursive: true });
  fs.writeFileSync(outputPath, config);

  return outputPath;
}

// ── Builders ────────────────────────────────────────────────────────────────

function buildColors(data: DesignData): Record<string, unknown> {
  const colors: Record<string, unknown> = {
    transparent: 'transparent',
    current: 'currentColor',
  };

  if (data.colors.primary?.value) colors.primary = rgbToHex(data.colors.primary.value);
  if (data.colors.secondary?.value) colors.secondary = rgbToHex(data.colors.secondary.value);
  if (data.colors.accent?.value) colors.accent = rgbToHex(data.colors.accent.value);

  // Neutral shades
  const neutral: Record<string, string> = {};
  for (const [shade, token] of Object.entries(data.colors.neutral)) {
    neutral[shade] = rgbToHex(token.value);
  }
  if (Object.keys(neutral).length > 0) colors.neutral = neutral;

  // Semantic colors
  for (const [name, token] of Object.entries(data.colors.semantic)) {
    if (token.value) colors[name] = rgbToHex(token.value);
  }

  // Overlays — keep rgba for alpha support
  const overlay: Record<string, string> = {};
  for (const [name, token] of Object.entries(data.colors.overlays)) {
    overlay[name] = token.value; // keep raw rgba
  }
  if (Object.keys(overlay).length > 0) colors.overlay = overlay;

  return colors;
}

function buildFontFamily(data: DesignData): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const usedCategories = new Set<string>();

  // Map semantic names to Tailwind-friendly keys
  const SEMANTIC_FONT_KEYS: Record<string, string> = {
    primary: 'sans', body: 'sans', heading: 'heading', display: 'display',
    mono: 'mono', code: 'mono', system: 'system', serif: 'serif',
  };

  for (const family of data.typography.fontFamilies) {
    // Use semantic name if available, otherwise classify from font name
    let category = SEMANTIC_FONT_KEYS[family.name.toLowerCase()] || classifyFont(family.name);
    // Avoid duplicate category keys
    if (usedCategories.has(category)) {
      category = `${category}-${usedCategories.size}`;
    }
    usedCategories.add(category);
    result[category] = parseFontStack(family.stack);
  }

  return result;
}

interface FontSizeEntry {
  size: string;
  lineHeight: string;
  letterSpacing: string;
}

function buildFontSize(data: DesignData): FontSizeEntry[] {
  // Deduplicate by size (keep first occurrence)
  const seen = new Set<string>();
  const entries: FontSizeEntry[] = [];

  for (const s of data.typography.scale) {
    if (seen.has(s.size)) continue;
    seen.add(s.size);
    entries.push({
      size: s.size,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
    });
  }

  return entries.sort((a, b) => parsePx(a.size) - parsePx(b.size));
}

function buildShadows(data: DesignData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const shadow of data.shadows) {
    const key = shadow.name.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    result[key] = shadow.value;
  }
  return result;
}

function buildScreens(data: DesignData): Record<string, string> {
  const result: Record<string, string> = {};

  // Tailwind uses min-width by default
  for (const [name, bp] of Object.entries(data.breakpoints)) {
    const val = bp.min || bp.value;
    if (val) result[name] = val;
  }

  // Sort by value ascending
  const sorted = Object.entries(result).sort((a, b) => parsePx(a[1]) - parsePx(b[1]));
  return Object.fromEntries(sorted);
}

function buildZIndex(data: DesignData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const z of data.zIndex) {
    result[String(z.value)] = String(z.value);
  }
  return result;
}

// ── Formatting Helpers ──────────────────────────────────────────────────────

function jsonBlock(obj: Record<string, any>, indent: number): string {
  const pad = ' '.repeat(indent);
  const innerPad = ' '.repeat(indent + 2);
  const lines: string[] = ['{'];

  for (const [key, val] of Object.entries(obj)) {
    const safeKey = /^[a-zA-Z_$][\w$]*$/.test(key) ? key : `"${key}"`;
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      lines.push(`${innerPad}${safeKey}: ${jsonBlock(val, indent + 2)},`);
    } else if (Array.isArray(val)) {
      const items = val.map(v => typeof v === 'string' ? `"${v}"` : String(v)).join(', ');
      lines.push(`${innerPad}${safeKey}: [${items}],`);
    } else {
      lines.push(`${innerPad}${safeKey}: "${val}",`);
    }
  }

  lines.push(`${pad}}`);
  return lines.join('\n');
}

/** Tailwind fontSize uses tuple format: { "sm": ["14px", { lineHeight: "22.4px", letterSpacing: "normal" }] } */
function fontSizeBlock(entries: FontSizeEntry[], indent: number): string {
  const pad = ' '.repeat(indent);
  const innerPad = ' '.repeat(indent + 2);
  const lines: string[] = ['{'];

  // Assign standard Tailwind names where possible
  const names = assignFontSizeNames(entries);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const name = names[i];
    const safeKey = /^[a-zA-Z_$][\w$]*$/.test(name) ? name : `"${name}"`;
    lines.push(`${innerPad}${safeKey}: ["${e.size}", { lineHeight: "${e.lineHeight}", letterSpacing: "${e.letterSpacing}" }],`);
  }

  lines.push(`${pad}}`);
  return lines.join('\n');
}

const TAILWIND_SIZE_NAMES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'];

function assignFontSizeNames(entries: FontSizeEntry[]): string[] {
  if (entries.length <= TAILWIND_SIZE_NAMES.length) {
    return entries.map((_, i) => TAILWIND_SIZE_NAMES[i]);
  }
  // More entries than standard names — use px values for overflow
  return entries.map((e, i) =>
    i < TAILWIND_SIZE_NAMES.length ? TAILWIND_SIZE_NAMES[i] : `size-${Math.round(parsePx(e.size))}`
  );
}

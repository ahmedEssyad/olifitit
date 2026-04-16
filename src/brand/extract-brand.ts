/**
 * Brand Auto-Detection
 *
 * Extracts a BrandConfig from a user's existing project by reading:
 *   1. .liftit-brand.json (explicit)
 *   2. tailwind.config.ts / .js (theme colors + fonts)
 *   3. globals.css / design-tokens.css (CSS custom properties)
 *
 * Usage:
 *   import { extractBrandFromProject } from './extract-brand';
 *   const brand = extractBrandFromProject('./my-project');
 */

import * as fs from 'fs';
import * as path from 'path';
import { BrandConfig, BrandConfigSchema, loadBrandConfig } from './brand';
import { log } from '../core/logger';

// ── Main Entry ─────────────────────────────────────────────────────────────

/**
 * Auto-detect brand from a project directory.
 * Tries sources in order: .liftit-brand.json → tailwind config → CSS variables.
 * Returns null if no brand can be detected.
 */
export function extractBrandFromProject(projectDir: string): BrandConfig | null {
  const resolved = path.resolve(projectDir);

  if (!fs.existsSync(resolved)) {
    log('brand-extract', 'warn', `Project directory not found: ${resolved}`);
    return null;
  }

  // 1. Explicit brand file
  const brandJsonPath = path.join(resolved, '.liftit-brand.json');
  if (fs.existsSync(brandJsonPath)) {
    log('brand-extract', 'info', `Found .liftit-brand.json in ${resolved}`);
    return loadBrandConfig(brandJsonPath);
  }

  // 2. Tailwind config
  for (const name of ['tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.mjs', 'tailwind.config.cjs']) {
    const twPath = path.join(resolved, name);
    if (fs.existsSync(twPath)) {
      log('brand-extract', 'info', `Found ${name} — extracting brand`);
      const brand = extractBrandFromTailwind(twPath);
      if (brand) return brand;
    }
  }

  // 3. CSS globals
  for (const candidate of [
    'app/globals.css', 'src/app/globals.css',
    'styles/globals.css', 'src/styles/globals.css',
    'app/global.css', 'src/globals.css',
    'design-tokens.css', 'src/design-tokens.css',
  ]) {
    const cssPath = path.join(resolved, candidate);
    if (fs.existsSync(cssPath)) {
      log('brand-extract', 'info', `Found ${candidate} — extracting brand`);
      const brand = extractBrandFromCSS(cssPath);
      if (brand) return brand;
    }
  }

  log('brand-extract', 'warn', `No brand detected in ${resolved}`);
  return null;
}

// ── Tailwind Config Parser ─────────────────────────────────────────────────

/**
 * Extract brand colors and fonts from a Tailwind config file.
 * Uses regex — no JS evaluation needed.
 */
export function extractBrandFromTailwind(configPath: string): BrandConfig | null {
  let content: string;
  try {
    content = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return null;
  }

  const colors: Record<string, string> = {};
  const fonts: Record<string, string> = {};

  // ── Extract colors ──────────────────────────────────────────────────────

  // Match color definitions in theme.extend.colors or theme.colors
  // Patterns: primary: '#1a73e8', primary: { DEFAULT: '#1a73e8' }, primary: 'hsl(var(--primary))'
  const colorKeyMap: Record<string, keyof BrandConfig['colors']> = {
    primary: 'primary',
    secondary: 'secondary',
    accent: 'accent',
    background: 'background',
    surface: 'surface',
    foreground: 'text',         // Next.js/shadcn convention
    'muted-foreground': 'textMuted',
    muted: 'textMuted',
    border: 'border',
  };

  for (const [key, brandKey] of Object.entries(colorKeyMap)) {
    // Match: key: '#hex' or key: 'rgb(...)' or key: { DEFAULT: '#hex' }
    const patterns = [
      new RegExp(`['"]?${key}['"]?\\s*:\\s*['"]([#][0-9a-fA-F]{3,8})['"]`, 'i'),
      new RegExp(`['"]?${key}['"]?\\s*:\\s*['"]?(rgb\\([^)]+\\))['"]?`, 'i'),
      new RegExp(`['"]?${key}['"]?\\s*:\\s*\\{[^}]*DEFAULT\\s*:\\s*['"]([#][0-9a-fA-F]{3,8})['"]`, 'i'),
    ];

    for (const re of patterns) {
      const match = content.match(re);
      if (match && match[1]) {
        colors[brandKey] = match[1];
        break;
      }
    }
  }

  // ── Extract fonts ───────────────────────────────────────────────────────

  // Match: sans: ['Inter', ...] or sans: ['Inter, sans-serif']
  const fontKeyMap: Record<string, keyof NonNullable<BrandConfig['fonts']>> = {
    sans: 'body',
    serif: 'heading',  // Common convention: serif = heading font
    mono: 'mono',
    heading: 'heading',
    body: 'body',
    display: 'heading',
  };

  for (const [key, brandKey] of Object.entries(fontKeyMap)) {
    // Match: key: ['FontName', ...] or key: ['FontName, fallback']
    const re = new RegExp(`['"]?${key}['"]?\\s*:\\s*\\[\\s*['"]([^'"]+)['"]`, 'i');
    const match = content.match(re);
    if (match && match[1]) {
      // Take first font from the stack
      const fontName = match[1].split(',')[0].trim();
      if (fontName && !['sans-serif', 'serif', 'monospace', 'system-ui', 'ui-sans-serif'].includes(fontName)) {
        fonts[brandKey] = fontName;
      }
    }
  }

  // Need at least a primary color
  if (!colors.primary) return null;

  const result: BrandConfig = {
    colors: {
      primary: colors.primary,
      ...(colors.secondary && { secondary: colors.secondary }),
      ...(colors.accent && { accent: colors.accent }),
      ...(colors.background && { background: colors.background }),
      ...(colors.surface && { surface: colors.surface }),
      ...(colors.text && { text: colors.text }),
      ...(colors.textMuted && { textMuted: colors.textMuted }),
      ...(colors.border && { border: colors.border }),
    },
    ...(Object.keys(fonts).length > 0 && { fonts }),
  };

  const parsed = BrandConfigSchema.safeParse(result);
  if (!parsed.success) return null;

  log('brand-extract', 'info', `Extracted from tailwind: ${Object.keys(colors).length} colors, ${Object.keys(fonts).length} fonts`);
  return parsed.data;
}

// ── CSS Variables Parser ───────────────────────────────────────────────────

/**
 * Extract brand colors and fonts from CSS custom properties in a stylesheet.
 */
export function extractBrandFromCSS(cssPath: string): BrandConfig | null {
  let content: string;
  try {
    content = fs.readFileSync(cssPath, 'utf-8');
  } catch {
    return null;
  }

  const colors: Record<string, string> = {};
  const fonts: Record<string, string> = {};

  // Extract :root block(s)
  const rootBlocks: string[] = [];
  const rootRe = /:root\s*\{([^}]+)\}/g;
  let rootMatch;
  while ((rootMatch = rootRe.exec(content)) !== null) {
    rootBlocks.push(rootMatch[1]);
  }

  if (rootBlocks.length === 0) return null;

  const allVars = rootBlocks.join('\n');

  // ── Color variable patterns ─────────────────────────────────────────────
  const colorVarMap: Record<string, keyof BrandConfig['colors']> = {
    '--color-primary': 'primary',
    '--primary': 'primary',
    '--brand-primary': 'primary',
    '--color-secondary': 'secondary',
    '--secondary': 'secondary',
    '--color-accent': 'accent',
    '--accent': 'accent',
    '--color-background': 'background',
    '--background': 'background',
    '--bg': 'background',
    '--color-surface': 'surface',
    '--surface': 'surface',
    '--color-text': 'text',
    '--text': 'text',
    '--foreground': 'text',
    '--color-foreground': 'text',
    '--color-muted': 'textMuted',
    '--muted-foreground': 'textMuted',
    '--text-muted': 'textMuted',
    '--color-border': 'border',
    '--border': 'border',
  };

  for (const [varName, brandKey] of Object.entries(colorVarMap)) {
    // Match: --var-name: #hex; or --var-name: rgb(...); or --var-name: 210 40% 98%;
    const re = new RegExp(`${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([^;]+);`);
    const match = allVars.match(re);
    if (match && match[1]) {
      const value = match[1].trim();
      // Skip hsl-without-function values (shadcn format like "210 40% 98%") — convert them
      if (/^\d+\s+[\d.]+%\s+[\d.]+%$/.test(value)) {
        const [h, s, l] = value.split(/\s+/);
        colors[brandKey] = `hsl(${h}, ${s}, ${l})`;
      } else if (value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl')) {
        colors[brandKey] = value;
      }
    }
  }

  // ── Font variable patterns ──────────────────────────────────────────────
  const fontVarMap: Record<string, keyof NonNullable<BrandConfig['fonts']>> = {
    '--font-sans': 'body',
    '--font-body': 'body',
    '--font-serif': 'heading',
    '--font-heading': 'heading',
    '--font-display': 'heading',
    '--font-mono': 'mono',
  };

  for (const [varName, brandKey] of Object.entries(fontVarMap)) {
    const re = new RegExp(`${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([^;]+);`);
    const match = allVars.match(re);
    if (match && match[1]) {
      const value = match[1].trim().replace(/^["']|["']$/g, '');
      const firstName = value.split(',')[0].trim().replace(/^["']|["']$/g, '');
      if (firstName && !['sans-serif', 'serif', 'monospace'].includes(firstName)) {
        fonts[brandKey] = firstName;
      }
    }
  }

  if (!colors.primary) return null;

  const result: BrandConfig = {
    colors: {
      primary: colors.primary,
      ...(colors.secondary && { secondary: colors.secondary }),
      ...(colors.accent && { accent: colors.accent }),
      ...(colors.background && { background: colors.background }),
      ...(colors.surface && { surface: colors.surface }),
      ...(colors.text && { text: colors.text }),
      ...(colors.textMuted && { textMuted: colors.textMuted }),
      ...(colors.border && { border: colors.border }),
    },
    ...(Object.keys(fonts).length > 0 && { fonts }),
  };

  const parsed = BrandConfigSchema.safeParse(result);
  if (!parsed.success) return null;

  log('brand-extract', 'info', `Extracted from CSS: ${Object.keys(colors).length} colors, ${Object.keys(fonts).length} fonts`);
  return parsed.data;
}

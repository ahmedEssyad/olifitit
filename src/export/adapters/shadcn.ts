/**
 * shadcn/ui Theme Adapter
 *
 * Generates globals.css (HSL CSS variables) + tailwind.config.ts
 * following shadcn/ui conventions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DesignData } from './reader';
import { rgbToHslString, rgbToHex, classifyFont, parseFontStack, parsePx, buildRadiusMap } from './utils';

export interface ShadcnOptions {
  outputDir: string;
}

export interface ShadcnOutput {
  globalsPath: string;
  tailwindPath: string;
}

export function generateShadcnTheme(data: DesignData, opts: ShadcnOptions): ShadcnOutput {
  fs.mkdirSync(opts.outputDir, { recursive: true });

  const globalsPath = path.join(opts.outputDir, 'globals.css');
  const tailwindPath = path.join(opts.outputDir, 'tailwind.config.ts');

  fs.writeFileSync(globalsPath, buildGlobalsCss(data));
  fs.writeFileSync(tailwindPath, buildTailwindConfig(data));

  return { globalsPath, tailwindPath };
}

// ── globals.css ─────────────────────────────────────────────────────────────

function buildGlobalsCss(data: DesignData): string {
  const mapping = mapToShadcnSlots(data);
  const radius = pickDefaultRadius(data);

  const lines: string[] = [];
  lines.push('@tailwind base;');
  lines.push('@tailwind components;');
  lines.push('@tailwind utilities;');
  lines.push('');
  lines.push('@layer base {');
  lines.push('  :root {');

  for (const [varName, hslValue] of Object.entries(mapping.light)) {
    lines.push(`    --${varName}: ${hslValue};`);
  }
  lines.push(`    --radius: ${radius};`);

  lines.push('  }');
  lines.push('');
  lines.push('  .dark {');
  for (const [varName, hslValue] of Object.entries(mapping.dark)) {
    lines.push(`    --${varName}: ${hslValue};`);
  }
  lines.push('  }');
  lines.push('}');
  lines.push('');

  // Base styles
  lines.push('@layer base {');
  lines.push('  * {');
  lines.push('    @apply border-border;');
  lines.push('  }');
  lines.push('  body {');
  lines.push('    @apply bg-background text-foreground;');
  lines.push('  }');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// ── tailwind.config.ts ──────────────────────────────────────────────────────

function buildTailwindConfig(data: DesignData): string {
  const fontFamily = buildFontFamily(data);
  const shadows = buildShadows(data);
  const screens = buildScreens(data);

  return `import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
${fontFamily}${shadows}${screens}    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
`;
}

// ── shadcn Slot Mapping ─────────────────────────────────────────────────────

interface ShadcnSlots {
  light: Record<string, string>;
  dark: Record<string, string>;
}

/** Convert any color format (hex, rgb, hsl) to HSL string for shadcn */
function toHsl(value: string): string {
  // Already HSL format (H S% L%)
  if (/^\d+\s+\d+/.test(value.trim())) return value;

  // Try rgb → hsl
  const hsl = rgbToHslString(value);
  if (hsl !== value) return hsl;

  // Hex → rgb → hsl
  if (value.startsWith('#')) {
    const hex = value.replace('#', '');
    const fullHex = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
    const r = parseInt(fullHex.slice(0, 2), 16);
    const g = parseInt(fullHex.slice(2, 4), 16);
    const b = parseInt(fullHex.slice(4, 6), 16);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      return rgbToHslString(`rgb(${r}, ${g}, ${b})`);
    }
  }

  return value;
}

export function mapToShadcnSlots(data: DesignData): ShadcnSlots {
  const c = data.colors;
  const n = c.neutral;

  // Find colors by semantic name (AI format: background-default, text-emphasis, etc.)
  function findColor(keys: string[], fallback: string): string {
    for (const key of keys) {
      if (n[key]?.value) return n[key].value;
    }
    // Also search in all colors
    for (const key of keys) {
      for (const [k, v] of Object.entries(n)) {
        if (k.includes(key)) return v.value;
      }
    }
    return fallback;
  }

  const background = findColor(['background-default', 'background-subtle'], '#ffffff');
  const foreground = findColor(['text-emphasis', 'text-default'], '#000000');
  const cardBg = findColor(['background-muted', 'background-subtle'], background);
  const mutedBg = findColor(['background-subtle', 'background-muted'], '#f4f4f5');
  const mutedFg = findColor(['text-muted', 'text-subtle'], '#71717a');
  const borderColor = findColor(['border-default', 'border-subtle'], '#e4e4e7');
  const darkBg = findColor(['background-inverted', 'text-emphasis'], '#09090b');
  const darkFg = findColor(['text-inverted', 'background-default'], '#fafafa');
  const darkMuted = findColor(['background-primaryEmphasis', 'background-primary'], '#27272a');

  const primary = c.primary?.value || foreground;
  const accent = c.accent?.value || primary;

  // Find a destructive red color from semantic colors
  let destructive = '#ef4444'; // fallback red
  for (const [key, val] of Object.entries(c.semantic)) {
    if (key.includes('error') || key.includes('destructive') || key.includes('danger')) {
      destructive = val.value;
      break;
    }
  }
  // Also check neutral for error colors
  for (const [key, val] of Object.entries(n)) {
    if (key.includes('error') && !key.includes('border')) {
      destructive = val.value;
      break;
    }
  }

  const light: Record<string, string> = {
    'background': toHsl(background),
    'foreground': toHsl(foreground),
    'card': toHsl(cardBg),
    'card-foreground': toHsl(foreground),
    'popover': toHsl(background),
    'popover-foreground': toHsl(foreground),
    'primary': toHsl(primary),
    'primary-foreground': toHsl(background),
    'secondary': toHsl(mutedBg),
    'secondary-foreground': toHsl(foreground),
    'muted': toHsl(mutedBg),
    'muted-foreground': toHsl(mutedFg),
    'accent': toHsl(accent),
    'accent-foreground': toHsl(background),
    'destructive': toHsl(destructive),
    'destructive-foreground': toHsl(background),
    'border': toHsl(borderColor),
    'input': toHsl(borderColor),
    'ring': toHsl(primary),
  };

  const dark: Record<string, string> = {
    'background': toHsl(darkBg),
    'foreground': toHsl(darkFg),
    'card': toHsl(darkMuted),
    'card-foreground': toHsl(darkFg),
    'popover': toHsl(darkMuted),
    'popover-foreground': toHsl(darkFg),
    'primary': toHsl(darkFg),
    'primary-foreground': toHsl(darkBg),
    'secondary': toHsl(darkMuted),
    'secondary-foreground': toHsl(darkFg),
    'muted': toHsl(darkMuted),
    'muted-foreground': toHsl(mutedFg),
    'accent': toHsl(accent),
    'accent-foreground': toHsl(darkFg),
    'destructive': toHsl(destructive),
    'destructive-foreground': toHsl(darkFg),
    'border': toHsl(darkMuted),
    'input': toHsl(darkMuted),
    'ring': toHsl(darkFg),
  };

  return { light, dark };
}

export function pickDefaultRadius(data: DesignData): string {
  const radiusMap = buildRadiusMap(data.borderRadius);
  return radiusMap['default'] || radiusMap['DEFAULT'] || radiusMap['md'] || radiusMap['sm'] || '0.5rem';
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildFontFamily(data: DesignData): string {
  if (data.typography.fontFamilies.length === 0) return '';

  const lines: string[] = ['      fontFamily: {'];
  const usedCategories = new Set<string>();

  const SEMANTIC_FONT_KEYS: Record<string, string> = {
    primary: 'sans', body: 'sans', heading: 'heading', display: 'display',
    mono: 'mono', code: 'mono', system: 'system', serif: 'serif',
  };
  for (const family of data.typography.fontFamilies) {
    let category = SEMANTIC_FONT_KEYS[family.name.toLowerCase()] || classifyFont(family.name);
    if (usedCategories.has(category)) {
      category = `${category}-${usedCategories.size}`;
    }
    usedCategories.add(category);
    const fonts = parseFontStack(family.stack).map(f => `"${f}"`).join(', ');
    lines.push(`        ${category}: [${fonts}],`);
  }

  lines.push('      },');
  return lines.join('\n') + '\n';
}

function buildShadows(data: DesignData): string {
  if (data.shadows.length === 0) return '';

  const lines: string[] = ['      boxShadow: {'];
  for (const shadow of data.shadows) {
    const key = shadow.name.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    // Escape the value for template literal safety
    lines.push(`        "${key}": "${shadow.value.replace(/"/g, '\\"')}",`);
  }
  lines.push('      },');
  return lines.join('\n') + '\n';
}

function buildScreens(data: DesignData): string {
  const entries = Object.entries(data.breakpoints)
    .filter(([_, bp]) => bp.min || bp.value)
    .map(([name, bp]) => [name, (bp.min || bp.value)!] as [string, string])
    .sort((a, b) => parsePx(a[1]) - parsePx(b[1]));

  if (entries.length === 0) return '';

  const lines: string[] = ['      screens: {'];
  for (const [name, val] of entries) {
    lines.push(`        "${name}": "${val}",`);
  }
  lines.push('      },');
  return lines.join('\n') + '\n';
}

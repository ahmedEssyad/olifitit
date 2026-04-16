/**
 * Data reader — loads design-system.json or falls back to scan-result.json
 * and normalizes into a common shape for adapters.
 */

import * as fs from 'fs';
import * as path from 'path';
import { BrandConfig, applyBrandToDesignData } from '../../brand/brand';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ColorToken {
  value: string;
  usage?: string;
}

export interface FontFamily {
  name: string;
  stack: string;
  weights: number[];
}

export interface TypeScale {
  size: string;
  font: string;
  weight: number;
  lineHeight: string;
  letterSpacing: string;
  usage?: string;
}

export interface ShadowToken {
  name: string;
  value: string;
}

export interface RadiusToken {
  value: string;
  usage?: string;
}

export interface ZIndexToken {
  value: number;
  usage?: string;
}

export interface BreakpointToken {
  min?: string;
  max?: string;
  value?: string;
  description?: string;
}

export interface DesignData {
  source: 'design-system' | 'scan-result';
  sourceUrl: string;
  colors: {
    primary?: ColorToken;
    secondary?: ColorToken;
    accent?: ColorToken;
    neutral: Record<string, ColorToken>;
    semantic: Record<string, ColorToken>;
    overlays: Record<string, ColorToken>;
    all: string[];
  };
  typography: {
    fontFamilies: FontFamily[];
    scale: TypeScale[];
    weights: number[];
    lineHeights: string[];
    letterSpacings: string[];
  };
  spacing: {
    scale: number[];
    baseUnit: string;
  };
  borderRadius: RadiusToken[];
  shadows: ShadowToken[];
  transitions: {
    durations: string[];
    timingFunctions: string[];
  };
  zIndex: ZIndexToken[];
  breakpoints: Record<string, BreakpointToken>;
  containerWidths: Record<string, string>;
}

// ── Reader ──────────────────────────────────────────────────────────────────

export function readDesignData(inputDir: string, brand?: BrandConfig): DesignData {
  const dsPath = path.join(inputDir, 'design-system.json');
  const scanPath = path.join(inputDir, 'scan-result.json');

  let data: DesignData;

  if (fs.existsSync(dsPath)) {
    data = readFromDesignSystem(dsPath);
  } else if (fs.existsSync(scanPath)) {
    data = readFromScanResult(scanPath);
  } else {
    throw new Error(
      `No design data found in ${inputDir}. Expected design-system.json or scan-result.json. Run extraction first.`
    );
  }

  if (brand) {
    data = applyBrandToDesignData(data, brand);
  }

  return data;
}

// ── Read from design-system.json (primary) ──────────────────────────────────

function readFromDesignSystem(filePath: string): DesignData {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  // Detect structure: AI synthesis writes colors/typography at top level,
  // legacy format nests under raw.tokens
  const hasTokensWrapper = !!raw.tokens;
  const t = hasTokensWrapper ? raw.tokens : raw;
  const layout = raw.layout || {};

  // ── Colors ──
  const rawColors = t.colors || {};
  const colors: DesignData['colors'] = {
    neutral: {},
    semantic: {},
    overlays: {},
    all: [],
  };

  // Collect all color values into a flat list + categorize
  const allColors: string[] = [];

  function extractColorValue(val: unknown): string | undefined {
    if (typeof val === 'string') return val;
    if (val && typeof val === 'object' && 'value' in val) return (val as Record<string, unknown>).value as string;
    return undefined;
  }

  function walkColors(obj: unknown, category: string) {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      const colorVal = extractColorValue(val);
      if (colorVal) {
        allColors.push(colorVal);
        const token: ColorToken = typeof val === 'object' && val !== null
          ? { value: (val as Record<string, unknown>).value as string || String(val), usage: (val as Record<string, unknown>).usage as string | undefined }
          : { value: String(val) };

        if (category === 'neutral' || category === 'background' || category === 'border') {
          colors.neutral[key] = token;
        } else if (category === 'semantic') {
          colors.semantic[key] = token;
        } else if (category === 'overlay' || category === 'overlays') {
          colors.overlays[key] = token;
        }
      } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        // Nested object — recurse (e.g., colors.brand.primary)
        walkColors(val, category || key);
      }
    }
  }

  // Handle both flat AI structure and nested tokens structure
  for (const [cat, val] of Object.entries(rawColors)) {
    if (Array.isArray(val)) {
      allColors.push(...val.filter((v: unknown) => typeof v === 'string') as string[]);
      continue;
    }
    walkColors(val, cat);
  }

  // Find primary/secondary/accent from brand or top-level color categories
  const brand = rawColors.brand || rawColors.primary || {};
  if (typeof brand === 'object' && !Array.isArray(brand)) {
    const primaryVal = extractColorValue(brand.primary || brand);
    if (primaryVal) colors.primary = { value: primaryVal, usage: 'primary' };
    const secondaryVal = extractColorValue(brand.secondary);
    if (secondaryVal) colors.secondary = { value: secondaryVal, usage: 'secondary' };
    const accentVal = extractColorValue(brand.accent || rawColors.accent);
    if (accentVal) colors.accent = { value: accentVal, usage: 'accent' };
  } else if (typeof brand === 'string') {
    colors.primary = { value: brand, usage: 'primary' };
  }

  // Also check top-level accent
  if (!colors.accent && rawColors.accent) {
    const av = extractColorValue(rawColors.accent);
    if (av) colors.accent = { value: av, usage: 'accent' };
  }

  // Flatten text/background colors into neutral
  for (const cat of ['text', 'background', 'border']) {
    const catObj = rawColors[cat];
    if (catObj && typeof catObj === 'object' && !Array.isArray(catObj)) {
      for (const [key, val] of Object.entries(catObj)) {
        const cv = extractColorValue(val);
        if (cv) {
          colors.neutral[`${cat}-${key}`] = { value: cv, usage: `${cat} ${key}` };
          allColors.push(cv);
        }
      }
    }
  }

  colors.all = [...new Set(allColors)];

  // ── Typography ──
  const rawTypo = t.typography || {};

  // Font families: handle both array and object formats
  let fontFamilies: FontFamily[] = [];
  const rawFamilies = rawTypo.fontFamilies;
  if (Array.isArray(rawFamilies)) {
    fontFamilies = (rawFamilies as Array<Record<string, unknown>>).map((f) => ({
      name: f.name as string,
      stack: (f.stack || f.fallback || f.cssValue || f.name) as string,
      weights: (f.weights as number[] | undefined) || [],
    }));
  } else if (rawFamilies && typeof rawFamilies === 'object') {
    // AI format: { primary: "Inter...", body: "fontSans..." }
    // Pre-parse global weights to assign to all fonts
    const globalWeights: number[] = [];
    const rw = rawTypo.weights;
    if (Array.isArray(rw)) {
      globalWeights.push(...(rw as unknown[]).map((w) => parseInt(String(w)) || 400));
    } else if (rw && typeof rw === 'object') {
      globalWeights.push(...Object.values(rw as Record<string, unknown>).map((w) => parseInt(String(w)) || 400));
    }
    globalWeights.sort((a, b) => a - b);

    for (const [name, stack] of Object.entries(rawFamilies)) {
      if (typeof stack === 'string') {
        fontFamilies.push({ name, stack, weights: globalWeights.length > 0 ? [...globalWeights] : [] });
      }
    }
  }

  // Type scale: handle both array and object formats
  let scale: TypeScale[] = [];
  const rawScale = rawTypo.scale;
  if (Array.isArray(rawScale)) {
    scale = (rawScale as Array<Record<string, unknown>>).map((s) => ({
      size: (s.size || s.fontSize) as string,
      font: (s.font || s.fontFamily || '') as string,
      weight: parseInt(String(s.weight || s.fontWeight)) || 400,
      lineHeight: (s.lineHeight || 'normal') as string,
      letterSpacing: (s.letterSpacing || 'normal') as string,
      usage: (s.usage || s.name) as string | undefined,
    }));
  } else if (rawScale && typeof rawScale === 'object') {
    // AI format: { xs: { fontSize: "0.75rem", lineHeight: "..." }, sm: {...} }
    for (const [name, val] of Object.entries(rawScale as Record<string, unknown>)) {
      if (val && typeof val === 'object') {
        const s = val as Record<string, unknown>;
        scale.push({
          size: (s.fontSize || s.size || s.px || '') as string,
          font: '',
          weight: 400,
          lineHeight: (s.lineHeight || 'normal') as string,
          letterSpacing: (s.letterSpacing || 'normal') as string,
          usage: name,
        });
      }
    }
  }

  // Weights: handle both array and object
  let weights: number[] = [];
  const rawWeights = rawTypo.weights;
  if (Array.isArray(rawWeights)) {
    weights = (rawWeights as unknown[]).map((w) => parseInt(String(w)) || 400);
  } else if (rawWeights && typeof rawWeights === 'object') {
    weights = Object.values(rawWeights as Record<string, unknown>).map((w) => parseInt(String(w)) || 400).sort((a, b) => a - b);
  }

  const typography: DesignData['typography'] = {
    fontFamilies,
    scale,
    weights,
    lineHeights: rawTypo.lineHeights || (rawTypo.leading ? Object.values(rawTypo.leading).map(String) : []),
    letterSpacings: rawTypo.letterSpacings || (rawTypo.tracking ? Object.values(rawTypo.tracking).map(String) : []),
  };

  // ── Spacing ──
  let spacingScale: number[] = [];
  const rawSpacing = t.spacing || {};
  const rawSpacingScale = rawSpacing.scale;
  if (Array.isArray(rawSpacingScale)) {
    spacingScale = (rawSpacingScale as unknown[])
      .map((v) => parseFloat(String(v)))
      .filter((n) => !isNaN(n) && n > 0)
      .sort((a, b) => a - b);
  }

  // ── Border Radius ──
  let borderRadius: RadiusToken[] = [];
  const rawRadius = t.borderRadius;
  if (Array.isArray(rawRadius)) {
    borderRadius = (rawRadius as Array<string | RadiusToken>).map((r) => typeof r === 'string' ? { value: r } : r);
  } else if (rawRadius && typeof rawRadius === 'object') {
    // AI format: { none: "0px", sm: "4px", md: "8px", componentMd: "calc(...)" }
    for (const [name, val] of Object.entries(rawRadius)) {
      const strVal = String(val);
      // Skip calc/var references — those are component-level, not token-level
      if (strVal.includes('var(') || strVal.includes('calc(')) continue;
      borderRadius.push({ value: strVal, usage: name });
    }
  }

  // ── Shadows ──
  let shadows: ShadowToken[] = [];
  const rawShadows = t.shadows;
  if (Array.isArray(rawShadows)) {
    shadows = rawShadows;
  } else if (rawShadows && typeof rawShadows === 'object') {
    for (const [name, val] of Object.entries(rawShadows)) {
      if (typeof val === 'string') {
        shadows.push({ name, value: val });
      } else if (val && typeof val === 'object') {
        // Stateful shadows (rested/hover/active) — use default/rested state
        const stateObj = val as Record<string, unknown>;
        const defaultVal = stateObj.default || stateObj.rested || stateObj.DEFAULT || Object.values(stateObj)[0];
        if (typeof defaultVal === 'string') {
          shadows.push({ name, value: defaultVal });
          // Also add hover/active/focused as separate tokens if present
          for (const [state, sv] of Object.entries(stateObj)) {
            if (state !== 'default' && state !== 'rested' && state !== 'DEFAULT' && typeof sv === 'string') {
              shadows.push({ name: `${name}-${state}`, value: sv });
            }
          }
        }
      }
    }
  }

  // ── Transitions ──
  const rawTransitions = t.transitions || {};
  const durations = Array.isArray(rawTransitions.durations)
    ? rawTransitions.durations
    : (rawTransitions.defaultDuration ? [rawTransitions.defaultDuration] : []);
  const timingFunctions = Array.isArray(rawTransitions.timingFunctions)
    ? rawTransitions.timingFunctions
    : [rawTransitions.defaultTimingFunction, rawTransitions.easeOut, rawTransitions.easeInOut].filter(Boolean);

  // ── Z-Index ──
  let zIndex: ZIndexToken[] = [];
  const rawZ = t.zIndex;
  if (rawZ) {
    if (Array.isArray(rawZ.scale || rawZ)) {
      const arr = rawZ.scale || rawZ;
      zIndex = (arr as Array<number | ZIndexToken>).map((z) => typeof z === 'number' ? { value: z } : z);
    } else if (typeof rawZ === 'object') {
      for (const [name, val] of Object.entries(rawZ)) {
        const num = parseInt(String(val));
        if (!isNaN(num)) zIndex.push({ value: num, usage: name });
      }
    }
  }

  // ── Breakpoints ──
  let breakpoints: Record<string, BreakpointToken> = {};
  const rawBP = layout.breakpoints || t.breakpoints || {};
  if (typeof rawBP === 'object') {
    for (const [name, val] of Object.entries(rawBP)) {
      if (typeof val === 'string') {
        breakpoints[name] = { value: val };
      } else if (val && typeof val === 'object') {
        breakpoints[name] = val as BreakpointToken;
      }
    }
  }

  // ── Container Widths ──
  let containerWidths: Record<string, string> = {};
  const rawContainers = layout.containerWidths || t.containers || {};
  if (typeof rawContainers === 'object') {
    for (const [name, val] of Object.entries(rawContainers)) {
      containerWidths[name] = String(val);
    }
  }

  return {
    source: 'design-system',
    sourceUrl: raw.metadata?.sourceUrl || raw.meta?.url || raw.url || '',
    colors,
    typography,
    spacing: {
      scale: spacingScale,
      baseUnit: rawSpacing.baseUnit || rawSpacing.base || '4px',
    },
    borderRadius,
    shadows,
    transitions: { durations, timingFunctions },
    zIndex,
    breakpoints,
    containerWidths,
  };
}

// ── Read from scan-result.json (fallback) ───────────────────────────────────

function readFromScanResult(filePath: string): DesignData {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  // Build font families from typographyMap
  const familyMap = new Map<string, { weights: Set<number> }>();
  for (const entry of raw.typographyMap || []) {
    const name = (entry.fontFamily || '').split(',')[0].replace(/['"]/g, '').trim();
    if (!name) continue;
    if (!familyMap.has(name)) familyMap.set(name, { weights: new Set() });
    familyMap.get(name)!.weights.add(parseInt(entry.fontWeight) || 400);
  }

  const fontFamilies: FontFamily[] = Array.from(familyMap.entries()).map(([name, data]) => ({
    name,
    stack: `"${name}", sans-serif`,
    weights: [...data.weights].sort((a, b) => a - b),
  }));

  // Build type scale from typographyMap (dedupe by size)
  const seenSizes = new Set<string>();
  const scale: TypeScale[] = [];
  for (const entry of raw.typographyMap || []) {
    const key = `${entry.fontSize}|${entry.fontWeight}`;
    if (seenSizes.has(key)) continue;
    seenSizes.add(key);
    const name = (entry.fontFamily || '').split(',')[0].replace(/['"]/g, '').trim();
    scale.push({
      size: entry.fontSize,
      font: name,
      weight: parseInt(entry.fontWeight) || 400,
      lineHeight: entry.lineHeight,
      letterSpacing: 'normal',
    });
  }

  // Parse spacing
  const spacingScale: number[] = (raw.spacingValues || [])
    .map((v: unknown) => parseFloat(String(v)))
    .filter((n: number) => !isNaN(n) && n > 0)
    .sort((a: number, b: number) => a - b);

  // All weights and line heights
  const weights: number[] = [...new Set<number>((raw.typographyMap || []).map((t: Record<string, unknown>) => parseInt(String(t.fontWeight)) || 400))].sort((a, b) => a - b);
  const lineHeights: string[] = [...new Set<string>((raw.typographyMap || []).map((t: Record<string, unknown>) => t.lineHeight as string))].filter(Boolean);

  return {
    source: 'scan-result',
    sourceUrl: raw.url || '',
    colors: {
      neutral: {},
      semantic: {},
      overlays: {},
      all: raw.colorPalette || [],
    },
    typography: {
      fontFamilies,
      scale,
      weights,
      lineHeights,
      letterSpacings: [],
    },
    spacing: {
      scale: spacingScale,
      baseUnit: '4px',
    },
    borderRadius: [],
    shadows: [],
    transitions: { durations: [], timingFunctions: [] },
    zIndex: [],
    breakpoints: {},
    containerWidths: {},
  };
}

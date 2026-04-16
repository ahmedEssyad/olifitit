/**
 * W3C Design Tokens Community Group Format Adapter
 *
 * Generates a design-tokens.json following the W3C Design Tokens spec:
 * https://design-tokens.github.io/community-group/format/
 *
 * Uses $value, $type, and $description per the spec.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DesignData } from './reader';
import {
  rgbToHex,
  buildSpacingMap,
  buildRadiusMap,
  classifyFont,
  parsePx,
} from './utils';

export interface W3CDesignTokensOptions {
  outputDir: string;
  filename?: string;
}

interface W3CToken {
  $value: string | number | object;
  $type: string;
  $description?: string;
}

export function generateW3CDesignTokens(data: DesignData, opts: W3CDesignTokensOptions): string {
  const tokens: Record<string, any> = {};

  // ── Colors ──
  const colorGroup: Record<string, W3CToken> = {};

  if (data.colors.primary?.value) {
    colorGroup['primary'] = {
      $value: rgbToHex(data.colors.primary.value),
      $type: 'color',
      ...(data.colors.primary.usage ? { $description: data.colors.primary.usage } : {}),
    };
  }
  if (data.colors.secondary?.value) {
    colorGroup['secondary'] = {
      $value: rgbToHex(data.colors.secondary.value),
      $type: 'color',
      ...(data.colors.secondary.usage ? { $description: data.colors.secondary.usage } : {}),
    };
  }
  if (data.colors.accent?.value) {
    colorGroup['accent'] = {
      $value: rgbToHex(data.colors.accent.value),
      $type: 'color',
      ...(data.colors.accent.usage ? { $description: data.colors.accent.usage } : {}),
    };
  }

  for (const [shade, token] of Object.entries(data.colors.neutral)) {
    colorGroup[`neutral-${shade}`] = {
      $value: rgbToHex(token.value),
      $type: 'color',
      ...(token.usage ? { $description: token.usage } : {}),
    };
  }

  for (const [name, token] of Object.entries(data.colors.semantic)) {
    if (token.value) {
      colorGroup[name] = {
        $value: rgbToHex(token.value),
        $type: 'color',
        ...(token.usage ? { $description: token.usage } : {}),
      };
    }
  }

  for (const [name, token] of Object.entries(data.colors.overlays)) {
    colorGroup[`overlay-${kebab(name)}`] = {
      $value: token.value,
      $type: 'color',
      $description: 'Overlay color (with alpha)',
    };
  }

  if (Object.keys(colorGroup).length > 0) {
    tokens['color'] = colorGroup;
  }

  // ── Font ──
  const fontGroup: Record<string, any> = {};

  // Font families
  if (data.typography.fontFamilies.length > 0) {
    const familyGroup: Record<string, W3CToken> = {};
    for (const family of data.typography.fontFamilies) {
      const category = classifyFont(family.name);
      familyGroup[category] = {
        $value: family.stack,
        $type: 'fontFamily',
      };
    }
    fontGroup['family'] = familyGroup;
  }

  // Font sizes
  const seenSizes = new Set<string>();
  const sizeNames = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'];
  let sizeIdx = 0;
  const sizeGroup: Record<string, W3CToken> = {};

  for (const s of data.typography.scale) {
    if (seenSizes.has(s.size)) continue;
    seenSizes.add(s.size);
    const name = sizeIdx < sizeNames.length ? sizeNames[sizeIdx] : `size-${Math.round(parsePx(s.size))}`;
    sizeGroup[name] = {
      $value: s.size,
      $type: 'dimension',
      ...(s.usage ? { $description: s.usage } : {}),
    };
    sizeIdx++;
  }

  if (Object.keys(sizeGroup).length > 0) {
    fontGroup['size'] = sizeGroup;
  }

  // Font weights
  const weightNames: Record<number, string> = {
    100: 'thin', 200: 'extralight', 300: 'light', 400: 'normal',
    500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black',
  };
  const weightGroup: Record<string, W3CToken> = {};

  for (const w of data.typography.weights) {
    const name = weightNames[w] || `w-${w}`;
    weightGroup[name] = {
      $value: w,
      $type: 'fontWeight',
    };
  }

  if (Object.keys(weightGroup).length > 0) {
    fontGroup['weight'] = weightGroup;
  }

  // Line heights
  if (data.typography.lineHeights.length > 0) {
    const lhGroup: Record<string, W3CToken> = {};
    for (let i = 0; i < data.typography.lineHeights.length; i++) {
      lhGroup[`lh-${i + 1}`] = {
        $value: data.typography.lineHeights[i],
        $type: 'dimension',
      };
    }
    fontGroup['lineHeight'] = lhGroup;
  }

  // Letter spacings
  if (data.typography.letterSpacings.length > 0) {
    const lsGroup: Record<string, W3CToken> = {};
    for (let i = 0; i < data.typography.letterSpacings.length; i++) {
      lsGroup[`ls-${i + 1}`] = {
        $value: data.typography.letterSpacings[i],
        $type: 'dimension',
      };
    }
    fontGroup['letterSpacing'] = lsGroup;
  }

  if (Object.keys(fontGroup).length > 0) {
    tokens['font'] = fontGroup;
  }

  // ── Spacing ──
  const spacingMap = buildSpacingMap(data.spacing.scale);
  if (Object.keys(spacingMap).length > 0) {
    const spacingGroup: Record<string, W3CToken> = {};
    for (const [key, val] of Object.entries(spacingMap)) {
      spacingGroup[key.replace('.', '-')] = {
        $value: val,
        $type: 'dimension',
      };
    }
    tokens['spacing'] = spacingGroup;
  }

  // ── Border Radius ──
  const radiusMap = buildRadiusMap(data.borderRadius);
  if (Object.keys(radiusMap).length > 0) {
    const radiusGroup: Record<string, W3CToken> = {};
    for (const [key, val] of Object.entries(radiusMap)) {
      const tokenKey = key === 'DEFAULT' ? 'default' : key;
      radiusGroup[tokenKey] = {
        $value: val,
        $type: 'dimension',
      };
    }
    tokens['borderRadius'] = radiusGroup;
  }

  // ── Shadows ──
  if (data.shadows.length > 0) {
    const shadowGroup: Record<string, W3CToken> = {};
    for (const shadow of data.shadows) {
      shadowGroup[kebab(shadow.name)] = {
        $value: shadow.value,
        $type: 'shadow',
      };
    }
    tokens['shadow'] = shadowGroup;
  }

  // ── Transitions ──
  if (data.transitions.durations.length > 0) {
    const durationGroup: Record<string, W3CToken> = {};
    const durationNames = ['fastest', 'fast', 'normal', 'slow', 'slower', 'slowest'];
    const sortedDurations = [...data.transitions.durations].sort((a, b) => parsePx(a) - parsePx(b));
    for (let i = 0; i < sortedDurations.length; i++) {
      const name = i < durationNames.length ? durationNames[i] : `d-${i}`;
      durationGroup[name] = {
        $value: sortedDurations[i],
        $type: 'duration',
      };
    }
    tokens['duration'] = durationGroup;
  }

  if (data.transitions.timingFunctions.length > 0) {
    const easingGroup: Record<string, W3CToken> = {};
    for (let i = 0; i < data.transitions.timingFunctions.length; i++) {
      const tf = data.transitions.timingFunctions[i];
      const name = tf === 'ease' ? 'default' : tf === 'ease-out' ? 'out' : tf === 'ease-in' ? 'in' : tf === 'linear' ? 'linear' : `ease-${i}`;
      easingGroup[name] = {
        $value: tf,
        $type: 'cubicBezier',
        $description: `Timing function: ${tf}`,
      };
    }
    tokens['easing'] = easingGroup;
  }

  // ── Z-Index ──
  if (data.zIndex.length > 0) {
    const zGroup: Record<string, W3CToken> = {};
    for (const z of data.zIndex) {
      zGroup[String(z.value)] = {
        $value: z.value,
        $type: 'dimension',
        ...(z.usage ? { $description: z.usage } : {}),
      };
    }
    tokens['zIndex'] = zGroup;
  }

  // ── Breakpoints ──
  if (Object.keys(data.breakpoints).length > 0) {
    const bpGroup: Record<string, W3CToken> = {};
    for (const [name, bp] of Object.entries(data.breakpoints)) {
      const val = bp.min || bp.max || bp.value;
      if (val) {
        bpGroup[name] = {
          $value: val,
          $type: 'dimension',
          ...(bp.description ? { $description: bp.description } : {}),
        };
      }
    }
    if (Object.keys(bpGroup).length > 0) {
      tokens['breakpoint'] = bpGroup;
    }
  }

  const json = JSON.stringify(tokens, null, 2);
  const outputPath = path.join(opts.outputDir, opts.filename || 'design-tokens.json');
  fs.mkdirSync(opts.outputDir, { recursive: true });
  fs.writeFileSync(outputPath, json + '\n');

  return outputPath;
}

function kebab(str: string): string {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
}

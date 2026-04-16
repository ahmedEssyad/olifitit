/**
 * Style Dictionary Format Adapter
 *
 * Generates a tokens.json following Amazon's Style Dictionary convention:
 * https://amzn.github.io/style-dictionary/
 *
 * Uses `value` (not `$value`) and numeric values without units
 * (Style Dictionary adds units via transforms).
 */

import * as fs from 'fs';
import * as path from 'path';
import { DesignData } from './reader';
import {
  rgbToHex,
  classifyFont,
  parsePx,
} from './utils';

export interface StyleDictionaryOptions {
  outputDir: string;
  filename?: string;
}

interface SDToken {
  value: string | number;
  comment?: string;
}

export function generateStyleDictionary(data: DesignData, opts: StyleDictionaryOptions): string {
  const tokens: Record<string, any> = {};

  // ── Colors ──
  const colorGroup: Record<string, SDToken> = {};

  if (data.colors.primary?.value) {
    colorGroup['primary'] = {
      value: rgbToHex(data.colors.primary.value),
      ...(data.colors.primary.usage ? { comment: data.colors.primary.usage } : {}),
    };
  }
  if (data.colors.secondary?.value) {
    colorGroup['secondary'] = {
      value: rgbToHex(data.colors.secondary.value),
      ...(data.colors.secondary.usage ? { comment: data.colors.secondary.usage } : {}),
    };
  }
  if (data.colors.accent?.value) {
    colorGroup['accent'] = {
      value: rgbToHex(data.colors.accent.value),
      ...(data.colors.accent.usage ? { comment: data.colors.accent.usage } : {}),
    };
  }

  for (const [shade, token] of Object.entries(data.colors.neutral)) {
    colorGroup[`neutral-${shade}`] = {
      value: rgbToHex(token.value),
      ...(token.usage ? { comment: token.usage } : {}),
    };
  }

  for (const [name, token] of Object.entries(data.colors.semantic)) {
    if (token.value) {
      colorGroup[name] = {
        value: rgbToHex(token.value),
        ...(token.usage ? { comment: token.usage } : {}),
      };
    }
  }

  for (const [name, token] of Object.entries(data.colors.overlays)) {
    colorGroup[`overlay-${kebab(name)}`] = {
      value: token.value,
      comment: 'Overlay color (with alpha)',
    };
  }

  if (Object.keys(colorGroup).length > 0) {
    tokens['color'] = colorGroup;
  }

  // ── Size ──
  const sizeGroup: Record<string, any> = {};

  // Font sizes (numeric, no units)
  const seenSizes = new Set<string>();
  const sizeNames = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'];
  let sizeIdx = 0;
  const fontSizeGroup: Record<string, SDToken> = {};

  for (const s of data.typography.scale) {
    if (seenSizes.has(s.size)) continue;
    seenSizes.add(s.size);
    const name = sizeIdx < sizeNames.length ? sizeNames[sizeIdx] : `size-${Math.round(parsePx(s.size))}`;
    fontSizeGroup[name] = {
      value: String(parsePx(s.size)),
      ...(s.usage ? { comment: s.usage } : {}),
    };
    sizeIdx++;
  }

  if (Object.keys(fontSizeGroup).length > 0) {
    sizeGroup['font'] = fontSizeGroup;
  }

  // Spacing (numeric, no units)
  const sorted = [...new Set(data.spacing.scale)].filter(n => n > 0).sort((a, b) => a - b);
  if (sorted.length > 0) {
    const spacingGroup: Record<string, SDToken> = {};
    const spacingNames = ['3xs', '2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl'];
    for (let i = 0; i < sorted.length; i++) {
      const name = i < spacingNames.length ? spacingNames[i] : `sp-${sorted[i]}`;
      spacingGroup[name] = { value: String(sorted[i]) };
    }
    sizeGroup['spacing'] = spacingGroup;
  }

  // Border radius (numeric, no units)
  if (data.borderRadius.length > 0) {
    const radiusGroup: Record<string, SDToken> = {};
    const radiusNames = ['none', 'sm', 'default', 'md', 'lg', 'xl', '2xl', '3xl', 'full'];
    const uniqueRadii = [...new Map(
      data.borderRadius
        .filter(r => r.value.endsWith('px') && !r.value.includes(' '))
        .map(r => [parsePx(r.value), r])
    ).values()].sort((a, b) => parsePx(a.value) - parsePx(b.value));

    for (let i = 0; i < uniqueRadii.length; i++) {
      const r = uniqueRadii[i];
      const px = parsePx(r.value);
      let name: string;
      if (px === 0) name = 'none';
      else if (px >= 999) name = 'full';
      else if (i < radiusNames.length) name = radiusNames[i];
      else name = `r-${px}`;
      radiusGroup[name] = {
        value: String(px),
        ...(r.usage ? { comment: r.usage } : {}),
      };
    }
    sizeGroup['borderRadius'] = radiusGroup;
  }

  // Line heights (numeric, no units)
  if (data.typography.lineHeights.length > 0) {
    const lhGroup: Record<string, SDToken> = {};
    for (let i = 0; i < data.typography.lineHeights.length; i++) {
      lhGroup[`lh-${i + 1}`] = {
        value: String(parsePx(data.typography.lineHeights[i])),
      };
    }
    sizeGroup['lineHeight'] = lhGroup;
  }

  if (Object.keys(sizeGroup).length > 0) {
    tokens['size'] = sizeGroup;
  }

  // ── Font ──
  const fontGroup: Record<string, any> = {};

  // Font families
  if (data.typography.fontFamilies.length > 0) {
    const familyGroup: Record<string, SDToken> = {};
    for (const family of data.typography.fontFamilies) {
      const category = classifyFont(family.name);
      familyGroup[category] = { value: family.stack };
    }
    fontGroup['family'] = familyGroup;
  }

  // Font weights
  const weightNames: Record<number, string> = {
    100: 'thin', 200: 'extralight', 300: 'light', 400: 'normal',
    500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black',
  };

  if (data.typography.weights.length > 0) {
    const weightGroup: Record<string, SDToken> = {};
    for (const w of data.typography.weights) {
      const name = weightNames[w] || `w-${w}`;
      weightGroup[name] = { value: String(w) };
    }
    fontGroup['weight'] = weightGroup;
  }

  if (Object.keys(fontGroup).length > 0) {
    tokens['font'] = fontGroup;
  }

  // ── Shadows ──
  if (data.shadows.length > 0) {
    const shadowGroup: Record<string, SDToken> = {};
    for (const shadow of data.shadows) {
      shadowGroup[kebab(shadow.name)] = { value: shadow.value };
    }
    tokens['shadow'] = shadowGroup;
  }

  // ── Transitions ──
  if (data.transitions.durations.length > 0) {
    const durationGroup: Record<string, SDToken> = {};
    const durationNames = ['fastest', 'fast', 'normal', 'slow', 'slower', 'slowest'];
    const sortedDurations = [...data.transitions.durations].sort((a, b) => parsePx(a) - parsePx(b));
    for (let i = 0; i < sortedDurations.length; i++) {
      const name = i < durationNames.length ? durationNames[i] : `d-${i}`;
      // Strip units for Style Dictionary — store raw ms number
      durationGroup[name] = { value: String(parsePx(sortedDurations[i])) };
    }
    tokens['time'] = { duration: durationGroup };
  }

  if (data.transitions.timingFunctions.length > 0) {
    const easingGroup: Record<string, SDToken> = {};
    for (let i = 0; i < data.transitions.timingFunctions.length; i++) {
      const tf = data.transitions.timingFunctions[i];
      const name = tf === 'ease' ? 'default' : tf === 'ease-out' ? 'out' : tf === 'ease-in' ? 'in' : tf === 'linear' ? 'linear' : `ease-${i}`;
      easingGroup[name] = { value: tf };
    }
    tokens['easing'] = easingGroup;
  }

  // ── Z-Index ──
  if (data.zIndex.length > 0) {
    const zGroup: Record<string, SDToken> = {};
    for (const z of data.zIndex) {
      zGroup[String(z.value)] = {
        value: String(z.value),
        ...(z.usage ? { comment: z.usage } : {}),
      };
    }
    tokens['zIndex'] = zGroup;
  }

  // ── Breakpoints ──
  if (Object.keys(data.breakpoints).length > 0) {
    const bpGroup: Record<string, SDToken> = {};
    for (const [name, bp] of Object.entries(data.breakpoints)) {
      const val = bp.min || bp.max || bp.value;
      if (val) {
        bpGroup[name] = {
          value: String(parsePx(val)),
          ...(bp.description ? { comment: bp.description } : {}),
        };
      }
    }
    if (Object.keys(bpGroup).length > 0) {
      tokens['breakpoint'] = bpGroup;
    }
  }

  const json = JSON.stringify(tokens, null, 2);
  const outputPath = path.join(opts.outputDir, opts.filename || 'tokens.json');
  fs.mkdirSync(opts.outputDir, { recursive: true });
  fs.writeFileSync(outputPath, json + '\n');

  return outputPath;
}

function kebab(str: string): string {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
}

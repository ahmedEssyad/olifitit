/**
 * Centralized Configuration for Liftit
 *
 * Single source of truth for all magic numbers, selector lists, and tuning
 * constants used across the extraction pipeline. Values can be overridden
 * via a `.liftitrc.json` file in the project root or by passing overrides
 * to `loadConfig()`.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

// ── Zod Schemas ───────────────────────────────────────────────────────────────

const BrowserSchema = z.object({
  /** Responsive breakpoints for screenshots and validation. */
  breakpoints: z.array(z.number().int().positive()),
  /** Default viewport height used across all scripts. */
  viewportHeight: z.number().int().positive(),
});

const ScanSchema = z.object({
  /** Maximum DOM elements to process (safety cap). */
  maxElements: z.number().int().positive(),
  /** Maximum pages to crawl in multi-page mode. */
  maxPages: z.number().int().positive(),
  /** CSS selectors for interactive elements. */
  interactiveSelectors: z.array(z.string()),
  /** Computed style properties to capture per element. */
  styleProperties: z.array(z.string()),
  /** Selectors for cookie/consent banners to auto-dismiss. */
  cookieSelectors: z.array(z.string()),
  /** Button text patterns that indicate cookie acceptance. */
  cookieButtonTexts: z.array(z.string()),
});

const MotionSchema = z.object({
  /** Viewport widths for motion capture (mobile, tablet, desktop). */
  viewports: z.array(z.number().int().positive()),
  /** Pixels to scroll per step. */
  scrollStep: z.number().int().positive(),
  /** Pixels to scroll per step during fine-grained second pass. */
  scrollStepFine: z.number().int().positive(),
  /** Milliseconds to pause between scroll steps. */
  scrollPause: z.number().int().nonnegative(),
  /** Maximum candidate elements for animation tracking. */
  maxCandidates: z.number().int().positive(),
  /** Frames to record per hover interaction. */
  hoverRecordFrames: z.number().int().positive(),
  /** Milliseconds between hover frames. */
  hoverFrameInterval: z.number().int().positive(),
  /** CSS properties tracked for animation changes. */
  animationProperties: z.array(z.string()),
});

const ScrollInteractionsSchema = z.object({
  /** Maximum distinct scroll positions to sample. */
  maxScrollPositions: z.number().int().positive(),
  /** Merge scroll positions within this pixel distance. */
  mergeDistance: z.number().int().nonnegative(),
  /** Maximum interactive elements to capture per scroll position. */
  maxElementsPerPosition: z.number().int().positive(),
  /** Milliseconds to wait for hover state to settle. */
  hoverSettleMs: z.number().int().nonnegative(),
  /** Milliseconds to wait after scrolling for layout to settle. */
  scrollSettleMs: z.number().int().nonnegative(),
  /** Selectors for interactive elements during scroll mapping. */
  interactiveSelectors: z.array(z.string()),
  /** CSS properties captured for hover diffs at scroll positions. */
  hoverProperties: z.array(z.string()),
});

const ValidationSchema = z.object({
  /** pixelmatch threshold (0 = exact, 1 = lenient). */
  pixelmatchThreshold: z.number().min(0).max(1),
  /** Score penalty per missing element. */
  missingElementPenalty: z.number().nonnegative(),
  /** Score penalty per style discrepancy. */
  styleDiscrepancyPenalty: z.number().nonnegative(),
  /** Percentage delta to count as improvement in diff mode. */
  improvementDelta: z.number().nonnegative(),
  /** Percentage delta to count as degradation in diff mode. */
  degradationDelta: z.number().nonnegative(),
  /** Default rebuild URL for validation. */
  defaultRebuildUrl: z.string(),
});

const LoggingSchema = z.object({
  /** Enable verbose logging. */
  verbose: z.boolean(),
});

const PerformanceSchema = z.object({
  /** Enable Lighthouse performance capture. */
  enabled: z.boolean(),
  /** Chrome DevTools Protocol port for Lighthouse. */
  lighthousePort: z.number().int(),
  /** Lighthouse audit categories. */
  categories: z.array(z.string()),
  /** Performance thresholds for flagging issues. */
  thresholds: z.object({
    performance: z.number(),
    lcp: z.number(),
    cls: z.number(),
    inp: z.number(),
  }),
});

const LiftitConfigSchema = z.object({
  browser: BrowserSchema,
  scan: ScanSchema,
  motion: MotionSchema,
  scrollInteractions: ScrollInteractionsSchema,
  validation: ValidationSchema,
  performance: PerformanceSchema,
  logging: LoggingSchema,
});

// ── Exported Type ─────────────────────────────────────────────────────────────

export type LiftitConfig = z.infer<typeof LiftitConfigSchema>;

// ── Default Configuration ─────────────────────────────────────────────────────

export const DEFAULT_CONFIG: LiftitConfig = {
  browser: {
    breakpoints: [320, 375, 414, 768, 1024, 1280, 1440, 1920],
    viewportHeight: 900,
  },

  scan: {
    maxElements: 50_000,
    maxPages: 20,
    interactiveSelectors: [
      'a', 'button', 'input', 'select', 'textarea',
      '[role="button"]', '[role="link"]', '[role="tab"]',
      '[role="menuitem"]', '[role="checkbox"]', '[role="radio"]',
      '[role="switch"]', '[role="slider"]', '[onclick]',
      '[tabindex]', 'details', 'summary', 'dialog',
    ],
    styleProperties: [
      // Box model
      'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
      'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
      'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'boxSizing',
      // Border
      'border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
      'borderWidth', 'borderStyle', 'borderColor',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
      'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
      'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius',
      'borderBottomLeftRadius', 'borderBottomRightRadius',
      // Typography
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
      'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'textDecoration',
      'textTransform', 'textIndent', 'textShadow', 'whiteSpace', 'wordBreak',
      'overflowWrap', 'fontFeatureSettings', 'fontVariationSettings',
      // Colors & Background
      'color', 'backgroundColor', 'opacity',
      'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
      'backgroundClip', 'backgroundOrigin', 'backgroundAttachment',
      // Layout
      'display', 'position', 'top', 'right', 'bottom', 'left',
      'float', 'clear', 'zIndex', 'overflow', 'overflowX', 'overflowY',
      'visibility', 'clip', 'clipPath',
      // Flexbox
      'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignContent',
      'alignSelf', 'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'order', 'gap',
      'rowGap', 'columnGap',
      // Grid
      'gridTemplateColumns', 'gridTemplateRows', 'gridTemplateAreas',
      'gridColumn', 'gridRow', 'gridArea', 'gridAutoFlow', 'gridAutoColumns',
      'gridAutoRows', 'gridGap', 'gridRowGap', 'gridColumnGap',
      // Transform & Animation
      'transform', 'transformOrigin', 'transition', 'transitionProperty',
      'transitionDuration', 'transitionTimingFunction', 'transitionDelay',
      'animation', 'animationName', 'animationDuration', 'animationTimingFunction',
      'animationDelay', 'animationIterationCount', 'animationDirection',
      'animationFillMode', 'animationPlayState',
      // Effects
      'boxShadow', 'filter', 'backdropFilter', 'mixBlendMode',
      'outline', 'outlineWidth', 'outlineStyle', 'outlineColor', 'outlineOffset',
      // Cursor & Interaction
      'cursor', 'pointerEvents', 'userSelect', 'touchAction',
      // List
      'listStyle', 'listStyleType', 'listStylePosition', 'listStyleImage',
      // Table
      'borderCollapse', 'borderSpacing', 'tableLayout',
      // Misc
      'objectFit', 'objectPosition', 'resize', 'appearance',
      'scrollBehavior', 'scrollSnapType', 'scrollSnapAlign',
      'contain', 'contentVisibility', 'willChange', 'isolation',
      'aspectRatio', 'accentColor', 'caretColor', 'colorScheme',
    ],
    cookieSelectors: [
      '[class*="cookie"] button', '[class*="Cookie"] button',
      '[class*="consent"] button', '[class*="Consent"] button',
      '[class*="gdpr"] button', '[class*="GDPR"] button',
      '#cookie-banner button', '#cookie-consent button',
      '[id*="cookie"] button', '[id*="consent"] button',
      '.cc-btn', '.cc-dismiss', '.cc-allow',
      '[data-cookieconsent="accept"]',
      'button[class*="accept"]', 'button[class*="Accept"]',
    ],
    cookieButtonTexts: [
      'accept', 'accept all', 'i agree', 'got it', 'allow all',
      'agree', 'ok', 'allow cookies', 'accept cookies',
    ],
  },

  motion: {
    viewports: [375, 768, 1440],
    scrollStep: 75,
    scrollStepFine: 25,
    scrollPause: 60,
    maxCandidates: 200,
    hoverRecordFrames: 20,
    hoverFrameInterval: 50,
    animationProperties: [
      'transform', 'opacity', 'visibility',
      'width', 'height', 'maxWidth', 'maxHeight',
      'top', 'left', 'right', 'bottom',
      'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
      'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
      'backgroundColor', 'color', 'borderColor',
      'borderRadius', 'boxShadow', 'filter', 'backdropFilter',
      'clipPath', 'scale', 'rotate',
      'fontSize', 'letterSpacing', 'lineHeight',
      'gap', 'flexDirection', 'gridTemplateColumns',
    ],
  },

  scrollInteractions: {
    maxScrollPositions: 20,
    mergeDistance: 30,
    maxElementsPerPosition: 40,
    hoverSettleMs: 200,
    scrollSettleMs: 400,
    interactiveSelectors: [
      'a[href]', 'button', 'input', 'select', 'textarea',
      '[role="button"]', '[role="link"]', '[role="tab"]',
      '[role="menuitem"]', '[role="checkbox"]', '[role="radio"]',
      '[role="switch"]', '[onclick]', '[tabindex]:not([tabindex="-1"])',
      'details > summary',
    ],
    hoverProperties: [
      'color', 'backgroundColor', 'borderColor', 'boxShadow',
      'textDecoration', 'opacity', 'transform', 'cursor',
      'filter', 'outline', 'width', 'height', 'gap',
      'padding', 'scale',
    ],
  },

  validation: {
    pixelmatchThreshold: 0.1,
    missingElementPenalty: 0.5,
    styleDiscrepancyPenalty: 0.2,
    improvementDelta: 0.5,
    degradationDelta: 0.5,
    defaultRebuildUrl: 'http://localhost:3000',
  },

  performance: {
    enabled: true,
    lighthousePort: 9222,
    categories: ['performance', 'accessibility', 'best-practices', 'seo'],
    thresholds: {
      performance: 50,
      lcp: 2500,
      cls: 0.1,
      inp: 200,
    },
  },

  logging: {
    verbose: false,
  },
};

// ── Config Loading ────────────────────────────────────────────────────────────

/**
 * Deep-merge `source` into `target`. Arrays in source replace target arrays
 * entirely (they are not concatenated).
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  const result = { ...target } as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = (target as Record<string, unknown>)[key];
    if (
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else {
      result[key] = srcVal;
    }
  }
  return result as T;
}

/**
 * Locate the nearest `.liftitrc.json` by walking up from `startDir`
 * (defaults to cwd). Returns `undefined` if not found.
 */
function findRcFile(startDir: string = process.cwd()): string | undefined {
  let dir = path.resolve(startDir);
  const { root } = path.parse(dir);
  while (true) {
    const candidate = path.join(dir, '.liftitrc.json');
    if (fs.existsSync(candidate)) return candidate;
    if (dir === root) return undefined;
    dir = path.dirname(dir);
  }
}

/**
 * Load configuration by merging (in order of precedence, lowest to highest):
 *   1. DEFAULT_CONFIG
 *   2. `.liftitrc.json` (if found)
 *   3. `overrides` argument
 *
 * The merged result is validated against the Zod schema. Throws on invalid
 * configuration.
 */
export function loadConfig(
  overrides?: Partial<Record<string, unknown>>,
): LiftitConfig {
  let merged: Record<string, unknown> = { ...DEFAULT_CONFIG };

  // Layer 2: RC file
  const rcPath = findRcFile();
  if (rcPath) {
    try {
      const raw = fs.readFileSync(rcPath, 'utf-8');
      const rcData = JSON.parse(raw) as Record<string, unknown>;
      merged = deepMerge(merged as Record<string, unknown> & typeof DEFAULT_CONFIG, rcData);
    } catch (err) {
      throw new Error(
        `Failed to read .liftitrc.json at ${rcPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Layer 3: programmatic overrides
  if (overrides) {
    merged = deepMerge(
      merged as Record<string, unknown> & typeof DEFAULT_CONFIG,
      overrides as Record<string, unknown>,
    );
  }

  // Validate
  const parsed = LiftitConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid Liftit configuration:\n${issues}`);
  }

  return Object.freeze(parsed.data) as LiftitConfig;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

/** Frozen configuration singleton. Reads `.liftitrc.json` on first import. */
export const config: LiftitConfig = loadConfig();

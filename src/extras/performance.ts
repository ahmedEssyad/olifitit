/**
 * Performance Impact Analysis & Bundle Size Estimation
 *
 * Analyzes scan results to produce a performance report with:
 * - DOM complexity metrics
 * - CSS weight analysis
 * - Font and image weight
 * - Animation count and performance risk flags
 * - Bundle size estimation for generated components
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PerformanceReport {
  domComplexity: number;
  cssWeight: number;
  fontWeight: number;
  imageWeight: number;
  animationCount: number;
  score: number;
  issues: string[];
  details: {
    totalDOMElements: number;
    cssFileSizes: { url: string; sizeBytes: number }[];
    totalCSSBytes: number;
    fontFiles: { url: string; estimatedSizeBytes: number }[];
    totalFontBytes: number;
    imageFiles: { url: string; estimatedSizeBytes: number }[];
    totalImageBytes: number;
    animations: { css: number; transitions: number; webAnimations: number };
    renderBlockingResources: string[];
    totalAssetWeight: number;
  };
}

export interface BundleSizeEstimate {
  jsxSizeBytes: number;
  cssSizeBytes: number;
  framerMotionOverheadBytes: number;
  totalEstimatedBytes: number;
  breakdown: {
    elementCount: number;
    cssCharCount: number;
    framerMotionImports: number;
  };
}

// ── Performance Analysis ───────────────────────────────────────────────────────

export function analyzePerformance(scanResult: Record<string, unknown>): PerformanceReport {
  const issues: string[] = [];

  // DOM complexity
  const domTree = (scanResult.domTree || []) as Record<string, unknown>[];
  const totalDOMElements = domTree.length;
  const domComplexity = totalDOMElements;

  if (totalDOMElements > 1500) {
    issues.push(`Heavy DOM: ${totalDOMElements} elements (threshold: 1500). Consider lazy loading or virtualizing long lists.`);
  }

  // CSS weight
  const cssRaw = (scanResult.cssRaw || []) as { url: string; content: string }[];
  const cssFileSizes = cssRaw.map(c => ({
    url: c.url || '(inline)',
    sizeBytes: Buffer.byteLength(c.content, 'utf8'),
  }));
  const totalCSSBytes = cssFileSizes.reduce((sum, c) => sum + c.sizeBytes, 0);
  const cssWeight = totalCSSBytes;

  if (totalCSSBytes > 500 * 1024) {
    issues.push(`Heavy CSS: ${(totalCSSBytes / 1024).toFixed(0)}KB total (threshold: 500KB). Consider code splitting or purging unused CSS.`);
  }

  // Font weight
  const assets = (scanResult.assets || []) as { type: string; url: string }[];
  const fontAssets = assets.filter(a => a.type === 'font');
  // Estimate font sizes: typical web font is 20-50KB, we estimate 35KB per font file
  const ESTIMATED_FONT_SIZE = 35 * 1024;
  const fontFiles = fontAssets.map(a => ({
    url: a.url,
    estimatedSizeBytes: ESTIMATED_FONT_SIZE,
  }));
  const totalFontBytes = fontFiles.length * ESTIMATED_FONT_SIZE;
  const fontWeight = totalFontBytes;

  if (fontAssets.length > 10) {
    issues.push(`Too many fonts: ${fontAssets.length} font files (threshold: 10). Consider reducing font variations.`);
  }

  // Image weight
  const imageAssets = assets.filter(a => a.type === 'image' || a.type === 'svg');
  // Estimate: SVGs ~5KB, images ~100KB average
  const imageFiles = imageAssets.map(a => ({
    url: a.url,
    estimatedSizeBytes: a.type === 'svg' ? 5 * 1024 : 100 * 1024,
  }));
  const totalImageBytes = imageFiles.reduce((sum, i) => sum + i.estimatedSizeBytes, 0);
  const imageWeight = totalImageBytes;

  // Animation count
  const cssAnimations = ((scanResult.animations || []) as unknown[]).length;
  const transitions = domTree.filter((e: Record<string, unknown>) => {
    const styles = (e.computedStyles as Record<string, string>) || {};
    return styles.transition && styles.transition !== 'all 0s ease 0s' && styles.transition !== 'none';
  }).length;
  const webAnimationElements = domTree.filter((e: Record<string, unknown>) => {
    const styles = (e.computedStyles as Record<string, string>) || {};
    return styles.animationName && styles.animationName !== 'none';
  }).length;

  const animationCount = cssAnimations + transitions + webAnimationElements;

  if (animationCount > 50) {
    issues.push(`Performance risk: ${animationCount} animations detected (threshold: 50). Consider reducing or optimizing animations.`);
  }

  // Render-blocking resources (CSS files loaded from <link> tags are render-blocking)
  const renderBlockingResources = cssRaw
    .filter(c => c.url && !c.url.includes('async') && c.url.startsWith('http'))
    .map(c => c.url);

  // Total asset weight
  const totalAssetWeight = totalCSSBytes + totalFontBytes + totalImageBytes;

  // Score: 0-100, lower is worse
  let score = 100;
  if (totalDOMElements > 1500) score -= Math.min(25, Math.floor((totalDOMElements - 1500) / 100));
  if (totalCSSBytes > 500 * 1024) score -= Math.min(20, Math.floor((totalCSSBytes - 500 * 1024) / (100 * 1024)));
  if (fontAssets.length > 10) score -= Math.min(15, (fontAssets.length - 10) * 2);
  if (animationCount > 50) score -= Math.min(20, Math.floor((animationCount - 50) / 5));
  if (totalAssetWeight > 2 * 1024 * 1024) score -= 10; // Over 2MB total
  if (renderBlockingResources.length > 5) score -= 5;
  score = Math.max(0, score);

  return {
    domComplexity,
    cssWeight,
    fontWeight,
    imageWeight,
    animationCount,
    score,
    issues,
    details: {
      totalDOMElements,
      cssFileSizes,
      totalCSSBytes,
      fontFiles,
      totalFontBytes,
      imageFiles,
      totalImageBytes,
      animations: {
        css: cssAnimations,
        transitions,
        webAnimations: webAnimationElements,
      },
      renderBlockingResources,
      totalAssetWeight,
    },
  };
}

// ── Bundle Size Estimation ─────────────────────────────────────────────────────

/**
 * Estimates the generated component bundle size based on:
 * - JSX complexity: element count x 200 bytes
 * - CSS size: character count of generated CSS
 * - framer-motion overhead: +15KB per animation import
 */
export function estimateBundleSize(
  generatedTsx: string,
  generatedCss: string,
  options?: { framerMotionAnimations?: number },
): BundleSizeEstimate {
  // Count JSX elements (approximate by counting < characters that start tags)
  const elementCount = (generatedTsx.match(/<[a-zA-Z]/g) || []).length;
  const jsxSizeBytes = elementCount * 200;

  // CSS size is the character count
  const cssSizeBytes = Buffer.byteLength(generatedCss, 'utf8');

  // framer-motion overhead: ~15KB per animation (tree-shaken import)
  const framerMotionImports = options?.framerMotionAnimations ??
    countFramerMotionImports(generatedTsx);
  const FRAMER_MOTION_PER_ANIMATION = 15 * 1024;
  const framerMotionOverheadBytes = framerMotionImports > 0
    ? FRAMER_MOTION_PER_ANIMATION * framerMotionImports
    : 0;

  const totalEstimatedBytes = jsxSizeBytes + cssSizeBytes + framerMotionOverheadBytes;

  return {
    jsxSizeBytes,
    cssSizeBytes,
    framerMotionOverheadBytes,
    totalEstimatedBytes,
    breakdown: {
      elementCount,
      cssCharCount: generatedCss.length,
      framerMotionImports,
    },
  };
}

function countFramerMotionImports(tsx: string): number {
  // Count distinct framer-motion features used
  let count = 0;
  if (tsx.includes('motion.')) count++;
  if (tsx.includes('useScroll')) count++;
  if (tsx.includes('useTransform')) count++;
  if (tsx.includes('whileHover')) count++;
  if (tsx.includes('whileInView')) count++;
  if (tsx.includes('AnimatePresence')) count++;
  return count;
}

// ── CLI Entry ──────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const inputDir = args[0] || path.resolve(process.cwd(), 'output');
  const scanResultPath = path.join(inputDir, 'scan-result.json');

  if (!fs.existsSync(scanResultPath)) {
    log('Performance', 'error', `scan-result.json not found at ${scanResultPath}. Run scanner first.`);
    process.exit(1);
  }

  const scanResult = JSON.parse(fs.readFileSync(scanResultPath, 'utf8'));
  const report = analyzePerformance(scanResult);

  log('Performance', 'info', '\n=== Performance Report ===\n');
  log('Performance', 'info', `DOM Complexity:   ${report.domComplexity} elements`);
  log('Performance', 'info', `CSS Weight:       ${(report.cssWeight / 1024).toFixed(1)}KB`);
  log('Performance', 'info', `Font Weight:      ${(report.fontWeight / 1024).toFixed(1)}KB (estimated)`);
  log('Performance', 'info', `Image Weight:     ${(report.imageWeight / 1024).toFixed(1)}KB (estimated)`);
  log('Performance', 'info', `Animation Count:  ${report.animationCount}`);
  log('Performance', 'info', `Overall Score:    ${report.score}/100`);

  if (report.issues.length > 0) {
    log('Performance', 'info', '\nIssues:');
    for (const issue of report.issues) {
      log('Performance', 'info', `  - ${issue}`);
    }
  } else {
    log('Performance', 'info', '\nNo performance issues detected.');
  }

  // Write report
  const outputPath = path.join(inputDir, 'performance-report.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  log('Performance', 'info', `\nReport written to ${outputPath}`);
}

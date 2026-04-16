/**
 * Performance Capture
 *
 * Runs Lighthouse programmatically via Chrome DevTools Protocol to capture
 * real performance metrics: Core Web Vitals, resource breakdown, image/font
 * analysis, and animation performance classification.
 *
 * Also cross-references motion-distilled.json to classify animations as
 * compositor-only (transform/opacity) vs layout-triggering.
 *
 * Output: performance-report.json
 */

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { log, safeReadJSON } from '../core/utils';
import { config } from '../core/config';
import type {
  PerformanceCaptureResult,
  LighthouseScores,
  LighthouseMetrics,
  ResourceBreakdown,
  AnimationPerformance,
  ImageOptimization,
  FontPerformance,
  OptimizationOpportunity,
  DistilledMotion,
} from '../core/types';

// ── Layout-triggering properties ────────────────────────────────────────────

const LAYOUT_TRIGGERS = new Set([
  'width', 'height', 'top', 'left', 'right', 'bottom',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'border', 'borderWidth', 'fontSize', 'lineHeight',
  'min-width', 'max-width', 'min-height', 'max-height',
]);

const COMPOSITOR_ONLY = new Set(['transform', 'opacity']);

// ── Port Allocation ─────────────────────────────────────────────────────────

async function findFreePort(startPort: number, maxAttempts: number = 5): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    const free = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port);
    });
    if (free) return port;
  }
  throw new Error(`No free port found in range ${startPort}-${startPort + maxAttempts - 1}`);
}

// ── Lighthouse Runner ───────────────────────────────────────────────────────

// ── Lighthouse Result Shape ──────────────────────────────────────────────────

interface LhrCategory {
  score: number | null;
}

interface LhrAuditDetails {
  items?: Record<string, unknown>[];
  overallSavingsBytes?: number;
}

interface LhrAudit {
  score?: number | null;
  numericValue?: number;
  details?: LhrAuditDetails;
}

interface LighthouseReport {
  categories?: Record<string, LhrCategory>;
  audits?: Record<string, LhrAudit>;
}

async function runLighthouse(url: string, port: number): Promise<LighthouseReport> {
  // Dynamic import — lighthouse is an optional dependency
  let lighthouse: (url: string, opts: Record<string, unknown>) => Promise<{ lhr: LighthouseReport }>;
  try {
    lighthouse = (await import('lighthouse')).default as typeof lighthouse;
  } catch {
    throw new Error('lighthouse npm package not installed — run: npm install lighthouse');
  }

  const result = await lighthouse(url, {
    port,
    output: 'json',
    onlyCategories: config.performance.categories,
    formFactor: 'desktop',
    screenEmulation: { disabled: true },
    throttling: {
      // No throttling — measure real performance
      cpuSlowdownMultiplier: 1,
      requestLatencyMs: 0,
      downloadThroughputKbps: 0,
      uploadThroughputKbps: 0,
    },
  });

  return result?.lhr;
}

// ── Extract Lighthouse Data ─────────────────────────────────────────────────

function extractScores(lhr: LighthouseReport): LighthouseScores {
  const cat = lhr.categories || {};
  return {
    performance: Math.round((cat.performance?.score || 0) * 100),
    accessibility: Math.round((cat.accessibility?.score || 0) * 100),
    bestPractices: Math.round((cat['best-practices']?.score || 0) * 100),
    seo: Math.round((cat.seo?.score || 0) * 100),
  };
}

function extractMetrics(lhr: LighthouseReport): LighthouseMetrics {
  const audits = lhr.audits || {};
  const metricsItem = audits.metrics?.details?.items?.[0] as Record<string, unknown> | undefined;
  const metricsAudit = metricsItem || {};

  return {
    fcp: Math.round((metricsAudit.firstContentfulPaint as number || audits['first-contentful-paint']?.numericValue || 0)),
    lcp: Math.round((metricsAudit.largestContentfulPaint as number || audits['largest-contentful-paint']?.numericValue || 0)),
    cls: parseFloat(((metricsAudit.cumulativeLayoutShift as number || audits['cumulative-layout-shift']?.numericValue || 0)).toFixed(3)),
    inp: Math.round((metricsAudit.interactionToNextPaint as number || audits['interaction-to-next-paint']?.numericValue || 0)),
    ttfb: Math.round((metricsAudit.timeToFirstByte as number || audits['server-response-time']?.numericValue || 0)),
    si: Math.round((metricsAudit.speedIndex as number || audits['speed-index']?.numericValue || 0)),
    tbt: Math.round((metricsAudit.totalBlockingTime as number || audits['total-blocking-time']?.numericValue || 0)),
  };
}

interface NetworkRequestItem {
  resourceType?: string;
  transferSize?: number;
  url?: string;
}

function extractResources(lhr: LighthouseReport): ResourceBreakdown {
  const audits = lhr.audits || {};

  // Total byte weight
  const totalWeight = audits['total-byte-weight'];
  const totalSize = totalWeight?.numericValue || 0;

  // By type from network-requests
  const networkAudit = (audits['network-requests']?.details?.items || []) as NetworkRequestItem[];
  const byType: Record<string, number> = {};
  for (const req of networkAudit) {
    const type = req.resourceType || 'other';
    byType[type] = (byType[type] || 0) + (req.transferSize || 0);
  }

  // Render blocking
  const renderBlocking = ((audits['render-blocking-resources']?.details?.items || []) as Array<{ url?: string }>)
    .map((item) => {
      const url = item.url || '';
      return url.split('/').pop()?.split('?')[0] || url;
    })
    .slice(0, 10);

  // Largest resources
  const largestResources = networkAudit
    .filter((r) => (r.transferSize ?? 0) > 0)
    .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
    .slice(0, 10)
    .map((r) => ({
      url: r.url?.split('/').pop()?.split('?')[0] || r.url || 'unknown',
      size: r.transferSize || 0,
      type: r.resourceType || 'other',
    }));

  // Unused bytes
  const unusedCss = audits['unused-css-rules']?.details?.overallSavingsBytes || 0;
  const unusedJs = audits['unused-javascript']?.details?.overallSavingsBytes || 0;

  return {
    totalSize: Math.round(totalSize),
    byType,
    renderBlocking,
    largestResources,
    unusedBytes: Math.round(unusedCss + unusedJs),
  };
}

interface ImageAuditItem {
  url?: string;
  totalBytes?: number;
  wastedBytes?: number;
  node?: { selector?: string };
}

function extractImages(lhr: LighthouseReport): ImageOptimization {
  const audits = lhr.audits || {};

  // Unoptimized images
  const modernFormats = (audits['modern-image-formats']?.details?.items || []) as ImageAuditItem[];
  const unoptimized = modernFormats.slice(0, 10).map((item) => {
    const url = item.url || '';
    const filename = url.split('/').pop()?.split('?')[0] || url;
    const ext = filename.split('.').pop()?.toLowerCase() || 'unknown';
    return {
      url: filename,
      format: ext,
      size: item.totalBytes || 0,
      suggestedFormat: 'webp',
      potentialSavings: item.wastedBytes || 0,
    };
  });

  // Missing lazy loading
  const offscreen = (audits['offscreen-images']?.details?.items || []) as ImageAuditItem[];
  const missingLazy = offscreen.slice(0, 10).map((item) => {
    const url = item.url || '';
    return url.split('/').pop()?.split('?')[0] || url;
  });

  // Missing sizes
  const unsized = (audits['unsized-images']?.details?.items || []) as ImageAuditItem[];
  const missingSizes = unsized.slice(0, 10).map((item) => item.node?.selector || 'unknown');

  return { unoptimized, missingLazy, missingSizes };
}

interface FontDisplayItem {
  value?: string;
}

function extractFonts(lhr: LighthouseReport): FontPerformance {
  const audits = lhr.audits || {};

  // Font display
  const fontDisplay = (audits['font-display']?.details?.items || []) as FontDisplayItem[];
  const strategies = fontDisplay.map((item) => item.value || 'unknown');
  const strategy = strategies[0] || 'unknown';

  // Font preload
  const preloadAudit = audits['preload-fonts'];
  const preloaded = preloadAudit?.score === 1;

  // Count + estimate size from network requests
  const network = (audits['network-requests']?.details?.items || []) as NetworkRequestItem[];
  const fontRequests = network.filter((r) => r.resourceType === 'Font');
  const totalSize = fontRequests.reduce((sum: number, r) => sum + (r.transferSize || 0), 0);

  const issues: string[] = [];
  if (strategy !== 'swap' && strategy !== 'optional') {
    issues.push(`font-display: ${strategy} may cause invisible text (FOIT)`);
  }
  if (!preloaded && fontRequests.length > 0) {
    issues.push('Fonts not preloaded — add <link rel="preload"> for critical fonts');
  }

  return {
    strategy,
    preloaded,
    totalSize: Math.round(totalSize),
    count: fontRequests.length,
    issues,
  };
}

// ── Animation Performance Analysis ──────────────────────────────────────────

function analyzeAnimationPerformance(outputDir: string): AnimationPerformance {
  const motion = safeReadJSON<DistilledMotion>(path.join(outputDir, 'motion-distilled.json'));
  if (!motion || !motion.animations) {
    return { compositorOnly: 0, layoutTriggers: 0, issues: [] };
  }

  let compositorOnly = 0;
  let layoutTriggers = 0;
  const issues: string[] = [];

  for (const anim of motion.animations) {
    const animatedProps = new Set([
      ...Object.keys(anim.from || {}),
      ...Object.keys(anim.to || {}),
    ]);

    let hasLayoutTrigger = false;
    for (const prop of animatedProps) {
      if (LAYOUT_TRIGGERS.has(prop)) {
        hasLayoutTrigger = true;
        issues.push(`${anim.element} animates "${prop}" (causes layout recalculation)`);
      }
    }

    if (hasLayoutTrigger) {
      layoutTriggers++;
    } else if (animatedProps.size > 0) {
      compositorOnly++;
    }
  }

  return { compositorOnly, layoutTriggers, issues: issues.slice(0, 20) };
}

// ── Optimization Opportunities ──────────────────────────────────────────────

function buildOpportunities(
  resources: ResourceBreakdown,
  images: ImageOptimization,
  fonts: FontPerformance,
  animations: AnimationPerformance,
  metrics: LighthouseMetrics,
): OptimizationOpportunity[] {
  const opportunities: OptimizationOpportunity[] = [];
  const thresholds = config.performance.thresholds;

  // Image optimization
  const imageSavings = images.unoptimized.reduce((sum, img) => sum + img.potentialSavings, 0);
  if (imageSavings > 50000) {
    opportunities.push({
      category: 'images',
      impact: imageSavings > 500000 ? 'high' : 'medium',
      description: `Convert ${images.unoptimized.length} images to WebP/AVIF (save ~${(imageSavings / 1024).toFixed(0)}KB)`,
      potentialSavings: imageSavings,
    });
  }

  if (images.missingLazy.length > 0) {
    opportunities.push({
      category: 'images',
      impact: 'medium',
      description: `Add loading="lazy" to ${images.missingLazy.length} offscreen images`,
    });
  }

  // Unused CSS/JS
  if (resources.unusedBytes > 50000) {
    opportunities.push({
      category: 'css',
      impact: resources.unusedBytes > 200000 ? 'high' : 'medium',
      description: `Remove ~${(resources.unusedBytes / 1024).toFixed(0)}KB of unused CSS/JavaScript`,
      potentialSavings: resources.unusedBytes,
    });
  }

  // Render blocking
  if (resources.renderBlocking.length > 0) {
    opportunities.push({
      category: 'rendering',
      impact: 'high',
      description: `${resources.renderBlocking.length} render-blocking resources delay first paint: ${resources.renderBlocking.slice(0, 3).join(', ')}`,
    });
  }

  // Font issues
  for (const issue of fonts.issues) {
    opportunities.push({
      category: 'fonts',
      impact: 'medium',
      description: issue,
    });
  }

  // Animation issues
  if (animations.layoutTriggers > 0) {
    opportunities.push({
      category: 'animations',
      impact: animations.layoutTriggers > 5 ? 'high' : 'medium',
      description: `${animations.layoutTriggers} animations trigger layout recalculation — use transform/opacity instead`,
    });
  }

  // Core Web Vitals failures
  if (metrics.lcp > thresholds.lcp) {
    opportunities.push({
      category: 'performance',
      impact: 'high',
      description: `LCP is ${metrics.lcp}ms (threshold: ${thresholds.lcp}ms) — optimize largest content element loading`,
    });
  }
  if (metrics.cls > thresholds.cls) {
    opportunities.push({
      category: 'performance',
      impact: 'high',
      description: `CLS is ${metrics.cls} (threshold: ${thresholds.cls}) — add explicit dimensions to images/embeds`,
    });
  }
  if (metrics.inp > thresholds.inp) {
    opportunities.push({
      category: 'performance',
      impact: 'high',
      description: `INP is ${metrics.inp}ms (threshold: ${thresholds.inp}ms) — reduce JavaScript execution on interactions`,
    });
  }

  // Sort by impact
  const impactOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  opportunities.sort((a, b) => (impactOrder[a.impact] || 2) - (impactOrder[b.impact] || 2));

  return opportunities;
}

// ── Main Capture Function ───────────────────────────────────────────────────

export async function capturePerformance(url: string, outputDir: string): Promise<PerformanceCaptureResult> {
  fs.mkdirSync(outputDir, { recursive: true });

  log('Performance', 'info', `Capturing performance metrics for ${url}...`);

  // Find a free port for CDP
  const basePort = config.performance.lighthousePort;
  const port = await findFreePort(basePort);
  log('Performance', 'info', `Using CDP port ${port}`);

  // Launch browser with remote debugging
  const browser = await chromium.launch({
    headless: true,
    args: [`--remote-debugging-port=${port}`],
  });

  let lhr: LighthouseReport | undefined;
  try {
    lhr = await runLighthouse(url, port);
  } finally {
    await browser.close().catch(() => {});
  }

  if (!lhr) {
    throw new Error('Lighthouse returned no results');
  }

  // Extract structured data from Lighthouse
  const scores = extractScores(lhr);
  const metrics = extractMetrics(lhr);
  const resources = extractResources(lhr);
  const images = extractImages(lhr);
  const fonts = extractFonts(lhr);

  // Analyze animation performance from motion data
  const animations = analyzeAnimationPerformance(outputDir);

  // Build ranked optimization opportunities
  const optimizationOpportunities = buildOpportunities(resources, images, fonts, animations, metrics);

  const result: PerformanceCaptureResult = {
    url,
    timestamp: new Date().toISOString(),
    lighthouse: { scores, metrics },
    resources,
    animations,
    images,
    fonts,
    optimizationOpportunities,
    score: scores.performance,
  };

  // Write output
  const outputPath = path.join(outputDir, 'performance-report.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  const sizeKB = (Buffer.byteLength(JSON.stringify(result), 'utf-8') / 1024).toFixed(1);
  log('Performance', 'info',
    `Wrote performance-report.json (${sizeKB} KB) — ` +
    `Score: ${scores.performance}/100, LCP: ${metrics.lcp}ms, CLS: ${metrics.cls}, INP: ${metrics.inp}ms`
  );
  if (optimizationOpportunities.length > 0) {
    const top = optimizationOpportunities.slice(0, 3).map(o => `[${o.impact}] ${o.description}`);
    log('Performance', 'info', `Top opportunities:\n  ${top.join('\n  ')}`);
  }

  return result;
}

// ── CLI Entry ───────────────────────────────────────────────────────────────

if (require.main === module) {
  const url = process.argv[2];
  const outputDir = process.argv[3] || path.resolve(process.cwd(), 'output');

  if (!url) {
    log('Performance', 'error', 'Usage: ts-node capture-performance.ts <url> [output-dir]');
    process.exit(1);
  }

  capturePerformance(url, outputDir)
    .then((result) => {
      log('Performance', 'info', `\nPerformance Score: ${result.score}/100`);
      log('Performance', 'info', `LCP: ${result.lighthouse.metrics.lcp}ms | CLS: ${result.lighthouse.metrics.cls} | INP: ${result.lighthouse.metrics.inp}ms`);
      log('Performance', 'info', `${result.optimizationOpportunities.length} optimization opportunities found`);
    })
    .catch((err) => {
      log('Performance', 'error', err.message);
      process.exit(1);
    });
}

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { withBrowser, withRetry, safeReadJSON, isScanResult, log } from '../core/utils';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ValidationResult {
  url: string;
  mode: 'rebuild' | 'site';
  timestamp: string;
  overallScore: number;
  screenshotComparisons: {
    breakpoint: number;
    originalPath: string;
    comparedPath: string;
    diffPixels: number;
    totalPixels: number;
    matchPercentage: number;
    diffImagePath: string;
    status?: 'error';
    error?: string;
  }[];
  domDiscrepancies: {
    selector: string;
    issue: string;
    expected: string;
    actual: string;
    severity: 'critical' | 'major' | 'minor';
  }[];
  missingElements: string[];
  extraElements: string[];
  styleDiscrepancies: {
    selector: string;
    property: string;
    specValue: string;
    actualValue: string;
  }[];
  interactionDiscrepancies: {
    selector: string;
    state: string;
    issue: string;
  }[];
  recommendations: string[];
}

interface Correction {
  component: string;
  breakpoint: number;
  issue: string;
  expected: string;
  actual: string;
  selector: string;
  severity: 'critical' | 'major' | 'minor';
}

interface DiffReport {
  corrections: Correction[];
  improved: string[];
  degraded: string[];
  overallDelta: string;
}

interface CLIOptions {
  url: string;
  outputDir: string;
  mode: 'rebuild' | 'site' | 'diff';
  rebuildUrl: string;
}

// ── Main Validator ─────────────────────────────────────────────────────────────

async function validateRebuild(originalUrl: string, outputDir: string, rebuildUrl: string): Promise<ValidationResult> {
  const scanResultPath = path.join(outputDir, 'scan-result.json');
  if (!fs.existsSync(scanResultPath)) throw new Error('scan-result.json not found');

  const scanResult = safeReadJSON(scanResultPath, isScanResult) as unknown as import('../core/types/scanner').ScanResult;

  const screenshotDir = path.join(outputDir, 'screenshots');
  const diffDir = path.join(outputDir, 'diffs');
  fs.mkdirSync(diffDir, { recursive: true });

  return withBrowser(async (browser) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  log('Validator', 'info', `Loading rebuild at ${rebuildUrl}...`);
  try {
    await withRetry(() => page.goto(rebuildUrl, { waitUntil: 'networkidle', timeout: 30000 }), { label: 'page.goto', retries: 2 });
  } catch (err) {
    log('Validator', 'error', `Failed to load rebuild at ${rebuildUrl}. Is the dev server running?`);
    throw err;
  }
  await page.waitForTimeout(2000);

  // ── Screenshot comparisons: rebuild vs original ──
  log('Validator', 'info', 'Comparing rebuild screenshots against originals...');
  const screenshotComparisons: ValidationResult['screenshotComparisons'] = [];
  const breakpoints = [320, 375, 414, 768, 1024, 1280, 1440, 1920];

  for (const bp of breakpoints) {
    const originalPath = path.join(screenshotDir, `viewport-${bp}.png`);
    if (!fs.existsSync(originalPath)) continue;

    await page.setViewportSize({ width: bp, height: 900 });
    await page.waitForTimeout(500);

    const rebuildScreenshotPath = path.join(diffDir, `rebuild-${bp}.png`);
    await page.screenshot({ path: rebuildScreenshotPath, fullPage: true });

    try {
      const original = PNG.sync.read(fs.readFileSync(originalPath));
      const rebuild = PNG.sync.read(fs.readFileSync(rebuildScreenshotPath));

      const width = Math.min(original.width, rebuild.width);
      const height = Math.min(original.height, rebuild.height);

      if (original.width !== rebuild.width || original.height !== rebuild.height) {
        log('Validator', 'warn', `  ${bp}px: size mismatch (original: ${original.width}x${original.height}, rebuild: ${rebuild.width}x${rebuild.height})`);
      }

      const cropOriginal = cropPNG(original, width, height);
      const cropRebuild = cropPNG(rebuild, width, height);

      const diff = new PNG({ width, height });
      const diffPixels = pixelmatch(
        cropOriginal.data, cropRebuild.data, diff.data,
        width, height,
        { threshold: 0.1 }
      );

      const diffImagePath = path.join(diffDir, `diff-rebuild-${bp}.png`);
      fs.writeFileSync(diffImagePath, PNG.sync.write(diff));

      const totalPixels = width * height;
      const matchPercentage = ((totalPixels - diffPixels) / totalPixels) * 100;

      screenshotComparisons.push({
        breakpoint: bp,
        originalPath,
        comparedPath: rebuildScreenshotPath,
        diffPixels,
        totalPixels,
        matchPercentage: Math.round(matchPercentage * 100) / 100,
        diffImagePath,
      });

      log('Validator', 'info', `  ${bp}px: ${matchPercentage.toFixed(2)}% match (${diffPixels} diff pixels)`);
    } catch (err) {
      log('Validator', 'info', `  ${bp}px: comparison failed - ${err}`);
      screenshotComparisons.push({
        breakpoint: bp,
        originalPath,
        comparedPath: rebuildScreenshotPath,
        diffPixels: -1,
        totalPixels: 0,
        matchPercentage: 0,
        diffImagePath: '',
        status: 'error',
        error: String(err),
      });
    }
  }

  // Reset viewport
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);

  // ── DOM verification: compare rebuild DOM against scan data ──
  log('Validator', 'info', 'Comparing DOM structure...');
  const domDiscrepancies: ValidationResult['domDiscrepancies'] = [];
  const missingElements: string[] = [];
  const extraElements: string[] = [];
  const styleDiscrepancies: ValidationResult['styleDiscrepancies'] = [];

  const rebuildDOM = await page.evaluate(() => {
    const elements: Record<string, { tag: string; display: string; visibility: string; width: string; height: string; fontSize: string; fontFamily: string; fontWeight: string; color: string; backgroundColor: string; padding: string; margin: string; borderRadius: string }> = {};
    document.querySelectorAll('*').forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const id = el.id;
      const cls = Array.from(el.classList).slice(0, 3).join('.');
      const selector = id ? `#${id}` : cls ? `${tag}.${cls}` : null;
      if (selector) {
        const computed = window.getComputedStyle(el);
        elements[selector] = {
          tag,
          display: computed.display,
          visibility: computed.visibility,
          width: computed.width,
          height: computed.height,
          fontSize: computed.fontSize,
          fontFamily: computed.fontFamily,
          fontWeight: computed.fontWeight,
          color: computed.color,
          backgroundColor: computed.backgroundColor,
          padding: computed.padding,
          margin: computed.margin,
          borderRadius: computed.borderRadius,
        };
      }
    });
    return elements;
  });

  // Compare key elements from original scan against rebuild
  const keyProps = ['display', 'fontSize', 'fontWeight', 'color', 'backgroundColor', 'borderRadius'];
  for (const scanEl of scanResult.domTree.slice(0, 1000)) {
    if (!scanEl.selector || scanEl.selector.includes(':nth-of-type') || scanEl.selector.includes(':nth-child')) continue;

    const rebuildEl = rebuildDOM[scanEl.selector];
    if (!rebuildEl) {
      missingElements.push(scanEl.selector);
      continue;
    }

    for (const prop of keyProps) {
      const scanVal = scanEl.computedStyles?.[prop];
      const rebuildVal = (rebuildEl as Record<string, string>)[prop];
      if (scanVal && rebuildVal && scanVal !== rebuildVal) {
        styleDiscrepancies.push({
          selector: scanEl.selector,
          property: prop,
          specValue: scanVal,
          actualValue: rebuildVal,
        });
      }
    }
  }

  // Check tag distribution (structural similarity)
  const originalTagCounts = await getTagCounts(scanResult.domTree);
  const rebuildTagCounts: Record<string, number> = await page.evaluate(() => {
    const counts: Record<string, number> = {};
    document.querySelectorAll('*').forEach(el => {
      const tag = el.tagName.toLowerCase();
      counts[tag] = (counts[tag] || 0) + 1;
    });
    return counts;
  });

  for (const tag of ['h1', 'h2', 'h3', 'nav', 'footer', 'header', 'main', 'section', 'article', 'form']) {
    const origCount = originalTagCounts[tag] || 0;
    const rebuildCount = rebuildTagCounts[tag] || 0;
    if (origCount !== rebuildCount) {
      domDiscrepancies.push({
        selector: tag,
        issue: `Tag count mismatch`,
        expected: `${origCount} <${tag}> elements`,
        actual: `${rebuildCount} <${tag}> elements`,
        severity: origCount > 0 && rebuildCount === 0 ? 'critical' as const : 'major' as const,
      });
    }
  }

  // ── Interaction validation ──
  log('Validator', 'info', 'Validating interactions...');
  const interactionDiscrepancies: ValidationResult['interactionDiscrepancies'] = [];

  for (const el of scanResult.interactiveElements?.slice(0, 50) || []) {
    if (!el.interactionStates || !el.selector) continue;

    try {
      const exists = await page.$(el.selector);
      if (!exists) {
        interactionDiscrepancies.push({
          selector: el.selector,
          state: 'existence',
          issue: 'Interactive element not found in rebuild',
        });
        continue;
      }

      if (el.interactionStates.hover) {
        await exists.hover();
        await page.waitForTimeout(150);

        const currentHoverStyles = await page.evaluate(({ sel, props }: { sel: string; props: string[] }) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const computed = window.getComputedStyle(el);
          const styles: Record<string, string> = {};
          for (const prop of props) {
            const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
            styles[prop] = computed.getPropertyValue(cssProp);
          }
          return styles;
        }, { sel: el.selector, props: Object.keys(el.interactionStates.hover) });

        if (currentHoverStyles) {
          for (const [prop, expectedVal] of Object.entries(el.interactionStates.hover)) {
            if (currentHoverStyles[prop] !== expectedVal) {
              interactionDiscrepancies.push({
                selector: el.selector,
                state: `hover:${prop}`,
                issue: `Expected "${expectedVal}", got "${currentHoverStyles[prop]}"`,
              });
            }
          }
        }

        await page.mouse.move(0, 0);
        await page.waitForTimeout(50);
      }
    } catch { /* */ }
  }

  // ── Calculate overall score ──
  const successfulComparisons = screenshotComparisons.filter(c => c.status !== 'error');
  const overallScore = successfulComparisons.length > 0
    ? Math.round((successfulComparisons.reduce((a, b) => a + b.matchPercentage, 0) / successfulComparisons.length) * 100) / 100
    : 0;

  const recommendations: string[] = [];
  if (missingElements.length > 0) {
    recommendations.push(`${missingElements.length} elements from original are missing in rebuild.`);
  }
  if (styleDiscrepancies.length > 10) {
    recommendations.push(`${styleDiscrepancies.length} style mismatches found. Check design token values.`);
  }
  if (interactionDiscrepancies.length > 0) {
    recommendations.push(`${interactionDiscrepancies.length} interaction states don't match. Check hover/focus styles.`);
  }
  if (domDiscrepancies.some(d => d.severity === 'critical')) {
    recommendations.push('Critical structural elements are missing. Check semantic HTML tags.');
  }

  const result: ValidationResult = {
    url: originalUrl,
    mode: 'rebuild',
    timestamp: new Date().toISOString(),
    overallScore,
    screenshotComparisons,
    domDiscrepancies,
    missingElements: missingElements.slice(0, 100),
    extraElements: extraElements.slice(0, 100),
    styleDiscrepancies: styleDiscrepancies.slice(0, 200),
    interactionDiscrepancies,
    recommendations,
  };

  const outputPath = path.join(outputDir, 'rebuild-validation-report.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  log('Validator', 'info', `Rebuild validation written to ${outputPath}`);
  log('Validator', 'info', `Overall rebuild accuracy: ${overallScore}%`);

  return result;
  }); // end withBrowser
}

// ── Site Consistency Check (old behavior) ──────────────────────────────────────

async function validateSite(url: string, outputDir: string): Promise<ValidationResult> {
  const scanResultPath = path.join(outputDir, 'scan-result.json');
  const designSystemPath = path.join(outputDir, 'design-system.json');

  if (!fs.existsSync(scanResultPath)) throw new Error('scan-result.json not found');

  const scanResult = safeReadJSON(scanResultPath, isScanResult) as unknown as import('../core/types/scanner').ScanResult;

  const screenshotDir = path.join(outputDir, 'screenshots');
  const diffDir = path.join(outputDir, 'diffs');
  fs.mkdirSync(diffDir, { recursive: true });

  return withBrowser(async (browser) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  log('Validator', 'info', `Loading ${url} for site consistency check...`);
  await withRetry(() => page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }), { label: 'page.goto', retries: 2 });
  await page.waitForTimeout(2000);

  // ── Screenshot comparisons ──
  log('Validator', 'info', 'Running screenshot comparisons...');
  const screenshotComparisons: ValidationResult['screenshotComparisons'] = [];
  const breakpoints = [320, 375, 414, 768, 1024, 1280, 1440, 1920];

  for (const bp of breakpoints) {
    const originalPath = path.join(screenshotDir, `viewport-${bp}.png`);
    if (!fs.existsSync(originalPath)) continue;

    await page.setViewportSize({ width: bp, height: 900 });
    await page.waitForTimeout(500);

    const currentScreenshotPath = path.join(diffDir, `current-${bp}.png`);
    await page.screenshot({ path: currentScreenshotPath, fullPage: true });

    try {
      const original = PNG.sync.read(fs.readFileSync(originalPath));
      const current = PNG.sync.read(fs.readFileSync(currentScreenshotPath));

      const width = Math.min(original.width, current.width);
      const height = Math.min(original.height, current.height);

      const cropOriginal = cropPNG(original, width, height);
      const cropCurrent = cropPNG(current, width, height);

      const diff = new PNG({ width, height });
      const diffPixels = pixelmatch(
        cropOriginal.data, cropCurrent.data, diff.data,
        width, height,
        { threshold: 0.1 }
      );

      const diffImagePath = path.join(diffDir, `diff-${bp}.png`);
      fs.writeFileSync(diffImagePath, PNG.sync.write(diff));

      const totalPixels = width * height;
      const matchPercentage = ((totalPixels - diffPixels) / totalPixels) * 100;

      screenshotComparisons.push({
        breakpoint: bp,
        originalPath,
        comparedPath: currentScreenshotPath,
        diffPixels,
        totalPixels,
        matchPercentage: Math.round(matchPercentage * 100) / 100,
        diffImagePath,
      });

      log('Validator', 'info', `  ${bp}px: ${matchPercentage.toFixed(2)}% match`);
    } catch (err) {
      log('Validator', 'info', `  ${bp}px: comparison failed - ${err}`);
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);

  // DOM verification
  const domDiscrepancies: ValidationResult['domDiscrepancies'] = [];
  const missingElements: string[] = [];
  const styleDiscrepancies: ValidationResult['styleDiscrepancies'] = [];

  const currentDOM = await page.evaluate(() => {
    const elements: Record<string, { tag: string; display: string; fontSize: string; color: string; backgroundColor: string }> = {};
    document.querySelectorAll('*').forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const id = el.id;
      const cls = Array.from(el.classList).slice(0, 3).join('.');
      const selector = id ? `#${id}` : cls ? `${tag}.${cls}` : null;
      if (selector) {
        const computed = window.getComputedStyle(el);
        elements[selector] = {
          tag,
          display: computed.display,
          fontSize: computed.fontSize,
          color: computed.color,
          backgroundColor: computed.backgroundColor,
        };
      }
    });
    return elements;
  });

  for (const scanEl of scanResult.domTree.slice(0, 1000)) {
    if (!scanEl.selector || scanEl.selector.includes(':nth-child')) continue;
    const currentEl = currentDOM[scanEl.selector];
    if (!currentEl) {
      missingElements.push(scanEl.selector);
      continue;
    }
    for (const prop of ['display', 'fontSize', 'color', 'backgroundColor']) {
      const scanVal = scanEl.computedStyles?.[prop];
      const currentVal = (currentEl as Record<string, string>)[prop];
      if (scanVal && currentVal && scanVal !== currentVal) {
        styleDiscrepancies.push({
          selector: scanEl.selector,
          property: prop,
          specValue: scanVal,
          actualValue: currentVal,
        });
      }
    }
  }

  let score = 100;
  if (screenshotComparisons.length > 0) {
    const avgMatch = screenshotComparisons.reduce((a, b) => a + b.matchPercentage, 0) / screenshotComparisons.length;
    score = Math.min(score, avgMatch);
  }
  score -= missingElements.length * 0.5;
  score -= styleDiscrepancies.length * 0.2;
  score = Math.max(0, Math.round(score * 100) / 100);

  const recommendations: string[] = [];
  if (missingElements.length > 0) recommendations.push(`${missingElements.length} elements missing. Re-scan may be needed.`);
  if (styleDiscrepancies.length > 10) recommendations.push(`${styleDiscrepancies.length} style discrepancies. Site may have changed.`);

  const result: ValidationResult = {
    url,
    mode: 'site',
    timestamp: new Date().toISOString(),
    overallScore: score,
    screenshotComparisons,
    domDiscrepancies,
    missingElements: missingElements.slice(0, 100),
    extraElements: [],
    styleDiscrepancies: styleDiscrepancies.slice(0, 200),
    interactionDiscrepancies: [],
    recommendations,
  };

  const outputPath = path.join(outputDir, 'validation-report.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  log('Validator', 'info', `Site consistency report written to ${outputPath}`);
  log('Validator', 'info', `Overall score: ${score}%`);

  return result;
  }); // end withBrowser
}

// ── Incremental Diff Mode ──────────────────────────────────────────────────────

async function validateDiff(originalUrl: string, outputDir: string, rebuildUrl: string): Promise<DiffReport> {
  const prevReportPath = path.join(outputDir, 'rebuild-validation-report.json');
  let prevReport: ValidationResult | null = null;

  if (fs.existsSync(prevReportPath)) {
    prevReport = JSON.parse(fs.readFileSync(prevReportPath, 'utf-8'));
    log('Validator', 'info', `Previous score: ${prevReport!.overallScore}%`);
  }

  // Run full rebuild validation
  const newReport = await validateRebuild(originalUrl, outputDir, rebuildUrl);

  const corrections: Correction[] = [];

  // Generate corrections from style discrepancies
  for (const disc of newReport.styleDiscrepancies) {
    corrections.push({
      component: disc.selector.split('.')[0] || disc.selector,
      breakpoint: 1440,
      issue: `${disc.property} mismatch`,
      expected: disc.specValue,
      actual: disc.actualValue,
      selector: disc.selector,
      severity: ['color', 'backgroundColor', 'fontSize'].includes(disc.property) ? 'critical' : 'major',
    });
  }

  // Generate corrections from DOM discrepancies
  for (const disc of newReport.domDiscrepancies) {
    corrections.push({
      component: disc.selector,
      breakpoint: 0,
      issue: disc.issue,
      expected: disc.expected,
      actual: disc.actual,
      selector: disc.selector,
      severity: disc.severity,
    });
  }

  // Generate corrections from screenshot diffs
  for (const sc of newReport.screenshotComparisons) {
    if (sc.matchPercentage < 95) {
      corrections.push({
        component: 'page',
        breakpoint: sc.breakpoint,
        issue: `Screenshot mismatch: ${sc.matchPercentage.toFixed(1)}% match`,
        expected: '>=95% pixel match',
        actual: `${sc.matchPercentage.toFixed(1)}% match (${sc.diffPixels} diff pixels)`,
        selector: 'body',
        severity: sc.matchPercentage < 80 ? 'critical' : 'major',
      });
    }
  }

  // Compare with previous report
  const improved: string[] = [];
  const degraded: string[] = [];
  let overallDelta = 'N/A';

  if (prevReport) {
    overallDelta = `${(newReport.overallScore - prevReport.overallScore) >= 0 ? '+' : ''}${(newReport.overallScore - prevReport.overallScore).toFixed(1)}%`;

    // Compare per-breakpoint
    for (const newSc of newReport.screenshotComparisons) {
      const prevSc = prevReport.screenshotComparisons.find(s => s.breakpoint === newSc.breakpoint);
      if (prevSc) {
        if (newSc.matchPercentage > prevSc.matchPercentage + 0.5) {
          improved.push(`${newSc.breakpoint}px viewport`);
        } else if (newSc.matchPercentage < prevSc.matchPercentage - 0.5) {
          degraded.push(`${newSc.breakpoint}px viewport`);
        }
      }
    }
  }

  const diffReport: DiffReport = {
    corrections: corrections.sort((a, b) => {
      const sev = { critical: 0, major: 1, minor: 2 };
      return sev[a.severity] - sev[b.severity];
    }),
    improved,
    degraded,
    overallDelta,
  };

  const outputPath = path.join(outputDir, 'corrections-needed.json');
  fs.writeFileSync(outputPath, JSON.stringify(diffReport, null, 2));
  log('Validator', 'info', `Corrections written to ${outputPath}`);
  log('Validator', 'info', `${corrections.length} corrections needed`);
  log('Validator', 'info', `Delta: ${overallDelta}`);
  if (improved.length) log('Validator', 'info', `Improved: ${improved.join(', ')}`);
  if (degraded.length) log('Validator', 'info', `Degraded: ${degraded.join(', ')}`);

  return diffReport;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function cropPNG(png: PNG, width: number, height: number): PNG {
  if (png.width === width && png.height === height) return png;
  const cropped = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * png.width + x) * 4;
      const dstIdx = (y * width + x) * 4;
      cropped.data[dstIdx] = png.data[srcIdx];
      cropped.data[dstIdx + 1] = png.data[srcIdx + 1];
      cropped.data[dstIdx + 2] = png.data[srcIdx + 2];
      cropped.data[dstIdx + 3] = png.data[srcIdx + 3];
    }
  }
  return cropped;
}

function getTagCounts(domTree: { tag: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const el of domTree) {
    counts[el.tag] = (counts[el.tag] || 0) + 1;
  }
  return counts;
}

export { validateRebuild, validateSite, validateDiff };

// ── CLI Entry ──────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): CLIOptions {
  const positional: string[] = [];
  let mode: 'rebuild' | 'site' | 'diff' = 'rebuild';
  let rebuildUrl = 'http://localhost:3000';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--rebuild') {
      mode = 'rebuild';
    } else if (arg === '--site') {
      mode = 'site';
    } else if (arg === '--diff') {
      mode = 'diff';
    } else if (arg === '--rebuild-url' && argv[i + 1]) {
      rebuildUrl = argv[++i];
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  return {
    url: positional[0] || '',
    outputDir: positional[1] || path.resolve(process.cwd(), 'output'),
    mode,
    rebuildUrl,
  };
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.url) {
    log('Validator', 'error', 'Usage: ts-node validate.ts <url> [output-dir] [--rebuild --rebuild-url URL] [--site] [--diff]');
    log('Validator', 'error', '');
    log('Validator', 'error', 'Modes:');
    log('Validator', 'error', '  --rebuild (default)  Compare rebuild at --rebuild-url against original screenshots');
    log('Validator', 'error', '  --site               Compare live site against stored scan data');
    log('Validator', 'error', '  --diff               Incremental: re-validate rebuild, produce corrections list');
    log('Validator', 'error', '');
    log('Validator', 'error', 'Options:');
    log('Validator', 'error', '  --rebuild-url URL    URL of rebuild dev server (default: http://localhost:3000)');
    process.exit(1);
  }

  let run: Promise<ValidationResult | DiffReport>;
  if (opts.mode === 'site') {
    run = validateSite(opts.url, opts.outputDir);
  } else if (opts.mode === 'diff') {
    run = validateDiff(opts.url, opts.outputDir, opts.rebuildUrl);
  } else {
    run = validateRebuild(opts.url, opts.outputDir, opts.rebuildUrl);
  }

  run
    .then(() => {
      log('Validator', 'info', 'Done.');
      process.exit(0);
    })
    .catch((err) => {
      log('Validator', 'error', `Error: ${err}`);
      process.exit(1);
    });
}

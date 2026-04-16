/**
 * Cross-browser screenshot comparison.
 *
 * Launches each requested browser (chromium, firefox, webkit) via Playwright,
 * screenshots at configured breakpoints, then diffs every pair with pixelmatch.
 *
 * Usage:
 *   npx ts-node scripts/cross-browser.ts <url> [output-dir] [--browsers chromium,firefox,webkit]
 */

import { chromium, firefox, webkit, Browser, BrowserType } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { log } from '../core/utils';

// ── Types ──────────────────────────────────────────────────────────────────────

type BrowserName = 'chromium' | 'firefox' | 'webkit';

interface CrossBrowserComparison {
  browser1: string;
  browser2: string;
  breakpoint: number;
  matchPercentage: number;
  diffImagePath: string;
}

interface CrossBrowserReport {
  url: string;
  browsers: string[];
  comparisons: CrossBrowserComparison[];
  overallScore: number;
}

// ── Browser registry ───────────────────────────────────────────────────────────

const BROWSER_TYPES: Record<BrowserName, BrowserType> = {
  chromium,
  firefox,
  webkit,
};

const BREAKPOINTS = [320, 375, 768, 1024, 1440, 1920];

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

// ── Core ───────────────────────────────────────────────────────────────────────

async function captureScreenshots(
  browserName: BrowserName,
  url: string,
  outputDir: string,
): Promise<void> {
  const browserDir = path.join(outputDir, 'cross-browser', browserName);
  fs.mkdirSync(browserDir, { recursive: true });

  const browserType = BROWSER_TYPES[browserName];
  let browser: Browser | null = null;

  try {
    browser = await browserType.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    log('cross-browser', 'info', `[${browserName}] Loading ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(2000);

    for (const bp of BREAKPOINTS) {
      await page.setViewportSize({ width: bp, height: 900 });
      await page.waitForTimeout(500);
      const screenshotPath = path.join(browserDir, `viewport-${bp}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log('cross-browser', 'info', `[${browserName}] Captured ${bp}px`);
    }

    await context.close();
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

function comparePair(
  browser1: BrowserName,
  browser2: BrowserName,
  breakpoint: number,
  outputDir: string,
): CrossBrowserComparison {
  const img1Path = path.join(outputDir, 'cross-browser', browser1, `viewport-${breakpoint}.png`);
  const img2Path = path.join(outputDir, 'cross-browser', browser2, `viewport-${breakpoint}.png`);
  const diffDir = path.join(outputDir, 'cross-browser', 'diffs');
  fs.mkdirSync(diffDir, { recursive: true });

  const diffImagePath = path.join(diffDir, `diff-${browser1}-${browser2}-${breakpoint}.png`);

  if (!fs.existsSync(img1Path) || !fs.existsSync(img2Path)) {
    return { browser1, browser2, breakpoint, matchPercentage: 0, diffImagePath: '' };
  }

  const png1 = PNG.sync.read(fs.readFileSync(img1Path));
  const png2 = PNG.sync.read(fs.readFileSync(img2Path));

  const width = Math.min(png1.width, png2.width);
  const height = Math.min(png1.height, png2.height);

  const crop1 = cropPNG(png1, width, height);
  const crop2 = cropPNG(png2, width, height);

  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(
    crop1.data, crop2.data, diff.data,
    width, height,
    { threshold: 0.1 },
  );

  fs.writeFileSync(diffImagePath, PNG.sync.write(diff));

  const totalPixels = width * height;
  const matchPercentage = totalPixels > 0
    ? Math.round(((totalPixels - diffPixels) / totalPixels) * 10000) / 100
    : 0;

  return { browser1, browser2, breakpoint, matchPercentage, diffImagePath };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function compareBrowsers(
  url: string,
  outputDir: string,
  browsers: BrowserName[] = ['chromium', 'firefox', 'webkit'],
): Promise<CrossBrowserReport> {
  log('cross-browser', 'info', `Comparing ${browsers.join(', ')} for ${url}`);

  // Capture screenshots for each browser sequentially (each launches its own process)
  for (const browserName of browsers) {
    await captureScreenshots(browserName, url, outputDir);
  }

  // Compare every pair at every breakpoint
  const comparisons: CrossBrowserComparison[] = [];

  for (let i = 0; i < browsers.length; i++) {
    for (let j = i + 1; j < browsers.length; j++) {
      for (const bp of BREAKPOINTS) {
        const result = comparePair(browsers[i], browsers[j], bp, outputDir);
        comparisons.push(result);
        log('cross-browser', 'info',
          `${browsers[i]} vs ${browsers[j]} @ ${bp}px: ${result.matchPercentage}% match`);
      }
    }
  }

  // Overall score: average of all comparison match percentages
  const validComparisons = comparisons.filter(c => c.matchPercentage > 0);
  const overallScore = validComparisons.length > 0
    ? Math.round((validComparisons.reduce((sum, c) => sum + c.matchPercentage, 0) / validComparisons.length) * 100) / 100
    : 0;

  const report: CrossBrowserReport = { url, browsers, comparisons, overallScore };

  const reportPath = path.join(outputDir, 'cross-browser-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log('cross-browser', 'info', `Report written to ${reportPath}`);
  log('cross-browser', 'info', `Overall cross-browser score: ${overallScore}%`);

  return report;
}

export type { CrossBrowserReport, BrowserName };

// ── CLI Entry ──────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  let browsers: BrowserName[] = ['chromium', 'firefox', 'webkit'];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--browsers' && args[i + 1]) {
      browsers = args[++i].split(',').map(b => b.trim()) as BrowserName[];
    } else if (!args[i].startsWith('--')) {
      positional.push(args[i]);
    }
  }

  const url = positional[0];
  const outputDir = positional[1] || path.resolve(process.cwd(), 'output');

  if (!url) {
    log('CrossBrowser', 'error', 'Usage: ts-node scripts/cross-browser.ts <url> [output-dir] [--browsers chromium,firefox,webkit]');
    process.exit(1);
  }

  compareBrowsers(url, outputDir, browsers)
    .then((report) => {
      log('CrossBrowser', 'info', `\nCross-browser comparison complete. Overall score: ${report.overallScore}%`);
      process.exit(0);
    })
    .catch((err) => {
      log('CrossBrowser', 'error', err);
      process.exit(1);
    });
}

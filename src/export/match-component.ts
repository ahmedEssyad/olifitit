/**
 * Match Component CLI — "Make Mine Match"
 *
 * Compares your existing CSS module against a target component from a URL.
 * Produces a style diff and a patched CSS file.
 *
 * Usage:
 *   npx ts-node scripts/match-component.ts <url> <component> --file <css-file> [--map "a=b,c=d"] [--output dir]
 *
 * Examples:
 *   npx ts-node scripts/match-component.ts https://linear.app header --file ./src/components/Navbar.module.css
 *   npx ts-node scripts/match-component.ts https://stripe.com pricing --file ./Pricing.module.css --map "card=root"
 */

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils';
import {
  extractComponentStyles,
  captureComponentAnimations,
} from '../mcp/handlers/extract-component';
import {
  parseCssModule,
  matchClasses,
  diffStyles,
  generateDiffReport,
  applyPatch,
} from './adapters/component-differ';
import type { ExtractedElement } from './adapters/codegen-shared';

// ── CLI Parsing ─────────────────────────────────────────────────────────────

interface CLIOptions {
  url: string;
  component: string;
  file: string;
  outputDir?: string;
  classMap?: string;
}

function parseArgs(argv: string[]): CLIOptions {
  const positional: string[] = [];
  let file = '';
  let outputDir: string | undefined;
  let classMap: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--file' && argv[i + 1]) {
      file = argv[++i];
    } else if (arg === '--output' && argv[i + 1]) {
      outputDir = argv[++i];
    } else if (arg === '--map' && argv[i + 1]) {
      classMap = argv[++i];
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  return {
    url: positional[0] || '',
    component: positional[1] || '',
    file,
    outputDir,
    classMap,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.url || !opts.component || !opts.file) {
    log('Match', 'error', 'Usage: npx ts-node scripts/match-component.ts <url> <component> --file <css-file>');
    log('Match', 'error', '');
    log('Match', 'error', 'Options:');
    log('Match', 'error', '  --file <path>       Your CSS module file to match against');
    log('Match', 'error', '  --map "a=b,c=d"     Manual class mapping (yourClass=targetLabel)');
    log('Match', 'error', '  --output <dir>      Directory for patched file (default: same as --file)');
    log('Match', 'error', '');
    log('Match', 'error', 'Examples:');
    log('Match', 'error', '  npx ts-node scripts/match-component.ts https://linear.app header --file ./Navbar.module.css');
    process.exit(1);
  }

  // Validate file exists
  if (!fs.existsSync(opts.file)) {
    log('Match', 'error', `File not found: ${opts.file}`);
    process.exit(1);
  }

  // Read user's CSS
  const cssContent = fs.readFileSync(opts.file, 'utf-8');

  // Check for Tailwind
  if (cssContent.includes('@tailwind') || cssContent.includes('@apply')) {
    log('Match', 'warn', 'Warning: This file uses Tailwind utilities. The diff compares against computed styles, which may not align with utility classes. Consider using export_tailwind instead.');
  }

  // Parse user's CSS
  log('Match', 'info', `Parsing ${opts.file}...`);
  const userClasses = parseCssModule(cssContent);
  log('Match', 'info', `Found ${userClasses.size} CSS classes: ${[...userClasses.keys()].join(', ')}`);

  // Extract target component
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage();

    log('Match', 'info', `Loading ${opts.url}...`);
    await page.goto(opts.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    log('Match', 'info', `Extracting "${opts.component}" from target...`);
    const result = await extractComponentStyles(page, opts.component);
    if (!result) {
      log('Match', 'error', `No component matching "${opts.component}" found on ${opts.url}`);
      process.exit(1);
    }

    log('Match', 'info', `Capturing animations...`);
    const animations = await captureComponentAnimations(page, opts.component);

    // Match classes
    log('Match', 'info', `Matching your classes to target elements...`);
    const mappings = matchClasses(
      userClasses,
      result.element as ExtractedElement,
      (result.children || []) as ExtractedElement[],
      opts.classMap,
    );

    for (const m of mappings) {
      log('Match', 'info', `  .${m.userClass} → ${m.targetLabel} (${m.targetElement.tag}) [${m.matchMethod}, ${Math.round(m.confidence * 100)}%]`);
    }

    // Diff styles
    log('Match', 'info', `Diffing styles...`);
    const diffResult = diffStyles(
      userClasses,
      mappings,
      animations?.hover,
    );

    // Generate report
    const report = generateDiffReport(
      diffResult,
      path.basename(opts.file),
      opts.url,
      opts.component,
    );

    log('Match', 'info', '');
    log('Match', 'info', report);

    // Generate patched file
    const patchedCss = applyPatch(cssContent, diffResult);
    const outputDir = opts.outputDir || path.dirname(opts.file);
    const baseName = path.basename(opts.file, path.extname(opts.file));
    const patchedPath = path.join(outputDir, `${baseName}.patched${path.extname(opts.file)}`);

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(patchedPath, patchedCss);

    log('Match', 'info', '');
    log('Match', 'info', `Patched file written to: ${patchedPath}`);
    log('Match', 'info', `Review the changes, then replace your original file.`);

  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    log('Match', 'error', `Error: ${err}`);
    process.exit(1);
  });
}

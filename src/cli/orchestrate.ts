/**
 * Orchestrator — coordinates the full pipeline.
 *
 * Pipeline:
 *   1. scan.ts               → scan-result.json + screenshots/
 *   2. analyze.ts            → analysis-result.json         ┐
 *   3. capture-motion.ts     → motion-capture.json          ├─ parallel
 *   4. extract-interactions.ts → interactions.json           ┘
 *   4.5 distill-motion.ts    → motion-distilled.json (compact animation spec)
 *   5. copy-assets.ts        → rebuild/public/ assets + font-face CSS
 *   6. synthesize (Claude API) → design-system.json + design-system.md
 *   7. validate.ts           → rebuild-validation-report.json
 */

import * as path from 'path';
import * as fs from 'fs';
import { log, runPipelineStep, StepResult } from '../core/utils';
import { scan } from '../scan';
import { analyze } from '../scan/analyze';
import { captureMotion } from '../scan/capture-motion';
import { extractInteractions } from '../scan/extract-interactions';
import { validateRebuild, validateSite } from '../scan/validate';
import { distillMotion } from '../transform/distill-motion';
import { classifyPatterns } from '../transform/classify-patterns';
import { capturePerformance } from '../scan/capture-performance';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CLIOptions {
  url: string;
  outputDir: string;
  step: string;
  full: boolean;
  crawl: boolean;
  rebuildUrl: string;
  authCookie?: string;
  authHeader?: string;
  brandPath?: string;
}

// ── CLI Parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): CLIOptions {
  const positional: string[] = [];
  let step = 'all';
  let full = false;
  let crawl = false;
  let rebuildUrl = process.env.REBUILD_URL || 'http://localhost:3000';
  let authCookie: string | undefined;
  let authHeader: string | undefined;
  let brandPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--step' && argv[i + 1]) {
      step = argv[++i];
    } else if (arg === '--full') {
      full = true;
    } else if (arg === '--crawl') {
      crawl = true;
    } else if (arg === '--rebuild-url' && argv[i + 1]) {
      rebuildUrl = argv[++i];
    } else if (arg === '--auth-cookie' && argv[i + 1]) {
      authCookie = argv[++i];
    } else if (arg === '--auth-header' && argv[i + 1]) {
      authHeader = argv[++i];
    } else if (arg === '--brand' && argv[i + 1]) {
      brandPath = argv[++i];
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  return {
    url: positional[0] || '',
    outputDir: positional[1] || path.resolve(process.cwd(), 'output'),
    step,
    full,
    crawl,
    rebuildUrl,
    authCookie,
    authHeader,
    brandPath,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.url) {
    log('Pipeline', 'error', 'Usage: npx ts-node scripts/orchestrate.ts <url> [output-dir] [options]');
    log('Pipeline', 'error', '');
    log('Pipeline', 'error', 'Options:');
    log('Pipeline', 'error', '  --step <step>          Run specific step: scan, analyze, motion, interactions, assets, synthesize, validate, all');
    log('Pipeline', 'error', '  --full                 Also validate rebuild at --rebuild-url');
    log('Pipeline', 'error', '  --crawl                Enable multi-page crawling');
    log('Pipeline', 'error', '  --rebuild-url <url>    URL of rebuild dev server (default: http://localhost:3000)');
    log('Pipeline', 'error', '  --auth-cookie "k=v"    Set auth cookie before scanning');
    log('Pipeline', 'error', '  --auth-header "K: V"   Set auth header for requests');
    log('Pipeline', 'error', '  --brand <path>         Path to brand override JSON file (swap extracted colors/fonts)');
    process.exit(1);
  }

  fs.mkdirSync(opts.outputDir, { recursive: true });

  const results: StepResult[] = [];
  const shouldRun = (step: string) => opts.step === 'all' || opts.step === step;

  log('Pipeline', 'info', `Target URL: ${opts.url}`);
  log('Pipeline', 'info', `Output dir: ${opts.outputDir}`);
  log('Pipeline', 'info', `Step: ${opts.step}`);
  if (opts.brandPath) {
    log('Pipeline', 'info', `Brand config: ${opts.brandPath}`);
  }
  log('Pipeline', 'info', `Started at: ${new Date().toISOString()}`);

  // ── Step 1: Scanner (must complete before parallel steps) ──

  if (shouldRun('scan')) {
    const scanOpts: Record<string, any> = {};
    if (opts.crawl) scanOpts.crawl = true;
    if (opts.authCookie) scanOpts.authCookie = opts.authCookie;
    if (opts.authHeader) scanOpts.authHeader = opts.authHeader;

    const result = await runPipelineStep('Scanner', async () => {
      await scan(opts.url, opts.outputDir, scanOpts);
    });
    results.push(result);

    if (result.status === 'failed') {
      log('Pipeline', 'error', 'Scanner failed — cannot continue pipeline');
      printSummary(opts.outputDir, results);
      process.exit(1);
    }
  }

  // ── Steps 2-4: Parallel (analyze + motion + interactions) ──

  if (opts.step === 'all') {
    log('Pipeline', 'info', 'Running analyze, motion capture, interaction extraction, and performance capture in parallel...');

    const parallelResults = await Promise.allSettled([
      runPipelineStep('Analyzer', () => analyze(opts.url, opts.outputDir)),
      runPipelineStep('Motion Capture', () => captureMotion(opts.url, opts.outputDir), true),
      runPipelineStep('Interaction Extraction', () => extractInteractions(opts.url, opts.outputDir), true),
      runPipelineStep('Performance Capture', () => capturePerformance(opts.url, opts.outputDir), true),
    ]);

    const stepNames = ['Analyzer', 'Motion Capture', 'Interaction Extraction', 'Performance Capture'];
    const failedOptional: string[] = [];
    for (let i = 0; i < parallelResults.length; i++) {
      const settled = parallelResults[i];
      if (settled.status === 'fulfilled') {
        results.push(settled.value);
        // Track optional step failures for downstream degradation warning
        if (settled.value.status === 'failed' && i > 0) {
          failedOptional.push(stepNames[i]);
        }
      } else {
        const stepName = stepNames[i] || 'parallel-step';
        results.push({
          step: stepName,
          status: 'failed',
          durationMs: 0,
          error: settled.reason?.message || 'Unknown error',
        });
        if (i > 0) failedOptional.push(stepName);
      }
    }

    if (failedOptional.length > 0) {
      log('Pipeline', 'warn',
        `Optional steps failed: ${failedOptional.join(', ')}. ` +
        `AI synthesis will proceed with reduced data — output quality may be degraded.`
      );
    }
  } else {
    // Individual step mode
    if (shouldRun('analyze')) {
      results.push(await runPipelineStep('Analyzer', () => analyze(opts.url, opts.outputDir)));
    }
    if (shouldRun('motion')) {
      results.push(await runPipelineStep('Motion Capture', () => captureMotion(opts.url, opts.outputDir), true));
    }
    if (shouldRun('interactions')) {
      results.push(await runPipelineStep('Interaction Extraction', () => extractInteractions(opts.url, opts.outputDir), true));
    }
  }

  // ── Step 4.5: Motion Distillation ──

  if (shouldRun('distill') || opts.step === 'all') {
    const motionPath = path.join(opts.outputDir, 'motion-capture.json');
    if (fs.existsSync(motionPath)) {
      results.push(await runPipelineStep('Motion Distillation', async () => {
        distillMotion(opts.outputDir);
      }, true));
    }
  }

  // ── Step 4.6: Scroll-State Interaction Mapping ──

  if (shouldRun('scroll-interactions') || opts.step === 'all') {
    const motionPath = path.join(opts.outputDir, 'motion-capture.json');
    if (fs.existsSync(motionPath)) {
      results.push(await runPipelineStep('Scroll-Interaction Mapping', async () => {
        const { captureScrollInteractions } = await import('../scan/capture-scroll-interactions');
        await captureScrollInteractions(opts.url, opts.outputDir);
      }, true));

      // Re-distill to incorporate scroll-interaction data
      if (fs.existsSync(path.join(opts.outputDir, 'scroll-interactions.json'))) {
        distillMotion(opts.outputDir);
      }
    }
  }

  // ── Step 4.7: Smart Interaction Capture ──

  if (opts.step === 'all') {
    const interactionsPath = path.join(opts.outputDir, 'interactions.json');
    if (fs.existsSync(interactionsPath)) {
      results.push(await runPipelineStep('Smart Interaction Capture', async () => {
        const { captureInteractionsSmart } = await import('../scan/capture-interactions-smart');
        await captureInteractionsSmart(opts.url, opts.outputDir);
      }, true));
    }
  }

  // ── Step 4.8: Display Pattern Classification ──

  if (opts.step === 'all' || shouldRun('patterns')) {
    const scanPath = path.join(opts.outputDir, 'scan-result.json');
    if (fs.existsSync(scanPath)) {
      results.push(await runPipelineStep('Pattern Classification', async () => {
        await classifyPatterns(opts.outputDir);
      }, true));
    }
  }

  // ── Step 4.9: AI Feature Extraction ──

  if (opts.step === 'all' || shouldRun('features')) {
    log('Pipeline', 'info', 'AI synthesis skipped (set ANTHROPIC_API_KEY to enable)');
  }

  // ── Step 5: Asset Pipeline ──

  if (shouldRun('assets')) {
    results.push(await runPipelineStep('Asset Pipeline', async () => {
      const { copyAssets } = await import('../transform/copy-assets');
      copyAssets(opts.outputDir, path.join(opts.outputDir, '..', 'rebuild'));
    }, true));
  }

  // ── Step 6: Automated AI Synthesis ──

  if (shouldRun('synthesize') || opts.step === 'all') {
    log('Pipeline', 'info', 'AI synthesis skipped (set ANTHROPIC_API_KEY to enable)');
  }

  // ── Step 6.5: Project Generation (--full flag) ──

  if (opts.full) {
    const rebuildDir = path.join(opts.outputDir, '..', 'rebuild');
    results.push(await runPipelineStep('Project Generation', async () => {
      const { generateProject } = await import('../export/generate-project');
      await generateProject({ outputDir: opts.outputDir, rebuildDir });
    }, true));
  }

  // ── Step 7: Validation ──

  if (shouldRun('validate')) {
    const dsPath = path.join(opts.outputDir, 'design-system.json');
    if (fs.existsSync(dsPath)) {
      results.push(await runPipelineStep('Site Validation', () =>
        validateSite(opts.url, opts.outputDir),
      ));
    } else {
      log('Pipeline', 'info', 'design-system.json not found, skipping site validation');
    }
  }

  // ── Step 8: Rebuild validation (--full flag) ──

  if (opts.full) {
    results.push(await runPipelineStep('Rebuild Validation', () =>
      validateRebuild(opts.url, opts.outputDir, opts.rebuildUrl),
    ));
  }

  printSummary(opts.outputDir, results);
}

// ── Summary ───────────────────────────────────────────────────────────────────

function printSummary(outputDir: string, results: StepResult[]) {
  log('Pipeline', 'info', `\n${'='.repeat(60)}`);
  log('Pipeline', 'info', '  PIPELINE SUMMARY');
  log('Pipeline', 'info', `${'='.repeat(60)}`);

  // Step results
  for (const r of results) {
    const icon = r.status === 'success' ? '✓' : r.status === 'failed' ? '✗' : '○';
    const time = (r.durationMs / 1000).toFixed(1);
    const err = r.error ? ` — ${r.error}` : '';
    log('Pipeline', 'info', `  ${icon} ${r.step} (${time}s)${err}`);
  }

  // Output files
  log('Pipeline', 'info', '');
  const outputFiles = [
    'scan-result.json', 'analysis-result.json', 'motion-capture.json',
    'interactions.json', 'scroll-interactions.json', 'display-patterns.json',
    'performance-report.json', 'site-features.json', 'site-features.md',
    'dynamic-content.json', 'design-system.json', 'design-system.md',
    'validation-report.json', 'rebuild-validation-report.json',
    'corrections-needed.json', 'site-map.json',
  ];
  for (const file of outputFiles) {
    const filePath = path.join(outputDir, file);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      log('Pipeline', 'info', `  ✓ ${file} (${sizeMB} MB)`);
    }
  }

  const ssDir = path.join(outputDir, 'screenshots');
  if (fs.existsSync(ssDir)) {
    const screenshots = fs.readdirSync(ssDir);
    log('Pipeline', 'info', `  ✓ screenshots/ (${screenshots.length} files)`);
  }

  // Validation scores
  for (const reportFile of ['validation-report.json', 'rebuild-validation-report.json']) {
    const valPath = path.join(outputDir, reportFile);
    if (fs.existsSync(valPath)) {
      try {
        const val = JSON.parse(fs.readFileSync(valPath, 'utf-8'));
        const label = reportFile.includes('rebuild') ? 'REBUILD ACCURACY' : 'SITE CONSISTENCY';
        log('Pipeline', 'info', `\n  ${label}: ${val.overallScore}%`);
      } catch (e) {
        log('Pipeline', 'warn', `Failed to parse ${reportFile}: ${(e as Error).message}`);
      }
    }
  }

  const totalTime = results.reduce((sum, r) => sum + r.durationMs, 0);
  log('Pipeline', 'info', `\nTotal time: ${(totalTime / 1000).toFixed(1)}s`);
  log('Pipeline', 'info', `Completed at: ${new Date().toISOString()}`);
}

// ── Entry ─────────────────────────────────────────────────────────────────────

main().catch((err) => {
  log('Pipeline', 'error', `Fatal error: ${err}`);
  process.exit(1);
});

/**
 * Interactive CLI for Liftit
 *
 * Guided prompts for all workflows: extract, component, match, export, adopt.
 * Launched when user runs `liftit` with no arguments or `liftit -i`.
 */

// Suppress pipeline logs during interactive mode — spinners provide progress
process.env.LOG_LEVEL = 'error';

import * as p from '@clack/prompts';
import * as fs from 'fs';
import * as path from 'path';

// Pipeline imports
import { scan } from '../scan';
import { analyze } from '../scan/analyze';
import { captureMotion } from '../scan/capture-motion';
import { extractInteractions } from '../scan/extract-interactions';
import { distillMotion } from '../transform/distill-motion';
import { classifyPatterns } from '../transform/classify-patterns';
import { copyAssets } from '../transform/copy-assets';
import { validateSite, validateRebuild as validateRebuildFn } from '../scan/validate';
import {
  readDesignData,
  generateTailwindConfig,
  generateCSSVariables,
  generateShadcnTheme,
  generateW3CDesignTokens,
  generateStyleDictionary,
} from '../export/export';
import { capturePerformance } from '../scan/capture-performance';

// ── Helpers ──────────────────────────────────────────────────────────────────

function cancelled(): never {
  p.cancel('Cancelled.');
  process.exit(0);
}

function check<T>(value: T | symbol): T {
  if (p.isCancel(value)) cancelled();
  return value as T;
}

function validateUrl(value: string | undefined): string | undefined {
  if (!value || !value.trim()) return 'URL is required';
  if (!/^https?:\/\//i.test(value.trim())) return 'Must start with http:// or https://';
}

function validateRequired(value: string | undefined): string | undefined {
  if (!value || !value.trim()) return 'This field is required';
}

/** Resolve a user-entered path: expand ~, resolve relative to cwd */
function resolvePath(input: string): string {
  let p = input.trim();
  if (p.startsWith('~/')) {
    p = path.join(process.env.HOME || '/tmp', p.slice(2));
  }
  return path.resolve(p);
}

async function withSpinner<T>(label: string, fn: () => Promise<T>): Promise<{ ok: true; result: T; ms: number } | { ok: false; error: string; ms: number }> {
  const s = p.spinner();
  s.start(label);
  const start = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - start;
    s.stop(`${label} (${(ms / 1000).toFixed(1)}s)`);
    return { ok: true, result, ms };
  } catch (err) {
    const ms = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    s.stop(`${label} -- FAILED (${(ms / 1000).toFixed(1)}s)`);
    return { ok: false, error: msg, ms };
  }
}

function listOutputFiles(dir: string): string[] {
  const files = [
    'scan-result.json', 'analysis-result.json', 'motion-distilled.json',
    'interactions.json', 'display-patterns.json', 'performance-report.json',
    'site-features.json', 'site-features.md',
    'design-system.json', 'design-system.md',
    'validation-report.json', 'rebuild-validation-report.json',
  ];
  const found: string[] = [];
  for (const f of files) {
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) {
      const size = (fs.statSync(fp).size / 1024).toFixed(0);
      found.push(`  ${f} (${size} KB)`);
    }
  }
  const ssDir = path.join(dir, 'screenshots');
  if (fs.existsSync(ssDir)) {
    found.push(`  screenshots/ (${fs.readdirSync(ssDir).length} files)`);
  }
  return found;
}

// ── Workflow: Extract Design System ──────────────────────────────────────────

async function runExtractFlow() {
  const url = check(await p.text({
    message: 'Target URL',
    placeholder: 'https://stripe.com',
    validate: validateUrl,
  })) as string;

  const crawl = check(await p.confirm({
    message: 'Enable multi-page crawling?',
    initialValue: false,
  }));

  const needsAuth = check(await p.confirm({
    message: 'Does the site require authentication?',
    initialValue: false,
  }));

  let authCookie: string | undefined;
  let authHeader: string | undefined;
  if (needsAuth) {
    const authType = check(await p.select({
      message: 'Authentication method',
      options: [
        { value: 'cookie', label: 'Cookie', hint: 'name=value' },
        { value: 'header', label: 'Header', hint: 'Key: Value' },
      ],
    }));
    const authValue = check(await p.text({
      message: authType === 'cookie' ? 'Cookie (name=value)' : 'Header (Key: Value)',
      validate: validateRequired,
    })) as string;
    if (authType === 'cookie') authCookie = authValue;
    else authHeader = authValue;
  }

  const outputDir = check(await p.text({
    message: 'Output directory',
    placeholder: './output',
    defaultValue: './output',
    validate: (value: string | undefined) => {
      if (!value || !value.trim()) return 'Output directory is required';
      const resolved = resolvePath(value);
      // Check the parent directory exists or can be created
      try {
        fs.mkdirSync(resolved, { recursive: true });
      } catch {
        return `Cannot create directory: ${resolved}`;
      }
    },
  })) as string;

  const fullRebuild = check(await p.confirm({
    message: 'Generate a full Next.js rebuild project?',
    initialValue: false,
  }));

  const resolvedDir = resolvePath(outputDir);
  const rebuildDir = path.join(resolvedDir, '..', 'rebuild');

  p.log.info(`Extracting design system from ${url}`);

  // Step 1: Scanner
  const scanOpts: Record<string, unknown> = {};
  if (crawl) scanOpts.crawl = true;
  if (authCookie) scanOpts.authCookie = authCookie;
  if (authHeader) scanOpts.authHeader = authHeader;

  const scanResult = await withSpinner('Scanning site', () => scan(url, resolvedDir, scanOpts));
  if (!scanResult.ok) {
    p.log.error(`Scanner failed: ${scanResult.error}`);
    p.outro('Pipeline failed.');
    return;
  }

  // Steps 2-4: Parallel (+ performance)
  const parallelResult = await withSpinner('Analyzing styles, motion, interactions, and performance', async () => {
    const results = await Promise.allSettled([
      analyze(url, resolvedDir),
      captureMotion(url, resolvedDir),
      extractInteractions(url, resolvedDir),
      capturePerformance(url, resolvedDir),
    ]);
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      const msgs = failures.map(f => (f as PromiseRejectedResult).reason?.message || 'Unknown');
      p.log.warn(`Some optional steps failed: ${msgs.join(', ')}`);
    }
  });
  if (!parallelResult.ok) {
    p.log.warn(`Analysis had issues: ${parallelResult.error}`);
  }

  // Step 5: Distillation
  const motionPath = path.join(resolvedDir, 'motion-capture.json');
  if (fs.existsSync(motionPath)) {
    await withSpinner('Distilling animations', async () => distillMotion(resolvedDir));

    // Scroll interactions
    const { captureScrollInteractions } = await import('../scan/capture-scroll-interactions');
    await withSpinner('Mapping scroll interactions', () => captureScrollInteractions(url, resolvedDir));

    // Re-distill with scroll data
    if (fs.existsSync(path.join(resolvedDir, 'scroll-interactions.json'))) {
      distillMotion(resolvedDir);
    }
  }

  // Step 6: Smart interactions
  const interactionsPath = path.join(resolvedDir, 'interactions.json');
  if (fs.existsSync(interactionsPath)) {
    const { captureInteractionsSmart } = await import('../scan/capture-interactions-smart');
    await withSpinner('Capturing interaction chains', () => captureInteractionsSmart(url, resolvedDir));
  }

  // Step 7: Pattern classification
  if (fs.existsSync(path.join(resolvedDir, 'scan-result.json'))) {
    await withSpinner('Classifying display patterns', () => classifyPatterns(resolvedDir));
  }

  // Step 8: Feature extraction skipped (requires ANTHROPIC_API_KEY)

  // Step 9: Assets
  await withSpinner('Copying assets', async () => {
    copyAssets(resolvedDir, rebuildDir);
  });

  // Step 10: AI Synthesis skipped (requires ANTHROPIC_API_KEY)
  p.log.info('AI synthesis skipped — set ANTHROPIC_API_KEY to enable design-system.json generation');

  // Step 11: Project generation (--full)
  if (fullRebuild && fs.existsSync(path.join(resolvedDir, 'design-system.json'))) {
    await withSpinner('Generating Next.js project', async () => {
      const { generateProject } = await import('../export/generate-project');
      await generateProject({ outputDir: resolvedDir, rebuildDir });
    });
  }

  // Step 12: Validation
  if (fs.existsSync(path.join(resolvedDir, 'design-system.json'))) {
    await withSpinner('Validating site consistency', () => validateSite(url, resolvedDir));
  }

  // Step 13: Rebuild validation (--full)
  if (fullRebuild) {
    p.log.info('To validate the rebuild, run: cd rebuild && npm install && npm run dev');
    p.log.info('Then re-run with "Validate" → "Rebuild Comparison"');
  }

  // Results
  const files = listOutputFiles(resolvedDir);
  let scoreText = '';
  const valPath = path.join(resolvedDir, 'validation-report.json');
  if (fs.existsSync(valPath)) {
    try {
      const val = JSON.parse(fs.readFileSync(valPath, 'utf-8'));
      scoreText = `\n\nSite consistency: ${val.overallScore}%`;
    } catch {}
  }

  p.note(
    files.join('\n') + scoreText,
    'Output files'
  );
}

// ── Workflow: Generate Component ─────────────────────────────────────────────

async function runComponentFlow() {
  const url = check(await p.text({
    message: 'Target URL',
    placeholder: 'https://linear.app',
    validate: validateUrl,
  })) as string;

  const component = check(await p.text({
    message: 'Component name or CSS selector',
    placeholder: 'header, nav, hero, footer, card, pricing...',
    validate: validateRequired,
  })) as string;

  const customName = check(await p.text({
    message: 'Custom component name (optional)',
    placeholder: 'e.g. StripeNav',
  })) as string;

  const framework = check(await p.select({
    message: 'Framework',
    options: [
      { value: 'react', label: 'React', hint: '.tsx + .module.css' },
      { value: 'vue', label: 'Vue', hint: '.vue (scoped styles)' },
      { value: 'svelte', label: 'Svelte', hint: '.svelte' },
    ],
    initialValue: 'react',
  })) as string;

  const outputDir = path.resolve(process.cwd(), 'output', 'components');
  fs.mkdirSync(outputDir, { recursive: true });

  p.log.info(`Extracting ${component} from ${url}`);

  // extractComponent returns extraction data; we then need to run code generation
  // For simplicity, use the generate-component CLI by calling the MCP handler
  const extractResult = await withSpinner('Extracting + generating component', async () => {
    const { handleGenerateComponent } = await import('../mcp/handlers/generate-component');
    return handleGenerateComponent({
      url: url.trim(),
      component: component.trim(),
      name: customName || undefined,
      framework: framework as 'react' | 'vue' | 'svelte',
    });
  });

  if (!extractResult.ok) {
    p.log.error(`Component generation failed: ${extractResult.error}`);
    return;
  }

  const response = extractResult.result as { content?: { text?: string }[] };
  const text = response?.content?.[0]?.text || 'Component generated';
  const lines = text.split('\n');
  const display = lines.length > 30 ? lines.slice(0, 30).join('\n') + '\n  ...(truncated)' : text;
  p.note(display, 'Generated component');
}

// ── Workflow: Match Component ────────────────────────────────────────────────

async function runMatchFlow() {
  const url = check(await p.text({
    message: 'Target URL',
    placeholder: 'https://stripe.com',
    validate: validateUrl,
  })) as string;

  const component = check(await p.text({
    message: 'Component name or CSS selector',
    placeholder: 'header, nav, hero...',
    validate: validateRequired,
  })) as string;

  const cssFile = check(await p.text({
    message: 'Path to your CSS file',
    placeholder: './src/Header.module.css',
    validate: (value: string | undefined) => {
      if (!value || !value.trim()) return 'CSS file path is required';
      if (!fs.existsSync(value.trim())) return `File not found: ${value}`;
    },
  })) as string;

  p.log.info(`Matching your CSS against ${component} on ${url}`);

  const result = await withSpinner('Extracting target + diffing styles', async () => {
    // Use the MCP handler approach — import match logic
    const { parseCssModule } = await import('../export/adapters/component-differ');
    const cssContent = fs.readFileSync(cssFile.trim(), 'utf-8');
    const userClasses = parseCssModule(cssContent);

    // Run the extraction and matching via the CLI script's approach
    // For simplicity, call the MCP handler which wraps everything
    const { handleMatchComponent } = await import('../mcp/handlers/match-component');
    return handleMatchComponent({
      url: url.trim(),
      component: component.trim(),
      css_content: cssContent,
    });
  });

  if (!result.ok) {
    p.log.error(`Match failed: ${result.error}`);
    return;
  }

  const response = result.result as { content?: { text?: string }[] };
  const text = response?.content?.[0]?.text || JSON.stringify(response, null, 2);

  // Truncate for display
  const lines = text.split('\n');
  const display = lines.length > 40 ? lines.slice(0, 40).join('\n') + '\n  ...(truncated)' : text;
  p.note(display, 'Style diff report');
}

// ── Workflow: Export Tokens ───────────────────────────────────────────────────

async function runExportFlow() {
  const format = check(await p.select({
    message: 'Export format',
    options: [
      { value: 'tailwind', label: 'Tailwind CSS', hint: 'tailwind.config.ts' },
      { value: 'shadcn', label: 'shadcn/ui', hint: 'globals.css + tailwind.config.ts' },
      { value: 'css-variables', label: 'CSS Variables', hint: 'design-tokens.css' },
      { value: 'w3c', label: 'W3C Design Tokens', hint: 'design-tokens.json' },
      { value: 'style-dictionary', label: 'Style Dictionary', hint: 'tokens.json' },
      { value: 'all', label: 'All formats' },
    ],
  })) as string;

  const inputDir = check(await p.text({
    message: 'Input directory (with extraction data)',
    placeholder: './output',
    defaultValue: './output',
    validate: (value: string | undefined) => {
      if (!value || !value.trim()) return 'Input directory is required';
      const resolved = resolvePath(value);
      if (!fs.existsSync(resolved)) return `Directory not found: ${resolved}`;
    },
  })) as string;

  const outputDir = check(await p.text({
    message: 'Output directory',
    placeholder: './output/export',
    defaultValue: './output/export',
    validate: (value: string | undefined) => {
      if (!value || !value.trim()) return 'Output directory is required';
      const resolved = resolvePath(value);
      try { fs.mkdirSync(resolved, { recursive: true }); } catch {
        return `Cannot create directory: ${resolved}`;
      }
    },
  })) as string;

  let prefix: string | undefined;
  if (format === 'css-variables' || format === 'all') {
    prefix = (check(await p.text({
      message: 'CSS variable prefix (optional)',
      placeholder: 'ds',
    })) as string) || undefined;
  }

  const resolvedInput = resolvePath(inputDir);
  const resolvedOutput = resolvePath(outputDir);

  // Check input data exists
  const dsPath = path.join(resolvedInput, 'design-system.json');
  const scanPath = path.join(resolvedInput, 'scan-result.json');
  if (!fs.existsSync(dsPath) && !fs.existsSync(scanPath)) {
    p.log.error('No extraction data found. Run "Extract Design System" first.');
    return;
  }

  const result = await withSpinner(`Generating ${format} config`, async () => {
    const data = readDesignData(resolvedInput);
    const generated: string[] = [];

    const run = async (fmt: string) => {
      const fmtDir = path.join(resolvedOutput, fmt);
      fs.mkdirSync(fmtDir, { recursive: true });

      switch (fmt) {
        case 'tailwind': {
          const p = generateTailwindConfig(data, { outputDir: fmtDir });
          generated.push(p);
          break;
        }
        case 'css-variables': {
          const p = generateCSSVariables(data, { outputDir: fmtDir, prefix });
          generated.push(p);
          break;
        }
        case 'shadcn': {
          const out = generateShadcnTheme(data, { outputDir: fmtDir });
          generated.push(out.globalsPath, out.tailwindPath);
          break;
        }
        case 'w3c': {
          const p = generateW3CDesignTokens(data, { outputDir: fmtDir });
          generated.push(p);
          break;
        }
        case 'style-dictionary': {
          const p = generateStyleDictionary(data, { outputDir: fmtDir });
          generated.push(p);
          break;
        }
      }
    };

    if (format === 'all') {
      for (const fmt of ['tailwind', 'css-variables', 'shadcn', 'w3c', 'style-dictionary']) {
        await run(fmt);
      }
    } else {
      await run(format);
    }

    return generated;
  });

  if (!result.ok) {
    p.log.error(`Export failed: ${result.error}`);
    return;
  }

  p.note(result.result.join('\n'), 'Generated files');
}

// ── Workflow: Adopt Design ───────────────────────────────────────────────────

async function runAdoptFlow() {
  p.log.info('This feature requires ANTHROPIC_API_KEY');
}

// ── Workflow: Single Step ────────────────────────────────────────────────────

async function runSingleStepFlow() {
  const step = check(await p.select({
    message: 'Which step?',
    options: [
      { value: 'scan', label: 'Scan', hint: 'Extract DOM, styles, screenshots' },
      { value: 'analyze', label: 'Analyze', hint: 'CSS architecture, components' },
      { value: 'motion', label: 'Motion Capture', hint: 'Animations at 3 viewports' },
      { value: 'interactions', label: 'Interactions', hint: 'Forms, modals, toggles' },
      { value: 'distill', label: 'Distill Motion', hint: 'Compress animation data' },
      { value: 'patterns', label: 'Classify Patterns', hint: 'Section types, layouts' },
      { value: 'features', label: 'Extract Features', hint: 'AI feature spec (needs API key)' },
      { value: 'synthesize', label: 'Synthesize', hint: 'AI design system (needs API key)' },
      { value: 'performance', label: 'Performance', hint: 'Lighthouse audit' },
      { value: 'validate', label: 'Validate', hint: 'Site consistency check' },
    ],
  })) as string;

  const needsUrl = ['scan', 'analyze', 'motion', 'interactions', 'performance', 'validate'].includes(step);

  let url = '';
  if (needsUrl) {
    url = check(await p.text({
      message: 'Target URL',
      placeholder: 'https://stripe.com',
      validate: validateUrl,
    })) as string;
  }

  const outputDir = check(await p.text({
    message: 'Output directory',
    placeholder: './output',
    defaultValue: './output',
    validate: (value: string | undefined) => {
      if (!value || !value.trim()) return 'Output directory is required';
      const resolved = resolvePath(value);
      try { fs.mkdirSync(resolved, { recursive: true }); } catch {
        return `Cannot create directory: ${resolved}`;
      }
    },
  })) as string;

  const resolvedDir = resolvePath(outputDir);

  switch (step) {
    case 'scan':
      await withSpinner('Scanning site', () => scan(url.trim(), resolvedDir));
      break;
    case 'analyze':
      await withSpinner('Analyzing', () => analyze(url.trim(), resolvedDir));
      break;
    case 'motion':
      await withSpinner('Capturing motion', () => captureMotion(url.trim(), resolvedDir));
      break;
    case 'interactions':
      await withSpinner('Extracting interactions', () => extractInteractions(url.trim(), resolvedDir));
      break;
    case 'distill':
      await withSpinner('Distilling motion', async () => distillMotion(resolvedDir));
      break;
    case 'patterns':
      await withSpinner('Classifying patterns', () => classifyPatterns(resolvedDir));
      break;
    case 'features':
      p.log.info('This feature requires ANTHROPIC_API_KEY');
      break;
    case 'synthesize':
      p.log.info('This feature requires ANTHROPIC_API_KEY');
      break;
    case 'performance':
      await withSpinner('Running Lighthouse audit', () => capturePerformance(url.trim(), resolvedDir));
      break;
    case 'validate':
      await withSpinner('Validating site consistency', () => validateSite(url.trim(), resolvedDir));
      break;
  }

  const files = listOutputFiles(resolvedDir);
  if (files.length > 0) p.note(files.join('\n'), 'Output files');
}

// ── Workflow: Display Patterns ──────────────────────────────────────────────

async function runPatternsFlow() {
  const outputDir = check(await p.text({
    message: 'Output directory (with scan-result.json)',
    placeholder: './output',
    defaultValue: './output',
    validate: (value: string | undefined) => {
      if (!value || !value.trim()) return 'Directory is required';
      const resolved = resolvePath(value);
      if (!fs.existsSync(path.join(resolved, 'scan-result.json')))
        return `No scan-result.json found in ${resolved}. Run extraction first.`;
    },
  })) as string;

  const resolvedDir = resolvePath(outputDir);
  const result = await withSpinner('Classifying display patterns', () => classifyPatterns(resolvedDir));

  if (!result.ok) {
    p.log.error(`Classification failed: ${result.error}`);
    return;
  }

  const patterns = result.result;
  const lines: string[] = [];
  if (patterns.sections.length > 0) {
    lines.push(`Sections (${patterns.sections.length}):`);
    for (const s of patterns.sections) lines.push(`  ${s.type} (${(s.confidence * 100).toFixed(0)}%)`);
  }
  if (patterns.layouts.length > 0) {
    lines.push(`\nLayouts (${patterns.layouts.length}):`);
    for (const l of patterns.layouts) lines.push(`  ${l.pattern} (${l.details.columns || ''}col)`);
  }
  if (patterns.contentPatterns.length > 0) {
    lines.push(`\nContent Patterns (${patterns.contentPatterns.length}):`);
    for (const c of patterns.contentPatterns) lines.push(`  ${c.type} (${c.behavior.itemCount} items)`);
  }
  if (patterns.animations.length > 0) {
    lines.push(`\nAnimations (${patterns.animations.length}):`);
    const intents = new Map<string, number>();
    for (const a of patterns.animations) intents.set(a.intent, (intents.get(a.intent) || 0) + 1);
    for (const [intent, count] of intents) lines.push(`  ${intent}: ${count}`);
  }

  p.note(lines.join('\n') || 'No patterns detected', 'Display Patterns');
}

// ── Workflow: Performance Report ────────────────────────────────────────────

async function runPerformanceFlow() {
  const url = check(await p.text({
    message: 'Target URL',
    placeholder: 'https://stripe.com',
    validate: validateUrl,
  })) as string;

  const outputDir = check(await p.text({
    message: 'Output directory',
    placeholder: './output',
    defaultValue: './output',
    validate: (value: string | undefined) => {
      if (!value || !value.trim()) return 'Directory is required';
      const resolved = resolvePath(value);
      try { fs.mkdirSync(resolved, { recursive: true }); } catch {
        return `Cannot create directory: ${resolved}`;
      }
    },
  })) as string;

  const resolvedDir = resolvePath(outputDir);
  const result = await withSpinner('Running Lighthouse audit', () => capturePerformance(url.trim(), resolvedDir));

  if (!result.ok) {
    p.log.error(`Performance capture failed: ${result.error}`);
    return;
  }

  const report = result.result;
  const lines = [
    `Performance: ${report.score}/100`,
    ``,
    `Core Web Vitals:`,
    `  LCP: ${report.lighthouse.metrics.lcp}ms`,
    `  CLS: ${report.lighthouse.metrics.cls}`,
    `  INP: ${report.lighthouse.metrics.inp}ms`,
    `  FCP: ${report.lighthouse.metrics.fcp}ms`,
    `  TTFB: ${report.lighthouse.metrics.ttfb}ms`,
    ``,
    `Resources: ${(report.resources.totalSize / 1024).toFixed(0)}KB total, ${(report.resources.unusedBytes / 1024).toFixed(0)}KB unused`,
    `Animations: ${report.animations.compositorOnly} compositor-only, ${report.animations.layoutTriggers} layout-triggering`,
  ];

  if (report.optimizationOpportunities.length > 0) {
    lines.push(``, `Top opportunities:`);
    for (const opp of report.optimizationOpportunities.slice(0, 5)) {
      lines.push(`  [${opp.impact}] ${opp.description}`);
    }
  }

  p.note(lines.join('\n'), 'Performance Report');
}

// ── Workflow: Site Features ─────────────────────────────────────────────────

async function runFeaturesFlow() {
  p.log.info('This feature requires ANTHROPIC_API_KEY');
}

// ── Workflow: Validate ──────────────────────────────────────────────────────

async function runValidateFlow() {
  const mode = check(await p.select({
    message: 'Validation mode',
    options: [
      { value: 'site', label: 'Site Consistency', hint: 'Compare live site against stored scan data' },
      { value: 'rebuild', label: 'Rebuild Comparison', hint: 'Compare rebuild against original (needs dev server)' },
    ],
  })) as string;

  const url = check(await p.text({
    message: 'Target URL',
    placeholder: 'https://stripe.com',
    validate: validateUrl,
  })) as string;

  const outputDir = check(await p.text({
    message: 'Output directory (with scan data)',
    placeholder: './output',
    defaultValue: './output',
    validate: (value: string | undefined) => {
      if (!value || !value.trim()) return 'Directory is required';
      const resolved = resolvePath(value);
      if (!fs.existsSync(path.join(resolved, 'scan-result.json')))
        return `No scan-result.json found in ${resolved}. Run extraction first.`;
    },
  })) as string;

  const resolvedDir = resolvePath(outputDir);

  let rebuildUrl = 'http://localhost:3000';
  if (mode === 'rebuild') {
    rebuildUrl = check(await p.text({
      message: 'Rebuild dev server URL',
      placeholder: 'http://localhost:3000',
      defaultValue: 'http://localhost:3000',
    })) as string;
  }

  const result = mode === 'site'
    ? await withSpinner('Validating site consistency', () => validateSite(url.trim(), resolvedDir))
    : await withSpinner('Validating rebuild', () => validateRebuildFn(url.trim(), resolvedDir, rebuildUrl.trim()));

  if (!result.ok) {
    p.log.error(`Validation failed: ${result.error}`);
    return;
  }

  const reportFile = mode === 'site' ? 'validation-report.json' : 'rebuild-validation-report.json';
  const reportPath = path.join(resolvedDir, reportFile);
  if (fs.existsSync(reportPath)) {
    try {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      const lines = [`Overall score: ${report.overallScore}%`, ''];
      if (report.screenshotComparisons) {
        lines.push('Screenshot matches:');
        for (const sc of report.screenshotComparisons) {
          lines.push(`  ${sc.breakpoint}px: ${sc.matchPercentage?.toFixed(1) || 'N/A'}%`);
        }
      }
      if (report.recommendations?.length > 0) {
        lines.push('', 'Recommendations:');
        for (const r of report.recommendations.slice(0, 5)) lines.push(`  - ${r}`);
      }
      p.note(lines.join('\n'), 'Validation Report');
    } catch {
      p.log.success(`${reportFile} written`);
    }
  }
}

// ── Workflow: MCP Server ────────────────────────────────────────────────────

async function runMCPFlow() {
  const mode = check(await p.select({
    message: 'Server mode',
    options: [
      { value: 'stdio', label: 'Stdio', hint: 'For Claude Code / IDE integration' },
      { value: 'http', label: 'HTTP', hint: 'REST API on port 3100' },
    ],
  })) as string;

  p.log.info(mode === 'stdio'
    ? 'Starting MCP stdio server... (Ctrl+C to stop)'
    : 'Starting MCP HTTP server on http://localhost:3100 ... (Ctrl+C to stop)'
  );
  p.outro('');

  // These block — no spinner needed
  if (mode === 'stdio') {
    await import('./mcp-server');
  } else {
    p.log.error('HTTP server mode is not available in this build.');
    process.exit(1);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  p.intro('liftit -- Lift any site\'s design. Paste a URL, get the code.');

  const workflow = check(await p.select({
    message: 'What would you like to do?',
    options: [
      // Extract
      { value: 'extract', label: 'Full Pipeline', hint: 'Extract everything from URL' },
      { value: 'step', label: 'Single Step', hint: 'Re-run one pipeline step' },
      // Analyze
      { value: 'patterns', label: 'Display Patterns', hint: 'Section types, layouts, content patterns' },
      { value: 'performance', label: 'Performance Report', hint: 'Lighthouse, Core Web Vitals' },
      { value: 'features', label: 'Site Features', hint: 'AI feature/spec extraction' },
      { value: 'validate', label: 'Validate', hint: 'Site consistency or rebuild comparison' },
      // Generate
      { value: 'component', label: 'Generate Component', hint: 'Single component to code' },
      { value: 'export', label: 'Export Tokens', hint: 'Tailwind, shadcn, CSS vars...' },
      { value: 'adopt', label: 'Adopt Design', hint: 'Restyle your project' },
      { value: 'match', label: 'Make Mine Match', hint: 'Diff your CSS vs target' },
      // Tools
      { value: 'mcp', label: 'Start MCP Server', hint: 'For Claude Code / Antigravity' },
    ],
  }));

  switch (workflow) {
    case 'extract': await runExtractFlow(); break;
    case 'step': await runSingleStepFlow(); break;
    case 'patterns': await runPatternsFlow(); break;
    case 'performance': await runPerformanceFlow(); break;
    case 'features': await runFeaturesFlow(); break;
    case 'validate': await runValidateFlow(); break;
    case 'component': await runComponentFlow(); break;
    case 'export': await runExportFlow(); break;
    case 'adopt': await runAdoptFlow(); break;
    case 'match': await runMatchFlow(); break;
    case 'mcp': await runMCPFlow(); break;
  }

  if (workflow !== 'mcp') p.outro('Done!');
}

main().catch((err) => {
  p.log.error(err.message || String(err));
  process.exit(1);
});

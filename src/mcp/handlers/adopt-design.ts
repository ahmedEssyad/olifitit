import * as fs from 'fs';
import * as path from 'path';
import { scan } from '../../scan';
import { analyze } from '../../scan/analyze';
import { captureMotion } from '../../scan/capture-motion';
import { extractInteractions } from '../../scan/extract-interactions';
import { distillMotion } from '../../transform/distill-motion';
import { copyAssets } from '../../transform/copy-assets';
import { runPipelineStep, StepResult, log } from '../../core/utils';
import { generateProject } from '../../export/generate-project';
import { extractBrandFromProject } from '../../brand/extract-brand';
import { BrandConfig } from '../../brand/brand';
import { listOutputFiles, textResponse, validateArgs, validateToolUrl } from '../helpers';
import { z } from 'zod';

const AdoptDesignInput = z.object({
  target_url: z.string(),
  project_dir: z.string().optional(),
  brand: z.any().optional(),
  output_dir: z.string().optional(),
  rebuild_dir: z.string().optional(),
});

export async function handleAdoptDesign(rawArgs: unknown) {
  const args = validateArgs(AdoptDesignInput, rawArgs);
  validateToolUrl(args.target_url);

  const { target_url: url } = args;
  const outputDir = args.output_dir || path.resolve(process.cwd(), 'output');
  const rebuildDir = args.rebuild_dir || path.resolve(process.cwd(), 'rebuild');

  fs.mkdirSync(outputDir, { recursive: true });

  // ── Step 1: Detect user's brand ────────────────────────────────────────

  let brand: BrandConfig | null = null;

  if (args.brand) {
    // Explicit brand provided
    brand = args.brand as BrandConfig;
    log('adopt-design', 'info', 'Using explicitly provided brand');
  } else if (args.project_dir) {
    // Auto-detect from project
    brand = extractBrandFromProject(args.project_dir);
    if (brand) {
      log('adopt-design', 'info', `Brand auto-detected from ${args.project_dir}`);
    } else {
      return textResponse({
        status: 'error',
        error: `Could not detect brand from ${args.project_dir}. ` +
          `Create a .liftit-brand.json file or ensure your project has a tailwind.config or globals.css with CSS custom properties (--color-primary, etc.).`,
      });
    }
  } else {
    return textResponse({
      status: 'error',
      error: 'Either project_dir or brand must be provided. ' +
        'Use project_dir to auto-detect your brand from your existing project, or pass brand colors/fonts explicitly.',
    });
  }

  log('adopt-design', 'info', `Brand: primary=${brand.colors.primary}` +
    (brand.fonts?.body ? `, body font=${brand.fonts.body}` : ''));

  // ── Step 2: Extract target design ──────────────────────────────────────

  const steps: StepResult[] = [];

  const scanResult = await runPipelineStep('Scanner', () => scan(url, outputDir));
  steps.push(scanResult);

  if (scanResult.status === 'failed') {
    return textResponse({
      status: 'failed',
      error: 'Scanner failed — cannot continue',
      steps,
    });
  }

  // Parallel: analyze + motion + interactions
  const parallelResults = await Promise.allSettled([
    runPipelineStep('Analyzer', () => analyze(url, outputDir)),
    runPipelineStep('Motion Capture', () => captureMotion(url, outputDir), true),
    runPipelineStep('Interaction Extraction', () => extractInteractions(url, outputDir), true),
  ]);

  for (const settled of parallelResults) {
    if (settled.status === 'fulfilled') {
      steps.push(settled.value);
    } else {
      steps.push({ step: 'parallel-step', status: 'failed', durationMs: 0, error: settled.reason?.message || 'Unknown' });
    }
  }

  // Distill motion
  if (fs.existsSync(path.join(outputDir, 'motion-capture.json'))) {
    steps.push(await runPipelineStep('Motion Distillation', async () => { distillMotion(outputDir); }, true));
  }

  // Scroll interactions
  if (fs.existsSync(path.join(outputDir, 'motion-capture.json'))) {
    steps.push(await runPipelineStep('Scroll-Interaction Mapping', async () => {
      const { captureScrollInteractions } = await import('../../scan/capture-scroll-interactions');
      await captureScrollInteractions(url, outputDir);
    }, true));
    if (fs.existsSync(path.join(outputDir, 'scroll-interactions.json'))) {
      distillMotion(outputDir);
    }
  }

  // Copy assets
  if (fs.existsSync(path.join(outputDir, 'scan-result.json'))) {
    steps.push(await runPipelineStep('Asset Pipeline', async () => { copyAssets(outputDir, rebuildDir); }, true));
  }

  // ── Step 3: AI Synthesis ───────────────────────────────────────────────

  if (!fs.existsSync(path.join(outputDir, 'design-system.json'))) {
    log('adopt-design', 'info', 'AI synthesis skipped (set ANTHROPIC_API_KEY to enable)');
  }

  // ── Step 4: Generate project with YOUR brand ───────────────────────────

  steps.push(await runPipelineStep('Project Generation (with your brand)', async () => {
    await generateProject({ outputDir, rebuildDir, brand: brand! });
  }));

  // ── Result ─────────────────────────────────────────────────────────────

  const projectGenerated = fs.existsSync(path.join(rebuildDir, 'package.json'));

  return textResponse({
    status: projectGenerated ? 'success' : 'partial',
    message: projectGenerated
      ? `Design adopted from ${url} with your brand preserved. Project generated at ${rebuildDir}.`
      : `Extraction complete but project generation may have failed. Check ${rebuildDir}.`,
    brandApplied: {
      colors: brand.colors,
      fonts: brand.fonts || null,
    },
    rebuildDir,
    steps: steps.map(s => ({ step: s.step, status: s.status, durationMs: s.durationMs, error: s.error })),
    outputFiles: listOutputFiles(outputDir),
    nextSteps: projectGenerated ? [
      `cd ${rebuildDir}`,
      'npm install',
      'npm run dev',
      'Components use YOUR brand colors/fonts with the target\'s layout and animations.',
    ] : [],
  });
}

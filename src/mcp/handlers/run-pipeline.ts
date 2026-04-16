import * as fs from 'fs';
import * as path from 'path';
import { scan } from '../../scan';
import { analyze } from '../../scan/analyze';
import { captureMotion } from '../../scan/capture-motion';
import { extractInteractions } from '../../scan/extract-interactions';
import { distillMotion } from '../../transform/distill-motion';
import { copyAssets } from '../../transform/copy-assets';
import { validateRebuild, validateSite } from '../../scan/validate';
import { classifyPatterns } from '../../transform/classify-patterns';
import { capturePerformance } from '../../scan/capture-performance';
import { runPipelineStep, StepResult, log } from '../../core/utils';
import { listOutputFiles, textResponse, validateArgs, validateToolUrl, withNextSteps } from '../helpers';
import { RunPipelineInput } from '../schemas';

export async function handleRunPipeline(rawArgs: unknown) {
  const args = validateArgs(RunPipelineInput, rawArgs);
  validateToolUrl(args.url);

  const { url, crawl, auth_cookie: authCookie, auth_header: authHeader, full } = args;
  const outputDir = args.output_dir || path.join(process.cwd(), 'output');
  const rebuildDir = args.rebuild_dir || path.join(outputDir, '..', 'rebuild');
  const rebuildUrl = args.rebuild_url || 'http://localhost:3000';

  fs.mkdirSync(outputDir, { recursive: true });
  const steps: StepResult[] = [];

  // Step 1: Scan
  const scanOpts: Record<string, any> = {};
  if (crawl) scanOpts.crawl = true;
  if (authCookie) scanOpts.authCookie = authCookie;
  if (authHeader) scanOpts.authHeader = authHeader;

  const scanResult = await runPipelineStep('Scanner', () => scan(url, outputDir, scanOpts));
  steps.push(scanResult);

  if (scanResult.status === 'failed') {
    return textResponse({ status: 'failed', error: 'Scanner failed — cannot continue pipeline', steps });
  }

  // Steps 2-4: Parallel (+ performance capture)
  const parallelResults = await Promise.allSettled([
    runPipelineStep('Analyzer', () => analyze(url, outputDir)),
    runPipelineStep('Motion Capture', () => captureMotion(url, outputDir), true),
    runPipelineStep('Interaction Extraction', () => extractInteractions(url, outputDir), true),
    runPipelineStep('Performance Capture', () => capturePerformance(url, outputDir), true),
  ]);

  for (const settled of parallelResults) {
    if (settled.status === 'fulfilled') {
      steps.push(settled.value);
    } else {
      steps.push({ step: 'parallel-step', status: 'failed', durationMs: 0, error: settled.reason?.message || 'Unknown error' });
    }
  }

  // Step 4.5: Motion Distillation
  if (fs.existsSync(path.join(outputDir, 'motion-capture.json'))) {
    steps.push(await runPipelineStep('Motion Distillation', async () => { distillMotion(outputDir); }, true));
  }

  // Step 4.6: Scroll-State Interaction Mapping
  if (fs.existsSync(path.join(outputDir, 'motion-capture.json'))) {
    steps.push(await runPipelineStep('Scroll-Interaction Mapping', async () => {
      const { captureScrollInteractions } = await import('../../scan/capture-scroll-interactions');
      await captureScrollInteractions(url, outputDir);
    }, true));

    // Re-distill to incorporate scroll-interaction data
    if (fs.existsSync(path.join(outputDir, 'scroll-interactions.json'))) {
      distillMotion(outputDir);
    }
  }

  // Step 4.8: Display Pattern Classification
  const scanResultPath = path.join(outputDir, 'scan-result.json');
  if (fs.existsSync(scanResultPath)) {
    steps.push(await runPipelineStep('Pattern Classification', () => classifyPatterns(outputDir), true));
  }

  // Step 4.9: Feature Extraction (requires ANTHROPIC_API_KEY)
  log('Pipeline', 'info', 'Feature extraction skipped (set ANTHROPIC_API_KEY to enable)');

  // Step 5: Asset Pipeline
  if (fs.existsSync(scanResultPath)) {
    steps.push(await runPipelineStep('Asset Pipeline', async () => { copyAssets(outputDir, rebuildDir); }, true));
  }

  // Step 6: Synthesis — SKIPPED (claude CLI can't run inside MCP)

  // Step 7: Site Validation
  if (fs.existsSync(scanResultPath)) {
    steps.push(await runPipelineStep('Site Validation', () => validateSite(url, outputDir)));
  }

  // Step 8: Rebuild Validation (optional)
  let rebuildScore: number | undefined;
  if (full) {
    steps.push(await runPipelineStep('Rebuild Validation', () => validateRebuild(url, outputDir, rebuildUrl)));
    const reportPath = path.join(outputDir, 'rebuild-validation-report.json');
    if (fs.existsSync(reportPath)) {
      try { rebuildScore = JSON.parse(fs.readFileSync(reportPath, 'utf-8')).overallScore; } catch (e) { log('Pipeline', 'warn', `Failed to parse rebuild validation report: ${(e as Error).message}`); }
    }
  }

  // Read site validation score
  let siteScore: number | undefined;
  const siteReportPath = path.join(outputDir, 'validation-report.json');
  if (fs.existsSync(siteReportPath)) {
    try { siteScore = JSON.parse(fs.readFileSync(siteReportPath, 'utf-8')).overallScore; } catch { /* */ }
  }

  return withNextSteps({
    status: steps.every(s => s.status !== 'failed') ? 'success' : 'partial',
    outputDir,
    steps: steps.map(s => ({ step: s.step, status: s.status, durationMs: s.durationMs, error: s.error || undefined })),
    outputFiles: listOutputFiles(outputDir),
    scores: {
      siteConsistency: siteScore !== undefined ? `${siteScore}%` : undefined,
      rebuildAccuracy: rebuildScore !== undefined ? `${rebuildScore}%` : undefined,
    },
    _note: 'AI synthesis was skipped — use the output data files to synthesize design-system.json and design-system.md.',
    totalDurationMs: steps.reduce((sum, s) => sum + s.durationMs, 0),
  }, ["Run export_tokens to generate Tailwind/shadcn/CSS variable configs", "Run get_display_patterns to classify section types and layout strategies", "Run validate (mode=site) to check extraction consistency", "Run describe_extraction to see full state"]);
}

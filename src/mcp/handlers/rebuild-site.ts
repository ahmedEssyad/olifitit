import * as fs from 'fs';
import * as path from 'path';
import { scan } from '../../scan';
import { analyze } from '../../scan/analyze';
import { captureMotion } from '../../scan/capture-motion';
import { extractInteractions } from '../../scan/extract-interactions';
import { distillMotion } from '../../transform/distill-motion';
import { copyAssets } from '../../transform/copy-assets';
import { validateSite } from '../../scan/validate';
import { safeReadJSON, runPipelineStep, StepResult, log } from '../../core/utils';
import { listOutputFiles, textResponse, validateArgs, validateToolUrl, withNextSteps } from '../helpers';
import { RebuildSiteInput } from '../schemas';
import { BrandConfig, applyBrandToDesignData } from '../../brand/brand';
import { readDesignData } from '../../export/adapters/reader';

export async function handleRebuildSite(rawArgs: unknown) {
  const args = validateArgs(RebuildSiteInput, rawArgs);
  validateToolUrl(args.url);

  const { url, crawl, auth_cookie: authCookie, auth_header: authHeader, skip_extraction: skipExtraction } = args;
  const outputDir = args.output_dir || path.resolve(process.cwd(), 'output');
  const rebuildDir = args.rebuild_dir || path.resolve(process.cwd(), 'rebuild');

  fs.mkdirSync(outputDir, { recursive: true });

  const steps: StepResult[] = [];

  // ── Run full extraction pipeline (unless skip_extraction=true) ────────

  if (!skipExtraction) {
    // Step 1: Scan
    const scanOpts: { crawl?: boolean; authCookie?: string; authHeader?: string } = {};
    if (crawl) scanOpts.crawl = true;
    if (authCookie) scanOpts.authCookie = authCookie;
    if (authHeader) scanOpts.authHeader = authHeader;

    const scanResult = await runPipelineStep('Scanner', () => scan(url, outputDir, scanOpts));
    steps.push(scanResult);

    if (scanResult.status === 'failed') {
      return textResponse({
        status: 'failed',
        error: 'Scanner failed — cannot continue pipeline',
        steps,
      });
    }

    // Steps 2-4: Parallel (analyze + motion + interactions)
    const parallelResults = await Promise.allSettled([
      runPipelineStep('Analyzer', () => analyze(url, outputDir)),
      runPipelineStep('Motion Capture', () => captureMotion(url, outputDir), true),
      runPipelineStep('Interaction Extraction', () => extractInteractions(url, outputDir), true),
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

    // Step 4.6: Scroll-Interaction Mapping
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

    // Step 5: Asset Pipeline
    const scanResultPath = path.join(outputDir, 'scan-result.json');
    if (fs.existsSync(scanResultPath)) {
      steps.push(await runPipelineStep('Asset Pipeline', async () => { copyAssets(outputDir, rebuildDir); }, true));
    }

    // Step 6: AI Synthesis (requires ANTHROPIC_API_KEY)
    if (!fs.existsSync(path.join(outputDir, 'design-system.json'))) {
      log('rebuild-site', 'info', 'AI synthesis skipped (set ANTHROPIC_API_KEY to enable)');
    }

    // Step 6.5: Project Generation
    try {
      const { generateProject } = await import('../../export/generate-project');
      steps.push(await runPipelineStep('Project Generation', () =>
        generateProject({ outputDir, rebuildDir })
      ));
    } catch (err) {
      log('rebuild-site', 'warn', `Project generation failed: ${(err as Error).message}`);
    }

    // Step 7: Site Validation
    if (fs.existsSync(path.join(outputDir, 'scan-result.json'))) {
      steps.push(await runPipelineStep('Site Validation', () => validateSite(url, outputDir)));
    }
  }

  // ── Gather all extraction data for rebuild ───────────────────────────

  const designSystem = safeReadJSON(path.join(outputDir, 'design-system.json'));
  const designSystemMd = fs.existsSync(path.join(outputDir, 'design-system.md'))
    ? fs.readFileSync(path.join(outputDir, 'design-system.md'), 'utf-8')
    : null;
  const scanData = safeReadJSON(path.join(outputDir, 'scan-result.json'));
  const motionDistilled = safeReadJSON(path.join(outputDir, 'motion-distilled.json'));
  const scrollInteractions = safeReadJSON(path.join(outputDir, 'scroll-interactions.json'));
  const interactions = safeReadJSON(path.join(outputDir, 'interactions.json'));
  const analysisResult = safeReadJSON(path.join(outputDir, 'analysis-result.json'));
  const assetManifest = safeReadJSON(path.join(rebuildDir, 'public', 'asset-manifest.json'))
    || safeReadJSON(path.join(outputDir, 'assets', 'asset-manifest.json'));

  // Screenshot paths
  const screenshotsDir = path.join(outputDir, 'screenshots');
  const screenshots = fs.existsSync(screenshotsDir)
    ? fs.readdirSync(screenshotsDir).filter(f => f.endsWith('.png')).map(f => path.join(screenshotsDir, f))
    : [];

  // Extract detailed data from scan
  let elements: unknown[] = [];
  let interactionStates: unknown = null;
  let responsiveSnapshots: unknown = null;
  let cssKeyframes: unknown = null;
  let cssCustomProperties: unknown = null;
  let fonts: unknown = null;

  if (scanData) {
    const s = scanData as Record<string, unknown>;
    elements = (s.elements as unknown[]) || [];
    interactionStates = s.interactionStates || null;
    responsiveSnapshots = s.responsiveSnapshots || null;
    const animations = s.animations as Record<string, unknown> | undefined;
    cssKeyframes = (animations?.keyframes ?? s.cssKeyframes) || null;
    cssCustomProperties = s.cssCustomProperties || null;
    const typography = s.typography as Record<string, unknown> | undefined;
    fonts = {
      families: (typography?.fontFamilies as unknown[]) || [],
      faces: (typography?.fontFaces as unknown[]) || [],
    };
  }

  // ── Build comprehensive rebuild context ──────────────────────────────

  const context: Record<string, unknown> = {
    status: steps.length > 0
      ? (steps.every(s => s.status !== 'failed') ? 'extraction_complete' : 'extraction_partial')
      : 'using_existing_data',
    url,
    outputDir,
    rebuildDir,
    screenshotPaths: screenshots,

    // Pipeline results
    steps: steps.length > 0 ? steps.map(s => ({
      step: s.step, status: s.status, durationMs: s.durationMs, error: s.error || undefined,
    })) : undefined,
    outputFiles: listOutputFiles(outputDir),
    totalExtractionMs: steps.reduce((sum, s) => sum + s.durationMs, 0) || undefined,

    // 1. DESIGN SPEC (if synthesis was run before via CLI)
    designSpec: designSystemMd || null,

    // 2. DESIGN TOKENS
    tokens: designSystem ? (designSystem as Record<string, unknown>).tokens || designSystem : null,

    // 3. COMPONENT SPECS
    components: designSystem ? (designSystem as Record<string, unknown>).components || null : null,

    // 4. ALL DOM ELEMENTS with computed styles
    elements: elements.map((el) => {
      const e = el as Record<string, unknown>;
      const children = e.children as unknown[] | undefined;
      return {
        tag: e.tag,
        selector: e.selector,
        text: typeof e.text === 'string' ? e.text.substring(0, 100) : undefined,
        classes: e.classes,
        attributes: e.attributes,
        styles: e.styles,
        boundingBox: e.boundingBox,
        children: children?.length || 0,
        parentSelector: e.parentSelector,
      };
    }),

    // 5. INTERACTION STATES (hover/focus/active before/after diffs)
    interactionStates,

    // 6. ANIMATIONS (distilled — trigger, from/to, duration, easing, scroll ranges)
    animations: motionDistilled,

    // 7. CSS @KEYFRAMES
    cssKeyframes,

    // 8. SCROLL-TRIGGERED INTERACTIONS (what appears/disappears per scroll position)
    scrollInteractions,

    // 9. INTERACTIVE BEHAVIORS (nav, toggles, modals, dropdowns, forms)
    interactions,

    // 10. RESPONSIVE SNAPSHOTS (style diffs per breakpoint vs 1440px)
    responsiveSnapshots,

    // 11. CSS ARCHITECTURE + CUSTOM PROPERTIES
    cssArchitecture: analysisResult ? (analysisResult as Record<string, unknown>).cssArchitecture || null : null,
    cssCustomProperties,
    detectedComponents: analysisResult ? (analysisResult as Record<string, unknown>).components || null : null,
    responsivePatterns: analysisResult ? (analysisResult as Record<string, unknown>).responsivePatterns || null : null,

    // 12. FONTS & ASSETS
    fonts,
    assets: assetManifest,

    // 13. META
    meta: designSystem ? (designSystem as Record<string, unknown>).meta || null : null,
  };

  // ── Apply brand overrides ───────────────────────────────────────────

  if (args.brand) {
    const brandConfig: BrandConfig = args.brand as BrandConfig;

    // Apply brand overrides to tokens if available
    if (context.tokens) {
      try {
        const designData = readDesignData(outputDir, brandConfig);
        context.tokens = designData;
      } catch {
        // If readDesignData fails, apply brand info directly
        if (brandConfig.colors) {
          const existingTokens = (context.tokens as Record<string, unknown>) || {};
          const existingColors = (existingTokens.colors as Record<string, unknown>) || {};
          const updatedColors = { ...existingColors };
          if (brandConfig.colors.primary) updatedColors.primary = { value: brandConfig.colors.primary };
          if (brandConfig.colors.secondary) updatedColors.secondary = { value: brandConfig.colors.secondary };
          if (brandConfig.colors.accent) updatedColors.accent = { value: brandConfig.colors.accent };
          context.tokens = { ...existingTokens, colors: updatedColors };
        }
      }
    }

    context.brand = brandConfig;
  }

  // ── Rebuild status ───────────────────────────────────────────────────

  // Check if project was generated
  const projectGenerated = fs.existsSync(path.join(rebuildDir, 'package.json'));

  context.projectGenerated = projectGenerated;
  context.instructions = projectGenerated
    ? `Next.js project generated at ${rebuildDir}. Run: cd ${rebuildDir} && npm install && npm run dev. ` +
      `Component stubs are in components/ — refine them using the extraction data in context.elements and context.animations. ` +
      `Design tokens are in app/globals.css as CSS custom properties. @keyframes animations are included.`
    : `Project generation was skipped or failed. Use generate_project tool or run: liftit build ${outputDir} ${rebuildDir}`;

  return withNextSteps(context, ["Run validate (mode=rebuild) to check rebuild accuracy", "Run export_tokens for additional framework configs", "Run describe_extraction to see full state"]);
}

import * as fs from 'fs';
import * as path from 'path';
import { withNextSteps, listOutputFiles, validateArgs } from '../helpers';
import { DescribeExtractionInput } from '../schemas';

export async function handleDescribeExtraction(rawArgs: unknown) {
  const args = validateArgs(DescribeExtractionInput, rawArgs);
  const outputDir = args.output_dir || path.join(process.cwd(), 'output');

  const exists = (f: string) => fs.existsSync(path.join(outputDir, f));
  const sizeKB = (f: string) => {
    const fp = path.join(outputDir, f);
    return fs.existsSync(fp) ? Math.round(fs.statSync(fp).size / 1024 * 10) / 10 : 0;
  };

  // Check state
  const scanned = exists('scan-result.json');
  const analyzed = exists('analysis-result.json');
  const motionCaptured = exists('motion-distilled.json');
  const interactionsExtracted = exists('interactions.json');
  const patternsClassified = exists('display-patterns.json');
  const synthesized = exists('design-system.json');
  const validated = exists('validation-report.json');
  const rebuildValidated = exists('rebuild-validation-report.json');

  // Check exports
  const exportDir = path.join(outputDir, 'export');
  const exported: Record<string, boolean> = {};
  for (const fmt of ['tailwind', 'css-variables', 'shadcn', 'w3c', 'style-dictionary']) {
    exported[fmt] = fs.existsSync(path.join(exportDir, fmt));
  }

  // Check project
  const rebuildDir = path.join(outputDir, '..', 'rebuild');
  const projectGenerated = fs.existsSync(path.join(rebuildDir, 'package.json'));

  // Detect components from analysis
  let detectedComponents: string[] = [];
  if (analyzed) {
    try {
      const analysis = JSON.parse(fs.readFileSync(path.join(outputDir, 'analysis-result.json'), 'utf-8'));
      detectedComponents = (analysis.components || [])
        .filter((c: { confidence?: string }) => c.confidence === 'high' || c.confidence === 'medium')
        .map((c: { pattern?: string; selector?: string }) => c.pattern || c.selector)
        .slice(0, 15);
    } catch {}
  }

  // Token summary
  let tokenSummary: Record<string, number> | undefined;
  if (scanned) {
    try {
      const scan = JSON.parse(fs.readFileSync(path.join(outputDir, 'scan-result.json'), 'utf-8'));
      tokenSummary = {
        colors: scan.colorPalette?.length || 0,
        fonts: scan.typographyMap?.length || 0,
        spacingValues: scan.spacingValues?.length || 0,
        animations: scan.animations?.length || 0,
        cssCustomProperties: scan.cssCustomProperties?.length || 0,
      };
    } catch {}
  }

  // Display patterns summary
  let patternSummary: Record<string, number> | undefined;
  if (patternsClassified) {
    try {
      const patterns = JSON.parse(fs.readFileSync(path.join(outputDir, 'display-patterns.json'), 'utf-8'));
      patternSummary = {
        sections: patterns.sections?.length || 0,
        layouts: patterns.layouts?.length || 0,
        contentPatterns: patterns.contentPatterns?.length || 0,
        animations: patterns.animations?.length || 0,
      };
    } catch {}
  }

  // Validation score
  let validationScore: number | undefined;
  if (validated) {
    try {
      const val = JSON.parse(fs.readFileSync(path.join(outputDir, 'validation-report.json'), 'utf-8'));
      validationScore = val.overallScore;
    } catch {}
  }

  // Build next steps
  const nextSteps: string[] = [];
  if (!scanned) {
    nextSteps.push('Run extract_design_system or run_pipeline to scan a site first');
  } else {
    if (!synthesized) nextSteps.push('Run rebuild_site to generate design-system.json via AI synthesis');
    if (!patternsClassified) nextSteps.push('Run get_display_patterns to classify section types and layout strategies');
    if (synthesized && !Object.values(exported).some(Boolean)) {
      nextSteps.push('Run export_tokens to generate Tailwind/shadcn/CSS variable configs');
    }
    if (!validated) nextSteps.push('Run validate (mode=site) to check extraction consistency');
    if (detectedComponents.length > 0) {
      nextSteps.push(`Run generate_component for detected components: ${detectedComponents.slice(0, 5).join(', ')}`);
    }
    if (!projectGenerated && synthesized) {
      nextSteps.push('Run rebuild_site to generate a complete Next.js project');
    }
  }

  return withNextSteps({
    outputDir,
    files: listOutputFiles(outputDir),
    state: {
      scanned,
      analyzed,
      motionCaptured,
      interactionsExtracted,
      patternsClassified,
      synthesized,
      validated,
      rebuildValidated,
      exported,
      projectGenerated,
    },
    detectedComponents,
    tokenSummary,
    patternSummary,
    validationScore,
  }, nextSteps);
}

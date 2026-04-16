import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { z } from 'zod';
import { ValidationError } from '../core/errors';
import { validateUrl } from '../core/security';

/**
 * Validate a URL from MCP tool arguments.
 * Rejects non-http(s) protocols and malformed URLs.
 */
export function validateToolUrl(url: string): void {
  validateUrl(url);
}

export function tmpOutputDir(): string {
  const dir = path.join(os.tmpdir(), `dse-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveOutputDir(provided?: string): { dir: string; isTemp: boolean } {
  if (provided) {
    fs.mkdirSync(provided, { recursive: true });
    return { dir: provided, isTemp: false };
  }
  return { dir: tmpOutputDir(), isTemp: true };
}

/** Clean up a temporary output directory. No-op if isTemp is false. */
export function cleanupTempDir(dir: string, isTemp: boolean): void {
  if (!isTemp) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort — don't crash if cleanup fails
  }
}

/** Summarize a JSON result if it exceeds maxBytes */
export function safeJsonResponse(data: unknown, maxBytes = 500_000): string {
  const dataObj = data as Record<string, unknown>;
  const json = JSON.stringify(dataObj, null, 2);
  if (json.length <= maxBytes) return json;

  const summary: Record<string, unknown> = {
    _note: 'Response summarized — full data exceeds 500KB',
  };

  if (dataObj.overallScore !== undefined) summary.overallScore = dataObj.overallScore;
  if (dataObj.mode) summary.mode = dataObj.mode;
  if (dataObj.url) summary.url = dataObj.url;
  if (dataObj.timestamp) summary.timestamp = dataObj.timestamp;
  if (dataObj.recommendations) summary.recommendations = dataObj.recommendations;

  if (Array.isArray(dataObj.screenshotComparisons)) {
    summary.screenshotComparisons = (dataObj.screenshotComparisons as { breakpoint: unknown; matchPercentage: unknown }[]).map((s) => ({
      breakpoint: s.breakpoint,
      matchPercentage: s.matchPercentage,
    }));
  }
  if (Array.isArray(dataObj.domDiscrepancies)) summary.domDiscrepancyCount = dataObj.domDiscrepancies.length;
  if (Array.isArray(dataObj.missingElements)) summary.missingElementCount = dataObj.missingElements.length;
  if (Array.isArray(dataObj.styleDiscrepancies)) summary.styleDiscrepancyCount = dataObj.styleDiscrepancies.length;
  if (Array.isArray(dataObj.interactionDiscrepancies)) summary.interactionDiscrepancyCount = dataObj.interactionDiscrepancies.length;

  return JSON.stringify(summary, null, 2);
}

/** List output files with sizes */
export function listOutputFiles(outputDir: string): { name: string; sizeKB: number }[] {
  const files: { name: string; sizeKB: number }[] = [];
  const outputFiles = [
    'scan-result.json', 'analysis-result.json', 'motion-capture.json',
    'motion-distilled.json', 'interactions.json', 'scroll-interactions.json',
    'display-patterns.json', 'interaction-captures.json', 'performance-report.json',
    'site-features.json', 'site-features.md',
    'dynamic-content.json',
    'design-system.json', 'design-system.md',
    'validation-report.json', 'rebuild-validation-report.json',
    'corrections-needed.json', 'site-map.json', 'asset-manifest.json',
  ];
  for (const file of outputFiles) {
    const filePath = path.join(outputDir, file);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      files.push({ name: file, sizeKB: Math.round(stats.size / 1024 * 10) / 10 });
    }
  }
  return files;
}

/** Validate MCP tool arguments against a Zod schema. Throws ValidationError on failure. */
export function validateArgs<T>(schema: z.ZodSchema<T>, args: unknown): T {
  try {
    return schema.parse(args);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const messages = err.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      );
      throw new ValidationError(
        `Invalid tool arguments: ${messages.join('; ')}`,
        'mcp',
        'input-validation',
        'INVALID_INPUT',
        undefined,
        messages.join('\n'),
      );
    }
    throw err;
  }
}

/** Standard MCP text response */
export function textResponse(data: string | unknown) {
  return {
    content: [{
      type: 'text' as const,
      text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    }],
  };
}

/**
 * Wrap a response with nextSteps guidance for AI agents.
 * Injects a `nextSteps` array into the JSON response data,
 * telling the agent what tools to run next and why.
 */
export function withNextSteps(data: string | unknown, nextSteps: string[]) {
  const enriched: Record<string, unknown> = typeof data === 'string' ? { result: data } : { ...(data as Record<string, unknown>) };
  enriched.nextSteps = nextSteps;
  return textResponse(enriched);
}

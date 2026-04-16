/**
 * GitHub Action Entry Point — Design Drift Check
 *
 * Compares a live site against reference scan data and reports visual drift.
 * Intended to run as a GitHub Action via action.yml at the project root.
 *
 * Environment variables (set by GitHub Actions from action.yml inputs):
 *   INPUT_URL           — URL to check (required)
 *   INPUT_REFERENCE_DIR — Directory with reference scan data (default: .liftit)
 *   INPUT_THRESHOLD     — Minimum match percentage 0-100 (default: 95)
 *   GITHUB_STEP_SUMMARY — Path to write markdown summary (set by GitHub Actions)
 */

import * as fs from 'fs';
import * as path from 'path';
import { validateSite } from '../scan/validate';
import { log } from '../core/utils';

// ── Input Parsing ────────────────────────────────────────────────────────────

interface ActionInputs {
  url: string;
  referenceDir: string;
  threshold: number;
}

function getInputs(): ActionInputs {
  const url = process.env.INPUT_URL || '';
  const referenceDir = process.env.INPUT_REFERENCE_DIR || '.liftit';
  const threshold = Number(process.env.INPUT_THRESHOLD || '95');

  if (!url) {
    log('GitHubAction', 'error', 'INPUT_URL is required');
    process.exitCode = 1;
    throw new Error('INPUT_URL is required');
  }

  if (isNaN(threshold) || threshold < 0 || threshold > 100) {
    log('GitHubAction', 'error', 'INPUT_THRESHOLD must be a number between 0 and 100');
    process.exitCode = 1;
    throw new Error('INPUT_THRESHOLD must be between 0 and 100');
  }

  return { url, referenceDir: path.resolve(referenceDir), threshold };
}

// ── Reference Check ──────────────────────────────────────────────────────────

function hasReference(referenceDir: string): boolean {
  const scanResult = path.join(referenceDir, 'scan-result.json');
  const screenshotsDir = path.join(referenceDir, 'screenshots');
  return fs.existsSync(scanResult) && fs.existsSync(screenshotsDir);
}

// ── Fresh Scan (save as reference) ───────────────────────────────────────────

async function createReference(url: string, referenceDir: string): Promise<void> {
  log('GitHubAction', 'info', `No reference found at ${referenceDir}. Running fresh scan to create reference...`);
  fs.mkdirSync(referenceDir, { recursive: true });

  // Run validation in site mode to produce scan data
  const result = await validateSite(url, referenceDir);
  const reportPath = path.join(referenceDir, 'validation-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));

  log('GitHubAction', 'info', `Reference data saved to ${referenceDir}`);
}

// ── Summary Writer ───────────────────────────────────────────────────────────

interface BreakpointScore {
  breakpoint: number;
  matchPercentage: number;
  diffPixels: number;
  status: string;
}

function writeSummary(
  overallScore: number,
  breakpointScores: BreakpointScore[],
  threshold: number,
  url: string,
): void {
  const passed = overallScore >= threshold;
  const emoji = passed ? '\u2705' : '\u274C';
  const status = passed ? 'PASS' : 'FAIL';

  const lines: string[] = [];
  lines.push(`## Design Drift Report: ${overallScore.toFixed(1)}% match ${emoji}`);
  lines.push('');

  if (!passed) {
    lines.push(`> **${status}** -- below threshold of ${threshold}%`);
  } else {
    lines.push(`> **${status}** -- meets threshold of ${threshold}%`);
  }

  lines.push('');
  lines.push(`**URL:** ${url}`);
  lines.push('');
  lines.push('| Breakpoint | Match % | Diff Pixels | Status |');
  lines.push('|------------|---------|-------------|--------|');

  for (const bp of breakpointScores) {
    const bpEmoji = bp.matchPercentage >= threshold ? '\u2705' : '\u274C';
    lines.push(
      `| ${bp.breakpoint}px | ${bp.matchPercentage.toFixed(1)}% | ${bp.diffPixels} | ${bpEmoji} |`,
    );
  }

  lines.push('');
  lines.push(`**Overall: ${overallScore.toFixed(1)}% match ${emoji}**`);

  if (!passed) {
    lines.push('');
    lines.push(`Threshold: ${threshold}% -- ${overallScore.toFixed(1)}% is below the required minimum.`);
  }

  const markdown = lines.join('\n');

  // Write to GITHUB_STEP_SUMMARY if available
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    fs.appendFileSync(summaryPath, markdown + '\n');
    log('GitHubAction', 'info', 'Summary written to $GITHUB_STEP_SUMMARY');
  }

  // Always print to stdout
  log('GitHubAction', 'info', markdown);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const inputs = getInputs();

  if (!hasReference(inputs.referenceDir)) {
    // No reference data: run fresh scan and save as baseline
    await createReference(inputs.url, inputs.referenceDir);
    log('GitHubAction', 'info', 'Reference created. Re-run this action to compare against the reference.');

    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      fs.appendFileSync(
        summaryPath,
        `## Design Drift Report\n\nReference baseline created at \`${inputs.referenceDir}\`. Commit this directory and re-run to enable drift detection.\n`,
      );
    }
    return;
  }

  // Reference exists: run validation comparison
  log('GitHubAction', 'info', `Reference found at ${inputs.referenceDir}. Running comparison...`);
  const result = await validateSite(inputs.url, inputs.referenceDir);

  // Save report
  const reportPath = path.join(inputs.referenceDir, 'validation-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));

  // Extract breakpoint scores
  const breakpointScores: BreakpointScore[] = result.screenshotComparisons.map((comp) => ({
    breakpoint: comp.breakpoint,
    matchPercentage: comp.matchPercentage,
    diffPixels: comp.diffPixels,
    status: comp.status || 'ok',
  }));

  const overallScore = result.overallScore;

  // Write summary
  writeSummary(overallScore, breakpointScores, inputs.threshold, inputs.url);

  // Set exit code
  if (overallScore < inputs.threshold) {
    log('GitHubAction', 'warn',
      `Design Drift Report: ${overallScore.toFixed(1)}% match \u274C (threshold: ${inputs.threshold}%)`,
    );
    process.exitCode = 1;
  } else {
    log('GitHubAction', 'info',
      `Design Drift Report: ${overallScore.toFixed(1)}% match \u2705`,
    );
  }
}

main().catch((err) => {
  log('GitHubAction', 'error', `Error: ${err}`);
  process.exitCode = 1;
});

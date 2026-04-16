import * as fs from 'fs';
import * as path from 'path';
import { textResponse, validateArgs, validateToolUrl, withNextSteps } from '../helpers';
import { GetPerformanceReportInput } from '../schemas';
import { capturePerformance } from '../../scan/capture-performance';

export async function handleGetPerformanceReport(rawArgs: unknown) {
  const args = validateArgs(GetPerformanceReportInput, rawArgs);
  const outputDir = args.output_dir || path.join(process.cwd(), 'output');

  const reportPath = path.join(outputDir, 'performance-report.json');

  // Use cached report if available and no URL provided (or no refresh)
  if (fs.existsSync(reportPath) && !args.url) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    return withNextSteps(report, [
      'Run rebuild_site to generate optimized code based on these findings',
      'Run validate to compare rebuild performance against original',
      'Run describe_extraction to see full extraction state',
    ]);
  }

  // Need a URL to run fresh analysis
  if (!args.url) {
    return textResponse({
      error: 'No performance-report.json found and no URL provided. Provide a URL or run the extraction pipeline first.',
    });
  }

  validateToolUrl(args.url);
  fs.mkdirSync(outputDir, { recursive: true });

  const report = await capturePerformance(args.url, outputDir);

  return withNextSteps(report, [
    'Run rebuild_site to generate optimized code based on these findings',
    'Run export_tokens to generate framework configs',
    'Run validate to compare rebuild performance against original',
  ]);
}

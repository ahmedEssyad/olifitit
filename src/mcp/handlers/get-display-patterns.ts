import * as fs from 'fs';
import * as path from 'path';
import { textResponse, validateArgs, withNextSteps } from '../helpers';
import { GetDisplayPatternsInput } from '../schemas';
import { classifyPatterns } from '../../transform/classify-patterns';

export async function handleGetDisplayPatterns(rawArgs: unknown) {
  const args = validateArgs(GetDisplayPatternsInput, rawArgs);
  const outputDir = args.output_dir || path.join(process.cwd(), 'output');

  const patternsPath = path.join(outputDir, 'display-patterns.json');

  // Use existing patterns or classify fresh
  if (fs.existsSync(patternsPath) && !args.refresh) {
    const patterns = JSON.parse(fs.readFileSync(patternsPath, 'utf-8'));
    return withNextSteps(patterns, ["Run generate_component for detected section types", "Run export_tokens to get framework configs", "Run describe_extraction for full state overview"]);
  }

  // Requires scan-result.json at minimum
  const scanPath = path.join(outputDir, 'scan-result.json');
  if (!fs.existsSync(scanPath)) {
    return textResponse({
      error: 'No scan-result.json found. Run the extraction pipeline first.',
    });
  }

  const patterns = await classifyPatterns(outputDir);
  return withNextSteps(patterns, ["Run generate_component for detected section types", "Run export_tokens to get framework configs", "Run describe_extraction for full state overview"]);
}

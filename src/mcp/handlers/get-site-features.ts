import * as fs from 'fs';
import * as path from 'path';
import { textResponse, validateArgs, withNextSteps } from '../helpers';
import { GetSiteFeaturesInput } from '../schemas';

export async function handleGetSiteFeatures(rawArgs: unknown) {
  const args = validateArgs(GetSiteFeaturesInput, rawArgs);
  const outputDir = args.output_dir || path.join(process.cwd(), 'output');

  const featuresPath = path.join(outputDir, 'site-features.json');

  // Use cached features if available
  if (fs.existsSync(featuresPath) && !args.refresh) {
    const features = JSON.parse(fs.readFileSync(featuresPath, 'utf-8'));
    return withNextSteps(features, [
      'Run rebuild_site to generate a project implementing these features',
      'Run get_performance_report to analyze site performance',
      'Run describe_extraction for full extraction state overview',
    ]);
  }

  return textResponse(
    'AI-powered feature extraction requires ANTHROPIC_API_KEY. Set it to enable site feature detection.'
  );
}

import { validateRebuild, validateSite, validateDiff } from '../../scan/validate';
import { safeJsonResponse, textResponse, validateArgs, validateToolUrl, withNextSteps } from '../helpers';
import { z } from 'zod';

const ValidateInput = z.object({
  url: z.string(),
  output_dir: z.string(),
  mode: z.enum(['rebuild', 'site', 'diff']).optional(),
  rebuild_url: z.string().optional(),
});

export async function handleValidate(rawArgs: unknown) {
  const args = validateArgs(ValidateInput, rawArgs);
  validateToolUrl(args.url);

  const { url, output_dir: outputDir } = args;
  const mode = args.mode || 'site';
  const rebuildUrl = args.rebuild_url || 'http://localhost:3000';

  if (mode === 'rebuild') {
    const result = await validateRebuild(url, outputDir, rebuildUrl);
    return { content: [{ type: 'text' as const, text: safeJsonResponse(result) }] };
  }

  if (mode === 'diff') {
    const result = await validateDiff(url, outputDir, rebuildUrl);
    return withNextSteps(result, ["Run describe_extraction to see full extraction state", "Fix reported discrepancies and re-run validate"]);
  }

  // Default: site validation
  const result = await validateSite(url, outputDir);
  return { content: [{ type: 'text' as const, text: safeJsonResponse(result) }] };
}

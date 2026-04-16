import { validateRebuild } from '../../scan/validate';
import { safeJsonResponse, validateArgs, validateToolUrl } from '../helpers';
import { ValidateRebuildInput } from '../schemas';

export async function handleValidateRebuild(rawArgs: unknown) {
  const args = validateArgs(ValidateRebuildInput, rawArgs);
  validateToolUrl(args.url);
  const { url, output_dir: outputDir } = args;
  const rebuildUrl = args.rebuild_url || 'http://localhost:3000';

  const result = await validateRebuild(url, outputDir, rebuildUrl);

  return {
    content: [{ type: 'text' as const, text: safeJsonResponse(result) }],
  };
}

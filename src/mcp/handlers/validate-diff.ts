import { validateDiff } from '../../scan/validate';
import { textResponse, validateArgs, validateToolUrl } from '../helpers';
import { ValidateDiffInput } from '../schemas';

export async function handleValidateDiff(rawArgs: unknown) {
  const args = validateArgs(ValidateDiffInput, rawArgs);
  validateToolUrl(args.url);
  const { url, output_dir: outputDir } = args;
  const rebuildUrl = args.rebuild_url || 'http://localhost:3000';

  const result = await validateDiff(url, outputDir, rebuildUrl);
  return textResponse(result);
}

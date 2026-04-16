import { validateSite } from '../../scan/validate';
import { safeJsonResponse, validateArgs, validateToolUrl } from '../helpers';
import { ValidateSiteInput } from '../schemas';

export async function handleValidateSite(rawArgs: unknown) {
  const args = validateArgs(ValidateSiteInput, rawArgs);
  validateToolUrl(args.url);
  const { url, output_dir: outputDir } = args;

  const result = await validateSite(url, outputDir);

  return {
    content: [{ type: 'text' as const, text: safeJsonResponse(result) }],
  };
}

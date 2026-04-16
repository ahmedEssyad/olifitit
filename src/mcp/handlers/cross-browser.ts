import { textResponse, validateArgs, validateToolUrl } from '../helpers';
import { CrossBrowserInput } from '../schemas';
import { compareBrowsers, BrowserName } from '../../extras/cross-browser';

/**
 * MCP handler for cross_browser_check tool.
 *
 * Launches multiple browsers, screenshots at standard breakpoints,
 * and diffs every pair with pixelmatch.
 */
export async function handleCrossBrowserCheck(rawArgs: unknown) {
  const args = validateArgs(CrossBrowserInput, rawArgs);
  validateToolUrl(args.url);

  const browsers = args.browsers
    ? (args.browsers as BrowserName[])
    : ['chromium', 'firefox', 'webkit'] as BrowserName[];

  const outputDir = args.output_dir || './output';

  const report = await compareBrowsers(args.url, outputDir, browsers);

  return textResponse(report);
}

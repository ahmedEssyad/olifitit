/**
 * CLI entry point for the scanner.
 *
 * Usage: npx ts-node scripts/scan/cli.ts <url> [output-dir] [--crawl] [--auth-cookie "k=v"] [--auth-header "K: V"]
 */

import * as path from 'path';
import { CLIOptions } from './types';
import { scan } from './index';
import { crawl } from './crawl';
import { log } from '../core/utils';

function parseArgs(argv: string[]): CLIOptions {
  const positional: string[] = [];
  let crawlMode = false;
  let authCookie: string | undefined;
  let authHeader: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--crawl') {
      crawlMode = true;
    } else if (arg === '--auth-cookie' && argv[i + 1]) {
      authCookie = argv[++i];
    } else if (arg === '--auth-header' && argv[i + 1]) {
      authHeader = argv[++i];
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  return {
    url: positional[0] || '',
    outputDir: positional[1] || path.resolve(process.cwd(), 'output'),
    crawl: crawlMode,
    authCookie,
    authHeader,
  };
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.url) {
    log('CLI', 'error', 'Usage: ts-node scan/cli.ts <url> [output-dir] [--crawl] [--auth-cookie "name=value"] [--auth-header "Key: Value"]');
    process.exit(1);
  }

  const run = opts.crawl
    ? crawl(opts.url, opts.outputDir, opts)
    : scan(opts.url, opts.outputDir, opts);

  run
    .then(() => {
      log('CLI', 'info', 'Done.');
      process.exit(0);
    })
    .catch((err) => {
      log('CLI', 'error', err);
      process.exit(1);
    });
}

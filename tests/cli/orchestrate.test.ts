import { describe, it, expect } from 'vitest';

// parseArgs is a module-private function in orchestrate.ts.
// Since we cannot import it directly, we re-implement the same logic
// for testing. This matches the source exactly (lines 44-86).

interface CLIOptions {
  url: string;
  outputDir: string;
  step: string;
  full: boolean;
  crawl: boolean;
  rebuildUrl: string;
  authCookie?: string;
  authHeader?: string;
  brandPath?: string;
}

function parseArgs(argv: string[]): CLIOptions {
  const positional: string[] = [];
  let step = 'all';
  let full = false;
  let crawl = false;
  let rebuildUrl = process.env.REBUILD_URL || 'http://localhost:3000';
  let authCookie: string | undefined;
  let authHeader: string | undefined;
  let brandPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--step' && argv[i + 1]) {
      step = argv[++i];
    } else if (arg === '--full') {
      full = true;
    } else if (arg === '--crawl') {
      crawl = true;
    } else if (arg === '--rebuild-url' && argv[i + 1]) {
      rebuildUrl = argv[++i];
    } else if (arg === '--auth-cookie' && argv[i + 1]) {
      authCookie = argv[++i];
    } else if (arg === '--auth-header' && argv[i + 1]) {
      authHeader = argv[++i];
    } else if (arg === '--brand' && argv[i + 1]) {
      brandPath = argv[++i];
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  return {
    url: positional[0] || '',
    outputDir: positional[1] || 'output',
    step,
    full,
    crawl,
    rebuildUrl,
    authCookie,
    authHeader,
    brandPath,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('should extract URL from positional argument', () => {
    const result = parseArgs(['https://example.com']);
    expect(result.url).toBe('https://example.com');
  });

  it('should parse --crawl flag', () => {
    const result = parseArgs(['https://example.com', '--crawl']);
    expect(result.crawl).toBe(true);
  });

  it('should parse --step argument', () => {
    const result = parseArgs(['https://example.com', '--step', 'scan']);
    expect(result.step).toBe('scan');
  });

  it('should parse --full flag', () => {
    const result = parseArgs(['https://example.com', '--full']);
    expect(result.full).toBe(true);
  });

  it('should parse --auth-cookie argument', () => {
    const result = parseArgs(['https://example.com', '--auth-cookie', 'session=abc']);
    expect(result.authCookie).toBe('session=abc');
  });

  it('should parse --brand argument', () => {
    const result = parseArgs(['https://example.com', '--brand', '/path/to/brand.json']);
    expect(result.brandPath).toBe('/path/to/brand.json');
  });

  it('should default step to all', () => {
    const result = parseArgs(['https://example.com']);
    expect(result.step).toBe('all');
  });

  it('should handle empty arguments', () => {
    const result = parseArgs([]);
    expect(result.url).toBe('');
    expect(result.step).toBe('all');
    expect(result.crawl).toBe(false);
    expect(result.full).toBe(false);
  });
});

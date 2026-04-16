/**
 * Export CLI — generate framework-specific config files from extracted design data.
 *
 * Usage:
 *   npx ts-node scripts/export.ts <format> [--input <dir>] [--output <dir>] [--prefix <prefix>]
 *
 * Formats: tailwind | css-variables | shadcn | all
 */

import * as path from 'path';
import { log } from '../core/utils';
import { readDesignData } from './adapters/reader';
import { generateTailwindConfig } from './adapters/tailwind';
import { generateCSSVariables } from './adapters/css-variables';
import { generateShadcnTheme } from './adapters/shadcn';
import { generateW3CDesignTokens } from './adapters/w3c-design-tokens';
import { generateStyleDictionary } from './adapters/style-dictionary';
import { generateDesignMd } from './adapters/design-md';
import { loadBrandConfig, BrandConfig } from '../brand/brand';

// ── CLI Parsing ─────────────────────────────────────────────────────────────

interface CLIOptions {
  format: string;
  inputDir: string;
  outputDir: string;
  prefix?: string;
  brandPath?: string;
}

function parseArgs(argv: string[]): CLIOptions {
  const positional: string[] = [];
  let inputDir = path.resolve(process.cwd(), 'output');
  let outputDir = path.resolve(process.cwd(), 'output', 'export');
  let prefix: string | undefined;
  let brandPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) {
      inputDir = argv[++i];
    } else if (arg === '--output' && argv[i + 1]) {
      outputDir = argv[++i];
    } else if (arg === '--prefix' && argv[i + 1]) {
      prefix = argv[++i];
    } else if (arg === '--brand' && argv[i + 1]) {
      brandPath = argv[++i];
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  return {
    format: positional[0] || '',
    inputDir,
    outputDir,
    prefix,
    brandPath,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const validFormats = ['tailwind', 'css-variables', 'shadcn', 'w3c', 'style-dictionary', 'design-md', 'all'];

  if (!opts.format || !validFormats.includes(opts.format)) {
    log('Export', 'error', 'Usage: npx ts-node scripts/export.ts <format> [--input <dir>] [--output <dir>] [--prefix <prefix>]');
    log('Export', 'error', '');
    log('Export', 'error', 'Formats:');
    log('Export', 'error', '  tailwind          Generate tailwind.config.ts');
    log('Export', 'error', '  css-variables     Generate design-tokens.css with :root custom properties');
    log('Export', 'error', '  shadcn            Generate shadcn/ui globals.css + tailwind.config.ts');
    log('Export', 'error', '  w3c               Generate W3C Design Tokens format (design-tokens.json)');
    log('Export', 'error', '  style-dictionary  Generate Amazon Style Dictionary format (tokens.json)');
    log('Export', 'error', '  design-md         Generate Stitch-compatible DESIGN.md for AI agents');
    log('Export', 'error', '  all               Generate all formats');
    log('Export', 'error', '');
    log('Export', 'error', 'Options:');
    log('Export', 'error', '  --input <dir>   Directory containing design-system.json or scan-result.json (default: ./output)');
    log('Export', 'error', '  --output <dir>  Directory to write generated files (default: ./output/export)');
    log('Export', 'error', '  --prefix <str>  CSS variable prefix for css-variables format (e.g., "ds" → --ds-color-primary)');
    log('Export', 'error', '  --brand <path>  Path to brand override JSON file (swap extracted colors/fonts with your own)');
    process.exit(1);
  }

  // Load brand overrides if provided
  const brand = opts.brandPath ? loadBrandConfig(opts.brandPath) : undefined;
  if (opts.brandPath && !brand) {
    log('Export', 'warn', `Warning: --brand specified but config could not be loaded from ${opts.brandPath}`);
  }
  if (brand) {
    log('Export', 'info', `Brand overrides loaded from ${opts.brandPath}`);
  }

  log('Export', 'info', `Reading design data from ${opts.inputDir}...`);
  const data = readDesignData(opts.inputDir, brand || undefined);
  log('Export', 'info', `Source: ${data.source} (${data.sourceUrl})`);

  const generated: string[] = [];

  if (opts.format === 'tailwind' || opts.format === 'all') {
    const outputDir = opts.format === 'all' ? path.join(opts.outputDir, 'tailwind') : opts.outputDir;
    const filePath = generateTailwindConfig(data, { outputDir });
    generated.push(filePath);
    log('Export', 'info', `Tailwind config → ${filePath}`);
  }

  if (opts.format === 'css-variables' || opts.format === 'all') {
    const outputDir = opts.format === 'all' ? path.join(opts.outputDir, 'css-variables') : opts.outputDir;
    const filePath = generateCSSVariables(data, { outputDir, prefix: opts.prefix });
    generated.push(filePath);
    log('Export', 'info', `CSS variables → ${filePath}`);
  }

  if (opts.format === 'shadcn' || opts.format === 'all') {
    const outputDir = opts.format === 'all' ? path.join(opts.outputDir, 'shadcn') : opts.outputDir;
    const result = generateShadcnTheme(data, { outputDir });
    generated.push(result.globalsPath, result.tailwindPath);
    log('Export', 'info', `shadcn globals → ${result.globalsPath}`);
    log('Export', 'info', `shadcn tailwind → ${result.tailwindPath}`);
  }

  if (opts.format === 'w3c' || opts.format === 'all') {
    const outputDir = opts.format === 'all' ? path.join(opts.outputDir, 'w3c') : opts.outputDir;
    const filePath = generateW3CDesignTokens(data, { outputDir });
    generated.push(filePath);
    log('Export', 'info', `W3C design tokens → ${filePath}`);
  }

  if (opts.format === 'style-dictionary' || opts.format === 'all') {
    const outputDir = opts.format === 'all' ? path.join(opts.outputDir, 'style-dictionary') : opts.outputDir;
    const filePath = generateStyleDictionary(data, { outputDir });
    generated.push(filePath);
    log('Export', 'info', `Style Dictionary → ${filePath}`);
  }

  if (opts.format === 'design-md' || opts.format === 'all') {
    const outputDir = opts.format === 'all' ? path.join(opts.outputDir, 'design-md') : opts.outputDir;
    const filePath = generateDesignMd(data, { outputDir, inputDir: opts.inputDir });
    generated.push(filePath);
    log('Export', 'info', `DESIGN.md → ${filePath}`);
  }

  log('Export', 'info', `Done. ${generated.length} file(s) generated.`);
}

export { readDesignData, generateTailwindConfig, generateCSSVariables, generateShadcnTheme, generateW3CDesignTokens, generateStyleDictionary, generateDesignMd };

if (require.main === module) {
  main();
}

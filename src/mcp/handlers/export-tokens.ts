import * as path from 'path';
import * as fs from 'fs';
import { readDesignData } from '../../export/adapters/reader';
import { generateTailwindConfig } from '../../export/adapters/tailwind';
import { generateCSSVariables } from '../../export/adapters/css-variables';
import { generateShadcnTheme } from '../../export/adapters/shadcn';
import { generateW3CDesignTokens } from '../../export/adapters/w3c-design-tokens';
import { generateStyleDictionary } from '../../export/adapters/style-dictionary';
import { generateDesignMd } from '../../export/adapters/design-md';
import { textResponse, validateArgs, withNextSteps } from '../helpers';
import { z } from 'zod';
import type { BrandConfig } from '../../brand/brand';

const ExportTokensInput = z.object({
  format: z.enum(['tailwind', 'css-variables', 'shadcn', 'w3c', 'style-dictionary', 'design-md', 'all']),
  input_dir: z.string().optional(),
  output_dir: z.string().optional(),
  prefix: z.string().optional(),
  brand: z.any().optional(),
});

export async function handleExportTokens(rawArgs: unknown) {
  const args = validateArgs(ExportTokensInput, rawArgs);
  const { format } = args;
  const inputDir = args.input_dir || path.join(process.cwd(), 'output');
  const brand = args.brand as BrandConfig | undefined;
  const data = readDesignData(inputDir, brand);

  const results: { format: string; file: string; content: string }[] = [];

  const run = (fmt: string) => {
    const outputDir = format === 'all'
      ? path.join(args.output_dir || path.join(inputDir, 'export'), fmt)
      : args.output_dir || path.join(inputDir, 'export');

    if (fmt === 'tailwind') {
      const filePath = generateTailwindConfig(data, { outputDir });
      results.push({ format: fmt, file: filePath, content: fs.readFileSync(filePath, 'utf-8') });
    } else if (fmt === 'css-variables') {
      const filePath = generateCSSVariables(data, { outputDir, prefix: args.prefix });
      results.push({ format: fmt, file: filePath, content: fs.readFileSync(filePath, 'utf-8') });
    } else if (fmt === 'shadcn') {
      const result = generateShadcnTheme(data, { outputDir });
      results.push({ format: 'shadcn-globals', file: result.globalsPath, content: fs.readFileSync(result.globalsPath, 'utf-8') });
      results.push({ format: 'shadcn-tailwind', file: result.tailwindPath, content: fs.readFileSync(result.tailwindPath, 'utf-8') });
    } else if (fmt === 'w3c') {
      const filePath = generateW3CDesignTokens(data, { outputDir });
      results.push({ format: fmt, file: filePath, content: fs.readFileSync(filePath, 'utf-8') });
    } else if (fmt === 'style-dictionary') {
      const filePath = generateStyleDictionary(data, { outputDir });
      results.push({ format: fmt, file: filePath, content: fs.readFileSync(filePath, 'utf-8') });
    } else if (fmt === 'design-md') {
      const filePath = generateDesignMd(data, { outputDir, inputDir });
      results.push({ format: fmt, file: filePath, content: fs.readFileSync(filePath, 'utf-8') });
    }
  };

  if (format === 'all') {
    for (const fmt of ['tailwind', 'css-variables', 'shadcn', 'w3c', 'style-dictionary', 'design-md']) {
      run(fmt);
    }
  } else {
    run(format);
  }

  return withNextSteps({
    status: 'success',
    source: data.source,
    sourceUrl: data.sourceUrl,
    filesGenerated: results.length,
    results: results.map(r => ({ format: r.format, file: r.file })),
    content: results.length === 1 ? results[0].content : undefined,
  }, ["Run validate to verify site consistency", "Run describe_extraction to see what else is available"]);
}

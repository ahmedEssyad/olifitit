import * as path from 'path';
import * as fs from 'fs';
import { readDesignData } from '../../export/adapters/reader';
import { generateShadcnTheme } from '../../export/adapters/shadcn';
import { textResponse, validateArgs } from '../helpers';
import { ExportShadcnInput } from '../schemas';
import type { BrandConfig } from '../../brand/brand';

export async function handleExportShadcn(rawArgs: unknown) {
  const args = validateArgs(ExportShadcnInput, rawArgs);
  const inputDir = args.input_dir || path.join(process.cwd(), 'output');
  const outputDir = args.output_dir || path.join(inputDir, 'export', 'shadcn');

  const data = readDesignData(inputDir, args.brand as BrandConfig | undefined);
  const result = generateShadcnTheme(data, { outputDir });

  const globalsCss = fs.readFileSync(result.globalsPath, 'utf-8');
  const tailwindConfig = fs.readFileSync(result.tailwindPath, 'utf-8');

  return textResponse({
    status: 'success',
    source: data.source,
    sourceUrl: data.sourceUrl,
    files: [result.globalsPath, result.tailwindPath],
    globalsCss,
    tailwindConfig,
  });
}

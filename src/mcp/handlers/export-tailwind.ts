import * as path from 'path';
import * as fs from 'fs';
import { readDesignData } from '../../export/adapters/reader';
import { generateTailwindConfig } from '../../export/adapters/tailwind';
import { textResponse, validateArgs } from '../helpers';
import { ExportTailwindInput } from '../schemas';
import type { BrandConfig } from '../../brand/brand';

export async function handleExportTailwind(rawArgs: unknown) {
  const args = validateArgs(ExportTailwindInput, rawArgs);
  const inputDir = args.input_dir || path.join(process.cwd(), 'output');
  const outputDir = args.output_dir || path.join(inputDir, 'export');

  const data = readDesignData(inputDir, args.brand as BrandConfig | undefined);
  const filePath = generateTailwindConfig(data, { outputDir });
  const content = fs.readFileSync(filePath, 'utf-8');

  return textResponse({
    status: 'success',
    source: data.source,
    sourceUrl: data.sourceUrl,
    file: filePath,
    content,
  });
}

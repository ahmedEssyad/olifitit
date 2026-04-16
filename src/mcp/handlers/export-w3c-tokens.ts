import * as path from 'path';
import * as fs from 'fs';
import { readDesignData } from '../../export/adapters/reader';
import { generateW3CDesignTokens } from '../../export/adapters/w3c-design-tokens';
import { textResponse, validateArgs } from '../helpers';
import { ExportW3CTokensInput } from '../schemas';
import type { BrandConfig } from '../../brand/brand';

export async function handleExportW3CTokens(rawArgs: unknown) {
  const args = validateArgs(ExportW3CTokensInput, rawArgs);
  const inputDir = args.input_dir || path.join(process.cwd(), 'output');
  const outputDir = args.output_dir || path.join(inputDir, 'export');

  const data = readDesignData(inputDir, args.brand as BrandConfig | undefined);
  const filePath = generateW3CDesignTokens(data, { outputDir });
  const content = fs.readFileSync(filePath, 'utf-8');

  return textResponse({
    status: 'success',
    source: data.source,
    sourceUrl: data.sourceUrl,
    file: filePath,
    content,
  });
}

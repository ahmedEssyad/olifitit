import * as path from 'path';
import * as fs from 'fs';
import { readDesignData } from '../../export/adapters/reader';
import { generateCSSVariables } from '../../export/adapters/css-variables';
import { textResponse, validateArgs } from '../helpers';
import { ExportCSSVariablesInput } from '../schemas';
import type { BrandConfig } from '../../brand/brand';

export async function handleExportCSSVariables(rawArgs: unknown) {
  const args = validateArgs(ExportCSSVariablesInput, rawArgs);
  const inputDir = args.input_dir || path.join(process.cwd(), 'output');
  const outputDir = args.output_dir || path.join(inputDir, 'export');
  const prefix = args.prefix;

  const data = readDesignData(inputDir, args.brand as BrandConfig | undefined);
  const filePath = generateCSSVariables(data, { outputDir, prefix });
  const content = fs.readFileSync(filePath, 'utf-8');

  return textResponse({
    status: 'success',
    source: data.source,
    sourceUrl: data.sourceUrl,
    file: filePath,
    content,
  });
}

import * as path from 'path';
import * as fs from 'fs';
import { readDesignData } from '../../export/adapters/reader';
import { generateStyleDictionary } from '../../export/adapters/style-dictionary';
import { textResponse, validateArgs } from '../helpers';
import { ExportStyleDictionaryInput } from '../schemas';
import type { BrandConfig } from '../../brand/brand';

export async function handleExportStyleDictionary(rawArgs: unknown) {
  const args = validateArgs(ExportStyleDictionaryInput, rawArgs);
  const inputDir = args.input_dir || path.join(process.cwd(), 'output');
  const outputDir = args.output_dir || path.join(inputDir, 'export');

  const data = readDesignData(inputDir, args.brand as BrandConfig | undefined);
  const filePath = generateStyleDictionary(data, { outputDir });
  const content = fs.readFileSync(filePath, 'utf-8');

  return textResponse({
    status: 'success',
    source: data.source,
    sourceUrl: data.sourceUrl,
    file: filePath,
    content,
  });
}

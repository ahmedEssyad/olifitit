import * as path from 'path';
import * as fs from 'fs';
import { readDesignData } from '../../export/adapters/reader';
import { generateDesignMd } from '../../export/adapters/design-md';
import { textResponse, validateArgs, withNextSteps } from '../helpers';
import { z } from 'zod';
import type { BrandConfig } from '../../brand/brand';

const ExportDesignMdInput = z.object({
  input_dir: z.string().optional(),
  output_dir: z.string().optional(),
  brand: z.any().optional(),
});

export async function handleExportDesignMd(rawArgs: unknown) {
  const args = validateArgs(ExportDesignMdInput, rawArgs);
  const inputDir = args.input_dir || path.join(process.cwd(), 'output');
  const outputDir = args.output_dir || path.join(inputDir, 'export');
  const brand = args.brand as BrandConfig | undefined;

  const data = readDesignData(inputDir, brand);
  const filePath = generateDesignMd(data, { outputDir, inputDir });
  const content = fs.readFileSync(filePath, 'utf-8');

  return withNextSteps({
    status: 'success',
    source: data.source,
    sourceUrl: data.sourceUrl,
    file: filePath,
    content,
  }, [
    'Drop DESIGN.md into your project root and tell your AI agent to use it as a design reference',
    'Run export_tokens to also get framework-specific configs (Tailwind, shadcn, CSS variables)',
  ]);
}

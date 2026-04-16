import * as path from 'path';
import { textResponse, validateArgs } from '../helpers';
import { z } from 'zod';
import { generateProject } from '../../export/generate-project';

const GenerateProjectInput = z.object({
  output_dir: z.string().optional(),
  rebuild_dir: z.string().optional(),
});

export async function handleGenerateProject(rawArgs: unknown) {
  const args = validateArgs(GenerateProjectInput, rawArgs);

  const outputDir = args.output_dir || path.resolve(process.cwd(), 'output');
  const rebuildDir = args.rebuild_dir || path.resolve(process.cwd(), 'rebuild');

  const files = await generateProject({ outputDir, rebuildDir });

  return textResponse({
    status: 'success',
    rebuildDir,
    filesGenerated: files.length,
    files: files.map(f => path.relative(rebuildDir, f)),
    nextSteps: [
      `cd ${rebuildDir}`,
      'npm install',
      'npm run dev',
      'Then refine components using extraction data in output/',
    ],
  });
}

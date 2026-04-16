import * as fs from 'fs';
import * as path from 'path';
import { scan } from '../../scan';
import { analyze } from '../../scan/analyze';
import { captureMotion } from '../../scan/capture-motion';
import { extractInteractions } from '../../scan/extract-interactions';
import { distillMotion } from '../../transform/distill-motion';
import { resolveOutputDir, listOutputFiles, textResponse, validateArgs, validateToolUrl } from '../helpers';
import { ExtractDesignSystemInput } from '../schemas';

export async function handleExtractDesignSystem(rawArgs: unknown) {
  const args = validateArgs(ExtractDesignSystemInput, rawArgs);
  validateToolUrl(args.url);

  const { url, crawl, auth_cookie: authCookie, auth_header: authHeader } = args;
  const { dir: outputDir, isTemp } = resolveOutputDir(args.output_dir);

  try {
    const scanOpts: Record<string, any> = {};
    if (crawl) scanOpts.crawl = true;
    if (authCookie) scanOpts.authCookie = authCookie;
    if (authHeader) scanOpts.authHeader = authHeader;

    await scan(url, outputDir, scanOpts);

    if (!fs.existsSync(path.join(outputDir, 'scan-result.json'))) {
      throw new Error(`Scan failed — no data extracted from ${url}`);
    }

    await Promise.allSettled([
      analyze(url, outputDir),
      captureMotion(url, outputDir),
      extractInteractions(url, outputDir),
    ]);

    if (fs.existsSync(path.join(outputDir, 'motion-capture.json'))) {
      distillMotion(outputDir);
    }

    const results: Record<string, any> = {};
    for (const file of ['scan-result.json', 'analysis-result.json', 'motion-distilled.json', 'interactions.json']) {
      const filePath = path.join(outputDir, file);
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.length <= 500_000) {
        results[file] = JSON.parse(content);
      } else {
        const parsed = JSON.parse(content);
        if (file === 'scan-result.json') {
          results[file] = {
            _note: 'Summarized — full data was too large for response',
            colors: parsed.colors,
            typography: parsed.typography,
            fonts: parsed.fonts,
            spacing: parsed.spacing,
            animations: parsed.animations,
            interactionStates: parsed.interactionStates,
            pageTitle: parsed.pageTitle,
            generator: parsed.generator,
          };
        } else {
          results[file] = { _note: 'File too large for response', sizeBytes: content.length };
        }
      }
    }

    if (!isTemp) {
      results._outputDir = outputDir;
      results._outputFiles = listOutputFiles(outputDir);
    }

    return textResponse(results);
  } finally {
    if (isTemp) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }
}

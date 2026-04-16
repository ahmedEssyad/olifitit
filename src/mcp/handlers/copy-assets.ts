import * as fs from 'fs';
import * as path from 'path';
import { copyAssets } from '../../transform/copy-assets';
import { textResponse, validateArgs } from '../helpers';
import { CopyAssetsInput } from '../schemas';

export async function handleCopyAssets(rawArgs: unknown) {
  const args = validateArgs(CopyAssetsInput, rawArgs);
  const { output_dir: outputDir, rebuild_dir: rebuildDir } = args;

  // Pre-check: copyAssets calls process.exit(1) if scan-result.json is missing
  if (!fs.existsSync(path.join(outputDir, 'scan-result.json'))) {
    throw new Error(`scan-result.json not found in ${outputDir}. Run extraction first.`);
  }

  copyAssets(outputDir, rebuildDir);

  const result: Record<string, any> = { status: 'success' };

  const manifestPath = path.join(rebuildDir, 'public', 'asset-manifest.json');
  if (fs.existsSync(manifestPath)) {
    result.manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  }

  const appFontsPath = path.join(rebuildDir, 'app', 'fonts.css');
  const publicFontsPath = path.join(rebuildDir, 'public', 'fonts.css');
  if (fs.existsSync(appFontsPath)) {
    result.fontFaceCSS = fs.readFileSync(appFontsPath, 'utf-8');
  } else if (fs.existsSync(publicFontsPath)) {
    result.fontFaceCSS = fs.readFileSync(publicFontsPath, 'utf-8');
  }

  return textResponse(result);
}

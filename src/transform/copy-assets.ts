/**
 * Asset Pipeline — copies extracted assets into the rebuild project
 * and generates @font-face declarations.
 *
 * Usage: npx ts-node scripts/copy-assets.ts [output-dir] [rebuild-dir]
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils';

interface AssetInfo {
  type: 'image' | 'svg' | 'font' | 'css' | 'video' | 'favicon';
  url: string;
  localPath?: string;
  mimeType?: string;
  faviconRel?: string;
}

interface AssetManifest {
  [originalUrl: string]: string; // original URL → local path
}

function copyAssets(outputDir: string, rebuildDir: string): void {
  const scanResultPath = path.join(outputDir, 'scan-result.json');
  if (!fs.existsSync(scanResultPath)) {
    throw new Error('[Assets] scan-result.json not found. Run scanner first.');
  }

  const scanResult = JSON.parse(fs.readFileSync(scanResultPath, 'utf-8'));
  const assets: AssetInfo[] = scanResult.assets || [];

  // Create directories
  const fontsDir = path.join(rebuildDir, 'public', 'fonts');
  const imagesDir = path.join(rebuildDir, 'public', 'images');
  const svgsDir = path.join(rebuildDir, 'public', 'svgs');
  fs.mkdirSync(fontsDir, { recursive: true });
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(svgsDir, { recursive: true });

  const manifest: AssetManifest = {};
  let fontCount = 0, imageCount = 0, svgCount = 0, faviconCount = 0;

  for (const asset of assets) {
    if (!asset.localPath || !fs.existsSync(asset.localPath)) continue;

    const filename = path.basename(asset.localPath);

    switch (asset.type) {
      case 'font': {
        const dest = path.join(fontsDir, filename);
        fs.copyFileSync(asset.localPath, dest);
        manifest[asset.url] = `/fonts/${filename}`;
        fontCount++;
        break;
      }
      case 'image': {
        const dest = path.join(imagesDir, filename);
        fs.copyFileSync(asset.localPath, dest);
        manifest[asset.url] = `/images/${filename}`;
        imageCount++;
        break;
      }
      case 'svg': {
        const dest = path.join(svgsDir, filename);
        fs.copyFileSync(asset.localPath, dest);
        manifest[asset.url] = `/svgs/${filename}`;
        svgCount++;
        break;
      }
      case 'favicon': {
        // Place favicons at the public root (e.g., /favicon.ico, /apple-touch-icon.png)
        const ext = path.extname(asset.localPath);
        const rel = asset.faviconRel?.toLowerCase() || 'icon';
        let destName: string;
        if (rel.includes('apple-touch-icon')) {
          destName = `apple-touch-icon${ext}`;
        } else {
          destName = `favicon${ext}`;
        }
        const dest = path.join(rebuildDir, 'public', destName);
        fs.copyFileSync(asset.localPath, dest);
        manifest[asset.url] = `/${destName}`;
        faviconCount++;
        break;
      }
    }
  }

  // Write manifest
  const manifestPath = path.join(rebuildDir, 'public', 'asset-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  log('Assets', 'info', `Manifest written to ${manifestPath}`);

  // Generate @font-face CSS
  const fontFaceCSS = generateFontFaceCSS(assets, scanResult.typographyMap || [], manifest);
  const fontsCSSPath = path.join(rebuildDir, 'app', 'fonts.css');

  // Only write if app/ exists
  const appDir = path.join(rebuildDir, 'app');
  if (fs.existsSync(appDir)) {
    fs.writeFileSync(fontsCSSPath, fontFaceCSS);
    log('Assets', 'info', `Font-face CSS written to ${fontsCSSPath}`);
  } else {
    // Write to public/ as fallback
    const fallbackPath = path.join(rebuildDir, 'public', 'fonts.css');
    fs.writeFileSync(fallbackPath, fontFaceCSS);
    log('Assets', 'info', `Font-face CSS written to ${fallbackPath}`);
  }

  log('Assets', 'info', `Copied: ${fontCount} fonts, ${imageCount} images, ${svgCount} SVGs, ${faviconCount} favicons`);
  log('Assets', 'info', `Total: ${fontCount + imageCount + svgCount + faviconCount} assets`);
}

function generateFontFaceCSS(
  assets: AssetInfo[],
  typographyMap: { fontFamily: string; fontWeight: string }[],
  manifest: AssetManifest
): string {
  const fontAssets = assets.filter(a => a.type === 'font' && a.localPath);
  if (fontAssets.length === 0) return '/* No fonts extracted */\n';

  // Try to map fonts to their families using typography data
  const familyWeights = new Map<string, Set<string>>();
  for (const entry of typographyMap) {
    const family = entry.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    if (!familyWeights.has(family)) familyWeights.set(family, new Set());
    familyWeights.get(family)!.add(entry.fontWeight);
  }

  let css = '/* Auto-generated @font-face declarations */\n\n';

  // Group font files by family name (heuristic: filename often contains family name)
  const usedFiles = new Set<string>();

  for (const [family, weights] of familyWeights) {
    const familyLower = family.toLowerCase().replace(/\s+/g, '');

    for (const weight of weights) {
      // Find a matching font file
      const matchingFont = fontAssets.find(f => {
        if (usedFiles.has(f.localPath!)) return false;
        const filename = path.basename(f.localPath!).toLowerCase();
        return filename.includes(familyLower) || filename.includes(family.toLowerCase());
      });

      if (matchingFont) {
        const localPath = manifest[matchingFont.url] || `/fonts/${path.basename(matchingFont.localPath!)}`;
        const ext = path.extname(matchingFont.localPath!).slice(1);
        const format = ext === 'woff2' ? 'woff2' : ext === 'woff' ? 'woff' : ext === 'ttf' ? 'truetype' : ext === 'otf' ? 'opentype' : ext;

        css += `@font-face {\n`;
        css += `  font-family: '${family}';\n`;
        css += `  src: url('${localPath}') format('${format}');\n`;
        css += `  font-weight: ${weight};\n`;
        css += `  font-style: normal;\n`;
        css += `  font-display: swap;\n`;
        css += `}\n\n`;

        usedFiles.add(matchingFont.localPath!);
      }
    }
  }

  // Also generate for any unmatched font files
  for (const font of fontAssets) {
    if (usedFiles.has(font.localPath!)) continue;

    const localPath = manifest[font.url] || `/fonts/${path.basename(font.localPath!)}`;
    const ext = path.extname(font.localPath!).slice(1);
    const format = ext === 'woff2' ? 'woff2' : ext === 'woff' ? 'woff' : ext === 'ttf' ? 'truetype' : ext === 'otf' ? 'opentype' : ext;
    const filename = path.basename(font.localPath!, path.extname(font.localPath!));

    css += `@font-face {\n`;
    css += `  font-family: '${filename}';\n`;
    css += `  src: url('${localPath}') format('${format}');\n`;
    css += `  font-weight: 400;\n`;
    css += `  font-style: normal;\n`;
    css += `  font-display: swap;\n`;
    css += `}\n\n`;
  }

  return css;
}

export { copyAssets };

if (require.main === module) {
  const args = process.argv.slice(2);
  const outputDir = args[0] || path.resolve(process.cwd(), 'output');
  const rebuildDir = args[1] || path.resolve(process.cwd(), 'rebuild');

  copyAssets(outputDir, rebuildDir);
  log('Assets', 'info', 'Done.');
}

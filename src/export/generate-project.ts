/**
 * Next.js Project Generator
 *
 * Takes extraction output (design-system.json, scan-result.json, motion-distilled.json,
 * interactions.json) and generates a runnable Next.js project with:
 *   - app/layout.tsx (root layout with fonts, metadata)
 *   - app/page.tsx (main page composing all sections)
 *   - app/globals.css (reset + CSS custom properties + @font-face + @keyframes)
 *   - components/*.tsx + *.module.css (one per detected component)
 *   - next.config.ts
 *   - package.json
 *   - tsconfig.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils';
import { readDesignData, DesignData } from './adapters/reader';
import { generateCSSVariables } from './adapters/css-variables';
import { generateComponentCode } from './adapters/component-codegen';
import { rgbToHex } from './adapters/utils';
import { BrandConfig, loadBrandConfig } from '../brand/brand';

// ── Types ──────────────────────────────────────────────────────────────────

interface ProjectOptions {
  outputDir: string;    // Where extraction data lives
  rebuildDir: string;   // Where to generate the Next.js project
  brandPath?: string;   // Path to brand JSON file
  brand?: BrandConfig;  // Direct brand config (takes precedence over brandPath)
}

interface DetectedComponent {
  name: string;
  selector: string;
  pattern: string;
  confidence: string;
}

interface DesignSystemJson {
  components?: Array<{ name?: string; selector?: string; pattern?: string; tag?: string; confidence?: string }>;
}

interface AnalysisResultJson {
  components?: Array<{ selector?: string; pattern?: string; tag?: string; confidence?: string }>;
}

interface MotionDistilledJson {
  animations?: Array<{ trigger?: string; element?: string }>;
  cssKeyframes?: Array<{ name: string; duration: string; iterations: string; keyframes: Record<string, string>[] }>;
}

interface AssetEntry {
  type?: string;
  url?: string;
  localPath?: string;
  faviconRel?: string;
}

interface DomElement {
  selector?: string;
  tag?: string;
  classes?: string[];
  depth?: number;
  textContent?: string;
  role?: string;
  computedStyles?: Record<string, string>;
  interactionStates?: {
    hover?: Record<string, string>;
  };
}

interface AnimationEntry {
  name?: string;
  keyframes?: string;
}

interface ScanResultJson {
  url?: string;
  pageTitle?: string;
  assets?: AssetEntry[];
  animations?: AnimationEntry[];
  domTree?: DomElement[];
}

// ── Main Generator ─────────────────────────────────────────────────────────

export async function generateProject(opts: ProjectOptions): Promise<string[]> {
  const { outputDir, rebuildDir } = opts;
  const generatedFiles: string[] = [];

  log('ProjectGen', 'info', `Generating Next.js project in ${rebuildDir}`);

  // Load brand config (direct > file > none)
  let brand: BrandConfig | undefined;
  if (opts.brand) {
    brand = opts.brand;
    log('ProjectGen', 'info', `Using brand override (primary: ${brand.colors.primary})`);
  } else if (opts.brandPath) {
    brand = loadBrandConfig(opts.brandPath) || undefined;
    if (brand) log('ProjectGen', 'info', `Loaded brand from ${opts.brandPath}`);
  }

  // Load extraction data (with brand applied if provided)
  const designData = readDesignData(outputDir, brand);

  let designSystem: DesignSystemJson | null = null;
  const dsPath = path.join(outputDir, 'design-system.json');
  if (fs.existsSync(dsPath)) {
    designSystem = JSON.parse(fs.readFileSync(dsPath, 'utf-8')) as DesignSystemJson;
  }

  let analysisResult: AnalysisResultJson | null = null;
  const analysisPath = path.join(outputDir, 'analysis-result.json');
  if (fs.existsSync(analysisPath)) {
    analysisResult = JSON.parse(fs.readFileSync(analysisPath, 'utf-8')) as AnalysisResultJson;
  }

  let motionDistilled: MotionDistilledJson | null = null;
  const motionPath = path.join(outputDir, 'motion-distilled.json');
  if (fs.existsSync(motionPath)) {
    motionDistilled = JSON.parse(fs.readFileSync(motionPath, 'utf-8')) as MotionDistilledJson;
  }

  let scanResult: ScanResultJson | null = null;
  const scanPath = path.join(outputDir, 'scan-result.json');
  if (fs.existsSync(scanPath)) {
    scanResult = JSON.parse(fs.readFileSync(scanPath, 'utf-8')) as ScanResultJson;
  }

  // Create directory structure
  const dirs = [
    path.join(rebuildDir, 'app'),
    path.join(rebuildDir, 'components'),
    path.join(rebuildDir, 'hooks'),
    path.join(rebuildDir, 'public'),
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // ── 1. package.json ────────────────────────────────────────────────────

  const packageJson = {
    name: 'liftit-rebuild',
    version: '0.1.0',
    private: true,
    scripts: {
      dev: 'next dev',
      build: 'next build',
      start: 'next start',
    },
    dependencies: {
      'next': '^15.0.0',
      'react': '^19.0.0',
      'react-dom': '^19.0.0',
      'framer-motion': '^11.0.0',
    },
    devDependencies: {
      '@types/node': '^22.0.0',
      '@types/react': '^19.0.0',
      'typescript': '^5.0.0',
    },
  };

  const pkgPath = path.join(rebuildDir, 'package.json');
  fs.writeFileSync(pkgPath, JSON.stringify(packageJson, null, 2) + '\n');
  generatedFiles.push(pkgPath);

  // ── 2. tsconfig.json ───────────────────────────────────────────────────

  const tsconfig = {
    compilerOptions: {
      target: 'ES2017',
      lib: ['dom', 'dom.iterable', 'esnext'],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'preserve',
      incremental: true,
      plugins: [{ name: 'next' }],
      paths: { '@/*': ['./*'] },
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules'],
  };

  const tsconfigPath = path.join(rebuildDir, 'tsconfig.json');
  fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + '\n');
  generatedFiles.push(tsconfigPath);

  // ── 3. next.config.ts ──────────────────────────────────────────────────

  const nextConfig = `import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
`;

  const nextConfigPath = path.join(rebuildDir, 'next.config.ts');
  fs.writeFileSync(nextConfigPath, nextConfig);
  generatedFiles.push(nextConfigPath);

  // ── 4. globals.css ─────────────────────────────────────────────────────

  const globalsCss = generateGlobalsCss(designData, scanResult, motionDistilled);
  const globalsCssPath = path.join(rebuildDir, 'app', 'globals.css');
  fs.writeFileSync(globalsCssPath, globalsCss);
  generatedFiles.push(globalsCssPath);

  // ── 5. app/layout.tsx ──────────────────────────────────────────────────

  const sourceUrl = designData.sourceUrl || scanResult?.url || '';
  const pageTitle = scanResult?.pageTitle || 'Liftit Rebuild';
  const fonts = designData.typography.fontFamilies;

  // Detect favicons from scan result
  const faviconAssets = (scanResult?.assets || []).filter((a: AssetEntry) => a.type === 'favicon');
  const layoutTsx = generateLayout(pageTitle, sourceUrl, fonts, faviconAssets);
  const layoutPath = path.join(rebuildDir, 'app', 'layout.tsx');
  fs.writeFileSync(layoutPath, layoutTsx);
  generatedFiles.push(layoutPath);

  // ── 6. Detect components from analysis ─────────────────────────────────

  const components = detectProjectComponents(analysisResult, designSystem);
  log('ProjectGen', 'info', `Detected ${components.length} components to generate`);

  // ── 7. Generate component stubs ────────────────────────────────────────

  for (const comp of components) {
    const compDir = path.join(rebuildDir, 'components');
    const { tsxContent, cssContent } = generateComponentStub(comp, designData, motionDistilled, scanResult);

    const tsxPath = path.join(compDir, `${comp.name}.tsx`);
    const cssPath = path.join(compDir, `${comp.name}.module.css`);

    fs.writeFileSync(tsxPath, tsxContent);
    fs.writeFileSync(cssPath, cssContent);
    generatedFiles.push(tsxPath, cssPath);
  }

  // ── 8. app/page.tsx ────────────────────────────────────────────────────

  const pageTsx = generatePage(components);
  const pagePath = path.join(rebuildDir, 'app', 'page.tsx');
  fs.writeFileSync(pagePath, pageTsx);
  generatedFiles.push(pagePath);

  // ── 9. hooks/useScrollAnimation.ts ─────────────────────────────────────

  const hookContent = generateScrollHook();
  const hookPath = path.join(rebuildDir, 'hooks', 'useScrollAnimation.ts');
  fs.writeFileSync(hookPath, hookContent);
  generatedFiles.push(hookPath);

  log('ProjectGen', 'info', `Generated ${generatedFiles.length} files`);
  return generatedFiles;
}

// ── Globals CSS Generator ──────────────────────────────────────────────────

function generateGlobalsCss(data: DesignData, scanResult: ScanResultJson | null, motionDistilled: MotionDistilledJson | null): string {
  const lines: string[] = [];

  lines.push('/* Generated by liftit */');
  lines.push('/* Reset */');
  lines.push('*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }');
  lines.push('html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }');
  lines.push('body { min-height: 100vh; }');
  lines.push('img, picture, video, canvas, svg { display: block; max-width: 100%; }');
  lines.push('input, button, textarea, select { font: inherit; }');
  lines.push('');

  // CSS custom properties
  lines.push(':root {');
  if (data.colors.primary) lines.push(`  --color-primary: ${rgbToHex(data.colors.primary.value)};`);
  if (data.colors.secondary) lines.push(`  --color-secondary: ${rgbToHex(data.colors.secondary.value)};`);
  if (data.colors.accent) lines.push(`  --color-accent: ${rgbToHex(data.colors.accent.value)};`);
  for (const [name, token] of Object.entries(data.colors.neutral)) {
    lines.push(`  --color-neutral-${name}: ${rgbToHex(token.value)};`);
  }
  for (const [name, token] of Object.entries(data.colors.semantic)) {
    lines.push(`  --color-${name}: ${rgbToHex(token.value)};`);
  }

  // Typography variables
  for (const family of data.typography.fontFamilies) {
    const key = family.name.toLowerCase().replace(/\s+/g, '-');
    lines.push(`  --font-${key}: ${family.stack};`);
  }

  // Spacing
  for (const val of data.spacing.scale.slice(0, 20)) {
    lines.push(`  --spacing-${val}: ${val}px;`);
  }

  // Border radius
  for (const r of data.borderRadius.slice(0, 10)) {
    const key = r.value.replace('px', '');
    lines.push(`  --radius-${key}: ${r.value};`);
  }

  // Shadows
  for (const shadow of data.shadows) {
    const key = shadow.name.toLowerCase().replace(/\s+/g, '-');
    lines.push(`  --shadow-${key}: ${shadow.value};`);
  }

  lines.push('}');
  lines.push('');

  // @font-face from assets
  const fontsCssPath = scanResult?.assets?.filter((a: AssetEntry) => a.type === 'font') || [];
  if (fontsCssPath.length > 0) {
    lines.push('/* Font faces — update src paths after npm install */');
    for (const font of fontsCssPath.slice(0, 10)) {
      const name = path.basename(font.url || '').split('?')[0];
      lines.push(`/* @font-face { font-family: "..."; src: url("/fonts/${name}"); } */`);
    }
    lines.push('');
  }

  // @keyframes from motion data
  if (motionDistilled?.cssKeyframes) {
    lines.push('/* Extracted @keyframes */');
    for (const kf of motionDistilled.cssKeyframes) {
      lines.push(`@keyframes ${kf.name} {`);
      if (kf.keyframes && Array.isArray(kf.keyframes)) {
        const stepCount = kf.keyframes.length;
        kf.keyframes.forEach((frame: Record<string, string>, i: number) => {
          const pct = stepCount === 1 ? '100%' : `${Math.round((i / (stepCount - 1)) * 100)}%`;
          const props = Object.entries(frame).map(([p, v]) => `    ${p.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${v};`).join('\n');
          lines.push(`  ${pct} {\n${props}\n  }`);
        });
      }
      lines.push('}');
      lines.push('');
    }
  }

  // Also add keyframes from scan animations
  if (scanResult?.animations) {
    for (const anim of scanResult.animations) {
      if (anim.keyframes) {
        lines.push(`@keyframes ${anim.name} {`);
        lines.push(`  ${anim.keyframes}`);
        lines.push('}');
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

// ── Layout Generator ───────────────────────────────────────────────────────

function generateLayout(title: string, sourceUrl: string, fonts: DesignData['typography']['fontFamilies'], faviconAssets?: AssetEntry[]): string {
  const fontImports = fonts.slice(0, 3).map((f, i) => {
    const varName = f.name.replace(/\s+/g, '');
    // Use next/font/google for common fonts, local for custom
    return `// TODO: Import font "${f.name}" — e.g., import { ${varName} } from 'next/font/google';`;
  }).join('\n');

  // Build icons metadata from favicon assets
  let iconsBlock = '';
  if (faviconAssets && faviconAssets.length > 0) {
    const iconEntries: string[] = [];
    const appleEntries: string[] = [];
    for (const fav of faviconAssets) {
      const rel = (fav.faviconRel || 'icon').toLowerCase();
      const ext = (fav.localPath || fav.url || '').split('.').pop() || 'ico';
      if (rel.includes('apple-touch-icon')) {
        appleEntries.push(`'/apple-touch-icon.${ext}'`);
      } else {
        iconEntries.push(`'/favicon.${ext}'`);
      }
    }
    const parts: string[] = [];
    if (iconEntries.length > 0) parts.push(`    icon: ${iconEntries[0]},`);
    if (appleEntries.length > 0) parts.push(`    apple: ${appleEntries[0]},`);
    if (parts.length > 0) {
      iconsBlock = `\n  icons: {\n${parts.join('\n')}\n  },`;
    }
  }

  return `import type { Metadata } from 'next';
import './globals.css';

${fontImports}

export const metadata: Metadata = {
  title: '${title.replace(/'/g, "\\'")}',
  description: 'Rebuilt from ${sourceUrl.replace(/'/g, "\\'")} by Liftit',${iconsBlock}
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;
}

// ── Component Detection ────────────────────────────────────────────────────

function detectProjectComponents(analysisResult: AnalysisResultJson | null, designSystem: DesignSystemJson | null): DetectedComponent[] {
  const components: DetectedComponent[] = [];
  const seen = new Set<string>();

  // From analysis result
  if (analysisResult?.components) {
    for (const comp of analysisResult.components) {
      const name = inferComponentName(comp.pattern || comp.selector || '', comp.tag);
      if (seen.has(name)) continue;
      seen.add(name);
      components.push({
        name,
        selector: comp.selector || '',
        pattern: comp.pattern || '',
        confidence: comp.confidence || 'medium',
      });
    }
  }

  // From design system
  if (designSystem?.components) {
    for (const comp of designSystem.components) {
      const name = comp.name || inferComponentName(comp.selector || '', comp.tag);
      if (seen.has(name)) continue;
      seen.add(name);
      components.push({
        name,
        selector: comp.selector || '',
        pattern: comp.pattern || comp.name || '',
        confidence: comp.confidence || 'medium',
      });
    }
  }

  // Ensure minimum set of structural components
  const structural = ['Header', 'Hero', 'Footer'];
  for (const name of structural) {
    if (!seen.has(name)) {
      components.push({ name, selector: name.toLowerCase(), pattern: name.toLowerCase(), confidence: 'inferred' });
    }
  }

  // Sort by page order: header first, footer last, high confidence first
  return components.sort((a, b) => {
    if (a.name === 'Header') return -1;
    if (b.name === 'Header') return 1;
    if (a.name === 'Footer') return 1;
    if (b.name === 'Footer') return -1;
    const confOrder: Record<string, number> = { high: 0, medium: 1, low: 2, inferred: 3 };
    return (confOrder[a.confidence] || 3) - (confOrder[b.confidence] || 3);
  });
}

function inferComponentName(pattern: string, tag?: string): string {
  const nameMap: Record<string, string> = {
    nav: 'Header', navigation: 'Header', header: 'Header', banner: 'Header',
    hero: 'Hero', footer: 'Footer', card: 'Card', button: 'Button',
    modal: 'Modal', form: 'ContactForm', pricing: 'Pricing',
    testimonial: 'Testimonials', faq: 'FAQ', sidebar: 'Sidebar',
    search: 'Search', 'data-table': 'DataTable', tabs: 'Tabs',
    accordion: 'Accordion', list: 'List', table: 'Table',
    alert: 'Alert', menu: 'Menu', toolbar: 'Toolbar',
  };

  const lower = pattern.toLowerCase();
  for (const [key, name] of Object.entries(nameMap)) {
    if (lower.includes(key)) return name;
  }

  // PascalCase the pattern
  return pattern
    .replace(/[#.\[\]="':>()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/[\s-_]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('') || 'Section';
}

// ── Component Stub Helpers ─────────────────────────────────────────────────

function toKebab(str: string): string {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}

function escapeStr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function minimalFilterStyles(styles: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  const alwaysKeep = new Set([
    'display', 'position', 'width', 'height', 'maxWidth', 'minHeight',
    'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
    'backgroundColor', 'color', 'fontFamily', 'fontSize', 'fontWeight',
    'lineHeight', 'letterSpacing', 'textAlign', 'textTransform', 'textDecoration',
    'borderRadius', 'border', 'boxShadow', 'gap', 'flexDirection', 'justifyContent',
    'alignItems', 'flexWrap', 'gridTemplateColumns', 'gridTemplateRows',
    'opacity', 'transform', 'transition', 'overflow', 'zIndex',
    'backgroundImage', 'backgroundSize', 'backgroundPosition',
    'backdropFilter', 'filter', 'cursor',
  ]);
  for (const [prop, value] of Object.entries(styles)) {
    if (!value) continue;
    if (!alwaysKeep.has(prop)) continue;
    if (prop === 'display' && value === 'block') continue;
    if (prop === 'position' && value === 'static') continue;
    if (prop === 'opacity' && value === '1') continue;
    if (prop === 'overflow' && value === 'visible') continue;
    if (prop === 'cursor' && value === 'auto') continue;
    if (prop === 'transform' && value === 'none') continue;
    if (prop === 'transition' && (value === 'all 0s ease 0s' || value === 'none')) continue;
    filtered[prop] = value;
  }
  return filtered;
}

function findMatchingElement(domTree: DomElement[], comp: DetectedComponent): DomElement | undefined {
  return domTree.find((el: DomElement) => {
    if (el.selector === comp.selector) return true;
    const elClasses = (el.classes || []).join(' ').toLowerCase();
    const compLower = comp.selector.toLowerCase();
    if (elClasses.includes(compLower)) return true;
    if (el.tag === comp.selector) return true;
    return false;
  });
}

function findChildren(domTree: DomElement[], primary: DomElement): DomElement[] {
  const primaryIndex = domTree.indexOf(primary);
  if (primaryIndex === -1) return [];
  const primaryDepth = primary.depth ?? 0;
  const children: DomElement[] = [];
  for (let i = primaryIndex + 1; i < domTree.length; i++) {
    const el = domTree[i];
    const elDepth = el.depth ?? 0;
    if (elDepth <= primaryDepth) break;
    if (elDepth === primaryDepth + 1) {
      children.push(el);
    }
  }
  // Fallback: use selector prefix match if depth info is unavailable
  if (children.length === 0 && primary.selector) {
    for (const el of domTree) {
      if (el === primary) continue;
      if (
        el.selector &&
        el.selector !== primary.selector &&
        el.selector.startsWith(primary.selector)
      ) {
        children.push(el);
      }
    }
  }
  return children;
}

function inferChildName(el: DomElement, index: number): string {
  if (el.role && el.role !== 'none' && el.role !== 'presentation') {
    return el.role.toLowerCase().replace(/\s+/g, '-');
  }
  const classes: string[] = el.classes || [];
  for (const cls of classes) {
    const clean = cls.replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase();
    if (clean.length > 1 && clean.length < 30) return clean;
  }
  const tagMap: Record<string, string> = {
    h1: 'heading', h2: 'heading', h3: 'subheading', h4: 'subheading',
    p: 'text', span: 'label', a: 'link', button: 'button',
    img: 'image', ul: 'list', ol: 'list', li: 'item',
    nav: 'nav', header: 'header', footer: 'footer', aside: 'aside',
    form: 'form', input: 'input', textarea: 'textarea',
  };
  if (el.tag && tagMap[el.tag]) return `${tagMap[el.tag]}${index > 0 ? index : ''}`;
  return `child${index}`;
}

// ── Component Stub Generator ───────────────────────────────────────────────

function generateComponentStub(
  comp: DetectedComponent,
  data: DesignData,
  motionDistilled: MotionDistilledJson | null,
  scanResult: ScanResultJson | null,
): { tsxContent: string; cssContent: string } {
  const domTree: DomElement[] = scanResult?.domTree || [];

  // Find primary element
  const primary = findMatchingElement(domTree, comp);

  // Find children
  const children = primary ? findChildren(domTree, primary) : [];

  // Check animations
  const hasEntrance = motionDistilled?.animations?.some(
    (a) => a.trigger === 'scroll-into-view' && a.element?.includes(comp.selector)
  );
  const needsMotion = !!hasEntrance;

  // Build CSS
  const cssLines: string[] = [];
  cssLines.push(`/* ${comp.name} — extracted from ${comp.selector} */`);
  cssLines.push('');

  if (primary) {
    const rootStyles = minimalFilterStyles(primary.computedStyles || {});
    cssLines.push('.root {');
    for (const [prop, value] of Object.entries(rootStyles)) {
      cssLines.push(`  ${toKebab(prop)}: ${value};`);
    }
    cssLines.push('}');
  } else {
    cssLines.push('.root { width: 100%; }');
  }

  // Child styles
  const childNames: { name: string; tag: string; text: string }[] = [];
  for (let i = 0; i < Math.min(children.length, 15); i++) {
    const child = children[i];
    const name = inferChildName(child, i);
    childNames.push({ name, tag: child.tag || 'div', text: (child.textContent || '').slice(0, 50) });

    const childStyles = minimalFilterStyles(child.computedStyles || {});
    if (Object.keys(childStyles).length > 0) {
      cssLines.push('');
      cssLines.push(`.${name} {`);
      for (const [prop, value] of Object.entries(childStyles)) {
        cssLines.push(`  ${toKebab(prop)}: ${value};`);
      }
      cssLines.push('}');
    }

    // Hover states
    if (child.interactionStates?.hover) {
      cssLines.push('');
      cssLines.push(`.${name}:hover {`);
      for (const [prop, value] of Object.entries(child.interactionStates.hover as Record<string, string>)) {
        cssLines.push(`  ${toKebab(prop)}: ${value};`);
      }
      cssLines.push('}');
    }
  }

  // Build TSX
  const tsxLines: string[] = [];
  tsxLines.push("'use client';");
  tsxLines.push('');
  if (needsMotion) tsxLines.push("import { motion } from 'framer-motion';");
  tsxLines.push(`import styles from './${comp.name}.module.css';`);
  tsxLines.push('');
  tsxLines.push(`export default function ${comp.name}() {`);
  tsxLines.push('  return (');

  const rootTag = primary?.tag || 'section';
  tsxLines.push(
    `    <${needsMotion ? 'motion.' : ''}${rootTag} className={styles.root}${
      hasEntrance
        ? ' initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}'
        : ''
    }>`
  );

  for (const child of childNames) {
    const tag = child.tag || 'div';
    if (tag === 'img') {
      tsxLines.push(`      <img className={styles.${child.name}} src="/placeholder.svg" alt="${escapeStr(child.text)}" />`);
    } else if (child.text) {
      tsxLines.push(`      <${tag} className={styles.${child.name}}>${escapeStr(child.text)}</${tag}>`);
    } else {
      tsxLines.push(`      <${tag} className={styles.${child.name}} />`);
    }
  }

  tsxLines.push(`    </${needsMotion ? 'motion.' : ''}${rootTag}>`);
  tsxLines.push('  );');
  tsxLines.push('}');

  return { tsxContent: tsxLines.join('\n') + '\n', cssContent: cssLines.join('\n') + '\n' };
}

// ── Page Generator ─────────────────────────────────────────────────────────

function generatePage(components: DetectedComponent[]): string {
  const imports = components
    .map(c => `import ${c.name} from '@/components/${c.name}';`)
    .join('\n');

  const jsx = components
    .map(c => `      <${c.name} />`)
    .join('\n');

  return `${imports}

export default function Home() {
  return (
    <main>
${jsx}
    </main>
  );
}
`;
}

// ── Scroll Animation Hook ──────────────────────────────────────────────────

function generateScrollHook(): string {
  return `'use client';

import { useScroll, useTransform, MotionValue } from 'framer-motion';

/**
 * Hook for scroll-linked animations.
 *
 * Usage:
 *   const { scrollY } = useScrollAnimation();
 *   const opacity = useTransform(scrollY, [0, 500], [0, 1]);
 */
export function useScrollAnimation() {
  const { scrollY } = useScroll();
  return { scrollY };
}

/**
 * Create a scroll-linked transform.
 *
 * @param scrollY - MotionValue from useScroll
 * @param inputRange - [startScroll, endScroll] in pixels
 * @param outputRange - [startValue, endValue]
 */
export function useScrollTransform(
  scrollY: MotionValue<number>,
  inputRange: [number, number],
  outputRange: [number, number],
) {
  return useTransform(scrollY, inputRange, outputRange);
}
`;
}

// ── CLI Entry ──────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const outputDir = args[0] || path.resolve(process.cwd(), 'output');
  const rebuildDir = args[1] || path.resolve(process.cwd(), 'rebuild');

  if (!fs.existsSync(path.join(outputDir, 'scan-result.json')) && !fs.existsSync(path.join(outputDir, 'design-system.json'))) {
    log('Project', 'error', 'No extraction data found. Run the extraction pipeline first.');
    log('Project', 'error', 'Usage: npx ts-node scripts/generate-project.ts [output-dir] [rebuild-dir]');
    process.exit(1);
  }

  generateProject({ outputDir, rebuildDir })
    .then((files) => {
      log('Project', 'info', `\nGenerated ${files.length} files in ${rebuildDir}`);
      log('Project', 'info', '\nNext steps:');
      log('Project', 'info', `  cd ${rebuildDir}`);
      log('Project', 'info', '  npm install');
      log('Project', 'info', '  npm run dev');
      log('Project', 'info', '\nThen refine components using extraction data in output/');
    })
    .catch((err) => {
      log('Project', 'error', err);
      process.exit(1);
    });
}

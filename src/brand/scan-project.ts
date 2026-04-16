/**
 * Project Component Scanner
 *
 * Discovers components in a user's React/Next.js project, parses their
 * CSS modules, and builds a local component inventory for smart matching.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils';
import { parseCssModule, ParsedCssClass } from '../export/adapters/component-differ';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LocalComponent {
  name: string;
  tsxPath: string;
  cssPath: string;
  cssContent: string;
  cssClasses: Map<string, ParsedCssClass>;
  componentType: string;
}

// ── Component Type Inference ───────────────────────────────────────────────

const COMPONENT_TYPE_PATTERNS: Record<string, RegExp[]> = {
  header:  [/header/i, /navbar/i, /nav\b/i, /topbar/i, /appbar/i],
  hero:    [/hero/i, /banner/i, /jumbotron/i, /splash/i, /landing/i],
  footer:  [/footer/i, /bottombar/i],
  sidebar: [/sidebar/i, /sidenav/i, /drawer/i],
  card:    [/card/i, /tile/i, /panel/i],
  button:  [/button/i, /btn\b/i, /cta/i],
  modal:   [/modal/i, /dialog/i, /popup/i, /overlay/i],
  form:    [/form/i, /contact/i, /signup/i, /login/i, /auth/i],
  pricing: [/pricing/i, /price/i, /plan/i],
  testimonial: [/testimonial/i, /review/i, /quote/i],
  faq:     [/faq/i, /accordion/i, /question/i],
  section: [/section/i, /block/i, /feature/i, /about/i, /service/i],
  table:   [/table/i, /datagrid/i, /list/i],
  avatar:  [/avatar/i, /profile/i, /user/i],
  badge:   [/badge/i, /tag/i, /chip/i, /pill/i, /label/i],
  search:  [/search/i],
  tabs:    [/tab/i],
  menu:    [/menu/i, /dropdown/i],
  alert:   [/alert/i, /notification/i, /toast/i, /snackbar/i],
  carousel: [/carousel/i, /slider/i, /swiper/i, /slideshow/i],
};

function inferComponentType(name: string, cssContent: string): string {
  const combined = name + ' ' + cssContent.slice(0, 500);
  for (const [type, patterns] of Object.entries(COMPONENT_TYPE_PATTERNS)) {
    if (patterns.some(re => re.test(combined))) return type;
  }
  return 'section';
}

// ── Scanner ────────────────────────────────────────────────────────────────

export function scanProjectComponents(projectDir: string): LocalComponent[] {
  const resolved = path.resolve(projectDir);
  const components: LocalComponent[] = [];

  if (!fs.existsSync(resolved)) {
    log('project-scan', 'warn', `Project directory not found: ${resolved}`);
    return [];
  }

  const searchDirs = [
    'components', 'src/components', 'app/components',
    'src/app/components', 'src/sections', 'sections',
    'src/features', 'features', 'src/ui', 'ui',
    'src/layouts', 'layouts',
  ];

  const cssModuleFiles = new Map<string, string>();

  for (const dir of searchDirs) {
    const fullDir = path.join(resolved, dir);
    if (!fs.existsSync(fullDir)) continue;
    collectCssModules(fullDir, cssModuleFiles, resolved);
  }

  const appDir = path.join(resolved, 'app');
  if (fs.existsSync(appDir)) {
    collectCssModules(appDir, cssModuleFiles, resolved, 1);
  }
  const srcAppDir = path.join(resolved, 'src', 'app');
  if (fs.existsSync(srcAppDir)) {
    collectCssModules(srcAppDir, cssModuleFiles, resolved, 1);
  }

  log('project-scan', 'info', `Found ${cssModuleFiles.size} CSS module files`);

  for (const [basename, cssPath] of cssModuleFiles) {
    try {
      const cssContent = fs.readFileSync(cssPath, 'utf-8');
      if (!cssContent.trim()) continue;

      const cssClasses = parseCssModule(cssContent);
      if (cssClasses.size === 0) continue;

      const name = basename
        .replace('.module.css', '')
        .replace('.module.scss', '');

      const dir = path.dirname(cssPath);
      const tsxCandidates = [
        path.join(dir, `${name}.tsx`),
        path.join(dir, `${name}.jsx`),
        path.join(dir, `${name}.ts`),
        path.join(dir, `${name}.js`),
        path.join(dir, 'index.tsx'),
        path.join(dir, 'index.jsx'),
      ];
      const tsxPath = tsxCandidates.find(p => fs.existsSync(p)) || '';

      const componentType = inferComponentType(name, cssContent);

      components.push({
        name,
        tsxPath,
        cssPath,
        cssContent,
        cssClasses,
        componentType,
      });
    } catch (err) {
      log('project-scan', 'debug', `Failed to parse ${cssPath}: ${(err as Error).message}`);
    }
  }

  log('project-scan', 'info', `Parsed ${components.length} components: ${components.map(c => `${c.name} (${c.componentType})`).join(', ')}`);

  return components;
}

// ── File Discovery ─────────────────────────────────────────────────────────

function collectCssModules(
  dir: string,
  map: Map<string, string>,
  projectRoot: string,
  maxDepth: number = 5,
  currentDepth: number = 0,
): void {
  if (currentDepth > maxDepth) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch { return; }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'dist', 'build', '.git', '.cache', 'coverage'].includes(entry.name)) continue;
      collectCssModules(fullPath, map, projectRoot, maxDepth, currentDepth + 1);
    } else if (entry.name.endsWith('.module.css') || entry.name.endsWith('.module.scss')) {
      map.set(entry.name, fullPath);
    }
  }
}

// ── Project Styling Detection ──────────────────────────────────────────────

export type StylingApproach = 'css-modules' | 'tailwind' | 'both' | 'unknown';

export interface ProjectInfo {
  stylingApproach: StylingApproach;
  hasTailwindConfig: boolean;
  hasGlobalsCss: boolean;
  tailwindConfigPath?: string;
  globalsCssPath?: string;
  components: LocalComponent[];
}

export function detectProjectInfo(projectDir: string): ProjectInfo {
  const resolved = path.resolve(projectDir);

  // Check for Tailwind
  const tailwindCandidates = [
    'tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.mjs', 'tailwind.config.cjs',
  ];
  let tailwindConfigPath: string | undefined;
  for (const f of tailwindCandidates) {
    const fp = path.join(resolved, f);
    if (fs.existsSync(fp)) { tailwindConfigPath = fp; break; }
  }

  // Check for globals.css
  const globalsCandidates = [
    'app/globals.css', 'src/app/globals.css', 'styles/globals.css',
    'src/styles/globals.css', 'app/global.css', 'src/globals.css',
  ];
  let globalsCssPath: string | undefined;
  for (const f of globalsCandidates) {
    const fp = path.join(resolved, f);
    if (fs.existsSync(fp)) { globalsCssPath = fp; break; }
  }

  const hasTailwindConfig = !!tailwindConfigPath;
  const hasGlobalsCss = !!globalsCssPath;

  // Scan for CSS modules
  const components = scanProjectComponents(projectDir);
  const hasCssModules = components.length > 0;

  let stylingApproach: StylingApproach = 'unknown';
  if (hasCssModules && hasTailwindConfig) stylingApproach = 'both';
  else if (hasTailwindConfig) stylingApproach = 'tailwind';
  else if (hasCssModules) stylingApproach = 'css-modules';

  return {
    stylingApproach,
    hasTailwindConfig,
    hasGlobalsCss,
    tailwindConfigPath,
    globalsCssPath,
    components,
  };
}

// ── Summary ────────────────────────────────────────────────────────────────

export function summarizeProject(components: LocalComponent[]): Record<string, any> {
  const typeCount: Record<string, number> = {};
  for (const comp of components) {
    typeCount[comp.componentType] = (typeCount[comp.componentType] || 0) + 1;
  }

  return {
    totalComponents: components.length,
    componentTypes: typeCount,
    components: components.map(c => ({
      name: c.name,
      type: c.componentType,
      cssClasses: c.cssClasses.size,
      hasTsx: !!c.tsxPath,
    })),
  };
}

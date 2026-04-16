/**
 * Component Generator CLI
 *
 * Extracts a component from a URL and generates a working React component
 * (.tsx + .module.css) that you can paste into your project.
 *
 * Usage:
 *   npx ts-node scripts/generate-component.ts <url> <component> [--output dir] [--name ComponentName]
 *
 * Examples:
 *   npx ts-node scripts/generate-component.ts https://linear.app header
 *   npx ts-node scripts/generate-component.ts https://stripe.com nav --name StripNav
 *   npx ts-node scripts/generate-component.ts https://vercel.com hero --output ./src/components
 */

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import {
  extractComponentStyles,
  captureComponentAnimations,
  COMPONENT_MAPPINGS,
  type ComponentStylesResult,
} from '../mcp/handlers/extract-component';
import { generateComponentCode, ScrollAnimation } from './adapters/component-codegen';
import { generateStorybookStory } from './adapters/storybook-codegen';
import { generateVueComponentCode } from './adapters/vue-codegen';
import { generateSvelteComponentCode } from './adapters/svelte-codegen';
import { loadBrandConfig, createColorMap, createFontMap, createContentMap, applyContentReplacements, transformStyleValue, BrandConfig } from '../brand/brand';
import { readDesignData } from './adapters/reader';
import { safeReadJSON, log } from '../core/utils';
import type { DistilledMotion, InteractionResult } from '../core/types';

// ── Types ───────────────────────────────────────────────────────────────────

type Framework = 'react' | 'vue' | 'svelte';

interface CLIOptions {
  url: string;
  component: string;
  outputDir: string;
  name?: string;
  storybook: boolean;
  framework: Framework;
  brandPath?: string;
}

// ── CLI Parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): CLIOptions {
  const positional: string[] = [];
  let outputDir = path.join(process.cwd(), 'output', 'components');
  let name: string | undefined;
  let storybook = false;
  let framework: Framework = 'react';
  let brandPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--output' && argv[i + 1]) {
      outputDir = argv[++i];
    } else if (arg === '--name' && argv[i + 1]) {
      name = argv[++i];
    } else if (arg === '--storybook') {
      storybook = true;
    } else if (arg === '--brand' && argv[i + 1]) {
      brandPath = argv[++i];
    } else if (arg === '--framework' && argv[i + 1]) {
      const fw = argv[++i].toLowerCase();
      if (fw === 'react' || fw === 'vue' || fw === 'svelte') {
        framework = fw;
      } else {
        log('Generate', 'error', `Unknown framework "${fw}". Supported: react, vue, svelte`);
        process.exit(1);
      }
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  return {
    url: positional[0] || '',
    component: positional[1] || '',
    outputDir,
    name,
    storybook,
    framework,
    brandPath,
  };
}

// ── Pipeline Data Enrichment ──────────────────────────────────────────────────

/**
 * If pipeline data exists, enrich animations with exact scroll ranges
 * and add link targets from interaction data.
 */
function enrichWithPipelineData(
  extraction: any,
  outputDir: string,
): void {
  // 1. Enrich scroll animations from motion-distilled.json
  const motion = safeReadJSON<DistilledMotion>(path.join(outputDir, 'motion-distilled.json'));
  if (motion?.animations) {
    const componentSelector = extraction.desktop_1440?.element?.selector || '';
    const componentChildren = (extraction.desktop_1440?.children || []).map((c: any) => c.selector);
    const allSelectors = new Set([componentSelector, ...componentChildren]);

    // Find animations that match this component's elements
    const pipelineScrollAnims: ScrollAnimation[] = [];
    for (const anim of motion.animations) {
      if (anim.trigger !== 'scroll-linked' && anim.trigger !== 'scroll-into-view') continue;

      // Match by selector overlap
      const animSelectors = anim.element.split(' + ');
      const matches = animSelectors.some(sel =>
        allSelectors.has(sel) || [...allSelectors].some(cs => sel.includes(cs) || cs.includes(sel))
      );
      if (!matches) continue;

      // Convert to ScrollAnimation format with correct from/to values
      const range = anim.scrollRange || { start: 0, end: 500 };
      const changes: Record<string, { from: string; to: string }> = {};
      for (const [prop, val] of Object.entries(anim.from || {})) {
        changes[prop] = { from: val, to: (anim.to || {})[prop] || val };
      }
      // Also include to-only properties
      for (const [prop, val] of Object.entries(anim.to || {})) {
        if (!changes[prop]) {
          changes[prop] = { from: (anim.from || {})[prop] || val, to: val };
        }
      }

      if (Object.keys(changes).length > 0) {
        // Create two keyframes: start and end of scroll range
        pipelineScrollAnims.push(
          { element: anim.element, scrollY: range.start, changes },
          { element: anim.element, scrollY: range.end, changes: Object.fromEntries(
            Object.entries(changes).map(([k, v]) => [k, { from: v.to, to: v.to }])
          )},
        );
      }
    }

    if (pipelineScrollAnims.length > 0) {
      log('Generate', 'info', `Enriched with ${pipelineScrollAnims.length / 2} scroll animations from pipeline data`);
      if (!extraction.animations) extraction.animations = {};
      extraction.animations.scroll = pipelineScrollAnims;
    }
  }

  // 2. Enrich link targets from interactions.json
  const interactions = safeReadJSON<InteractionResult>(path.join(outputDir, 'interactions.json'));
  if (interactions?.navigation) {
    const linkMap = new Map<string, string>();
    for (const link of [...interactions.navigation.internal, ...interactions.navigation.external]) {
      linkMap.set(link.text?.toLowerCase().trim(), link.href);
      linkMap.set(link.selector, link.href);
    }
    // Attach to extraction for codegen to use
    (extraction as any)._linkTargets = linkMap;
  }

  // 3. Enrich post-animation interactivity from scroll-interactions.json
  const scrollData = safeReadJSON<any>(path.join(outputDir, 'scroll-interactions.json'));
  if (scrollData?.animationInteractionLinks) {
    const producedInteractions: { selector: string; href?: string; text?: string }[] = [];
    for (const link of scrollData.animationInteractionLinks) {
      for (const produced of link.produces || []) {
        if (produced.interaction?.includes('link') || produced.interaction?.includes('button')) {
          producedInteractions.push({
            selector: produced.selector,
            text: produced.text,
            href: interactions?.navigation?.internal?.find(
              (n: any) => n.selector === produced.selector || n.text?.toLowerCase() === produced.text?.toLowerCase()
            )?.href,
          });
        }
      }
    }
    if (producedInteractions.length > 0) {
      (extraction as any)._producedInteractions = producedInteractions;
    }
  }
}

// ── Extraction (reuses extract-component.ts core functions) ─────────────────

async function extractComponent(url: string, component: string) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage();

    log('Generate', 'info', `Loading ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    log('Generate', 'info', `Extracting "${component}" styles...`);
    const result = await extractComponentStyles(page, component);
    if (!result) return null;

    log('Generate', 'info', `Capturing animations...`);
    const animations = await captureComponentAnimations(page, component);

    // Responsive breakpoints
    log('Generate', 'info', `Capturing responsive behavior...`);
    const breakpoints = [
      { name: '320', width: 320, height: 568 },
      { name: '375', width: 375, height: 812 },
      { name: '414', width: 414, height: 896 },
      { name: '768', width: 768, height: 1024 },
      { name: '1024', width: 1024, height: 768 },
      { name: '1280', width: 1280, height: 800 },
      { name: '1920', width: 1920, height: 1080 },
    ];

    const responsive: Record<string, Record<string, unknown>> = {};
    const desktopStyles = result.element?.styles || {};
    const desktopChildren = result.children || [];

    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.waitForTimeout(500);
      const bpResult = await extractComponentStyles(page, component);
      if (!bpResult) continue;

      const bpStyles = bpResult.element?.styles || {};
      const bpChildren = bpResult.children || [];

      const elementDiff: Record<string, Record<string, string>> = {};
      for (const key of new Set([...Object.keys(desktopStyles), ...Object.keys(bpStyles)])) {
        if (desktopStyles[key] !== bpStyles[key]) {
          elementDiff[key] = { desktop: desktopStyles[key] || 'unset', [`${bp.name}px`]: bpStyles[key] || 'unset' };
        }
      }

      const childDiffs: Record<string, unknown>[] = [];
      for (let i = 0; i < Math.min(desktopChildren.length, bpChildren.length); i++) {
        const dStyles = desktopChildren[i]?.styles || {};
        const bStyles = bpChildren[i]?.styles || {};
        const diff: Record<string, Record<string, string>> = {};
        for (const key of new Set([...Object.keys(dStyles), ...Object.keys(bStyles)])) {
          if (dStyles[key] !== bStyles[key]) diff[key] = { desktop: dStyles[key] || 'unset', [`${bp.name}px`]: bStyles[key] || 'unset' };
        }
        if (Object.keys(diff).length > 0) childDiffs.push({ tag: desktopChildren[i]?.tag, text: desktopChildren[i]?.text?.slice(0, 30), changes: diff });
      }

      if (Object.keys(elementDiff).length > 0 || childDiffs.length > 0) {
        responsive[`${bp.name}px`] = {
          element: Object.keys(elementDiff).length > 0 ? elementDiff : undefined,
          children: childDiffs.length > 0 ? childDiffs : undefined,
        };
      }
    }

    return {
      url,
      component,
      desktop_1440: result,
      animations,
      responsiveChanges: Object.keys(responsive).length > 0 ? responsive : 'No responsive changes detected',
    };
  } finally {
    await browser.close();
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.url || !opts.component) {
    log('Generate', 'error', 'Usage: npx ts-node scripts/generate-component.ts <url> <component> [--output dir] [--name Name] [--framework react|vue|svelte] [--storybook]');
    log('Generate', 'error', '');
    log('Generate', 'error', 'Components: header, nav, hero, footer, card, button, pricing, faq, or any CSS selector');
    log('Generate', 'error', '');
    log('Generate', 'error', 'Examples:');
    log('Generate', 'error', '  npx ts-node scripts/generate-component.ts https://linear.app header');
    log('Generate', 'error', '  npx ts-node scripts/generate-component.ts https://stripe.com pricing --name StripePricing');
    log('Generate', 'error', '  npx ts-node scripts/generate-component.ts https://vercel.com hero --framework vue');
    log('Generate', 'error', '  npx ts-node scripts/generate-component.ts https://vercel.com hero --framework svelte');
    log('Generate', 'error', '  npx ts-node scripts/generate-component.ts https://stripe.com hero --brand brand.json');
    process.exit(1);
  }

  // Load brand overrides if provided
  const brand = opts.brandPath ? loadBrandConfig(opts.brandPath) : undefined;
  if (opts.brandPath && !brand) {
    log('Generate', 'warn', `Warning: --brand specified but config could not be loaded from ${opts.brandPath}`);
  }
  if (brand) {
    log('Generate', 'info', `Brand overrides loaded from ${opts.brandPath}`);
  }

  // Extract
  const extraction = await extractComponent(opts.url, opts.component);
  if (!extraction || !extraction.desktop_1440) {
    log('Generate', 'error', `No component matching "${opts.component}" found on ${opts.url}`);
    process.exit(1);
  }

  // Enrich with pipeline data if available (better animations, link targets, interactivity)
  // Search common locations for pipeline output
  const pipelineCandidates = [
    opts.outputDir ? path.resolve(opts.outputDir, '..') : null, // parent of component output dir
    path.resolve(process.cwd(), 'output'),
    path.resolve(process.cwd(), 'test'),
  ].filter(Boolean) as string[];

  for (const candidateDir of pipelineCandidates) {
    if (fs.existsSync(path.join(candidateDir, 'motion-distilled.json'))) {
      log('Generate', 'info', `Found pipeline data in ${candidateDir}`);
      enrichWithPipelineData(extraction, candidateDir);
      break;
    }
  }

  // Apply brand overrides to extracted styles if brand config is loaded
  if (brand) {
    // Try to load design data for building color/font maps
    let colorMap = new Map<string, string>();
    let fontMap = new Map<string, string>();
    try {
      const outputDir = path.join(process.cwd(), 'output');
      const designData = readDesignData(outputDir);
      colorMap = createColorMap(designData, brand);
      fontMap = createFontMap(designData, brand);
    } catch {
      // No design data available — build maps from brand config directly
      if (brand.colors) {
        // Direct color replacements will be applied via transformStyleValue
      }
    }

    // Transform styles in the extraction data
    if (colorMap.size > 0 || fontMap.size > 0) {
      const transformStyles = (styles: Record<string, string>) => {
        for (const [prop, value] of Object.entries(styles)) {
          styles[prop] = transformStyleValue(prop, value, colorMap, fontMap);
        }
      };

      if (extraction.desktop_1440?.element?.styles) {
        transformStyles(extraction.desktop_1440.element.styles);
      }
      if (extraction.desktop_1440?.children) {
        for (const child of extraction.desktop_1440.children) {
          if (child?.styles) transformStyles(child.styles);
        }
      }
      log('Generate', 'info', `Applied brand color/font overrides (${colorMap.size} colors, ${fontMap.size} fonts)`);
    }

    // Apply content replacements (e.g., site name, headings)
    const contentMap = createContentMap(brand);
    if (contentMap.size > 0) {
      const replaceText = (el: { text?: string }) => {
        if (el.text) el.text = applyContentReplacements(el.text, contentMap);
      };

      if (extraction.desktop_1440?.element) replaceText(extraction.desktop_1440.element);
      if (extraction.desktop_1440?.children) {
        for (const child of extraction.desktop_1440.children) {
          if (child) replaceText(child);
        }
      }
      log('Generate', 'info', `Applied brand content replacements (${contentMap.size} entries)`);
    }
  }

  // Generate code based on framework
  const generatedFiles: string[] = [];
  fs.mkdirSync(opts.outputDir, { recursive: true });
  const ext = extraction as unknown as Parameters<typeof generateComponentCode>[0];

  if (opts.framework === 'vue') {
    log('Generate', 'info', `Generating Vue 3 component...`);
    const vueResult = generateVueComponentCode(ext as Parameters<typeof generateVueComponentCode>[0], opts.name);
    if (!vueResult) {
      log('Generate', 'error', `Code generation failed`);
      process.exit(1);
    }
    const componentName = opts.name || vueResult.componentName;
    const vuePath = path.join(opts.outputDir, `${componentName}.vue`);
    fs.writeFileSync(vuePath, vueResult.vue);
    generatedFiles.push(vuePath);
  } else if (opts.framework === 'svelte') {
    log('Generate', 'info', `Generating Svelte component...`);
    const svelteResult = generateSvelteComponentCode(ext as Parameters<typeof generateSvelteComponentCode>[0], opts.name);
    if (!svelteResult) {
      log('Generate', 'error', `Code generation failed`);
      process.exit(1);
    }
    const componentName = opts.name || svelteResult.componentName;
    const sveltePath = path.join(opts.outputDir, `${componentName}.svelte`);
    fs.writeFileSync(sveltePath, svelteResult.svelte);
    generatedFiles.push(sveltePath);
  } else {
    // React (default)
    log('Generate', 'info', `Generating React component...`);
    const result = generateComponentCode(ext);
    if (!result) {
      log('Generate', 'error', `Code generation failed`);
      process.exit(1);
    }

    const componentName = opts.name || result.componentName;
    const tsx = opts.name ? result.tsx.replace(new RegExp(result.componentName, 'g'), opts.name) : result.tsx;
    const css = result.css;

    const tsxPath = path.join(opts.outputDir, `${componentName}.tsx`);
    const cssPath = path.join(opts.outputDir, `${componentName}.module.css`);

    fs.writeFileSync(tsxPath, tsx);
    fs.writeFileSync(cssPath, css);
    generatedFiles.push(tsxPath, cssPath);

    // Generate Storybook story if requested (React only)
    if (opts.storybook) {
      const hasHoverStates = !!(extraction.animations?.hover && extraction.animations.hover.length > 0);
      const hasAnimations = !!(extraction.animations?.scroll && extraction.animations.scroll.length > 0);
      const storyContent = generateStorybookStory(componentName, opts.url, hasHoverStates, hasAnimations);
      const storyPath = path.join(opts.outputDir, `${componentName}.stories.tsx`);
      fs.writeFileSync(storyPath, storyContent);
      generatedFiles.push(storyPath);
    }
  }

  log('Generate', 'info', `Done!`);
  for (const f of generatedFiles) {
    log('Generate', 'info', `  ${f}`);
  }
  log('Generate', 'info', `Paste the generated file(s) into your project and import the component.`);
}

export { extractComponent, generateComponentCode };

if (require.main === module) {
  main().catch((err) => {
    log('Generate', 'error', `Error: ${err}`);
    process.exit(1);
  });
}

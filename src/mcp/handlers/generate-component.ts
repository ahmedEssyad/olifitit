import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import {
  extractComponentStyles,
  captureComponentAnimations,
  type ComponentStylesResult,
} from './extract-component';
import { generateComponentCode, ScrollAnimation } from '../../export/adapters/component-codegen';
import type { ExtractedElement, HoverAnimation } from '../../export/adapters/codegen-shared';
import { generateVueComponentCode } from '../../export/adapters/vue-codegen';
import { generateSvelteComponentCode } from '../../export/adapters/svelte-codegen';
import { textResponse, validateArgs, validateToolUrl, withNextSteps } from '../helpers';
import { GenerateComponentInput } from '../schemas';
import { BrandConfig, createColorMap, createFontMap, transformStyleValue } from '../../brand/brand';
import { readDesignData } from '../../export/adapters/reader';
import { safeReadJSON } from '../../core/utils';
import type { DistilledMotion, InteractionResult } from '../../core/types';

export async function handleGenerateComponent(rawArgs: unknown) {
  const args = validateArgs(GenerateComponentInput, rawArgs);
  validateToolUrl(args.url);
  const { url, component, name, framework = 'react' } = args;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Extract styles
    const result = await extractComponentStyles(page, component);
    if (!result) {
      return textResponse(`No component matching "${component}" found on ${url}. Try a different name or CSS selector.`);
    }

    // Capture animations
    const animations = await captureComponentAnimations(page, component);

    // Responsive diffs
    const breakpoints = [
      { name: '320', width: 320, height: 568 },
      { name: '768', width: 768, height: 1024 },
      { name: '1024', width: 1024, height: 768 },
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
        const diff: Record<string, any> = {};
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

    const extraction = {
      url,
      component,
      desktop_1440: result as ComponentStylesResult | null,
      animations: animations as { hover?: HoverAnimation[]; scroll?: ScrollAnimation[] },
      responsiveChanges: (Object.keys(responsive).length > 0 ? responsive : 'No responsive changes detected') as Record<string, unknown> | string,
      _linkTargets: undefined as Map<string, string> | undefined,
      _producedInteractions: undefined as { selector: string; href?: string; text?: string }[] | undefined,
    };

    // Enrich with pipeline data if available
    const pipelineCandidates = [
      path.resolve(process.cwd(), 'output'),
      path.resolve(process.cwd(), 'test'),
    ];
    for (const dir of pipelineCandidates) {
      const motionPath = path.join(dir, 'motion-distilled.json');
      if (fs.existsSync(motionPath)) {
        const motion = safeReadJSON<DistilledMotion>(motionPath);
        if (motion?.animations) {
          const componentChildren = (result.children || []).map((c) => c.classes || '');
          const pipelineScrollAnims: ScrollAnimation[] = [];
          for (const anim of motion.animations) {
            if (anim.trigger !== 'scroll-linked' && anim.trigger !== 'scroll-into-view') continue;
            const range = anim.scrollRange || { start: 0, end: 500 };
            const changes: Record<string, { from: string; to: string }> = {};
            for (const [prop, val] of Object.entries(anim.from || {})) {
              changes[prop] = { from: val, to: (anim.to || {})[prop] || val };
            }
            for (const [prop, val] of Object.entries(anim.to || {})) {
              if (!changes[prop]) changes[prop] = { from: (anim.from || {})[prop] || val, to: val };
            }
            if (Object.keys(changes).length > 0) {
              pipelineScrollAnims.push(
                { element: anim.element, scrollY: range.start, changes },
                { element: anim.element, scrollY: range.end, changes: Object.fromEntries(
                  Object.entries(changes).map(([k, v]) => [k, { from: v.to, to: v.to }])
                )},
              );
            }
          }
          if (pipelineScrollAnims.length > 0) {
            extraction.animations = { ...extraction.animations, scroll: pipelineScrollAnims };
          }
        }

        // Link targets
        const interactions = safeReadJSON<InteractionResult>(path.join(dir, 'interactions.json'));
        if (interactions?.navigation) {
          const linkMap = new Map<string, string>();
          for (const link of [...interactions.navigation.internal, ...interactions.navigation.external]) {
            linkMap.set(link.text?.toLowerCase().trim(), link.href);
          }
          extraction._linkTargets = linkMap;
        }
        break;
      }
    }

    // Apply brand overrides if provided
    if (args.brand) {
      const brandConfig = args.brand as BrandConfig;
      let colorMap = new Map<string, string>();
      let fontMap = new Map<string, string>();

      try {
        const outputDir = path.join(process.cwd(), 'output');
        const designData = readDesignData(outputDir);
        colorMap = createColorMap(designData, brandConfig);
        fontMap = createFontMap(designData, brandConfig);
      } catch {
        // No design data available — maps stay empty
      }

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
      }
    }

    // Generate code based on framework
    const ext = extraction as unknown as Parameters<typeof generateComponentCode>[0];
    if (framework === 'vue') {
      const vueResult = generateVueComponentCode(ext as Parameters<typeof generateVueComponentCode>[0], name);
      if (!vueResult) {
        return textResponse(`Code generation failed for "${component}" on ${url}.`);
      }
      const componentName = name || vueResult.componentName;
      return withNextSteps({
        componentName,
        framework: 'vue',
        files: {
          [`${componentName}.vue`]: vueResult.vue,
        },
      }, ["Run match_component to compare this with your existing CSS", "Run generate_component for another component from the same site"]);
    }

    if (framework === 'svelte') {
      const svelteResult = generateSvelteComponentCode(ext as Parameters<typeof generateSvelteComponentCode>[0], name);
      if (!svelteResult) {
        return textResponse(`Code generation failed for "${component}" on ${url}.`);
      }
      const componentName = name || svelteResult.componentName;
      return withNextSteps({
        componentName,
        framework: 'svelte',
        files: {
          [`${componentName}.svelte`]: svelteResult.svelte,
        },
      }, ["Run match_component to compare this with your existing CSS", "Run generate_component for another component from the same site"]);
    }

    // React (default)
    const generated = generateComponentCode(ext);
    if (!generated) {
      return textResponse(`Code generation failed for "${component}" on ${url}.`);
    }

    const componentName = name || generated.componentName;
    const tsx = name ? generated.tsx.replace(new RegExp(generated.componentName, 'g'), name) : generated.tsx;
    const cssModule = name ? generated.css.replace(new RegExp(generated.componentName, 'g'), name) : generated.css;

    return withNextSteps({
      componentName,
      framework: 'react',
      files: {
        [`${componentName}.tsx`]: tsx,
        [`${componentName}.module.css`]: cssModule,
      },
    }, ["Run match_component to compare this with your existing CSS", "Run generate_component for another component from the same site"]);
  } finally {
    await browser.close();
  }
}

import { chromium } from 'playwright';
import {
  extractComponentStyles,
  captureComponentAnimations,
} from './extract-component';
import type { ExtractedElement } from '../../export/adapters/codegen-shared';
import {
  parseCssModule,
  matchClasses,
  diffStyles,
  generateDiffReport,
  applyPatch,
} from '../../export/adapters/component-differ';
import { textResponse, validateArgs, validateToolUrl, withNextSteps } from '../helpers';
import { MatchComponentInput } from '../schemas';

export async function handleMatchComponent(rawArgs: unknown) {
  const args = validateArgs(MatchComponentInput, rawArgs);
  validateToolUrl(args.url);
  const { url, component, css_content: cssContent, class_map: classMap } = args;

  // Parse user's CSS
  const userClasses = parseCssModule(cssContent);

  // Extract target
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const result = await extractComponentStyles(page, component);
    if (!result) {
      return textResponse(`No component matching "${component}" found on ${url}.`);
    }

    const animations = await captureComponentAnimations(page, component);

    // Match + diff
    const mappings = matchClasses(userClasses, result.element as ExtractedElement, (result.children || []) as ExtractedElement[], classMap);
    const diffResult = diffStyles(userClasses, mappings, animations?.hover);
    const report = generateDiffReport(diffResult, 'your-file.module.css', url, component);
    const patchedCss = applyPatch(cssContent, diffResult);

    return withNextSteps({
      report,
      patchedCss,
      matchedClasses: mappings.map(m => ({
        userClass: m.userClass,
        targetLabel: m.targetLabel,
        targetTag: m.targetElement.tag,
        confidence: m.confidence,
        method: m.matchMethod,
      })),
      summary: {
        changes: diffResult.diffs.reduce((s, d) => s + d.entries.filter(e => e.type === 'CHANGE').length, 0),
        additions: diffResult.diffs.reduce((s, d) => s + d.entries.filter(e => e.type === 'ADD').length, 0),
        removals: diffResult.diffs.reduce((s, d) => s + d.entries.filter(e => e.type === 'REMOVE').length, 0),
        unmatchedClasses: diffResult.unmatchedUserClasses,
      },
    }, ["Apply the patched CSS file to your component", "Adjust class_map parameter for better matching if needed"]);
  } finally {
    await browser.close();
  }
}

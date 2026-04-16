import { chromium } from 'playwright';
import { textResponse, validateArgs, validateToolUrl, withNextSteps } from '../helpers';
import { GetDesignTokensInput } from '../schemas';

export async function handleGetDesignTokens(rawArgs: unknown) {
  const args = validateArgs(GetDesignTokensInput, rawArgs);
  validateToolUrl(args.url);
  const { url } = args;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const tokens = await page.evaluate(() => {
      const colorSet = new Set<string>();
      const fontSet = new Set<string>();
      const fontSizeSet = new Set<string>();
      const spacingSet = new Set<string>();
      const radiusSet = new Set<string>();
      const shadowSet = new Set<string>();

      const sampled = Array.from(document.querySelectorAll('*')).slice(0, 500);

      for (const el of sampled) {
        const cs = window.getComputedStyle(el);
        if (cs.color && cs.color !== 'rgba(0, 0, 0, 0)') colorSet.add(cs.color);
        if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') colorSet.add(cs.backgroundColor);
        if (cs.borderColor && cs.borderColor !== 'rgb(0, 0, 0)') colorSet.add(cs.borderColor);
        if (cs.fontFamily) fontSet.add(cs.fontFamily);
        if (cs.fontSize) fontSizeSet.add(cs.fontSize);
        for (const prop of ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'gap'] as const) {
          const val = cs.getPropertyValue(prop.replace(/([A-Z])/g, '-$1').toLowerCase());
          if (val && val !== '0px' && val !== 'normal') spacingSet.add(val);
        }
        if (cs.borderRadius && cs.borderRadius !== '0px') radiusSet.add(cs.borderRadius);
        if (cs.boxShadow && cs.boxShadow !== 'none') shadowSet.add(cs.boxShadow);
      }

      const customProps: Record<string, string> = {};
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules)) {
            if (rule instanceof CSSStyleRule && (rule.selectorText === ':root' || rule.selectorText === 'body')) {
              for (let i = 0; i < rule.style.length; i++) {
                const prop = rule.style[i];
                if (prop.startsWith('--')) customProps[prop] = rule.style.getPropertyValue(prop).trim();
              }
            }
          }
        } catch { /* cross-origin stylesheet access restricted by browser security policy */ }
      }

      return {
        colors: {
          palette: Array.from(colorSet).sort(),
          cssVariables: Object.keys(customProps).length > 0 ? customProps : undefined,
          bodyBackground: window.getComputedStyle(document.body).backgroundColor,
        },
        typography: {
          fontFamilies: Array.from(fontSet),
          fontSizes: Array.from(fontSizeSet).sort((a, b) => parseFloat(a) - parseFloat(b)),
        },
        spacing: { values: Array.from(spacingSet).sort((a, b) => parseFloat(a) - parseFloat(b)) },
        borderRadius: Array.from(radiusSet).sort((a, b) => parseFloat(a) - parseFloat(b)),
        shadows: Array.from(shadowSet),
      };
    });

    return withNextSteps({ url, tokens }, ["Run extract_design_system for a full extraction with components and animations", "Run export_tokens to generate framework config files from these tokens"]);
  } finally {
    await browser.close();
  }
}

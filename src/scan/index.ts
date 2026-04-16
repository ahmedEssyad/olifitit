/**
 * Scanner — main entry point.
 *
 * Extracts complete DOM, computed styles, screenshots at multiple breakpoints,
 * fonts, images, colors, typography, spacing, animations, interaction states,
 * API calls (XHR/fetch), login wall detection. Supports multi-page crawling,
 * auth, cookie consent dismissal, lazy content loading.
 *
 * Usage (programmatic):
 *   import { scan } from './scan';
 *   await scan('https://example.com', './output');
 *
 * Usage (CLI):
 *   npx ts-node scripts/scan/cli.ts <url> [output-dir] [--crawl]
 */

import * as fs from 'fs';
import * as path from 'path';
import { withBrowser, withRetry, log } from '../core/utils';
import { config } from '../core/config';

import { CLIOptions, ScanResult, ResponsiveSnapshot, AssetInfo, LinkTag } from './types';
import { dismissCookieConsent } from './cookies';
import { triggerLazyContent } from './lazy-content';
import { extractAllElements } from './elements';
import { captureInteractionStates } from './interactions';
import { extractAnimationsFromCSS } from './animations';

// Re-export types and sub-modules for external consumers
export { scan, crawl };
export type { ScanResult, CLIOptions, ElementData, ResponsiveSnapshot, AssetInfo, LinkTag, SiteMap } from './types';
export { escapeClassToken, generateStableSelector } from './selectors';
export { dismissCookieConsent } from './cookies';
export { triggerLazyContent } from './lazy-content';
export { discoverLinks, urlToSlug } from './crawl';
export { extractAllElements } from './elements';
export { captureInteractionStates } from './interactions';
export { extractAnimationsFromCSS } from './animations';

const BREAKPOINTS = config.browser.breakpoints;
const VIEWPORT_HEIGHT = config.browser.viewportHeight;
const STYLE_PROPERTIES = config.scan.styleProperties;

/**
 * Retry a page.evaluate call if the execution context was destroyed
 * (e.g., by a client-side navigation/redirect). Waits for the page to settle
 * before retrying.
 */
async function safeEvaluate<T>(page: any, fn: (...args: any[]) => T, arg?: any, retries = 2): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return arg !== undefined ? await page.evaluate(fn, arg) : await page.evaluate(fn);
    } catch (err: any) {
      const msg = err?.message || '';
      if (attempt < retries && (msg.includes('Execution context was destroyed') || msg.includes('navigating'))) {
        log('Scanner', 'warn', `Context destroyed during evaluate — waiting for page to settle (attempt ${attempt + 1}/${retries})...`);
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1000);
        continue;
      }
      throw err;
    }
  }
  throw new Error('safeEvaluate exhausted retries');
}

// ── Main Scanner ───────────────────────────────────────────────────────────────

async function scan(url: string, outputDir: string, options?: Partial<CLIOptions>): Promise<ScanResult> {
  const screenshotDir = path.join(outputDir, 'screenshots');
  const assetsDir = path.join(outputDir, 'assets');
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });

  return withBrowser(async (browser) => {
  // Build context options with optional auth
  const contextOptions: any = {
    viewport: { width: 1440, height: VIEWPORT_HEIGHT },
    deviceScaleFactor: 2,
  };

  if (options?.authHeader) {
    const [key, ...valueParts] = options.authHeader.split(':');
    contextOptions.extraHTTPHeaders = { [key.trim()]: valueParts.join(':').trim() };
  }

  const context = await browser.newContext(contextOptions);

  // Set auth cookies before navigation
  if (options?.authCookie) {
    const cookies = options.authCookie.split(';').map(c => {
      const [name, ...vParts] = c.trim().split('=');
      const parsed = new URL(url);
      return {
        name: name.trim(),
        value: vParts.join('=').trim(),
        domain: parsed.hostname,
        path: '/',
      };
    });
    await context.addCookies(cookies);
  }

  // Intercept network to capture assets
  const assets: AssetInfo[] = [];
  const apiCalls: { url: string; method: string; status: number; contentType: string; bodyPreview: string; timestamp: number }[] = [];
  const cssContents: { url: string; content: string }[] = [];

  const page = await context.newPage();

  // Capture all network responses for assets
  page.on('response', async (response) => {
    const resUrl = response.url();
    const contentType = response.headers()['content-type'] || '';
    try {
      if (contentType.includes('text/css') || resUrl.endsWith('.css')) {
        const text = await response.text();
        cssContents.push({ url: resUrl, content: text });
        assets.push({ type: 'css', url: resUrl });
      } else if (contentType.includes('font') || resUrl.match(/\.(woff2?|ttf|otf|eot)(\?|$)/)) {
        const buffer = await response.body();
        const filename = `font_${assets.length}_${path.basename(resUrl).split('?')[0]}`;
        const localPath = path.join(assetsDir, filename);
        fs.writeFileSync(localPath, buffer);
        assets.push({ type: 'font', url: resUrl, localPath, mimeType: contentType });
      } else if (contentType.includes('image/svg') || resUrl.endsWith('.svg')) {
        const text = await response.text();
        const filename = `svg_${assets.length}.svg`;
        const localPath = path.join(assetsDir, filename);
        fs.writeFileSync(localPath, text);
        assets.push({ type: 'svg', url: resUrl, localPath, mimeType: contentType });
      } else if (contentType.includes('image/')) {
        const buffer = await response.body();
        const ext = contentType.split('/')[1]?.split(';')[0] || 'png';
        const filename = `img_${assets.length}.${ext}`;
        const localPath = path.join(assetsDir, filename);
        fs.writeFileSync(localPath, buffer);
        assets.push({ type: 'image', url: resUrl, localPath, mimeType: contentType });
      } else if (contentType.includes('video/')) {
        assets.push({ type: 'video', url: resUrl, mimeType: contentType });
      }
      // Capture XHR/fetch API calls
      const resourceType = response.request().resourceType();
      if (resourceType === 'xhr' || resourceType === 'fetch') {
        try {
          const body = await response.text().catch(() => '');
          apiCalls.push({
            url: resUrl,
            method: response.request().method(),
            status: response.status(),
            contentType,
            bodyPreview: body.slice(0, 500),
            timestamp: Date.now(),
          });
        } catch (e) { log('Scanner', 'debug', `Response body unreadable: ${(e as Error).message}`); }
      }
    } catch (e) {
      log('Scanner', 'debug', `Response processing failed: ${(e as Error).message}`);
    }
  });

  log('Scanner', 'info', `Loading ${url}...`);
  await withRetry(() => page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }), { label: 'page.goto', retries: 2 });
  await page.waitForTimeout(2000); // allow late-loading content

  // Wait for any client-side redirects to settle
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
  } catch {
    // Already loaded — safe to continue
  }

  // Detect login walls
  const authDetection = await safeEvaluate(page, () => {
    const indicators: string[] = [];
    if (document.querySelector('input[type="password"]')) indicators.push('password-field-present');
    const url = window.location.href.toLowerCase();
    if (url.includes('login') || url.includes('signin') || url.includes('/auth')) indicators.push('auth-url-detected');
    const bodyText = document.body?.innerText?.toLowerCase() || '';
    if (bodyText.includes('sign in') || bodyText.includes('log in')) {
      if (document.querySelectorAll('input').length <= 5) indicators.push('login-form-likely');
    }
    return { detected: indicators.length > 0, indicators };
  });

  // ── Dismiss cookie consent ──
  try {
    await dismissCookieConsent(page);
  } catch (err: any) {
    log('Scanner', 'warn', `Cookie dismissal failed: ${err.message}`);
  }

  // ── Trigger lazy-loaded content ──
  try {
    await triggerLazyContent(page);
  } catch (err: any) {
    log('Scanner', 'warn', `Lazy content trigger failed: ${err.message}`);
  }

  // ── Wait for page to fully settle after interactions ──
  // Some sites redirect after cookie consent or trigger client-side navigation
  try {
    await page.waitForLoadState('networkidle', { timeout: 10000 });
  } catch {
    // Timeout is fine — page may already be idle
  }
  try {
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 });
  } catch {
    // Best effort
  }
  await page.waitForTimeout(500);

  // ── Page metadata ──
  const pageTitle = await page.title();
  const pageMetadata = await safeEvaluate(page, () => {
    const metas: Record<string, string> = {};
    document.querySelectorAll('meta').forEach((meta) => {
      const name = meta.getAttribute('name') || meta.getAttribute('property') || '';
      const content = meta.getAttribute('content') || '';
      if (name && content) metas[name] = content;
    });
    metas['charset'] = document.characterSet;
    metas['lang'] = document.documentElement.lang || '';
    metas['doctype'] = document.doctype ? `<!DOCTYPE ${document.doctype.name}>` : '';
    return metas;
  });

  // ── Extract link tags (favicon, apple-touch-icon, etc.) ──
  const linkTags: LinkTag[] = await safeEvaluate(page, () => {
    const links: { rel: string; href: string; sizes?: string; type?: string }[] = [];
    document.querySelectorAll('link').forEach((link) => {
      const rel = link.getAttribute('rel') || '';
      const href = link.getAttribute('href') || '';
      if (rel && href) {
        links.push({
          rel,
          href,
          sizes: link.getAttribute('sizes') || undefined,
          type: link.getAttribute('type') || undefined,
        });
      }
    });
    return links;
  });

  // Download favicons
  const faviconRels = ['icon', 'shortcut icon', 'apple-touch-icon', 'apple-touch-icon-precomposed'];
  const faviconLinks = linkTags.filter(lt => faviconRels.includes(lt.rel.toLowerCase()));

  // Also try /favicon.ico if no explicit favicon link tag
  if (faviconLinks.length === 0) {
    const parsed = new URL(url);
    faviconLinks.push({ rel: 'icon', href: `${parsed.origin}/favicon.ico` });
  }

  for (const fav of faviconLinks) {
    try {
      const faviconUrl = fav.href.startsWith('http') ? fav.href : new URL(fav.href, url).href;
      const response = await page.context().request.get(faviconUrl);
      if (response.ok()) {
        const buffer = await response.body();
        const contentType = response.headers()['content-type'] || '';
        const ext = faviconUrl.endsWith('.svg') ? 'svg'
          : faviconUrl.endsWith('.png') ? 'png'
          : faviconUrl.endsWith('.ico') ? 'ico'
          : contentType.includes('svg') ? 'svg'
          : contentType.includes('png') ? 'png'
          : contentType.includes('icon') ? 'ico'
          : 'ico';
        const filename = `favicon_${assets.length}.${ext}`;
        const localPath = path.join(assetsDir, filename);
        fs.writeFileSync(localPath, buffer);
        assets.push({ type: 'favicon', url: faviconUrl, localPath, mimeType: contentType, faviconRel: fav.rel });
        log('Scanner', 'info', `Captured favicon: ${fav.rel} (${ext})`);
      }
    } catch (e) {
      log('Scanner', 'debug', `Favicon download failed for ${fav.href}: ${(e as Error).message}`);
    }
  }

  // ── Extract inline styles and <style> tags ──
  const inlineStyles = await safeEvaluate(page, () => {
    const styles: { url: string; content: string }[] = [];
    document.querySelectorAll('style').forEach((style, i) => {
      styles.push({ url: `inline-style-${i}`, content: style.textContent || '' });
    });
    return styles;
  });
  cssContents.push(...inlineStyles);

  // ── Full DOM extraction with computed styles ──
  log('Scanner', 'info', 'Extracting DOM and computed styles...');
  let domTree;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      domTree = await extractAllElements(page);
      break;
    } catch (err: any) {
      const msg = err?.message || '';
      if (attempt < 2 && (msg.includes('Execution context was destroyed') || msg.includes('navigating'))) {
        log('Scanner', 'warn', `DOM extraction context destroyed — re-navigating (attempt ${attempt + 1}/2)...`);
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(2000);
        continue;
      }
      throw err;
    }
  }
  if (!domTree) throw new Error('DOM extraction failed after retries');
  log('Scanner', 'info', `Extracted ${domTree.length} elements`);

  // ── Capture interaction states for interactive elements ──
  log('Scanner', 'info', 'Capturing interaction states...');
  const interactiveElements = domTree.filter(e => e.isInteractive);
  const maxInteractive = 50;
  for (const elem of interactiveElements.slice(0, maxInteractive)) {
    try {
      // Per-element timeout to prevent hangs on non-interactable elements
      const statePromise = captureInteractionStates(page, elem.selector);
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
      const result = await Promise.race([statePromise, timeoutPromise]);
      if (result) elem.interactionStates = result;
    } catch (e) {
      log('Scanner', 'debug', `Interaction capture failed for ${elem.selector}: ${(e as Error).message}`);
    }
  }
  log('Scanner', 'info', `Captured interaction states for ${Math.min(interactiveElements.length, maxInteractive)} elements`);

  // ── Responsive snapshots ──
  log('Scanner', 'info', 'Capturing responsive snapshots...');
  const responsiveSnapshots: ResponsiveSnapshot[] = [];

  // Build reference map from 1440px DOM extraction for diffing
  const referenceStyles = new Map<string, Record<string, string>>();
  for (const el of domTree) {
    // Extract only the layout props from the full computed styles
    const layoutStyles: Record<string, string> = {};
    const layoutProps = ['display', 'width', 'height', 'flexDirection', 'flexWrap',
      'gridTemplateColumns', 'gridTemplateRows', 'fontSize', 'padding',
      'margin', 'gap', 'position', 'visibility', 'order'];
    for (const prop of layoutProps) {
      if (el.computedStyles[prop]) layoutStyles[prop] = el.computedStyles[prop];
    }
    referenceStyles.set(el.selector, layoutStyles);
  }

  for (const bp of BREAKPOINTS) {
    log('Scanner', 'info', `  Breakpoint: ${bp}px`);
    await page.setViewportSize({ width: bp, height: VIEWPORT_HEIGHT });
    await page.waitForTimeout(500);

    const screenshotPath = path.join(screenshotDir, `viewport-${bp}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const bpElements = await page.evaluate((_unused: string[]) => {
      const results: { selector: string; boundingBox: any; computedStyles: Record<string, string> }[] = [];
      const allEls = document.querySelectorAll('*');
      const layoutProps = ['display', 'width', 'height', 'flexDirection', 'flexWrap',
        'gridTemplateColumns', 'gridTemplateRows', 'fontSize', 'padding',
        'margin', 'gap', 'position', 'visibility', 'order'];
      for (let i = 0; i < Math.min(allEls.length, 5000); i++) {
        const el = allEls[i];
        const computed = window.getComputedStyle(el);
        const styles: Record<string, string> = {};
        for (const prop of layoutProps) {
          styles[prop] = computed.getPropertyValue(
            prop.replace(/([A-Z])/g, '-$1').toLowerCase()
          );
        }
        const rect = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        const id = el.id;
        const cls = Array.from(el.classList).filter(c => c && !/^[0-9]/.test(c)).slice(0, 3);

        // Stable selector for responsive snapshots
        let selector = '';
        if (id) {
          selector = `#${id}`;
        } else if (cls.length > 0) {
          selector = `${tag}.${cls.join('.')}`;
        } else {
          const parent = el.parentElement;
          if (parent) {
            const parentTag = parent.tagName.toLowerCase();
            const parentId = parent.id;
            const parentCls = Array.from(parent.classList).filter(c => c && !/^[0-9]/.test(c)).slice(0, 2);
            const parentSel = parentId ? `#${parentId}` : parentCls.length ? `${parentTag}.${parentCls.join('.')}` : '';
            if (parentSel) {
              const siblings = Array.from(parent.children).filter(s => s.tagName === el.tagName);
              if (siblings.length > 1) {
                selector = `${parentSel} > ${tag}:nth-of-type(${siblings.indexOf(el) + 1})`;
              } else {
                selector = `${parentSel} > ${tag}`;
              }
            }
          }
          if (!selector) selector = `${tag}[${i}]`;
        }

        results.push({
          selector,
          boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          computedStyles: styles,
        });
      }
      return results;
    }, STYLE_PROPERTIES);

    // Only store elements with style differences from 1440px reference
    const diffs = bpElements.filter(el => {
      const ref = referenceStyles.get(el.selector);
      if (!ref) return true; // new element at this breakpoint, keep it
      for (const [prop, val] of Object.entries(el.computedStyles)) {
        if (ref[prop] !== val) return true;
      }
      return false; // all styles match reference, skip
    });

    log('Scanner', 'info', `  Breakpoint: ${bp}px — ${diffs.length} changed elements (of ${bpElements.length})`);

    responsiveSnapshots.push({
      breakpoint: bp,
      screenshotPath,
      elements: diffs,
    });
  }

  // Reset viewport
  await page.setViewportSize({ width: 1440, height: VIEWPORT_HEIGHT });
  await page.waitForTimeout(500);

  // ── Extract unique colors ──
  log('Scanner', 'info', 'Extracting color palette...');
  const colorPalette = await safeEvaluate(page, () => {
    const colors = new Set<string>();
    const allEls = document.querySelectorAll('*');
    for (let i = 0; i < allEls.length; i++) {
      const computed = window.getComputedStyle(allEls[i]);
      [
        computed.color, computed.backgroundColor,
        computed.borderTopColor, computed.borderRightColor,
        computed.borderBottomColor, computed.borderLeftColor,
        computed.outlineColor, computed.textDecorationColor,
        computed.caretColor, computed.accentColor,
        computed.boxShadow, computed.textShadow,
      ].forEach(v => {
        if (v && v !== 'none' && v !== 'currentcolor') {
          const matches = v.match(/rgba?\([^)]+\)/g);
          if (matches) matches.forEach(m => colors.add(m));
          else if (v.startsWith('#') || v.startsWith('rgb')) colors.add(v);
        }
      });
    }
    return Array.from(colors);
  });

  // ── Extract typography map ──
  log('Scanner', 'info', 'Extracting typography...');
  const typographyMap = await safeEvaluate(page, () => {
    const typeMap = new Map<string, { fontFamily: string; fontSize: string; fontWeight: string; lineHeight: string; count: number; selector: string }>();
    const allEls = document.querySelectorAll('*');
    for (let i = 0; i < allEls.length; i++) {
      const el = allEls[i];
      const computed = window.getComputedStyle(el);
      if (!el.textContent?.trim()) continue;
      const key = `${computed.fontFamily}|${computed.fontSize}|${computed.fontWeight}|${computed.lineHeight}`;
      const existing = typeMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        const tag = el.tagName.toLowerCase();
        const id = el.id;
        const cls = Array.from(el.classList).slice(0, 2).join('.');
        typeMap.set(key, {
          fontFamily: computed.fontFamily,
          fontSize: computed.fontSize,
          fontWeight: computed.fontWeight,
          lineHeight: computed.lineHeight,
          count: 1,
          selector: id ? `#${id}` : cls ? `${tag}.${cls}` : tag,
        });
      }
    }
    return Array.from(typeMap.values()).sort((a, b) => b.count - a.count);
  });

  // ── Extract spacing values ──
  log('Scanner', 'info', 'Extracting spacing values...');
  const spacingValues = await safeEvaluate(page, () => {
    const values = new Set<string>();
    const allEls = document.querySelectorAll('*');
    const spacingProps = [
      'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'gap', 'rowGap', 'columnGap',
      'top', 'right', 'bottom', 'left',
    ];
    for (let i = 0; i < allEls.length; i++) {
      const computed = window.getComputedStyle(allEls[i]);
      for (const prop of spacingProps) {
        const val = computed.getPropertyValue(prop.replace(/([A-Z])/g, '-$1').toLowerCase());
        if (val && val !== '0px' && val !== 'auto' && val !== 'normal') {
          values.add(val);
        }
      }
    }
    return Array.from(values).sort((a, b) => parseFloat(a) - parseFloat(b));
  });

  // ── Extract unique opacity values ──
  log('Scanner', 'info', 'Extracting opacity scale...');
  const opacityScale = await safeEvaluate(page, () => {
    const values = new Set<string>();
    const allEls = document.querySelectorAll('*');
    for (let i = 0; i < allEls.length; i++) {
      const computed = window.getComputedStyle(allEls[i]);
      const opacity = computed.opacity;
      if (opacity) values.add(opacity);
    }
    return Array.from(values).sort((a, b) => parseFloat(a) - parseFloat(b));
  });

  // ── Extract CSS custom properties from stylesheets and :root ──
  log('Scanner', 'info', 'Extracting CSS custom properties...');
  const cssCustomProperties = await safeEvaluate(page, (stylesheets: { url: string; content: string }[]) => {
    const props: { name: string; value: string; source: string }[] = [];
    const seen = new Set<string>();

    // Extract from computed :root styles
    const rootEl = document.documentElement;
    const rootStyles = window.getComputedStyle(rootEl);
    // getComputedStyle doesn't enumerate custom properties, so parse stylesheets

    // Parse all stylesheet contents for custom property declarations
    for (const sheet of stylesheets) {
      const regex = /(--[\w-]+)\s*:\s*([^;]+)/g;
      let match;
      while ((match = regex.exec(sheet.content)) !== null) {
        const name = match[1];
        const value = match[2].trim();
        const key = `${name}::${value}`;
        if (!seen.has(key)) {
          seen.add(key);
          props.push({ name, value, source: sheet.url });
        }
      }
    }

    // Also extract from inline element styles
    const allEls = document.querySelectorAll('[style]');
    for (let i = 0; i < allEls.length; i++) {
      const style = allEls[i].getAttribute('style') || '';
      const regex = /(--[\w-]+)\s*:\s*([^;]+)/g;
      let match;
      while ((match = regex.exec(style)) !== null) {
        const name = match[1];
        const value = match[2].trim();
        const key = `${name}::${value}`;
        if (!seen.has(key)) {
          seen.add(key);
          props.push({ name, value, source: 'inline-style' });
        }
      }
    }

    return props;
  }, cssContents);

  // ── Extract aspect-ratio usage ──
  log('Scanner', 'info', 'Extracting aspect ratios...');
  const aspectRatios = await safeEvaluate(page, () => {
    const results: { selector: string; value: string }[] = [];
    const allEls = document.querySelectorAll('*');
    for (let i = 0; i < allEls.length; i++) {
      const el = allEls[i];
      const computed = window.getComputedStyle(el);
      const ar = computed.getPropertyValue('aspect-ratio');
      if (ar && ar !== 'auto') {
        const tag = el.tagName.toLowerCase();
        const id = el.id;
        const cls = Array.from(el.classList).filter(c => c && !/^[0-9]/.test(c)).slice(0, 3);
        const selector = id ? `#${id}` : cls.length ? `${tag}.${cls.join('.')}` : tag;
        results.push({ selector, value: ar });
      }
    }
    return results;
  });

  // ── Extract animations from CSS ──
  log('Scanner', 'info', 'Extracting animations...');
  const animations = extractAnimationsFromCSS(cssContents);

  // ── Take final full-page screenshot at default viewport ──
  await page.screenshot({ path: path.join(screenshotDir, 'full-page-1440.png'), fullPage: true });

  const result: ScanResult = {
    url,
    timestamp: new Date().toISOString(),
    pageTitle,
    pageMetadata,
    linkTags,
    domTree,
    responsiveSnapshots,
    assets,
    apiCalls,
    cssRaw: cssContents,
    colorPalette,
    typographyMap: typographyMap.map(t => ({
      fontFamily: t.fontFamily,
      fontSize: t.fontSize,
      fontWeight: t.fontWeight,
      lineHeight: t.lineHeight,
      usageCount: t.count,
      selector: t.selector,
    })),
    spacingValues,
    opacityScale,
    cssCustomProperties,
    aspectRatios,
    animations,
    interactiveElements,
    authDetection,
  };

  // Write output
  const outputPath = path.join(outputDir, 'scan-result.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  log('Scanner', 'info', `Results written to ${outputPath}`);
  log('Scanner', 'info', `Total elements: ${domTree.length}`);
  log('Scanner', 'info', `Total colors: ${colorPalette.length}`);
  log('Scanner', 'info', `Total typography variants: ${typographyMap.length}`);
  log('Scanner', 'info', `Total assets: ${assets.length}`);
  log('Scanner', 'info', `Total CSS files: ${cssContents.length}`);
  log('Scanner', 'info', `Total spacing values: ${spacingValues.length}`);
  log('Scanner', 'info', `Total opacity values: ${opacityScale.length}`);
  log('Scanner', 'info', `Total CSS custom properties: ${cssCustomProperties.length}`);
  log('Scanner', 'info', `Total aspect-ratio usages: ${aspectRatios.length}`);
  log('Scanner', 'info', `Total animations: ${animations.length}`);
  log('Scanner', 'info', `Responsive snapshots: ${responsiveSnapshots.length}`);

  return result;
  }); // end withBrowser
}

// Lazy require to avoid circular dependency — crawl.ts imports scan from this file.
// By the time crawl() is called at runtime, both modules are fully loaded.
async function crawl(url: string, outputDir: string, options?: Partial<CLIOptions>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { crawl: crawlImpl } = require('./crawl') as typeof import('./crawl');
  return crawlImpl(url, outputDir, options);
}

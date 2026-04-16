import { chromium, Page } from 'playwright';
import { textResponse, validateArgs, validateToolUrl } from '../helpers';
import { ExtractComponentInput } from '../schemas';
import { escapeCSSSelector, log } from '../../core/utils';
import type { ExtractedElement } from '../../export/adapters/codegen-shared';

export interface ComponentStylesResult {
  element: ExtractedElement;
  children: ExtractedElement[];
  variants?: ExtractedElement[];
  totalMatches?: number;
  hoverRules?: string[];
  warnings?: string[];
}

// ── Component name → selector mappings ──────────────────────────────────────

const COMPONENT_MAPPINGS: Record<string, string[]> = {
  header: [
    'header', 'nav', '[role="banner"]', '[role="navigation"]',
    '.header', '.navbar', '.nav', '.navigation',
    '[class*="header"]', '[class*="navbar"]', '[class*="nav-"]', '[class*="topbar"]',
    '[class*="app-bar"]', '[class*="appbar"]', '[class*="site-header"]',
    '[data-testid*="header"]', '[data-testid*="nav"]',
  ],
  nav: [
    'nav', '[role="navigation"]', 'header',
    '.nav', '.navbar', '.navigation', '[class*="nav"]',
    '[class*="menu"]', '[class*="topbar"]',
    '[data-testid*="nav"]',
  ],
  navbar: [
    'nav', '[role="navigation"]', 'header',
    '.nav', '.navbar', '[class*="navbar"]', '[class*="nav-bar"]',
  ],
  footer: [
    'footer', '[role="contentinfo"]',
    '.footer', '[class*="footer"]', '[class*="site-footer"]',
    '[data-testid*="footer"]',
  ],
  hero: [
    '.hero', '[class*="hero"]',
    'section:first-of-type', 'main > section:first-child', 'main > div:first-child',
    '[class*="banner"]', '[class*="splash"]', '[class*="landing"]', '[class*="jumbotron"]',
  ],
  sidebar: [
    'aside', '[role="complementary"]',
    '.sidebar', '[class*="sidebar"]', '[class*="side-bar"]', '[class*="drawer"]',
  ],
  card: [
    '.card', '[class*="card"]', 'article',
    '[class*="tile"]', '[class*="panel"]',
  ],
  button: [
    'button', '.btn', '[class*="button"]', '[class*="btn"]',
    'a[class*="cta"]', '[role="button"]',
  ],
  modal: [
    'dialog', '[role="dialog"]', '[role="alertdialog"]',
    '.modal', '[class*="modal"]', '[class*="dialog"]', '[class*="popup"]',
  ],
  form: [
    'form', '[role="form"]', '.form', '[class*="form"]',
    '[class*="contact"]', '[class*="signup"]', '[class*="subscribe"]',
  ],
  pricing: [
    '[class*="pricing"]', '[class*="price"]', '[class*="plan"]',
    '[class*="tier"]', '[class*="package"]',
  ],
  testimonial: [
    '[class*="testimonial"]', '[class*="review"]', '[class*="quote"]',
    '[class*="feedback"]', '[class*="customer"]',
  ],
  faq: [
    '[class*="faq"]', '[class*="accordion"]',
    '[class*="question"]', 'details',
  ],
};


const ANIM_PROPS = [
  'transform', 'opacity', 'visibility', 'width', 'height',
  'backgroundColor', 'color', 'borderColor', 'borderRadius',
  'boxShadow', 'filter', 'backdropFilter', 'gap',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'top', 'left', 'right', 'bottom',
];

// ── Browser-evaluated helpers ───────────────────────────────────────────────

async function extractComponentStyles(page: Page, selector: string): Promise<ComponentStylesResult | null> {
  const raw = await page.evaluate((args) => {
    const { sel, mappings } = args;

    // ── findComponent — try selectors, fuzzy match, then positional heuristics ──
    function findComponent(sel: string, mappings: Record<string, string[]>): Element[] {
      try {
        const direct = document.querySelectorAll(sel);
        if (direct.length > 0) return Array.from(direct);
      } catch { /* invalid selector */ }

      const mapped = mappings[sel.toLowerCase()];
      if (mapped) {
        for (const s of mapped) {
          try {
            const found = document.querySelectorAll(s);
            if (found.length > 0) return Array.from(found);
          } catch { /* */ }
        }
      }

      const term = sel.toLowerCase().replace(/[^a-z]/g, '');
      if (term.length >= 3) {
        try {
          const fuzzy = document.querySelectorAll(`[class*="${term}"]`);
          if (fuzzy.length > 0) {
            const sorted = Array.from(fuzzy)
              .filter(el => { const r = el.getBoundingClientRect(); return r.width > 50 && r.height > 20; })
              .sort((a, b) => {
                const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
                return (rb.width * rb.height) - (ra.width * ra.height);
              });
            if (sorted.length > 0) return [sorted[0]];
          }
        } catch { /* */ }
      }

      if (sel.toLowerCase() === 'header' || sel.toLowerCase() === 'nav') {
        // Find the first visible full-width element near the top that contains links
        const allEls = document.querySelectorAll('body *');
        for (const el of Array.from(allEls)) {
          const r = el.getBoundingClientRect();
          if (r.width > window.innerWidth * 0.6 && r.top < 150 && r.height > 20 && r.height < 200) {
            const links = el.querySelectorAll('a');
            if (links.length >= 2) return [el];
          }
        }
        // Fallback: any visible element at top
        for (const el of Array.from(allEls)) {
          const r = el.getBoundingClientRect();
          if (r.width > window.innerWidth * 0.5 && r.top < 100 && r.height > 30 && r.height < 200) return [el];
        }
      }

      if (sel.toLowerCase() === 'footer') {
        const allEls = document.querySelectorAll('body *');
        const pageBottom = document.documentElement.scrollHeight;
        for (const el of Array.from(allEls)) {
          const r = el.getBoundingClientRect();
          const absTop = r.top + window.scrollY;
          if (r.width > window.innerWidth * 0.6 && absTop > pageBottom - 600 && r.height > 50) {
            const links = el.querySelectorAll('a');
            if (links.length >= 2) return [el];
          }
        }
      }

      if (sel.toLowerCase() === 'hero') {
        const allEls = document.querySelectorAll('body *');
        for (const el of Array.from(allEls)) {
          const r = el.getBoundingClientRect();
          if (r.top < window.innerHeight && r.height > 300 && r.width > window.innerWidth * 0.7) {
            return [el];
          }
        }
      }

      return [];
    }

    const elements = findComponent(sel, mappings);
    if (elements.length === 0) return null;

    function buildCssVarReverseMap(): Map<string, string> {
      const reverseMap = new Map<string, string>();
      const rootStyles = getComputedStyle(document.documentElement);

      // Iterate all stylesheets to find custom property declarations
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules)) {
            if (rule instanceof CSSStyleRule && (rule.selectorText === ':root' || rule.selectorText === 'html' || rule.selectorText === 'body')) {
              for (let i = 0; i < rule.style.length; i++) {
                const prop = rule.style[i];
                if (prop.startsWith('--')) {
                  // Get the RESOLVED value of this variable
                  const resolved = rootStyles.getPropertyValue(prop).trim();
                  if (resolved && !reverseMap.has(resolved)) {
                    reverseMap.set(resolved, `var(${prop})`);
                  }
                }
              }
            }
          }
        } catch { /* cross-origin stylesheet */ }
      }

      return reverseMap;
    }

    const cssVarMap = buildCssVarReverseMap();

    function getAuthoredCssFunctions(el: Element): Map<string, string> {
      const authored = new Map<string, string>();
      const functionProps = new Set([
        'font-size', 'width', 'max-width', 'min-width', 'height', 'max-height', 'min-height',
        'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
        'gap', 'row-gap', 'column-gap', 'line-height', 'letter-spacing',
        'border-radius', 'top', 'right', 'bottom', 'left',
      ]);
      const cssFunctionRe = /\b(clamp|calc|min|max)\s*\(/;

      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules)) {
            if (!(rule instanceof CSSStyleRule)) continue;
            try {
              if (!el.matches(rule.selectorText)) continue;
            } catch { continue; }

            for (const prop of functionProps) {
              const value = rule.style.getPropertyValue(prop);
              if (value && cssFunctionRe.test(value)) {
                authored.set(prop, value.trim());
              }
            }
          }
        } catch { /* cross-origin stylesheet */ }
      }

      return authored;
    }

    function getStyles(el: Element): Record<string, string> {
      const computed = window.getComputedStyle(el);
      const positionProps = new Set([
        'top', 'left', 'right', 'bottom', 'zIndex',
        'width', 'height', 'maxWidth', 'maxHeight', 'minWidth', 'minHeight',
      ]);
      const props = [
        'display', 'position', 'float', 'clear',
        'top', 'left', 'right', 'bottom',
        'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
        'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
        'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'boxSizing',
        'zIndex', 'opacity', 'visibility', 'overflow', 'overflowX', 'overflowY',
        'isolation', 'mixBlendMode',
        'backgroundColor', 'color',
        'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat', 'backgroundClip',
        'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
        'lineHeight', 'letterSpacing', 'textAlign', 'textTransform', 'textDecoration',
        'textOverflow', 'whiteSpace', 'wordBreak', 'verticalAlign',
        'border', 'borderRadius', 'borderColor', 'borderWidth', 'borderStyle',
        'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
        'outline', 'outlineOffset',
        'boxShadow', 'textShadow', 'backdropFilter', 'filter',
        'flexDirection', 'justifyContent', 'alignItems', 'alignSelf', 'alignContent',
        'gap', 'rowGap', 'columnGap', 'flexWrap',
        'flexGrow', 'flexShrink', 'flexBasis', 'order',
        'gridTemplateColumns', 'gridTemplateRows', 'gridGap',
        'gridColumn', 'gridRow', 'gridArea',
        'aspectRatio', 'objectFit', 'objectPosition',
        'transform', 'transformOrigin', 'transition', 'animation', 'willChange',
        'cursor', 'pointerEvents', 'userSelect',
        'listStyle', 'listStyleType',
        'contain', 'contentVisibility',
      ];

      const colorProps = new Set(['color', 'background-color', 'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'box-shadow', 'text-shadow', 'fill', 'stroke']);
      const fontProps = new Set(['font-family']);

      const styles: Record<string, string> = {};
      for (const p of props) {
        const cssProp = p.replace(/([A-Z])/g, '-$1').toLowerCase();
        const val = computed.getPropertyValue(cssProp);
        if (!val) continue;
        if (positionProps.has(p)) {
          if (val !== '' && val !== 'none') styles[p] = val;
          continue;
        }
        if (val === 'none' || val === 'normal' || val === 'rgba(0, 0, 0, 0)' || val === '0px' || val === 'auto' || val === 'visible' || val === 'static' || val === 'start' || val === 'baseline') continue;
        // After getting the value, check for CSS variable match
        if (cssVarMap.has(val) && (colorProps.has(cssProp) || fontProps.has(cssProp))) {
          styles[p] = cssVarMap.get(val)!;
        } else {
          styles[p] = val;
        }
      }

      styles.display = computed.display;
      styles.position = computed.position;
      if (computed.backgroundColor !== 'rgba(0, 0, 0, 0)') styles.backgroundColor = cssVarMap.has(computed.backgroundColor) && colorProps.has('background-color') ? cssVarMap.get(computed.backgroundColor)! : computed.backgroundColor;
      if (computed.color) styles.color = cssVarMap.has(computed.color) && colorProps.has('color') ? cssVarMap.get(computed.color)! : computed.color;
      if (computed.fontFamily) styles.fontFamily = cssVarMap.has(computed.fontFamily) && fontProps.has('font-family') ? cssVarMap.get(computed.fontFamily)! : computed.fontFamily;
      if (computed.fontSize) styles.fontSize = computed.fontSize;
      if (computed.fontWeight) styles.fontWeight = computed.fontWeight;

      // After the main style computation loop, overlay authored CSS functions
      const authoredFns = getAuthoredCssFunctions(el);
      for (const [kebabProp, authoredValue] of authoredFns) {
        const camelProp = kebabProp.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        if (styles[camelProp] !== undefined) {
          styles[camelProp] = authoredValue;
        }
      }

      return styles;
    }

    const INHERITABLE_PROPS = new Set([
      'color', 'font-family', 'font-size', 'font-weight', 'font-style',
      'line-height', 'letter-spacing', 'text-align', 'text-transform',
      'text-indent', 'white-space', 'word-spacing', 'visibility',
      'cursor', 'list-style-type', 'direction',
    ]);

    function getElementInfo(el: Element, parentEl?: Element): Record<string, unknown> {
      const rect = el.getBoundingClientRect();
      const tag = el.tagName.toLowerCase();
      const text = el.textContent?.trim().slice(0, 100) || '';
      const elStyles = getStyles(el);

      const inheritedProps: string[] = [];
      if (parentEl) {
        const parentComputed = window.getComputedStyle(parentEl);
        const childComputed = window.getComputedStyle(el);
        for (const cssProp of INHERITABLE_PROPS) {
          const childVal = childComputed.getPropertyValue(cssProp);
          const parentVal = parentComputed.getPropertyValue(cssProp);
          if (childVal && parentVal && childVal === parentVal) {
            inheritedProps.push(cssProp);
          }
        }
      }

      const info: Record<string, unknown> = {
        tag,
        id: el.id || undefined,
        classes: Array.from(el.classList).join(' ') || undefined,
        role: el.getAttribute('role') || undefined,
        text: text || undefined,
        dimensions: { width: `${rect.width}px`, height: `${rect.height}px`, x: `${rect.x}px`, y: `${rect.y}px` },
        styles: elStyles,
        inheritedProps: inheritedProps.length > 0 ? inheritedProps : undefined,
      };
      if (tag === 'svg') {
        const svgHtml = el.outerHTML;
        info.svgContent = svgHtml.length <= 5120 ? svgHtml : null;
        info.svgTooLarge = svgHtml.length > 5120 ? true : undefined;
        info.svgAttributes = {
          viewBox: el.getAttribute('viewBox') || undefined,
          fill: el.getAttribute('fill') || undefined,
          stroke: el.getAttribute('stroke') || undefined,
          width: el.getAttribute('width') || undefined,
          height: el.getAttribute('height') || undefined,
        };
      }
      return info;
    }

    function collectDescendants(root: Element, currentDepth: number, maxDepth: number, maxNodes: number): Record<string, unknown>[] {
      const results: Record<string, unknown>[] = [];
      const skipTags = new Set(['script', 'style', 'meta', 'link', 'noscript', 'br', 'wbr']);

      function walk(parent: Element, depth: number, parentIdx: number) {
        if (depth > maxDepth || results.length >= maxNodes) return;
        const children = Array.from(parent.children);
        for (const child of children) {
          if (results.length >= maxNodes) return;
          const tag = child.tagName.toLowerCase();
          if (skipTags.has(tag)) continue;
          const info = getElementInfo(child, parent);
          info.depth = depth;
          info.parentIndex = parentIdx;
          const idx = results.length;
          results.push(info);
          walk(child, depth + 1, idx);
        }
      }

      walk(root, 1, -1);
      return results;
    }

    const primary = elements[0];
    const result: Record<string, unknown> = {
      element: getElementInfo(primary),
      children: collectDescendants(primary, 0, 5, 60),
    };

    if (elements.length > 1) {
      result.variants = elements.slice(1, 5).map(el => getElementInfo(el));
      result.totalMatches = elements.length;
    }

    // Static hover rules
    const sheets = Array.from(document.styleSheets);
    const hoverRules: string[] = [];
    for (const sheet of sheets) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          if (rule instanceof CSSStyleRule && rule.selectorText?.includes(':hover')) {
            if (primary.matches(rule.selectorText.replace(/:hover/g, ''))) {
              hoverRules.push(rule.cssText);
            }
          }
        }
      } catch (e) { /* cross-origin stylesheet - expected */ }
    }
    if (hoverRules.length > 0) result.hoverRules = hoverRules;

    // Warnings
    const warnings: string[] = [];
    const ps = (result.element as { styles: Record<string, string> }).styles;
    if (ps.position === 'fixed' || ps.position === 'sticky') warnings.push(`Component uses position: ${ps.position} — make sure to replicate this exactly or it won't stick/float correctly.`);
    if (ps.zIndex && parseInt(ps.zIndex) > 1) warnings.push(`Component has z-index: ${ps.zIndex} — ensure your stacking context matches to avoid overlapping issues.`);
    if (ps.backdropFilter) warnings.push(`Component uses backdrop-filter: ${ps.backdropFilter} — requires a semi-transparent background to be visible.`);
    if (ps.transform && ps.transform !== 'none') warnings.push(`Component uses transform: ${ps.transform} — this creates a new stacking context and may affect child positioning.`);
    if (ps.willChange && ps.willChange !== 'auto') warnings.push(`Component uses will-change: ${ps.willChange} — include this for animation performance.`);
    if (ps.isolation === 'isolate') warnings.push('Component uses isolation: isolate — creates a new stacking context.');
    if (ps.overflow === 'hidden' || ps.overflowX === 'hidden' || ps.overflowY === 'hidden') warnings.push('Component clips overflow — content outside bounds will be hidden.');
    if (ps.mixBlendMode && ps.mixBlendMode !== 'normal') warnings.push(`Component uses mix-blend-mode: ${ps.mixBlendMode} — visual effect depends on background.`);
    for (const child of (result.children as { tag: string; styles: Record<string, string> }[]) || []) {
      if (child.styles.position === 'absolute' && ps.position === 'static') warnings.push(`Child "${child.tag}" is position: absolute but parent is static — the child will position relative to the nearest positioned ancestor, not this component.`);
    }
    if (warnings.length > 0) result.warnings = warnings;

    return result;
  }, { sel: selector, mappings: COMPONENT_MAPPINGS });
  return raw as ComponentStylesResult | null;
}

interface HoverAnimationEntry {
  element: string;
  text: string;
  baseStyles: Record<string, string>;
  cssTransition?: string;
}

export interface HoverResult {
  element: string;
  text: string;
  cssTransition?: string;
  transitionDuration?: string;
  transitionEasing?: string;
  changes: Record<string, { from: string; to: string }>;
}

export interface ScrollChange {
  element: string;
  scrollY: number;
  changes: Record<string, { from: string; to: string }>;
}

async function captureComponentAnimations(page: Page, selector: string): Promise<{
  hover?: HoverResult[];
  scroll?: ScrollChange[];
}> {
  // 1. Find interactive children and capture hover transitions
  const hoverAnimations = await page.evaluate((args) => {
    const { sel, props, mappings } = args;
    let container: Element | null = document.querySelector(sel);
    if (!container) {
      const mapped = mappings[sel.toLowerCase()];
      if (mapped) {
        for (const s of mapped) {
          try { container = document.querySelector(s); } catch { /* */ }
          if (container) break;
        }
      }
    }
    if (!container) return [];

    const interactives = Array.from(container.querySelectorAll('a, button, [role="button"], [class*="btn"], [class*="cta"], [class*="link"]'));
    const results: { element: string; text: string; baseStyles: Record<string, string>; cssTransition?: string }[] = [];
    for (const el of interactives.slice(0, 10)) {
      const tag = el.tagName.toLowerCase();
      const text = el.textContent?.trim().slice(0, 50) || '';
      const cs = window.getComputedStyle(el);
      const baseStyles: Record<string, string> = {};
      for (const p of props) baseStyles[p] = cs.getPropertyValue(p.replace(/([A-Z])/g, '-$1').toLowerCase());
      const transition = cs.transition;
      const hasTransition = transition && transition !== 'all 0s ease 0s' && transition !== 'none';
      results.push({
        element: `${tag}${el.className ? '.' + Array.from(el.classList).slice(0, 2).join('.') : ''}`,
        text,
        baseStyles: Object.fromEntries(Object.entries(baseStyles).filter(([, v]) => v && v !== 'none' && v !== 'rgba(0, 0, 0, 0)')),
        cssTransition: hasTransition ? transition : undefined,
      });
    }
    return results;
  }, { sel: selector, props: ANIM_PROPS, mappings: COMPONENT_MAPPINGS });

  // 2. Actually hover each element and diff
  const hoverResults: HoverResult[] = [];
  for (const item of hoverAnimations) {
    try {
      const elHandle = await page.$(escapeCSSSelector(item.element)).catch(() => null);
      if (!elHandle) continue;

      const getStyles = (sel: string) => page.evaluate((args) => {
        const el = document.querySelector(args.sel);
        if (!el) return null;
        const cs = window.getComputedStyle(el);
        const styles: Record<string, string> = {};
        for (const p of args.props) styles[p] = cs.getPropertyValue(p.replace(/([A-Z])/g, '-$1').toLowerCase());
        return styles;
      }, { sel, props: ANIM_PROPS });

      const preStyles = await getStyles(escapeCSSSelector(item.element));
      await elHandle.hover().catch(() => {});
      await page.waitForTimeout(400);
      const postStyles = await getStyles(escapeCSSSelector(item.element));

      if (preStyles && postStyles) {
        const changes: Record<string, { from: string; to: string }> = {};
        for (const p of ANIM_PROPS) {
          if (preStyles[p] !== postStyles[p]) changes[p] = { from: preStyles[p], to: postStyles[p] };
        }
        if (Object.keys(changes).length > 0) {
          // Parse duration and easing from the cssTransition string
          let parsedDuration: string | undefined;
          let parsedEasing: string | undefined;
          if (item.cssTransition) {
            // cssTransition is a shorthand like "color 0.3s ease-in-out, background-color 0.2s linear"
            // Extract all durations and take the longest; take the first easing value
            const durationMatches = item.cssTransition.match(/\b(\d+(?:\.\d+)?(?:ms|s))\b/g);
            if (durationMatches) {
              let maxMs = 0;
              let maxRaw = durationMatches[0];
              for (const d of durationMatches) {
                const ms = d.endsWith('ms') ? parseFloat(d) : parseFloat(d) * 1000;
                if (!isNaN(ms) && ms > maxMs) { maxMs = ms; maxRaw = d; }
              }
              parsedDuration = maxRaw;
            }
            // Match known easing keywords or cubic-bezier(...)
            const easingMatch = item.cssTransition.match(/\b(ease(?:-in)?(?:-out)?|linear|step-start|step-end|cubic-bezier\([^)]+\))\b/);
            if (easingMatch) parsedEasing = easingMatch[1];
          }
          hoverResults.push({
            element: item.element,
            text: item.text,
            cssTransition: item.cssTransition,
            transitionDuration: parsedDuration,
            transitionEasing: parsedEasing,
            changes,
          });
        }
      }
      await page.mouse.move(0, 0);
      await page.waitForTimeout(200);
    } catch (e) { log('Extract', 'warn', `Hover capture failed: ${(e as Error).message}`); }
  }

  // 3. Scroll-triggered animations
  const scrollAnimations = await (async () => {
    const bounds = await page.evaluate((args) => {
      const { sel, mappings } = args;
      let el: Element | null = document.querySelector(sel);
      if (!el) { const mapped = mappings[sel.toLowerCase()]; if (mapped) { for (const s of mapped) { try { el = document.querySelector(s); } catch {} if (el) break; } } }
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { top: rect.top + window.scrollY, height: rect.height };
    }, { sel: selector, mappings: COMPONENT_MAPPINGS });
    if (!bounds) return [];

    const getComponentStyles = () => page.evaluate((args) => {
      const { sel, props, mappings } = args;
      let container: Element | null = document.querySelector(sel);
      if (!container) { const mapped = mappings[sel.toLowerCase()]; if (mapped) { for (const s of mapped) { try { container = document.querySelector(s); } catch {} if (container) break; } } }
      if (!container) return null;
      return [container, ...Array.from(container.children).slice(0, 10)].map(el => {
        const cs = window.getComputedStyle(el);
        const styles: Record<string, string> = {};
        for (const p of props) { const val = cs.getPropertyValue(p.replace(/([A-Z])/g, '-$1').toLowerCase()); if (val && val !== 'none' && val !== 'rgba(0, 0, 0, 0)') styles[p] = val; }
        return { tag: el.tagName.toLowerCase(), classes: Array.from(el.classList).slice(0, 3).join(' '), styles };
      });
    }, { sel: selector, props: ANIM_PROPS, mappings: COMPONENT_MAPPINGS });

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const atTop = await getComponentStyles();

    const scrollSnapshots: { scrollY: number; elements: { tag: string; classes: string; styles: Record<string, string> }[] }[] = [];
    for (const scrollY of [200, 500, 1000, 2000]) {
      await page.evaluate((y) => window.scrollTo(0, y), scrollY);
      await page.waitForTimeout(300);
      const snapshot = await getComponentStyles();
      if (snapshot) scrollSnapshots.push({ scrollY, elements: snapshot });
    }
    if (!atTop) return [];

    const changes: ScrollChange[] = [];
    for (const snap of scrollSnapshots) {
      for (let i = 0; i < Math.min(atTop.length, snap.elements.length); i++) {
        const before = atTop[i].styles;
        const after = snap.elements[i].styles;
        const diff: Record<string, { from: string; to: string }> = {};
        for (const key of Object.keys({ ...before, ...after })) {
          if (before[key] !== after[key]) diff[key] = { from: before[key] || 'none', to: after[key] || 'none' };
        }
        if (Object.keys(diff).length > 0) changes.push({ element: `${atTop[i].tag}.${atTop[i].classes}`, scrollY: snap.scrollY, changes: diff });
      }
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    return changes;
  })();

  return {
    hover: hoverResults.length > 0 ? hoverResults : undefined,
    scroll: scrollAnimations.length > 0 ? scrollAnimations : undefined,
  };
}

// ── Exported for reuse by generate-component ───────────────────────────────

export { extractComponentStyles, captureComponentAnimations, COMPONENT_MAPPINGS };

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handleExtractComponent(rawArgs: unknown) {
  const args = validateArgs(ExtractComponentInput, rawArgs);
  validateToolUrl(args.url);
  const { url, component } = args;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const result = await extractComponentStyles(page, component);
    if (!result) {
      return textResponse(`No component matching "${component}" found on ${url}. Try a different name or CSS selector.`);
    }

    const animations = await captureComponentAnimations(page, component);

    // Responsive breakpoints
    const breakpoints = [
      { name: '320', width: 320, height: 568 },
      { name: '375', width: 375, height: 812 },
      { name: '414', width: 414, height: 896 },
      { name: '768', width: 768, height: 1024 },
      { name: '1024', width: 1024, height: 768 },
      { name: '1280', width: 1280, height: 800 },
      { name: '1920', width: 1920, height: 1080 },
    ];

    const responsive: Record<string, ComponentStylesResult | null> = {};
    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.waitForTimeout(500);
      const bpResult = await extractComponentStyles(page, component);
      if (bpResult) responsive[`${bp.name}px`] = bpResult;
    }

    // Diff each breakpoint against desktop
    const responsiveDiffs: Record<string, unknown> = {};
    const desktopStyles: Record<string, string> = result.element?.styles || {};
    const desktopChildren = result.children || [];

    for (const [bp, bpData] of Object.entries(responsive)) {
      if (!bpData) continue;
      const bpStyles: Record<string, string> = bpData.element?.styles || {};
      const bpChildren = bpData.children || [];

      const elementDiff: Record<string, Record<string, string>> = {};
      for (const key of new Set([...Object.keys(desktopStyles), ...Object.keys(bpStyles)])) {
        if (desktopStyles[key] !== bpStyles[key]) elementDiff[key] = { desktop: desktopStyles[key] || 'unset', [bp]: bpStyles[key] || 'unset' };
      }

      const childDiffs: Record<string, unknown>[] = [];
      for (let i = 0; i < Math.min(desktopChildren.length, bpChildren.length); i++) {
        const dStyles: Record<string, string> = (desktopChildren[i]?.styles as Record<string, string>) || {};
        const bStyles: Record<string, string> = (bpChildren[i]?.styles as Record<string, string>) || {};
        const diff: Record<string, unknown> = {};
        for (const key of new Set([...Object.keys(dStyles), ...Object.keys(bStyles)])) {
          if (dStyles[key] !== bStyles[key]) diff[key] = { desktop: dStyles[key] || 'unset', [bp]: bStyles[key] || 'unset' };
        }
        const dText = desktopChildren[i]?.text as string | undefined;
        if (Object.keys(diff).length > 0) childDiffs.push({ tag: desktopChildren[i]?.tag, text: dText?.slice(0, 30), changes: diff });
      }

      if (Object.keys(elementDiff).length > 0 || childDiffs.length > 0) {
        responsiveDiffs[bp] = {
          element: Object.keys(elementDiff).length > 0 ? elementDiff : undefined,
          children: childDiffs.length > 0 ? childDiffs : undefined,
        };
      }
    }

    return textResponse({
      url,
      component,
      desktop_1440: result,
      animations,
      responsiveChanges: Object.keys(responsiveDiffs).length > 0 ? responsiveDiffs : 'No responsive changes detected',
    });
  } finally {
    await browser.close();
  }
}

/**
 * Full DOM extraction with computed styles.
 *
 * The entire extractAllElements function runs a single page.evaluate() call
 * that executes in the browser context. Helper functions (escapeClass,
 * genSelector, getDepth) are defined INLINE because browser-context code
 * cannot import Node modules.
 */

import { Page } from 'playwright';
import { config } from '../core/config';
import { ElementData } from './types';

const STYLE_PROPERTIES = config.scan.styleProperties;
const MAX_ELEMENTS = config.scan.maxElements;
const INTERACTIVE_SELECTORS = config.scan.interactiveSelectors;

const PSEUDO_ELEMENT_PROPERTIES = [
  // Layout
  'content', 'display', 'position', 'top', 'left', 'right', 'bottom',
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'zIndex', 'overflow', 'visibility',
  // Colors & Background
  'color', 'backgroundColor', 'backgroundImage', 'backgroundSize',
  'backgroundPosition', 'backgroundRepeat',
  // Border
  'border', 'borderWidth', 'borderStyle', 'borderColor', 'borderRadius',
  // Typography
  'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
  'textAlign', 'textDecoration', 'textTransform',
  // Effects
  'boxShadow', 'filter', 'backdropFilter', 'opacity', 'clipPath',
  'mixBlendMode',
  // Transform & Animation
  'transform', 'transition', 'animation',
  // Interaction
  'cursor', 'pointerEvents',
];

export async function extractAllElements(page: Page): Promise<ElementData[]> {
  return await page.evaluate((evalConfig: { styleProps: string[]; maxElements: number; interactiveSelectors: string[]; pseudoProps: string[] }) => {
    const results: ElementData[] = [];
    const allEls = document.querySelectorAll('*');
    const interactiveSet = new Set<Element>();

    // Build interactive element set
    for (const sel of evalConfig.interactiveSelectors) {
      try {
        document.querySelectorAll(sel).forEach(el => interactiveSet.add(el));
      } catch { /* invalid selector */ }
    }

    function getDepth(el: Element): number {
      let depth = 0;
      let parent = el.parentElement;
      while (parent) { depth++; parent = parent.parentElement; }
      return depth;
    }

    // BROWSER-CONTEXT: This function MUST stay inline — it runs inside
    // page.evaluate() and cannot import Node modules.
    // Escape special characters in a single CSS class name token so it is safe
    // to use in querySelector (handles Tailwind classes like hover:text-cream,
    // md:flex, max-w-[1600px], py-2.5, etc.).
    function escapeClass(cls: string): string {
      return cls
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/:/g, '\\:')
        .replace(/\//g, '\\/')
        .replace(/@/g, '\\@')
        .replace(/%/g, '\\%')
        .replace(/!/g, '\\!')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/\.(?=\d)/g, '\\.');
    }

    // BROWSER-CONTEXT: Stable selector generation — must stay inline inside
    // page.evaluate(). Cannot reference Node-side generateStableSelector.
    function genSelector(el: Element, index: number): string {
      if (el.id) return `#${el.id}`;

      const tag = el.tagName.toLowerCase();
      const classes = Array.from(el.classList).filter(c => c && !/^[0-9]/.test(c));

      // Try tag.class combo if unique
      if (classes.length > 0) {
        const classStr = classes.slice(0, 3).map(c => `.${escapeClass(c)}`).join('');
        const candidate = `${tag}${classStr}`;
        try {
          if (document.querySelectorAll(candidate).length === 1) return candidate;
        } catch { /* */ }
      }

      // Try distinguishing attributes
      const attrs = ['role', 'type', 'name', 'aria-label', 'data-testid', 'data-id'];
      for (const attr of attrs) {
        const val = el.getAttribute(attr);
        if (val) {
          const candidate = `${tag}[${attr}="${val.replace(/"/g, '\\"').slice(0, 80)}"]`;
          try {
            if (document.querySelectorAll(candidate).length === 1) return candidate;
          } catch { /* */ }
        }
      }

      // Try parent > tag.class
      const parent = el.parentElement;
      if (parent) {
        let parentSel = '';
        if (parent.id) {
          parentSel = `#${parent.id}`;
        } else {
          const pTag = parent.tagName.toLowerCase();
          const pCls = Array.from(parent.classList).filter(c => c && !/^[0-9]/.test(c));
          if (pCls.length > 0) parentSel = `${pTag}.${pCls.slice(0, 2).map(escapeClass).join('.')}`;
        }

        if (parentSel) {
          if (classes.length > 0) {
            const candidate = `${parentSel} > ${tag}.${classes.slice(0, 2).map(escapeClass).join('.')}`;
            try {
              if (document.querySelectorAll(candidate).length === 1) return candidate;
            } catch { /* */ }
          }
          const siblings = Array.from(parent.children).filter(s => s.tagName === el.tagName);
          if (siblings.length > 1) {
            return `${parentSel} > ${tag}:nth-of-type(${siblings.indexOf(el) + 1})`;
          }
          return `${parentSel} > ${tag}`;
        }
      }

      if (classes.length > 0) return `${tag}.${classes.slice(0, 3).map(escapeClass).join('.')}`;
      return `${tag}:nth-of-type(${index + 1})`;
    }

    for (let i = 0; i < Math.min(allEls.length, evalConfig.maxElements); i++) {
      const el = allEls[i];
      const tag = el.tagName.toLowerCase();

      // Skip script, style, meta elements
      if (['script', 'style', 'meta', 'link', 'noscript', 'br', 'wbr'].includes(tag)) continue;

      const computed = window.getComputedStyle(el);
      const styles: Record<string, string> = {};

      for (const prop of evalConfig.styleProps) {
        const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        styles[prop] = computed.getPropertyValue(cssProp);
      }

      const rect = el.getBoundingClientRect();
      const id = el.id || '';
      const classes = Array.from(el.classList);
      const attrs: Record<string, string> = {};
      for (const attr of Array.from(el.attributes)) {
        if (!['class', 'id', 'style'].includes(attr.name)) {
          attrs[attr.name] = attr.value;
        }
      }

      // Get direct text content (not children's text)
      let textContent = '';
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          textContent += (child.textContent || '').trim();
        }
      }

      // Pseudo elements
      const beforeStyles: Record<string, string> = {};
      const afterStyles: Record<string, string> = {};
      const beforeComputed = window.getComputedStyle(el, '::before');
      const afterComputed = window.getComputedStyle(el, '::after');
      const beforeContent = beforeComputed.getPropertyValue('content');
      const afterContent = afterComputed.getPropertyValue('content');

      let pseudoElements: { before?: Record<string, string>; after?: Record<string, string> } | undefined = undefined;
      if (beforeContent && beforeContent !== 'none' && beforeContent !== 'normal') {
        for (const prop of evalConfig.pseudoProps) {
          const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
          beforeStyles[prop] = beforeComputed.getPropertyValue(cssProp);
        }
        pseudoElements = { ...(pseudoElements || {}), before: beforeStyles };
      }
      if (afterContent && afterContent !== 'none' && afterContent !== 'normal') {
        for (const prop of evalConfig.pseudoProps) {
          const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
          afterStyles[prop] = afterComputed.getPropertyValue(cssProp);
        }
        pseudoElements = { ...(pseudoElements || {}), after: afterStyles };
      }

      const selector = genSelector(el, i);

      results.push({
        selector,
        tag,
        id,
        classes,
        attributes: attrs,
        textContent: textContent.slice(0, 200),
        computedStyles: styles,
        boundingBox: rect.width > 0 || rect.height > 0
          ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
          : null,
        childCount: el.children.length,
        depth: getDepth(el),
        isInteractive: interactiveSet.has(el),
        pseudoElements,
      });
    }

    return results;
  }, {
    styleProps: STYLE_PROPERTIES,
    maxElements: MAX_ELEMENTS,
    interactiveSelectors: INTERACTIVE_SELECTORS,
    pseudoProps: PSEUDO_ELEMENT_PROPERTIES,
  });
}

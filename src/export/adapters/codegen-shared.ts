/**
 * Shared constants and utilities for component code generators.
 *
 * Used by component-codegen.ts, vue-codegen.ts, and svelte-codegen.ts.
 */

import { rgbToHex, parseRgb } from './utils';

export { rgbToHex, parseRgb };

// ── Types ──────────────────────────────────────────────────────────────────

export interface ExtractedElement {
  tag: string;
  id?: string;
  classes?: string;
  role?: string;
  text?: string;
  dimensions?: { width: string; height: string; x: string; y: string };
  styles: Record<string, string>;
  depth?: number;
  parentIndex?: number;
  svgContent?: string | null;
  svgTooLarge?: boolean;
  svgAttributes?: { viewBox?: string; fill?: string; stroke?: string; width?: string; height?: string };
}

export interface HoverAnimation {
  element: string;
  text?: string;
  cssTransition?: string;
  changes: Record<string, { from: string; to: string }>;
}

// Tags where margin/padding defaults are NOT 0 — so 0px is a meaningful explicit reset
const TAG_NONZERO_MARGIN = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'dl',
  'blockquote', 'figure', 'pre', 'hr', 'fieldset',
]);

// Tags where text-decoration defaults are NOT none
const TAG_DECORATED_DEFAULTS = new Set(['a']);

// ── Style Defaults to Exclude ──────────────────────────────────────────────

export const TAG_DEFAULTS: Record<string, Record<string, string>> = {
  div: { display: 'block' },
  span: { display: 'inline' },
  a: { display: 'inline', cursor: 'pointer' },
  img: { display: 'inline' },
  nav: { display: 'block' },
  header: { display: 'block' },
  footer: { display: 'block' },
  section: { display: 'block' },
  main: { display: 'block' },
  p: { display: 'block' },
  h1: { display: 'block' },
  h2: { display: 'block' },
  h3: { display: 'block' },
  ul: { display: 'block' },
  li: { display: 'list-item' },
  button: { cursor: 'pointer' },
};

export const UNIVERSAL_DEFAULTS = new Set([
  'position: static',
  'visibility: visible',
  'overflow: visible',
  'overflowX: visible',
  'overflowY: visible',
  'opacity: 1',
  'fontStyle: normal',
  'textTransform: none',
  'letterSpacing: normal',
  'verticalAlign: baseline',
  'cursor: auto',
  'pointerEvents: auto',
  'userSelect: auto',
  'touchAction: auto',
  'resize: none',
  'float: none',
  'clear: none',
  'zIndex: auto',
  'order: 0',
  'flexGrow: 0',
  'flexShrink: 1',
  'boxSizing: border-box',
  'isolation: auto',
  'mixBlendMode: normal',
  'contain: none',
  'contentVisibility: visible',
  'willChange: auto',
  'appearance: none',
  'objectFit: fill',
  'objectPosition: 50% 50%',
]);

export const SKIP_PROPERTIES = new Set([
  'colorScheme', 'caretColor', 'accentColor',
  'scrollBehavior',
  'listStyle', 'listStylePosition', 'listStyleImage',
  'borderCollapse', 'borderSpacing', 'tableLayout',
  'outlineOffset', 'fontVariant', 'fontFeatureSettings',
  'fontVariationSettings',
  'wordSpacing', 'textIndent', 'backgroundOrigin',
  'backgroundAttachment', 'clip',
]);

// ── Semantic Class Name Generation ─────────────────────────────────────────

export const SEMANTIC_WORDS = new Set([
  'logo', 'brand', 'nav', 'link', 'btn', 'button', 'cta', 'menu', 'icon',
  'title', 'subtitle', 'heading', 'description', 'desc', 'image', 'img',
  'hero', 'content', 'wrapper', 'container', 'group', 'list', 'item',
  'card', 'badge', 'tag', 'avatar', 'social', 'search', 'input', 'label',
  'footer', 'header', 'section', 'sidebar', 'price', 'feature', 'quote',
  'author', 'name', 'text', 'star', 'rating', 'dot', 'indicator',
  'profile', 'contact', 'email', 'phone', 'address',
]);

export function camelCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

export function kebabCase(str: string): string {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
}

export function cssProperty(camelCaseProp: string): string {
  return camelCaseProp.replace(/([A-Z])/g, '-$1').toLowerCase();
}

export function generateClassName(
  child: ExtractedElement,
  index: number,
  siblings: ExtractedElement[],
  usedNames: Set<string>,
): string {
  let name = '';

  if (child.role && child.role !== 'presentation' && child.role !== 'none') {
    name = camelCase(child.role);
  }

  if (!name && child.classes) {
    const words = child.classes.toLowerCase().split(/[\s._-]+/);
    for (const word of words) {
      if (SEMANTIC_WORDS.has(word)) {
        name = camelCase(word);
        break;
      }
    }
  }

  if (!name && child.text) {
    const shortText = child.text.trim().split(/\s+/).slice(0, 2).join(' ');
    if (shortText.length > 0 && shortText.length <= 20) {
      const base = camelCase(shortText);
      if (child.tag === 'a') name = base + 'Link';
      else if (child.tag === 'button') name = base + 'Button';
      else if (/^h[1-6]$/.test(child.tag)) name = base || 'heading';
      else name = base;
    }
  }

  if (!name) {
    const styles = child.styles || {};
    if (child.tag === 'img') name = 'image';
    else if (child.tag === 'a') name = 'link';
    else if (child.tag === 'button') name = 'button';
    else if (/^h[1-6]$/.test(child.tag)) name = 'heading';
    else if (child.tag === 'p') name = 'text';
    else if (child.tag === 'ul' || child.tag === 'ol') name = 'list';
    else if (child.tag === 'li') name = 'listItem';
    else if (child.tag === 'svg') name = 'icon';
    else if (styles.display === 'flex' || styles.display === 'grid') name = 'group';
    else name = child.tag;
  }

  let finalName = name;
  let counter = 2;
  while (usedNames.has(finalName)) {
    finalName = `${name}${counter}`;
    counter++;
  }
  usedNames.add(finalName);

  return finalName;
}

// ── Style Filtering ────────────────────────────────────────────────────────

export function filterStyles(
  styles: Record<string, string>,
  tag: string,
  isRoot: boolean,
  inheritedProps?: string[],
): Record<string, string> {
  const filtered: Record<string, string> = {};
  const tagDefaults = TAG_DEFAULTS[tag] || {};
  const inheritedSet = inheritedProps ? new Set(inheritedProps) : undefined;

  // Properties where 'none' is the browser default — skip those, keep 'none' for everything else
  const NONE_IS_DEFAULT = new Set([
    'float', 'clear', 'resize', 'textShadow', 'boxShadow',
    'filter', 'backdropFilter', 'transform', 'animation',
    'transition', 'backgroundImage', 'clipPath', 'maskImage',
  ]);

  for (const [prop, value] of Object.entries(styles)) {
    if (inheritedSet) {
      const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
      if (inheritedSet.has(cssProp)) continue;
    }
    if (!value || value === '') continue;
    if (value === 'none') {
      if (NONE_IS_DEFAULT.has(prop)) continue; // none is the default for this prop, skip
      // else: none is a meaningful value (e.g., text-decoration: none, border: none), keep it
    }
    if (value === 'normal') {
      // 'normal' is default for most props; only keep where it carries meaning
      if (prop !== 'letterSpacing' && prop !== 'wordSpacing' && prop !== 'lineHeight') continue;
    }
    if (SKIP_PROPERTIES.has(prop)) continue;
    if (tagDefaults[prop] === value) continue;
    if (UNIVERSAL_DEFAULTS.has(`${prop}: ${value}`)) continue;
    if (value === '0px' && /^(margin|padding|top|right|bottom|left|gap|rowGap|columnGap)/.test(prop)) {
      // Keep 0px if this tag normally has non-zero defaults (e.g., h1 margin)
      if (!TAG_NONZERO_MARGIN.has(tag)) continue;
    }
    if (value === 'auto' && /^(width|height|top|right|bottom|left|flexBasis)$/.test(prop)) continue;
    // Note: margin: auto is NOT stripped — it is used for centering
    if (isRoot && prop === 'width' && value === '1440px') continue;

    let normalizedValue = value;
    if (parseRgb(value)) {
      normalizedValue = rgbToHex(value);
    }
    filtered[prop] = normalizedValue;
  }

  return collapseShorthands(filtered);
}

export function collapseShorthands(styles: Record<string, string>): Record<string, string> {
  const result = { ...styles };
  collapseBoxProp(result, 'padding', ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']);
  collapseBoxProp(result, 'margin', ['marginTop', 'marginRight', 'marginBottom', 'marginLeft']);
  return result;
}

export function collapseBoxProp(styles: Record<string, string>, shorthand: string, parts: string[]) {
  const values = parts.map(p => styles[p]);
  if (values.some(v => v === undefined)) return;
  for (const p of parts) delete styles[p];
  const [top, right, bottom, left] = values;
  if (top === right && right === bottom && bottom === left) {
    styles[shorthand] = top;
  } else if (top === bottom && right === left) {
    styles[shorthand] = `${top} ${right}`;
  } else if (right === left) {
    styles[shorthand] = `${top} ${right} ${bottom}`;
  } else {
    styles[shorthand] = `${top} ${right} ${bottom} ${left}`;
  }
}

// ── Hover Map ──────────────────────────────────────────────────────────────

export function buildHoverMap(
  hoverAnims: HoverAnimation[] | undefined,
  childEntries: { child: ExtractedElement; className: string }[],
  rootElement: ExtractedElement,
): Map<string, Record<string, string>> {
  const map = new Map<string, Record<string, string>>();
  if (!hoverAnims) return map;

  for (const hover of hoverAnims) {
    const toStyles: Record<string, string> = {};
    for (const [prop, { to }] of Object.entries(hover.changes)) {
      toStyles[prop] = parseRgb(to) ? rgbToHex(to) : to;
    }

    const matchedChild = childEntries.find(e => {
      const text = e.child.text?.toLowerCase().trim();
      const hoverText = hover.text?.toLowerCase().trim();
      if (text && hoverText && text === hoverText) return true;
      const childClasses = e.child.classes?.split(/\s+/) || [];
      const hoverParts = hover.element.split('.');
      return hoverParts.some(p => childClasses.includes(p));
    });

    if (matchedChild) {
      map.set(matchedChild.className, toStyles);
    }
  }

  return map;
}

// ── Media Query Generation ─────────────────────────────────────────────────

export const BREAKPOINT_GROUPS: [string, string[]][] = [
  ['max-width: 767px', ['320px', '375px', '414px']],
  ['max-width: 1023px', ['768px']],
  ['max-width: 1279px', ['1024px']],
  ['min-width: 1921px', ['1920px']],
];

/**
 * Generates responsive media query CSS for extracted component data.
 *
 * @param responsiveChanges - breakpoint change map from extraction output
 * @param childEntries - array of child elements paired with their class names
 * @param useKebabCaseClassNames - when true, applies kebabCase to child class
 *   names in the output (used by Svelte). React CSS Modules and Vue use the
 *   camelCase name directly.
 */
export function generateMediaQueries(
  responsiveChanges: Record<string, any> | string | undefined,
  childEntries: { child: ExtractedElement; className: string }[],
  useKebabCaseClassNames = false,
): string {
  if (!responsiveChanges || typeof responsiveChanges === 'string') return '';

  const lines: string[] = [];

  for (const [mediaQuery, bpKeys] of BREAKPOINT_GROUPS) {
    const rules: string[] = [];

    for (const bpKey of bpKeys) {
      const changes = responsiveChanges[bpKey];
      if (!changes) continue;

      if (changes.element) {
        const props: string[] = [];
        for (const [prop, vals] of Object.entries(changes.element) as [string, any][]) {
          const bpVal = vals[bpKey] || vals[Object.keys(vals).find(k => k !== 'desktop') || ''];
          if (bpVal && bpVal !== 'unset') {
            const normalizedVal = parseRgb(bpVal) ? rgbToHex(bpVal) : bpVal;
            props.push(`    ${cssProperty(prop)}: ${normalizedVal};`);
          }
        }
        if (props.length > 0) {
          rules.push(`  .root {\n${props.join('\n')}\n  }`);
        }
      }

      if (changes.children) {
        for (const childChange of changes.children) {
          const matched = childEntries.find(e =>
            e.child.tag === childChange.tag &&
            (!childChange.text || e.child.text?.startsWith(childChange.text))
          );
          if (!matched) continue;

          const props: string[] = [];
          for (const [prop, vals] of Object.entries(childChange.changes) as [string, any][]) {
            const bpVal = vals[Object.keys(vals).find(k => k !== 'desktop') || ''];
            if (bpVal && bpVal !== 'unset') {
              const normalizedVal = parseRgb(bpVal) ? rgbToHex(bpVal) : bpVal;
              props.push(`    ${cssProperty(prop)}: ${normalizedVal};`);
            }
          }
          if (props.length > 0) {
            const cls = useKebabCaseClassNames ? kebabCase(matched.className) : matched.className;
            rules.push(`  .${cls} {\n${props.join('\n')}\n  }`);
          }
        }
      }

      if (rules.length > 0) break;
    }

    if (rules.length > 0) {
      lines.push(`@media (${mediaQuery}) {`);
      lines.push(rules.join('\n\n'));
      lines.push(`}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── Derive Component Name ──────────────────────────────────────────────────

export function deriveComponentName(component: string): string {
  if (/^[A-Z][a-zA-Z0-9]+$/.test(component)) return component;

  const nameMap: Record<string, string> = {
    header: 'Header', nav: 'Navbar', navbar: 'Navbar', footer: 'Footer',
    hero: 'Hero', sidebar: 'Sidebar', card: 'Card', button: 'Button',
    modal: 'Modal', form: 'Form', pricing: 'Pricing', testimonial: 'Testimonials',
    faq: 'FAQ',
  };
  if (nameMap[component.toLowerCase()]) return nameMap[component.toLowerCase()];

  const cleaned = component
    .replace(/[#.\[\]="':>()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned
    .split(/[\s-_]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('') || 'Component';
}

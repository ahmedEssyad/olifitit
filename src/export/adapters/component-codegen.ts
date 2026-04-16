/**
 * Component Code Generator
 *
 * Takes extraction output from extract_component and produces
 * a working React component (.tsx) + CSS Module (.module.css).
 */

import { rgbToHex, parseRgb } from './utils';
export {
  TAG_DEFAULTS,
  UNIVERSAL_DEFAULTS,
  SKIP_PROPERTIES,
  SEMANTIC_WORDS,
  camelCase,
  kebabCase,
  cssProperty,
  generateClassName,
  filterStyles,
  collapseShorthands,
  collapseBoxProp,
  buildHoverMap,
  generateMediaQueries,
  deriveComponentName,
  type ExtractedElement,
  type HoverAnimation,
} from './codegen-shared';
import {
  camelCase,
  cssProperty,
  generateClassName,
  filterStyles,
  buildHoverMap,
  generateMediaQueries,
  deriveComponentName,
  type ExtractedElement,
  type HoverAnimation,
} from './codegen-shared';

export interface ScrollAnimation {
  element: string;
  scrollY: number;
  changes: Record<string, { from: string; to: string }>;
}

interface ComponentExtraction {
  url: string;
  component: string;
  desktop_1440: {
    element: ExtractedElement;
    children: ExtractedElement[];
    variants?: ExtractedElement[];
    totalMatches?: number;
    hoverRules?: string[];
    warnings?: string[];
  } | null;
  animations?: {
    hover?: HoverAnimation[];
    scroll?: ScrollAnimation[];
  };
  responsiveChanges?: Record<string, any> | string;
  _linkTargets?: Map<string, string>;
  _producedInteractions?: { selector: string; href?: string; text?: string }[];
}

interface GeneratedComponent {
  tsx: string;
  css: string;
  componentName: string;
  fileName: string;
}

// ── Main Generator ──────────────────────────────────────────────────────────

export function generateComponentCode(extraction: ComponentExtraction): GeneratedComponent | null {
  const data = extraction.desktop_1440;
  if (!data) return null;

  const componentName = deriveComponentName(extraction.component);
  const fileName = componentName;

  const usedNames = new Set<string>();
  usedNames.add('root');

  // Classify children and assign class names
  const childEntries = data.children.map((child, i) => ({
    child,
    className: generateClassName(child, i, data.children, usedNames),
  }));

  // Determine animation strategy
  const animStrategy = classifyAnimations(extraction.animations);

  // Build hover map: className → hover changes
  const hoverMap = buildHoverMap(extraction.animations?.hover, childEntries, data.element);

  // Build CSS
  const css = buildCssModule(
    data.element,
    childEntries,
    hoverMap,
    extraction.responsiveChanges,
    extraction.url,
  );

  // Build TSX
  const tsx = buildTsx(
    componentName,
    data.element,
    childEntries,
    animStrategy,
    extraction.animations,
    data.warnings,
    extraction._linkTargets,
  );

  return { tsx, css, componentName, fileName };
}

// ── Animation Classification ────────────────────────────────────────────────

function cssToMotionProps(styles: Record<string, string>): Record<string, any> {
  const props: Record<string, any> = {};
  for (const [key, value] of Object.entries(styles)) {
    if (key === 'opacity') props.opacity = parseFloat(value);
    else if (key === 'transform') {
      const translateY = value.match(/translateY\(([^)]+)\)/);
      const translateX = value.match(/translateX\(([^)]+)\)/);
      const scale = value.match(/scale\(([^)]+)\)/);
      if (translateY) props.y = parseFloat(translateY[1]);
      if (translateX) props.x = parseFloat(translateX[1]);
      if (scale) props.scale = parseFloat(scale[1]);
    }
  }
  return props;
}

interface AnimStrategy {
  useFramerMotion: boolean;
  hasScrollAnimation: boolean;
  motionElements: Set<string>; // class names that need motion.*
  cssHoverElements: Set<string>; // class names that use CSS :hover
  entranceElements: Map<string, { from: Record<string, string>; to: Record<string, string> }>; // element selector → entrance anim
  scrollLinkedElements: Map<string, { scrollY: number; changes: Record<string, { from: string; to: string }> }[]>; // element selector → scroll-linked anim data
}

const SIMPLE_HOVER_PROPS = new Set([
  'opacity', 'color', 'backgroundColor', 'borderColor',
  'textDecoration', 'boxShadow', 'transform', 'filter',
]);

function classifyAnimations(animations?: ComponentExtraction['animations']): AnimStrategy {
  const strategy: AnimStrategy = {
    useFramerMotion: false,
    hasScrollAnimation: false,
    motionElements: new Set(),
    cssHoverElements: new Set(),
    entranceElements: new Map(),
    scrollLinkedElements: new Map(),
  };

  if (!animations) return strategy;

  // Classify scroll animations as entrance vs scroll-linked
  if (animations.scroll && animations.scroll.length > 0) {
    strategy.useFramerMotion = true;
    strategy.hasScrollAnimation = true;

    for (const scrollAnim of animations.scroll) {
      const changes = scrollAnim.changes;
      const changedKeys = Object.keys(changes);

      // Entrance animation: triggered at a single scroll position, has opacity or transform going from hidden→visible
      const isEntrance = changedKeys.some(k => k === 'opacity' || k === 'transform');
      const hasOpacityReveal = changes.opacity && parseFloat(changes.opacity.from) < parseFloat(changes.opacity.to);
      const hasTransformReveal = changes.transform &&
        (changes.transform.from.includes('translate') || changes.transform.from.includes('scale'));

      if (isEntrance && (hasOpacityReveal || hasTransformReveal)) {
        const from: Record<string, string> = {};
        const to: Record<string, string> = {};
        for (const [prop, { from: f, to: t }] of Object.entries(changes)) {
          from[prop] = f;
          to[prop] = t;
        }
        strategy.entranceElements.set(scrollAnim.element, { from, to });
      } else {
        // Scroll-linked (parallax, continuous): accumulate all scroll positions for this element
        const existing = strategy.scrollLinkedElements.get(scrollAnim.element) || [];
        existing.push({ scrollY: scrollAnim.scrollY, changes });
        strategy.scrollLinkedElements.set(scrollAnim.element, existing);
      }
    }
  }

  // Classify hover animations
  for (const hover of animations.hover || []) {
    const changedProps = Object.keys(hover.changes);
    const isSimple = changedProps.length <= 3 && changedProps.every(p => SIMPLE_HOVER_PROPS.has(p));

    if (isSimple) {
      strategy.cssHoverElements.add(hover.element);
    } else {
      strategy.useFramerMotion = true;
      strategy.motionElements.add(hover.element);
    }
  }

  return strategy;
}

// ── CSS Module Builder ──────────────────────────────────────────────────────

function buildCssModule(
  root: ExtractedElement,
  childEntries: { child: ExtractedElement; className: string }[],
  hoverMap: Map<string, Record<string, string>>,
  responsiveChanges: ComponentExtraction['responsiveChanges'],
  url: string,
): string {
  const lines: string[] = [];

  // Header comment
  lines.push(`/* Extracted from ${url} */`);
  lines.push(`/* Generated by liftit */`);

  // Detect fonts used
  const allStyles = [root.styles, ...childEntries.map(e => e.child.styles)];
  const fonts = new Set<string>();
  for (const s of allStyles) {
    if (s.fontFamily) {
      const primary = s.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      if (primary && primary !== 'sans-serif' && primary !== 'serif' && primary !== 'monospace') {
        fonts.add(primary);
      }
    }
  }
  if (fonts.size > 0) {
    lines.push(`/* Required fonts: ${[...fonts].join(', ')} */`);
  }
  lines.push('');

  // Root styles
  const rootStyles = filterStyles(root.styles, root.tag, true);
  lines.push(`.root {`);
  for (const [prop, value] of Object.entries(rootStyles)) {
    lines.push(`  ${cssProperty(prop)}: ${value};`);
  }
  // Emit transition if present and non-default
  const rootRawTransition = root.styles.transition;
  if (rootRawTransition && rootRawTransition !== 'all 0s ease 0s' && rootRawTransition !== 'none') {
    lines.push(`  transition: ${rootRawTransition};`);
  }
  lines.push(`}`);

  // Root hover
  if (hoverMap.has('root')) {
    lines.push('');
    lines.push(`.root:hover {`);
    for (const [prop, value] of Object.entries(hoverMap.get('root')!)) {
      lines.push(`  ${cssProperty(prop)}: ${value};`);
    }
    lines.push(`}`);
  }

  // Child styles
  for (const { child, className } of childEntries) {
    const childStyles = filterStyles(child.styles, child.tag, false);
    if (Object.keys(childStyles).length === 0) continue;

    lines.push('');
    lines.push(`.${className} {`);
    for (const [prop, value] of Object.entries(childStyles)) {
      lines.push(`  ${cssProperty(prop)}: ${value};`);
    }
    // Emit transition if present in raw styles and non-default
    const rawTransition = child.styles.transition;
    if (rawTransition && rawTransition !== 'all 0s ease 0s' && rawTransition !== 'none') {
      lines.push(`  transition: ${rawTransition};`);
    }
    lines.push(`}`);

    // Child hover
    if (hoverMap.has(className)) {
      lines.push('');
      lines.push(`.${className}:hover {`);
      for (const [prop, value] of Object.entries(hoverMap.get(className)!)) {
        lines.push(`  ${cssProperty(prop)}: ${value};`);
      }
      lines.push(`}`);
    }
  }

  // Responsive media queries
  const mediaCSS = generateMediaQueries(responsiveChanges, childEntries);
  if (mediaCSS) {
    lines.push('');
    lines.push(mediaCSS);
  }

  lines.push('');
  return lines.join('\n');
}

// ── TSX Builder ─────────────────────────────────────────────────────────────

function buildTsx(
  componentName: string,
  root: ExtractedElement,
  childEntries: { child: ExtractedElement; className: string }[],
  animStrategy: AnimStrategy,
  animations: ComponentExtraction['animations'],
  warnings?: string[],
  linkTargets?: Map<string, string>,
): string {
  const lines: string[] = [];

  // "use client"
  lines.push('"use client";');
  lines.push('');

  // Imports
  if (animStrategy.useFramerMotion) {
    const imports: string[] = ['motion'];
    if (animStrategy.hasScrollAnimation) imports.push('useScroll', 'useTransform');
    lines.push(`import { ${imports.join(', ')} } from "framer-motion";`);
  }
  lines.push(`import styles from "./${componentName}.module.css";`);
  lines.push('');

  // Component function
  lines.push(`export default function ${componentName}() {`);

  // Scroll animation hooks
  if (animStrategy.hasScrollAnimation) {
    lines.push('  const { scrollY } = useScroll();');

    // Generate useTransform hooks for scroll-linked elements
    for (const [element, scrollSteps] of animStrategy.scrollLinkedElements) {
      if (scrollSteps.length >= 2) {
        const allProps = new Set<string>();
        for (const step of scrollSteps) {
          for (const prop of Object.keys(step.changes)) allProps.add(prop);
        }
        for (const prop of allProps) {
          const steps = scrollSteps.filter(s => s.changes[prop]);
          if (steps.length >= 2) {
            const scrollRange = steps.map(s => s.scrollY).join(', ');
            // Use 'from' for first keyframe, 'to' for subsequent ones
            const values = steps.map((s, i) => {
              const val = i === 0 ? s.changes[prop].from : s.changes[prop].to;
              return isNaN(parseFloat(val)) ? `"${val}"` : parseFloat(val);
            }).join(', ');
            const safeVarName = camelCase(`${element.replace(/[^a-zA-Z0-9]/g, '_')}_${prop}`);
            lines.push(`  const ${safeVarName} = useTransform(scrollY, [${scrollRange}], [${values}]);`);
          }
        }
      }
    }

    lines.push('');
  }

  lines.push('  return (');

  // Root element
  const rootTag = root.tag || 'div';
  lines.push(`    <${rootTag} className={styles.root}>`);

  // Children
  for (const { child, className } of childEntries) {
    const indent = '      ';
    const childLine = buildChildJsx(child, className, animStrategy, animations, linkTargets);
    lines.push(indent + childLine);
  }

  lines.push(`    </${rootTag}>`);
  lines.push('  );');
  lines.push('}');
  lines.push('');

  // Warnings as comments at bottom
  if (warnings && warnings.length > 0) {
    lines.push('/*');
    lines.push(' * Implementation notes:');
    for (const w of warnings) {
      lines.push(` * - ${w}`);
    }
    lines.push(' */');
    lines.push('');
  }

  return lines.join('\n');
}

function buildChildJsx(
  child: ExtractedElement,
  className: string,
  animStrategy: AnimStrategy,
  animations?: ComponentExtraction['animations'],
  linkTargets?: Map<string, string>,
): string {
  const tag = child.tag || 'div';
  const text = child.text?.trim() || '';
  const isMotion = animStrategy.motionElements.has(child.classes || '');

  // Check for entrance animation (whileInView)
  const entranceAnim = animStrategy.entranceElements.get(child.classes || '') ||
    animStrategy.entranceElements.get(child.tag || '');
  const isEntrance = !!entranceAnim;

  // Check for scroll-linked animation
  const scrollLinkedSteps = animStrategy.scrollLinkedElements.get(child.classes || '') ||
    animStrategy.scrollLinkedElements.get(child.tag || '');
  const hasScrollLinked = !!scrollLinkedSteps && scrollLinkedSteps.length >= 2;

  const needsMotion = isMotion || isEntrance || hasScrollLinked;

  // Determine if this needs framer-motion hover
  let motionHoverProps = '';
  if (isMotion && animations?.hover) {
    const hover = animations.hover.find(h => {
      const hText = h.text?.toLowerCase().trim();
      const cText = text.toLowerCase();
      return hText === cText;
    });
    if (hover) {
      const hoverObj: Record<string, any> = {};
      for (const [prop, { to }] of Object.entries(hover.changes)) {
        const numVal = parseFloat(to);
        hoverObj[prop] = isNaN(numVal) ? to : numVal;
      }
      motionHoverProps = ` whileHover={${JSON.stringify(hoverObj)}}`;
      if (hover.cssTransition) {
        const durMatch = hover.cssTransition.match(/([\d.]+)s/);
        if (durMatch) {
          motionHoverProps += ` transition={{ duration: ${durMatch[1]} }}`;
        }
      }
    }
  }

  // Build whileInView props for entrance animations
  let entranceProps = '';
  if (isEntrance && entranceAnim) {
    const fromMotion = cssToMotionProps(entranceAnim.from);
    const toMotion = cssToMotionProps(entranceAnim.to);
    // Fall back to sensible defaults if CSS parsing yields nothing
    const initial = Object.keys(fromMotion).length > 0 ? fromMotion : { opacity: 0, y: 20 };
    const whileInView = Object.keys(toMotion).length > 0 ? toMotion : { opacity: 1, y: 0 };
    entranceProps = ` initial={${JSON.stringify(initial)}} whileInView={${JSON.stringify(whileInView)}} viewport={{ once: true }} transition={{ duration: 0.6, ease: "easeOut" }}`;
  }

  // Build style prop for scroll-linked elements
  let scrollStyleProp = '';
  if (hasScrollLinked && scrollLinkedSteps) {
    const elementKey = (child.classes || child.tag || '').replace(/[^a-zA-Z0-9]/g, '_');
    const allProps = new Set<string>();
    for (const step of scrollLinkedSteps) {
      for (const prop of Object.keys(step.changes)) allProps.add(prop);
    }
    const styleEntries: string[] = [];
    for (const prop of allProps) {
      const steps = scrollLinkedSteps.filter(s => s.changes[prop]);
      if (steps.length >= 2) {
        const safeVarName = camelCase(`${elementKey}_${prop}`);
        styleEntries.push(`${prop}: ${safeVarName}`);
      }
    }
    if (styleEntries.length > 0) {
      scrollStyleProp = ` style={{ ${styleEntries.join(', ')} }}`;
    }
  }

  const tagName = needsMotion ? `motion.${tag}` : tag;
  const classAttr = `className={styles.${className}}`;

  // Self-closing tags
  if (tag === 'img') {
    return `<${tagName} ${classAttr}${entranceProps}${scrollStyleProp} src="/placeholder.svg" alt="${text || 'Image'}" />{/* Update src */}`;
  }

  if (tag === 'svg') {
    if (child.svgContent) {
      // Emit inline SVG with className
      return `<span className={styles.${className}} dangerouslySetInnerHTML={{ __html: \`${child.svgContent.replace(/`/g, '\\`')}\` }} />`;
    }
    return `<svg className={styles.${className}} />{/* Add SVG content${child.svgTooLarge ? ' (SVG too large for inline — extract separately)' : ''} */}`;
  }

  // Links
  if (tag === 'a') {
    // Resolve real href from pipeline link targets if available
    let resolvedHref = '#';
    if (linkTargets) {
      const textLower = text?.toLowerCase().trim();
      if (textLower && linkTargets.has(textLower)) resolvedHref = linkTargets.get(textLower)!;
      else if (child.classes && linkTargets.has(child.classes)) resolvedHref = linkTargets.get(child.classes)!;
    }
    const href = `href="${resolvedHref}"`;
    return `<${tagName} ${href} ${classAttr}${motionHoverProps}${entranceProps}${scrollStyleProp}>${escapeJsx(text) || 'Link'}</${tagName}>`;
  }

  // Buttons
  if (tag === 'button') {
    return `<${tagName} ${classAttr}${motionHoverProps}${entranceProps}${scrollStyleProp}>${escapeJsx(text) || 'Button'}</${tagName}>`;
  }

  // Input elements
  if (tag === 'input') {
    return `<${tagName} ${classAttr}${scrollStyleProp} />`;
  }

  // Text elements
  if (text) {
    return `<${tagName} ${classAttr}${motionHoverProps}${entranceProps}${scrollStyleProp}>${escapeJsx(text)}</${tagName}>`;
  }

  // Container divs (likely has nested content)
  return `<${tagName} ${classAttr}${motionHoverProps}${entranceProps}${scrollStyleProp}>{/* Nested content */}</${tagName}>`;
}

function escapeJsx(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Tailwind Class Generation ──────────────────────────────────────────────

interface TailwindGeneratedComponent {
  tsx: string;
  componentName: string;
  fileName: string;
}

/**
 * Generate a React component using Tailwind utility classes instead of CSS Modules.
 * Maps extracted computed styles to Tailwind classes (best-effort).
 * Exact values that don't match Tailwind's scale use arbitrary syntax like `text-[rgb(255,0,0)]`.
 */
export function generateTailwindComponentCode(extraction: ComponentExtraction): TailwindGeneratedComponent | null {
  const data = extraction.desktop_1440;
  if (!data) return null;

  const componentName = deriveComponentName(extraction.component);
  const fileName = componentName;

  const usedNames = new Set<string>();
  usedNames.add('root');

  const childEntries = data.children.map((child, i) => ({
    child,
    className: generateClassName(child, i, data.children, usedNames),
  }));

  const animStrategy = classifyAnimations(extraction.animations);

  // Build TSX with Tailwind classes
  const lines: string[] = [];

  lines.push('"use client";');
  lines.push('');

  if (animStrategy.useFramerMotion) {
    const imports: string[] = ['motion'];
    if (animStrategy.hasScrollAnimation) imports.push('useScroll', 'useTransform');
    lines.push(`import { ${imports.join(', ')} } from "framer-motion";`);
    lines.push('');
  }

  lines.push(`export default function ${componentName}() {`);

  if (animStrategy.hasScrollAnimation) {
    lines.push('  const { scrollY } = useScroll();');
    lines.push('');
  }

  lines.push('  return (');

  const rootTag = data.element.tag || 'div';
  const rootTwClasses = stylesToTailwind(filterStyles(data.element.styles, rootTag, true));
  lines.push(`    <${rootTag} className="${rootTwClasses}">`);

  for (const { child, className } of childEntries) {
    const indent = '      ';
    const childLine = buildTailwindChildJsx(child, className, animStrategy, extraction.animations);
    lines.push(indent + childLine);
  }

  lines.push(`    </${rootTag}>`);
  lines.push('  );');
  lines.push('}');
  lines.push('');

  if (data.warnings && data.warnings.length > 0) {
    lines.push('/*');
    lines.push(' * Implementation notes:');
    for (const w of data.warnings) {
      lines.push(` * - ${w}`);
    }
    lines.push(' */');
    lines.push('');
  }

  return { tsx: lines.join('\n'), componentName, fileName };
}

function buildTailwindChildJsx(
  child: ExtractedElement,
  _className: string,
  animStrategy: AnimStrategy,
  animations?: ComponentExtraction['animations'],
): string {
  const tag = child.tag || 'div';
  const text = child.text?.trim() || '';
  const isMotion = animStrategy.motionElements.has(child.classes || '');

  let motionHoverProps = '';
  if (isMotion && animations?.hover) {
    const hover = animations.hover.find(h => {
      const hText = h.text?.toLowerCase().trim();
      const cText = text.toLowerCase();
      return hText === cText;
    });
    if (hover) {
      const hoverObj: Record<string, any> = {};
      for (const [prop, { to }] of Object.entries(hover.changes)) {
        const numVal = parseFloat(to);
        hoverObj[prop] = isNaN(numVal) ? to : numVal;
      }
      motionHoverProps = ` whileHover={${JSON.stringify(hoverObj)}}`;
      if (hover.cssTransition) {
        const durMatch = hover.cssTransition.match(/([\d.]+)s/);
        if (durMatch) {
          motionHoverProps += ` transition={{ duration: ${durMatch[1]} }}`;
        }
      }
    }
  }

  const tagName = isMotion ? `motion.${tag}` : tag;
  const twClasses = stylesToTailwind(filterStyles(child.styles, tag, false));
  const classAttr = twClasses ? `className="${twClasses}"` : '';

  if (tag === 'img') {
    return `<${tagName} ${classAttr} src="/placeholder.svg" alt="${text || 'Image'}" />{/* Update src */}`;
  }
  if (tag === 'svg') {
    return `<${tagName} ${classAttr} />{/* Add SVG content */}`;
  }
  if (tag === 'a') {
    return `<${tagName} href="#" ${classAttr}${motionHoverProps}>${escapeJsx(text) || 'Link'}</${tagName}>`;
  }
  if (tag === 'button') {
    return `<${tagName} ${classAttr}${motionHoverProps}>${escapeJsx(text) || 'Button'}</${tagName}>`;
  }
  if (tag === 'input') {
    return `<${tagName} ${classAttr} />`;
  }
  if (text) {
    return `<${tagName} ${classAttr}${motionHoverProps}>${escapeJsx(text)}</${tagName}>`;
  }
  return `<${tagName} ${classAttr}${motionHoverProps}>{/* Nested content */}</${tagName}>`;
}

// ── Style to Tailwind Mapping ──────────────────────────────────────────────

// Standard Tailwind spacing scale (in px)
const TW_SPACING: Record<number, string> = {
  0: '0', 1: 'px', 2: '0.5', 4: '1', 6: '1.5', 8: '2', 10: '2.5', 12: '3',
  14: '3.5', 16: '4', 20: '5', 24: '6', 28: '7', 32: '8', 36: '9', 40: '10',
  44: '11', 48: '12', 56: '14', 64: '16', 80: '20', 96: '24', 112: '28',
  128: '32', 144: '36', 160: '40', 176: '44', 192: '48', 208: '52', 224: '56',
  240: '60', 256: '64', 288: '72', 320: '80', 384: '96',
};

// Standard Tailwind color map (common named colors)
const TW_COLORS: Record<string, string> = {
  '#000000': 'black', '#ffffff': 'white', '#ef4444': 'red-500', '#f97316': 'orange-500',
  '#eab308': 'yellow-500', '#22c55e': 'green-500', '#3b82f6': 'blue-500',
  '#6366f1': 'indigo-500', '#a855f7': 'purple-500', '#ec4899': 'pink-500',
  '#f87171': 'red-400', '#fb923c': 'orange-400', '#facc15': 'yellow-400',
  '#4ade80': 'green-400', '#60a5fa': 'blue-400', '#818cf8': 'indigo-400',
  '#c084fc': 'purple-400', '#f472b6': 'pink-400',
  '#dc2626': 'red-600', '#ea580c': 'orange-600', '#ca8a04': 'yellow-600',
  '#16a34a': 'green-600', '#2563eb': 'blue-600', '#4f46e5': 'indigo-600',
  '#9333ea': 'purple-600', '#db2777': 'pink-600',
  '#f5f5f5': 'neutral-100', '#e5e5e5': 'neutral-200', '#d4d4d4': 'neutral-300',
  '#a3a3a3': 'neutral-400', '#737373': 'neutral-500', '#525252': 'neutral-600',
  '#404040': 'neutral-700', '#262626': 'neutral-800', '#171717': 'neutral-900',
  'transparent': 'transparent',
};

const TW_FONT_SIZES: Record<string, string> = {
  '12px': 'xs', '14px': 'sm', '16px': 'base', '18px': 'lg', '20px': 'xl',
  '24px': '2xl', '30px': '3xl', '36px': '4xl', '48px': '5xl', '60px': '6xl',
  '72px': '7xl', '96px': '8xl', '128px': '9xl',
};

const TW_FONT_WEIGHTS: Record<string, string> = {
  '100': 'thin', '200': 'extralight', '300': 'light', '400': 'normal',
  '500': 'medium', '600': 'semibold', '700': 'bold', '800': 'extrabold', '900': 'black',
};

const TW_BORDER_RADIUS: Record<string, string> = {
  '0px': 'none', '2px': 'sm', '4px': 'rounded', '6px': 'md', '8px': 'lg',
  '12px': 'xl', '16px': '2xl', '24px': '3xl', '9999px': 'full',
};

function pxToSpacing(value: string): string | null {
  const num = parseFloat(value);
  if (isNaN(num)) return null;
  if (TW_SPACING[num] !== undefined) return TW_SPACING[num];
  return null;
}

function colorToTw(value: string, prefix: string): string {
  // Convert rgb to hex for lookup
  const parsed = parseRgb(value);
  if (parsed) {
    const hex = rgbToHex(value).toLowerCase();
    if (TW_COLORS[hex]) return `${prefix}-${TW_COLORS[hex]}`;
    return `${prefix}-[${value}]`;
  }
  const lower = value.toLowerCase();
  if (TW_COLORS[lower]) return `${prefix}-${TW_COLORS[lower]}`;
  if (lower === 'transparent') return `${prefix}-transparent`;
  return `${prefix}-[${value}]`;
}

function stylesToTailwind(styles: Record<string, string>): string {
  const classes: string[] = [];

  for (const [prop, value] of Object.entries(styles)) {
    const cls = mapSingleStyle(prop, value);
    if (cls) classes.push(cls);
  }

  return classes.join(' ');
}

function mapSingleStyle(prop: string, value: string): string {
  switch (prop) {
    // Display
    case 'display':
      if (value === 'flex') return 'flex';
      if (value === 'grid') return 'grid';
      if (value === 'inline-flex') return 'inline-flex';
      if (value === 'inline-grid') return 'inline-grid';
      if (value === 'inline') return 'inline';
      if (value === 'block') return 'block';
      if (value === 'none') return 'hidden';
      if (value === 'inline-block') return 'inline-block';
      return `[display:${value}]`;

    // Flex
    case 'flexDirection':
      if (value === 'column') return 'flex-col';
      if (value === 'column-reverse') return 'flex-col-reverse';
      if (value === 'row-reverse') return 'flex-row-reverse';
      return '';
    case 'flexWrap':
      if (value === 'wrap') return 'flex-wrap';
      if (value === 'wrap-reverse') return 'flex-wrap-reverse';
      return '';
    case 'alignItems':
      if (value === 'center') return 'items-center';
      if (value === 'flex-start') return 'items-start';
      if (value === 'flex-end') return 'items-end';
      if (value === 'stretch') return 'items-stretch';
      if (value === 'baseline') return 'items-baseline';
      return `[align-items:${value}]`;
    case 'justifyContent':
      if (value === 'center') return 'justify-center';
      if (value === 'flex-start') return 'justify-start';
      if (value === 'flex-end') return 'justify-end';
      if (value === 'space-between') return 'justify-between';
      if (value === 'space-around') return 'justify-around';
      if (value === 'space-evenly') return 'justify-evenly';
      return `[justify-content:${value}]`;

    // Gap
    case 'gap': {
      const sp = pxToSpacing(value);
      return sp ? `gap-${sp}` : `gap-[${value}]`;
    }
    case 'rowGap': {
      const sp = pxToSpacing(value);
      return sp ? `gap-y-${sp}` : `gap-y-[${value}]`;
    }
    case 'columnGap': {
      const sp = pxToSpacing(value);
      return sp ? `gap-x-${sp}` : `gap-x-[${value}]`;
    }

    // Spacing
    case 'padding': {
      const sp = pxToSpacing(value);
      return sp ? `p-${sp}` : `p-[${value}]`;
    }
    case 'paddingTop': { const sp = pxToSpacing(value); return sp ? `pt-${sp}` : `pt-[${value}]`; }
    case 'paddingRight': { const sp = pxToSpacing(value); return sp ? `pr-${sp}` : `pr-[${value}]`; }
    case 'paddingBottom': { const sp = pxToSpacing(value); return sp ? `pb-${sp}` : `pb-[${value}]`; }
    case 'paddingLeft': { const sp = pxToSpacing(value); return sp ? `pl-${sp}` : `pl-[${value}]`; }
    case 'margin': {
      if (value === '0px auto') return 'mx-auto';
      const sp = pxToSpacing(value);
      return sp ? `m-${sp}` : `m-[${value}]`;
    }
    case 'marginTop': { const sp = pxToSpacing(value); return sp ? `mt-${sp}` : `mt-[${value}]`; }
    case 'marginRight': { const sp = pxToSpacing(value); return sp ? `mr-${sp}` : `mr-[${value}]`; }
    case 'marginBottom': { const sp = pxToSpacing(value); return sp ? `mb-${sp}` : `mb-[${value}]`; }
    case 'marginLeft': { const sp = pxToSpacing(value); return sp ? `ml-${sp}` : `ml-[${value}]`; }

    // Sizing
    case 'width':
      if (value === '100%') return 'w-full';
      if (value === 'auto') return 'w-auto';
      if (value === 'fit-content') return 'w-fit';
      if (value === 'max-content') return 'w-max';
      if (value === 'min-content') return 'w-min';
      { const sp = pxToSpacing(value); return sp ? `w-${sp}` : `w-[${value}]`; }
    case 'height':
      if (value === '100%') return 'h-full';
      if (value === 'auto') return 'h-auto';
      if (value === '100vh') return 'h-screen';
      if (value === 'fit-content') return 'h-fit';
      { const sp = pxToSpacing(value); return sp ? `h-${sp}` : `h-[${value}]`; }
    case 'maxWidth':
      if (value === '100%') return 'max-w-full';
      if (value === 'none') return 'max-w-none';
      return `max-w-[${value}]`;
    case 'minWidth':
      return `min-w-[${value}]`;
    case 'maxHeight':
      if (value === '100%') return 'max-h-full';
      if (value === '100vh') return 'max-h-screen';
      return `max-h-[${value}]`;
    case 'minHeight':
      if (value === '100vh') return 'min-h-screen';
      return `min-h-[${value}]`;

    // Position
    case 'position':
      if (value === 'relative') return 'relative';
      if (value === 'absolute') return 'absolute';
      if (value === 'fixed') return 'fixed';
      if (value === 'sticky') return 'sticky';
      return '';
    case 'top': return value === '0px' ? 'top-0' : `top-[${value}]`;
    case 'right': return value === '0px' ? 'right-0' : `right-[${value}]`;
    case 'bottom': return value === '0px' ? 'bottom-0' : `bottom-[${value}]`;
    case 'left': return value === '0px' ? 'left-0' : `left-[${value}]`;

    // Typography
    case 'fontSize':
      return TW_FONT_SIZES[value] ? `text-${TW_FONT_SIZES[value]}` : `text-[${value}]`;
    case 'fontWeight':
      return TW_FONT_WEIGHTS[value] ? `font-${TW_FONT_WEIGHTS[value]}` : `font-[${value}]`;
    case 'lineHeight':
      if (value === '1') return 'leading-none';
      if (value === '1.25') return 'leading-tight';
      if (value === '1.5') return 'leading-normal';
      if (value === '2') return 'leading-loose';
      return `leading-[${value}]`;
    case 'letterSpacing':
      return `tracking-[${value}]`;
    case 'textAlign':
      return `text-${value}`;
    case 'textDecoration':
      if (value === 'underline') return 'underline';
      if (value === 'line-through') return 'line-through';
      if (value === 'none') return 'no-underline';
      return '';
    case 'textTransform':
      if (value === 'uppercase') return 'uppercase';
      if (value === 'lowercase') return 'lowercase';
      if (value === 'capitalize') return 'capitalize';
      return '';
    case 'fontFamily':
      return `font-[${value.split(',')[0].replace(/['"]/g, '').trim()}]`;

    // Colors
    case 'color':
      return colorToTw(value, 'text');
    case 'backgroundColor':
      return colorToTw(value, 'bg');
    case 'borderColor':
      return colorToTw(value, 'border');

    // Border
    case 'borderWidth':
      if (value === '0px') return 'border-0';
      if (value === '1px') return 'border';
      if (value === '2px') return 'border-2';
      if (value === '4px') return 'border-4';
      if (value === '8px') return 'border-8';
      return `border-[${value}]`;
    case 'borderRadius':
      if (TW_BORDER_RADIUS[value]) return `rounded-${TW_BORDER_RADIUS[value]}`;
      if (value === '50%') return 'rounded-full';
      return `rounded-[${value}]`;
    case 'borderStyle':
      if (value === 'solid') return 'border-solid';
      if (value === 'dashed') return 'border-dashed';
      if (value === 'dotted') return 'border-dotted';
      if (value === 'none') return 'border-none';
      return '';

    // Effects
    case 'opacity':
      return `opacity-[${value}]`;
    case 'boxShadow':
      if (value === 'none') return 'shadow-none';
      return `shadow-[${value.replace(/\s+/g, '_')}]`;
    case 'overflow':
      return `overflow-${value}`;
    case 'overflowX':
      return `overflow-x-${value}`;
    case 'overflowY':
      return `overflow-y-${value}`;

    // Transform
    case 'transform':
      if (value === 'none') return '';
      return `[transform:${value.replace(/\s+/g, '_')}]`;

    // Transition
    case 'transition':
      if (value === 'none' || value === 'all 0s ease 0s') return '';
      return `[transition:${value.replace(/\s+/g, '_')}]`;

    // Grid
    case 'gridTemplateColumns':
      return `[grid-template-columns:${value.replace(/\s+/g, '_')}]`;
    case 'gridTemplateRows':
      return `[grid-template-rows:${value.replace(/\s+/g, '_')}]`;

    // Cursor
    case 'cursor':
      return `cursor-${value}`;

    default:
      // Fallback: use arbitrary property syntax
      const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
      return `[${cssProp}:${value.replace(/\s+/g, '_')}]`;
  }
}

/**
 * Svelte Component Code Generator
 *
 * Takes extraction output from extract_component and produces
 * a working Svelte component (.svelte) with auto-scoped styles.
 */

import {
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

// ── Types ──────────────────────────────────────────────────────────────────

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
    scroll?: Record<string, unknown>[];
  };
  responsiveChanges?: Record<string, any> | string;
}

interface GeneratedSvelteComponent {
  svelte: string;
  componentName: string;
  fileName: string;
}

// ── Main Generator ─────────────────────────────────────────────────────────

export function generateSvelteComponentCode(extraction: ComponentExtraction, componentName?: string): GeneratedSvelteComponent | null {
  const data = extraction.desktop_1440;
  if (!data) return null;

  const resolvedName = componentName || deriveComponentName(extraction.component);
  const fileName = resolvedName;

  const usedNames = new Set<string>();
  usedNames.add('root');

  const childEntries = data.children.map((child: ExtractedElement, i: number) => ({
    child,
    className: generateClassName(child, i, data.children, usedNames),
  }));

  const hoverMap = buildHoverMap(extraction.animations?.hover, childEntries, data.element);

  const hasScrollAnimation = extraction.animations?.scroll && extraction.animations.scroll.length > 0;

  // Build script
  const script = buildScript(resolvedName, hasScrollAnimation ?? false);

  // Build markup
  const markup = buildMarkup(data.element, childEntries);

  // Build styles
  const styles = buildStyles(
    data.element,
    childEntries,
    hoverMap,
    extraction.responsiveChanges,
    extraction.url,
  );

  const svelte = [script, '', markup, '', styles, ''].join('\n');

  return { svelte, componentName: resolvedName, fileName };
}

// ── Script Builder ─────────────────────────────────────────────────────────

function buildScript(componentName: string, hasScrollAnimation: boolean): string {
  const lines: string[] = [];

  lines.push('<script lang="ts">');

  if (hasScrollAnimation) {
    lines.push("  import { onMount, onDestroy } from 'svelte';");
    lines.push('');
    lines.push('  let scrollY = 0;');
    lines.push('');
    lines.push('  function onScroll() {');
    lines.push('    scrollY = window.scrollY;');
    lines.push('  }');
    lines.push('');
    lines.push("  onMount(() => window.addEventListener('scroll', onScroll));");
    lines.push("  onDestroy(() => window.removeEventListener('scroll', onScroll));");
  } else {
    lines.push(`  // ${componentName} — extracted by liftit`);
  }

  lines.push('</script>');

  return lines.join('\n');
}

// ── Markup Builder ─────────────────────────────────────────────────────────

function buildMarkup(
  root: ExtractedElement,
  childEntries: { child: ExtractedElement; className: string }[],
): string {
  const lines: string[] = [];
  const rootTag = root.tag || 'div';

  lines.push(`<${rootTag} class="root">`);

  for (const { child, className } of childEntries) {
    const indent = '  ';
    const childLine = buildChildMarkup(child, className);
    lines.push(indent + childLine);
  }

  lines.push(`</${rootTag}>`);

  return lines.join('\n');
}

function buildChildMarkup(child: ExtractedElement, className: string): string {
  const tag = child.tag || 'div';
  const text = child.text?.trim() || '';
  const cssClassName = kebabCase(className);
  const classAttr = `class="${cssClassName}"`;

  if (tag === 'img') {
    return `<${tag} ${classAttr} src="/placeholder.svg" alt="${escapeHtml(text) || 'Image'}" /><!-- Update src -->`;
  }
  if (tag === 'svg') {
    return `<${tag} ${classAttr} /><!-- Add SVG content -->`;
  }
  if (tag === 'a') {
    return `<${tag} href="#" ${classAttr}>${escapeHtml(text) || 'Link'}</${tag}>`;
  }
  if (tag === 'button') {
    return `<${tag} ${classAttr}>${escapeHtml(text) || 'Button'}</${tag}>`;
  }
  if (tag === 'input') {
    return `<${tag} ${classAttr} />`;
  }
  if (text) {
    return `<${tag} ${classAttr}>${escapeHtml(text)}</${tag}>`;
  }
  return `<${tag} ${classAttr}><!-- Nested content --></${tag}>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Style Builder ──────────────────────────────────────────────────────────

function buildStyles(
  root: ExtractedElement,
  childEntries: { child: ExtractedElement; className: string }[],
  hoverMap: Map<string, Record<string, string>>,
  responsiveChanges: ComponentExtraction['responsiveChanges'],
  url: string,
): string {
  const lines: string[] = [];

  lines.push('<style>');
  lines.push(`  /* Extracted from ${url} */`);
  lines.push('  /* Generated by liftit */');

  // Detect fonts
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
    lines.push(`  /* Required fonts: ${[...fonts].join(', ')} */`);
  }
  lines.push('');

  // Root styles
  const rootStyles = filterStyles(root.styles, root.tag, true);
  lines.push(`  .root {`);
  for (const [prop, value] of Object.entries(rootStyles)) {
    lines.push(`    ${cssProperty(prop)}: ${value};`);
  }
  lines.push(`  }`);

  // Root hover
  if (hoverMap.has('root')) {
    lines.push('');
    lines.push(`  .root:hover {`);
    for (const [prop, value] of Object.entries(hoverMap.get('root')!)) {
      lines.push(`    ${cssProperty(prop)}: ${value};`);
    }
    lines.push(`  }`);
  }

  // Child styles
  for (const { child, className } of childEntries) {
    const childStyles = filterStyles(child.styles, child.tag, false);
    if (Object.keys(childStyles).length === 0) continue;

    const cssClassName = kebabCase(className);
    lines.push('');
    lines.push(`  .${cssClassName} {`);
    for (const [prop, value] of Object.entries(childStyles)) {
      lines.push(`    ${cssProperty(prop)}: ${value};`);
    }
    lines.push(`  }`);

    // Child hover
    if (hoverMap.has(className)) {
      lines.push('');
      lines.push(`  .${cssClassName}:hover {`);
      for (const [prop, value] of Object.entries(hoverMap.get(className)!)) {
        lines.push(`    ${cssProperty(prop)}: ${value};`);
      }
      lines.push(`  }`);
    }
  }

  // Responsive media queries (indented for Svelte style block)
  const mediaCSS = generateMediaQueries(responsiveChanges, childEntries, true);
  if (mediaCSS) {
    lines.push('');
    // Indent media queries inside the style block
    for (const line of mediaCSS.split('\n')) {
      lines.push(line ? `  ${line}` : '');
    }
  }

  lines.push('</style>');

  return lines.join('\n');
}

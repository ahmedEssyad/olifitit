/**
 * DESIGN.md Adapter — Stitch-compatible design system markdown
 *
 * Generates a 9-section DESIGN.md that AI coding agents can consume
 * to produce on-brand UI. Compatible with the Stitch format popularized
 * by awesome-design-md.
 *
 * Unlike other adapters that only use DesignData, this one also reads
 * enriched extraction files (motion, interactions, patterns, analysis)
 * to produce richer output than hand-curated alternatives.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DesignData } from './reader';
import { rgbToHex, classifyFont, parseFontStack, buildRadiusMap } from './utils';
import { DistilledMotion, DistilledAnimation } from '../../core/types/distiller';
import { DisplayPatterns, LayoutStrategy } from '../../core/types/patterns';
import { InteractionResult } from '../../core/types/interactions';
import { AnalysisResult, ComponentCandidate } from '../../core/types/analyzer';
import { ElementData, ResponsiveSnapshot } from '../../core/types/scanner';
import { AnimationInteractionLink } from '../../core/types/scroll-interactions';

// ── Types ───────────────────────────────────────────────────────────────────

export interface DesignMdOptions {
  outputDir: string;
  inputDir: string;
  filename?: string;
}

interface DesignSystemJson {
  components?: DesignSystemComponent[];
  metadata?: { sourceUrl?: string };
  meta?: { url?: string };
  url?: string;
}

interface DesignSystemComponent {
  selector?: string;
  name?: string;
  description?: string;
  baseStyles?: Record<string, string>;
  states?: Record<string, Record<string, string>>;
  variants?: DesignSystemVariant[];
  compositionRules?: string;
}

interface DesignSystemVariant {
  selector?: string;
  name?: string;
}

interface EnrichedData {
  motion: DistilledMotion | null;
  patterns: DisplayPatterns | null;
  interactions: InteractionResult | null;
  analysis: AnalysisResult | null;
  designSystem: DesignSystemJson | null;
  scan: ScanData | null;
  semanticMap: Map<string, string>;
  layoutMap: Map<string, LayoutInfo>;
}

interface ScanData {
  domTree: ElementData[];
  responsiveSnapshots: ResponsiveSnapshot[];
}

interface LayoutInfo {
  base: Record<string, string>;
  responsive: { breakpoint: number; changes: Record<string, string> }[];
}

// ── Main ────────────────────────────────────────────────────────────────────

export function generateDesignMd(data: DesignData, opts: DesignMdOptions): string {
  const enriched = readEnrichedData(opts.inputDir);
  enriched.semanticMap = buildSemanticMap(enriched);
  enriched.layoutMap = buildLayoutMap(enriched);
  const lines: string[] = [];

  const siteName = deriveSiteName(data.sourceUrl);

  lines.push(`# ${siteName} — Design System`);
  lines.push('');

  buildSection1_VisualTheme(lines, data, enriched);
  buildSection2_ColorPalette(lines, data);
  buildSection3_Typography(lines, data);
  buildSection4_ComponentStylings(lines, data, enriched);
  buildSection5_LayoutPrinciples(lines, data, enriched);
  buildSection6_DepthElevation(lines, data);
  buildSection7_DosAndDonts(lines, data, enriched);
  buildSection8_ResponsiveBehavior(lines, data, enriched);
  buildSection9_AgentPromptGuide(lines, data, enriched);
  buildSection10_Animations(lines, enriched);

  const markdown = lines.join('\n');
  const outputPath = path.join(opts.outputDir, opts.filename || 'DESIGN.md');
  fs.mkdirSync(opts.outputDir, { recursive: true });
  fs.writeFileSync(outputPath, markdown);

  return outputPath;
}

// ── Enriched Data Reader ────────────────────────────────────────────────────

function readEnrichedData(inputDir: string): EnrichedData {
  const safeRead = (file: string): unknown => {
    const p = path.join(inputDir, file);
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
    }
    return null;
  };

  // Read scan-result.json for domTree + responsive snapshots (layout data)
  const scanRaw = safeRead('scan-result.json') as Record<string, unknown> | null;
  const scan: ScanData | null = scanRaw ? {
    domTree: (scanRaw.domTree as ElementData[]) || [],
    responsiveSnapshots: (scanRaw.responsiveSnapshots as ResponsiveSnapshot[]) || [],
  } : null;

  return {
    motion: safeRead('motion-distilled.json') as DistilledMotion | null,
    patterns: safeRead('display-patterns.json') as DisplayPatterns | null,
    interactions: safeRead('interactions.json') as InteractionResult | null,
    analysis: safeRead('analysis-result.json') as AnalysisResult | null,
    designSystem: safeRead('design-system.json') as DesignSystemJson | null,
    scan,
    semanticMap: new Map(), // populated after construction
    layoutMap: new Map(),
  };
}

// ── Semantic Name Resolver ───────────────────────────────────────────────────

const SEMANTIC_TAGS = new Set(['nav', 'footer', 'header', 'main', 'aside', 'section', 'article', 'form', 'button', 'dialog']);

function buildSemanticMap(enriched: EnrichedData): Map<string, string> {
  const map = new Map<string, string>();

  // 1. Display patterns: selector → section type (highest priority)
  for (const section of enriched.patterns?.sections || []) {
    if (section.selector && section.type) {
      map.set(section.selector, section.type);
    }
  }

  // 2. Analysis components: selector → pattern
  for (const comp of enriched.analysis?.components || []) {
    if (comp.selector && !map.has(comp.selector)) {
      const name = comp.pattern || comp.tag;
      if (name && name !== 'style-cluster-div' && name !== 'style-cluster-a') {
        map.set(comp.selector, name);
      }
    }
  }

  // 3. Interaction links/buttons: selector → "link-{text}" or "button-{text}"
  const nav = enriched.interactions?.navigation;
  for (const link of [...(nav?.internal || []), ...(nav?.external || [])]) {
    if (link.selector && link.text && !map.has(link.selector)) {
      const slug = slugifyText(link.text);
      if (slug) map.set(link.selector, `link-${slug}`);
    }
  }
  for (const toggle of enriched.interactions?.toggles || []) {
    if (toggle.trigger && toggle.triggerText && !map.has(toggle.trigger)) {
      map.set(toggle.trigger, `toggle-${slugifyText(toggle.triggerText)}`);
    }
  }

  // 4. DOM tree: tag + id + textContent
  for (const el of enriched.scan?.domTree || []) {
    if (!el.selector || map.has(el.selector)) continue;

    // Elements with semantic HTML tags
    if (SEMANTIC_TAGS.has(el.tag)) {
      const hint = el.id || slugifyText(el.textContent) || '';
      map.set(el.selector, hint ? `${el.tag}-${hint}` : el.tag);
      continue;
    }

    // Elements with meaningful IDs
    if (el.id && !el.id.match(/^[a-f0-9-]{8,}$/i)) {
      map.set(el.selector, el.id);
      continue;
    }

    // Headings with text content
    if (/^h[1-6]$/.test(el.tag) && el.textContent) {
      map.set(el.selector, `heading-${slugifyText(el.textContent)}`);
    }
  }

  return map;
}

function slugifyText(text: string): string {
  if (!text) return '';
  return text.trim().toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 30)
    .replace(/-$/, '');
}

/** Resolve a selector to its semantic name, falling back to a cleaned version of the selector */
function sem(selector: string, map: Map<string, string>): string {
  // Direct lookup
  const name = map.get(selector);
  if (name) return name;

  // Try partial match (selector may be compound: "div.framer-x + nav.framer-y")
  for (const [key, val] of map) {
    if (selector.includes(key) || key.includes(selector)) return val;
  }

  // Fallback: extract tag and clean up hash classes
  const tag = selector.match(/^([a-z][a-z0-9]*)/)?.[1] || '';
  const id = selector.match(/#([a-z][\w-]*)/i)?.[1] || '';
  if (id) return id;
  if (tag && SEMANTIC_TAGS.has(tag)) return tag;

  // Last resort: truncate selector
  return selector.length > 40 ? selector.slice(0, 37) + '...' : selector;
}

// ── Layout Data Extractor ───────────────────────────────────────────────────

const LAYOUT_PROPS = [
  'display', 'flexDirection', 'flexWrap', 'gap',
  'justifyContent', 'alignItems',
  'gridTemplateColumns', 'gridTemplateRows',
  'padding', 'maxWidth', 'overflow',
];

const LAYOUT_DEFAULTS: Record<string, Set<string>> = {
  display: new Set(['block', 'inline']),
  flexDirection: new Set(['row']),
  flexWrap: new Set(['nowrap']),
  gap: new Set(['normal', '0px']),
  justifyContent: new Set(['normal', 'flex-start']),
  alignItems: new Set(['normal', 'stretch']),
  gridTemplateColumns: new Set(['none']),
  gridTemplateRows: new Set(['none']),
  padding: new Set(['0px']),
  maxWidth: new Set(['none']),
  overflow: new Set(['visible']),
};

function buildLayoutMap(enriched: EnrichedData): Map<string, LayoutInfo> {
  const map = new Map<string, LayoutInfo>();
  if (!enriched.scan) return map;

  // Index domTree elements by selector AND by tag+class fragments for fuzzy matching
  const domBySelector = new Map<string, ElementData>();
  const domByFragment = new Map<string, ElementData>();
  for (const el of enriched.scan.domTree) {
    if (!el.selector || !el.computedStyles) continue;
    domBySelector.set(el.selector, el);
    // Index by id
    if (el.id) domByFragment.set(`#${el.id}`, el);
    // Index by tag.class combos
    const classes: string[] = el.classes || [];
    if (el.tag && classes.length > 0) {
      domByFragment.set(`${el.tag}.${classes[0]}`, el);
      if (classes.length >= 2) {
        domByFragment.set(`${el.tag}.${classes[0]}.${classes[1]}`, el);
      }
    }
  }

  // Fuzzy lookup: find domTree element matching an analysis-style selector
  function findElement(selector: string): ElementData | null {
    if (domBySelector.has(selector)) return domBySelector.get(selector) ?? null;
    // Try id match: #main-1
    const idMatch = selector.match(/#([\w-]+)/);
    if (idMatch && domByFragment.has(`#${idMatch[1]}`)) return domByFragment.get(`#${idMatch[1]}`) ?? null;
    // Try tag.class match: nav.framer-dre0J
    const classMatch = selector.match(/^([a-z]+)\.([\w-]+)/);
    if (classMatch) {
      const key = `${classMatch[1]}.${classMatch[2]}`;
      if (domByFragment.has(key)) return domByFragment.get(key) ?? null;
    }
    return null;
  }

  // Build responsive index: domTree-selector → { breakpoint → styles }
  const keyBreakpoints = [375, 768, 1024];
  const responsiveIndex = new Map<string, Map<number, Record<string, string>>>();
  for (const snap of enriched.scan.responsiveSnapshots) {
    if (!keyBreakpoints.includes(snap.breakpoint)) continue;
    for (const el of snap.elements || []) {
      if (!el.selector || !el.computedStyles) continue;
      if (!responsiveIndex.has(el.selector)) responsiveIndex.set(el.selector, new Map());
      responsiveIndex.get(el.selector)!.set(snap.breakpoint, el.computedStyles);
    }
  }

  // For each analysis component, extract layout data
  const componentSelectors: string[] = [];
  for (const comp of (enriched.analysis?.components || []) as ComponentCandidate[]) {
    if (comp.selector) componentSelectors.push(comp.selector);
  }
  const dsComps = enriched.designSystem?.components;
  if (Array.isArray(dsComps)) {
    for (const comp of dsComps as DesignSystemComponent[]) {
      if (comp.selector) componentSelectors.push(comp.selector);
    }
  }

  for (const selector of componentSelectors) {
    if (map.has(selector)) continue;
    const el = findElement(selector);
    if (!el) continue;

    // Extract non-default layout properties
    const base: Record<string, string> = {};
    for (const prop of LAYOUT_PROPS) {
      const val = el.computedStyles[prop];
      if (val && !LAYOUT_DEFAULTS[prop]?.has(val)) {
        base[prop] = val;
      }
    }
    if (Object.keys(base).length === 0) continue;

    // Get responsive diffs
    const responsive: { breakpoint: number; changes: Record<string, string> }[] = [];
    const respData = responsiveIndex.get(el.selector);
    if (respData) {
      for (const bp of keyBreakpoints) {
        const bpStyles = respData.get(bp);
        if (!bpStyles) continue;
        const changes: Record<string, string> = {};
        for (const prop of LAYOUT_PROPS) {
          const snapVal = bpStyles[prop];
          const baseVal = base[prop];
          if (snapVal && baseVal && snapVal !== baseVal && !LAYOUT_DEFAULTS[prop]?.has(snapVal)) {
            changes[prop] = snapVal;
          }
        }
        if (Object.keys(changes).length > 0) {
          responsive.push({ breakpoint: bp, changes });
        }
      }
    }

    map.set(selector, {
      base,
      responsive: responsive.sort((a, b) => b.breakpoint - a.breakpoint),
    });
  }

  return map;
}

function formatLayoutProps(props: Record<string, string>): string {
  return Object.entries(props)
    .map(([k, v]) => `\`${formatCssProp(k)}: ${v}\``)
    .join(', ');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function deriveSiteName(url: string): string {
  if (!url) return 'Design System';
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // Capitalize: "linear.app" → "Linear.app", "stripe.com" → "Stripe"
    const name = hostname.replace(/\.(com|io|dev|app|co|org|net)$/, '');
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return 'Design System';
  }
}

function hex(value: string): string {
  return rgbToHex(value);
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text.split('\n').map(l => pad + l).join('\n');
}

// ── Section 1: Visual Theme & Atmosphere ────────────────────────────────────

function buildSection1_VisualTheme(lines: string[], data: DesignData, enriched: EnrichedData): void {
  lines.push('## 1. Visual Theme & Atmosphere');
  lines.push('');

  // Determine dark/light mode
  const bgColors = Object.entries(data.colors.neutral)
    .filter(([k]) => k.startsWith('background'))
    .map(([, v]) => v.value);

  const isDark = bgColors.some(c => {
    const parsed = parseSimpleColor(c);
    return parsed && (parsed.r + parsed.g + parsed.b) / 3 < 80;
  });

  // Primary font — resolve actual font name from stack if name is generic
  const primaryFont = data.typography.fontFamilies[0];
  const primaryFontName = primaryFont ? resolveFontName(primaryFont) : '';
  const fontDesc = primaryFont
    ? `The typography is built on ${primaryFontName}${primaryFont.weights.length > 0 ? ` at weights ${primaryFont.weights.join(', ')}` : ''}.`
    : '';

  // Accent color
  const accentColor = data.colors.accent?.value || data.colors.primary?.value;
  const accentDesc = accentColor ? ` The brand accent is \`${hex(accentColor)}\`, used sparingly for CTAs and interactive elements.` : '';

  // Motion summary
  const motionSummary = enriched.motion?.summary;
  const motionDesc = motionSummary
    ? ` The site uses ${motionSummary.totalAnimatedElements} animated elements — ${motionSummary.entrance || 0} entrance reveals, ${motionSummary.scrollLinked || 0} scroll-linked, and ${motionSummary.hover || 0} hover transitions.`
    : '';

  // Section types from patterns
  const sectionTypes = enriched.patterns?.sections?.map(s => s.type).filter(Boolean) || [];
  const uniqueSections = [...new Set(sectionTypes)];
  const patternDesc = uniqueSections.length > 0
    ? ` Page structure includes ${uniqueSections.join(', ')} sections.`
    : '';

  lines.push(`The site uses a ${isDark ? 'dark' : 'light'}-mode-first design. ${fontDesc}${accentDesc}${motionDesc}${patternDesc}`);
  lines.push('');

  // Key characteristics
  lines.push('**Key Characteristics:**');

  if (data.colors.primary?.value) {
    lines.push(`- Primary color: \`${hex(data.colors.primary.value)}\``);
  }
  if (data.colors.accent?.value) {
    lines.push(`- Accent color: \`${hex(data.colors.accent.value)}\``);
  }

  const bgDefault = data.colors.neutral['background-default']?.value || data.colors.neutral['background-Default']?.value;
  if (bgDefault) {
    lines.push(`- Page background: \`${hex(bgDefault)}\``);
  }

  if (primaryFont) {
    lines.push(`- Primary font: ${primaryFontName} (${classifyFont(primaryFontName)})`);
  }
  if (data.typography.fontFamilies.length > 1) {
    const secondary = data.typography.fontFamilies[1];
    const secondaryName = resolveFontName(secondary);
    lines.push(`- Secondary font: ${secondaryName} (${classifyFont(secondaryName)})`);
  }

  if (data.shadows.length > 0) {
    lines.push(`- Shadow system: ${data.shadows.length} elevation levels`);
  }

  if (data.transitions.timingFunctions.length > 0) {
    lines.push(`- Default easing: \`${data.transitions.timingFunctions[0]}\``);
  }

  // CSS architecture from analysis
  const cssArch = enriched.analysis?.cssArchitecture;
  if (cssArch?.methodology) {
    lines.push(`- CSS methodology: ${cssArch.methodology}`);
  }
  if (cssArch?.cssStrategy) {
    lines.push(`- CSS strategy: ${cssArch.cssStrategy}`);
  }

  lines.push('');
}

// ── Section 2: Color Palette & Roles ────────────────────────────────────────

function buildSection2_ColorPalette(lines: string[], data: DesignData): void {
  lines.push('## 2. Color Palette & Roles');
  lines.push('');

  // Brand colors
  const brandColors: [string, string][] = [];
  if (data.colors.primary?.value) brandColors.push(['Primary', hex(data.colors.primary.value)]);
  if (data.colors.secondary?.value) brandColors.push(['Secondary', hex(data.colors.secondary.value)]);
  if (data.colors.accent?.value) brandColors.push(['Accent', hex(data.colors.accent.value)]);

  if (brandColors.length > 0) {
    lines.push('### Brand');
    for (const [name, value] of brandColors) {
      lines.push(`- **${name}** (\`${value}\`)`);
    }
    lines.push('');
  }

  // Background surfaces
  const backgrounds = Object.entries(data.colors.neutral)
    .filter(([k]) => k.startsWith('background'));
  if (backgrounds.length > 0) {
    lines.push('### Background Surfaces');
    for (const [key, token] of backgrounds) {
      const label = key.replace('background-', '');
      lines.push(`- **${label}** (\`${hex(token.value)}\`): ${token.usage || label + ' background'}`);
    }
    lines.push('');
  }

  // Text colors
  const textColors = Object.entries(data.colors.neutral)
    .filter(([k]) => k.startsWith('text'));
  if (textColors.length > 0) {
    lines.push('### Text & Content');
    for (const [key, token] of textColors) {
      const label = key.replace('text-', '');
      lines.push(`- **${label}** (\`${hex(token.value)}\`): ${token.usage || label + ' text'}`);
    }
    lines.push('');
  }

  // Border colors
  const borderColors = Object.entries(data.colors.neutral)
    .filter(([k]) => k.startsWith('border'));
  if (borderColors.length > 0) {
    lines.push('### Border & Divider');
    for (const [key, token] of borderColors) {
      const label = key.replace('border-', '');
      lines.push(`- **${label}** (\`${hex(token.value)}\`)`);
    }
    lines.push('');
  }

  // Semantic colors
  if (Object.keys(data.colors.semantic).length > 0) {
    lines.push('### Status Colors');
    for (const [name, token] of Object.entries(data.colors.semantic)) {
      lines.push(`- **${name}** (\`${hex(token.value)}\`): ${token.usage || name}`);
    }
    lines.push('');
  }

  // Overlays
  if (Object.keys(data.colors.overlays).length > 0) {
    lines.push('### Overlay');
    for (const [name, token] of Object.entries(data.colors.overlays)) {
      lines.push(`- **${name}**: \`${token.value}\``);
    }
    lines.push('');
  }
}

// ── Section 3: Typography Rules ─────────────────────────────────────────────

function buildSection3_Typography(lines: string[], data: DesignData): void {
  lines.push('## 3. Typography Rules');
  lines.push('');

  // Font families
  lines.push('### Font Family');
  for (const family of data.typography.fontFamilies) {
    const category = classifyFont(family.name);
    const stack = parseFontStack(family.stack).join(', ');
    lines.push(`- **${category.charAt(0).toUpperCase() + category.slice(1)}**: \`${stack}\``);
    if (family.weights.length > 0) {
      lines.push(`  - Weights: ${family.weights.join(', ')}`);
    }
  }
  lines.push('');

  // Type scale hierarchy
  if (data.typography.scale.length > 0) {
    lines.push('### Hierarchy');
    lines.push('');
    lines.push('| Role | Font | Size | Weight | Line Height | Letter Spacing |');
    lines.push('|------|------|------|--------|-------------|----------------|');

    for (const s of data.typography.scale) {
      const role = s.usage || sizeToRole(s.size);
      const fontFamily = s.font
        ? (data.typography.fontFamilies.find(f => f.name === s.font) || { name: s.font, stack: s.font })
        : data.typography.fontFamilies[0];
      const font = fontFamily ? resolveFontName(fontFamily) : '—';
      lines.push(`| ${role} | ${font} | ${s.size} | ${s.weight} | ${s.lineHeight} | ${s.letterSpacing} |`);
    }
    lines.push('');
  }

  // Principles
  lines.push('### Principles');

  const weights = data.typography.weights;
  if (weights.length > 0) {
    lines.push(`- Weight range: ${weights[0]}–${weights[weights.length - 1]}`);
  }

  const negativeTracking = data.typography.letterSpacings.filter(ls => ls.startsWith('-'));
  if (negativeTracking.length > 0) {
    lines.push(`- Uses negative letter-spacing at display sizes (${negativeTracking.join(', ')})`);
  }

  if (data.typography.fontFamilies.length >= 2) {
    const [primary, secondary] = data.typography.fontFamilies;
    const pName = resolveFontName(primary);
    const sName = resolveFontName(secondary);
    lines.push(`- ${pName} for UI/headings, ${sName} for ${classifyFont(sName) === 'mono' ? 'code' : 'body text'}`);
  }

  lines.push('');
}

// ── Section 4: Component Stylings ───────────────────────────────────────────

function buildSection4_ComponentStylings(lines: string[], data: DesignData, enriched: EnrichedData): void {
  lines.push('## 4. Component Stylings');
  lines.push('');

  // Pull components from design-system.json or analysis
  const dsComponents: DesignSystemComponent[] = enriched.designSystem?.components || [];
  const analysisComponents: ComponentCandidate[] = enriched.analysis?.components || [];

  // Use AI-synthesized components first, fall back to analysis
  const components: (DesignSystemComponent | ComponentCandidate)[] = dsComponents.length > 0 ? dsComponents : analysisComponents;

  if (components.length === 0) {
    lines.push('*No component data available. Run full extraction pipeline for component details.*');
    lines.push('');
    return;
  }

  for (const comp of components.slice(0, 12)) {
    const selector = comp.selector || '';
    const isDsComp = 'name' in comp;
    const compName = isDsComp ? (comp as DesignSystemComponent).name : undefined;
    const compPattern = !isDsComp ? (comp as ComponentCandidate).pattern : undefined;
    const semanticName = sem(selector, enriched.semanticMap) || compName || compPattern || 'Component';
    lines.push(`### ${semanticName}`);

    const compDescription = isDsComp ? (comp as DesignSystemComponent).description : undefined;
    if (compDescription) {
      lines.push(compDescription);
    }

    // Base styles from design-system.json
    const baseStyles = isDsComp
      ? ((comp as DesignSystemComponent).baseStyles || {})
      : ((comp as ComponentCandidate).commonStyles || {});
    const styleEntries = Object.entries(baseStyles);
    if (styleEntries.length > 0) {
      for (const [prop, val] of styleEntries) {
        lines.push(`- ${formatCssProp(prop)}: \`${val}\``);
      }
    }

    // Layout data from scan-result.json
    const layout = selector ? enriched.layoutMap.get(selector) : undefined;
    if (layout && Object.keys(layout.base).length > 0) {
      lines.push(`- Layout: ${formatLayoutProps(layout.base)}`);
      for (const resp of layout.responsive) {
        lines.push(`  - ${resp.breakpoint}px: ${formatLayoutProps(resp.changes)}`);
      }
    }

    // States
    const states = isDsComp ? ((comp as DesignSystemComponent).states || {}) : {};
    for (const [state, styles] of Object.entries(states)) {
      if (state === 'default' || !styles || typeof styles !== 'object') continue;
      const stateStyles = Object.entries(styles as Record<string, string>);
      if (stateStyles.length > 0) {
        lines.push(`- **${state}**: ${stateStyles.map(([p, v]) => `${formatCssProp(p)}: \`${v}\``).join(', ')}`);
      }
    }

    // Variants
    const variants = comp.variants || [];
    if (variants.length > 0) {
      lines.push(`- Variants: ${(variants as DesignSystemVariant[]).map(v => v.name || sem(v.selector || '', enriched.semanticMap) || v.selector).join(', ')}`);
    }

    if (selector) {
      lines.push(`- Selector: \`${selector}\``);
    }

    const compCompositionRules = isDsComp ? (comp as DesignSystemComponent).compositionRules : undefined;
    lines.push(`- Use: ${compCompositionRules || compDescription || semanticName}`);
    lines.push('');
  }
}

// ── Section 5: Layout Principles ────────────────────────────────────────────

function buildSection5_LayoutPrinciples(lines: string[], data: DesignData, enriched: EnrichedData): void {
  lines.push('## 5. Layout Principles');
  lines.push('');

  // Spacing system
  lines.push('### Spacing System');
  lines.push(`- Base unit: ${data.spacing.baseUnit}`);
  if (data.spacing.scale.length > 0) {
    const coreScale = data.spacing.scale.filter(v => v <= 80);
    lines.push(`- Scale: ${coreScale.map(v => `${v}px`).join(', ')}`);
  }
  lines.push('');

  // Grid & Container
  lines.push('### Grid & Container');
  if (Object.keys(data.containerWidths).length > 0) {
    for (const [name, width] of Object.entries(data.containerWidths)) {
      lines.push(`- **${name}**: ${width}`);
    }
  }

  // Layout strategies from display patterns
  const layouts: LayoutStrategy[] = enriched.patterns?.layouts || [];
  if (layouts.length > 0) {
    for (const layout of layouts.slice(0, 5)) {
      const details = layout.details || {};
      const desc = details.columns ? `${details.columns}-column` : '';
      lines.push(`- **${layout.pattern}** layout${desc ? ` (${desc})` : ''}: \`${layout.selector || ''}\``);
    }
  }
  lines.push('');

  // Border radius scale
  if (data.borderRadius.length > 0) {
    lines.push('### Border Radius Scale');
    const radiusMap = buildRadiusMap(data.borderRadius);
    for (const [name, value] of Object.entries(radiusMap)) {
      lines.push(`- ${name}: \`${value}\``);
    }
    lines.push('');
  }
}

// ── Section 6: Depth & Elevation ────────────────────────────────────────────

function buildSection6_DepthElevation(lines: string[], data: DesignData): void {
  lines.push('## 6. Depth & Elevation');
  lines.push('');

  if (data.shadows.length === 0) {
    lines.push('*Flat design — no shadow elevation system detected.*');
    lines.push('');
    return;
  }

  lines.push('| Level | Name | Value |');
  lines.push('|-------|------|-------|');

  for (let i = 0; i < data.shadows.length; i++) {
    const s = data.shadows[i];
    // Truncate very long shadow values for readability
    const displayValue = s.value.length > 80 ? s.value.slice(0, 77) + '...' : s.value;
    lines.push(`| ${i} | ${s.name} | \`${displayValue}\` |`);
  }
  lines.push('');

  // Transition defaults
  if (data.transitions.durations.length > 0 || data.transitions.timingFunctions.length > 0) {
    lines.push('### Transitions');
    if (data.transitions.durations.length > 0) {
      lines.push(`- Default duration: \`${data.transitions.durations[0]}\``);
    }
    if (data.transitions.timingFunctions.length > 0) {
      lines.push(`- Default easing: \`${data.transitions.timingFunctions[0]}\``);
    }
    lines.push('');
  }
}

// ── Section 7: Do's and Don'ts ──────────────────────────────────────────────

function buildSection7_DosAndDonts(lines: string[], data: DesignData, enriched: EnrichedData): void {
  lines.push("## 7. Do's and Don'ts");
  lines.push('');

  // Generate Do's from extracted data
  lines.push('### Do');

  if (data.typography.fontFamilies.length > 0) {
    const primary = data.typography.fontFamilies[0];
    lines.push(`- Use \`${primary.stack}\` for all UI text — this is the site's primary typeface`);
  }

  if (data.colors.primary?.value) {
    lines.push(`- Use \`${hex(data.colors.primary.value)}\` as the primary brand color`);
  }

  if (data.colors.accent?.value) {
    lines.push(`- Reserve accent color \`${hex(data.colors.accent.value)}\` for CTAs and interactive elements only`);
  }

  const bgDefault = data.colors.neutral['background-default']?.value || data.colors.neutral['background-Default']?.value;
  if (bgDefault) {
    lines.push(`- Build on \`${hex(bgDefault)}\` background`);
  }

  if (data.spacing.baseUnit) {
    lines.push(`- Follow the ${data.spacing.baseUnit} spacing grid`);
  }

  if (data.borderRadius.length > 0) {
    const commonRadius = data.borderRadius[Math.floor(data.borderRadius.length / 2)]?.value;
    if (commonRadius) {
      lines.push(`- Use \`${commonRadius}\` as the standard border-radius for interactive elements`);
    }
  }

  if (data.transitions.timingFunctions.length > 0) {
    lines.push(`- Apply \`${data.transitions.timingFunctions[0]}\` easing for all transitions`);
  }

  // Motion-specific do's
  const motionSummary = enriched.motion?.summary;
  if ((motionSummary?.entrance ?? 0) > 0) {
    lines.push('- Use entrance-reveal animations for content appearing on scroll');
  }

  // Accessibility from analysis
  const accessibility = enriched.analysis?.accessibility;
  if ((accessibility?.landmarks?.length ?? 0) > 0) {
    lines.push('- Maintain proper landmark structure (nav, main, footer)');
  }

  // CSS architecture
  const cssArch = enriched.analysis?.cssArchitecture;
  if (cssArch?.cssStrategy) {
    lines.push(`- Follow ${cssArch.cssStrategy} responsive approach`);
  }

  lines.push('');

  // Generate Don'ts
  lines.push("### Don't");

  if (data.colors.primary?.value) {
    lines.push(`- Don't use the primary color (\`${hex(data.colors.primary.value)}\`) decoratively — it's reserved for brand and interactive elements`);
  }

  const textPrimary = data.colors.neutral['text-emphasis']?.value || data.colors.neutral['text-Emphasis']?.value;
  if (textPrimary && hex(textPrimary) !== '#ffffff' && hex(textPrimary) !== '#000000') {
    lines.push(`- Don't use pure black/white for text — use \`${hex(textPrimary)}\` for primary text`);
  }

  if (data.typography.weights.length > 0) {
    const maxWeight = data.typography.weights[data.typography.weights.length - 1];
    if (maxWeight < 700) {
      lines.push(`- Don't use weight 700+ (bold) — the maximum weight in use is ${maxWeight}`);
    }
  }

  if (data.borderRadius.length > 0) {
    lines.push("- Don't mix border-radius values outside the defined scale");
  }

  if (motionSummary && motionSummary.totalAnimatedElements > 0) {
    lines.push("- Don't skip `prefers-reduced-motion` checks for animations");
  }

  lines.push("- Don't introduce colors outside the defined palette");
  lines.push("- Don't use spacing values outside the grid scale");

  lines.push('');
}

// ── Section 8: Responsive Behavior ──────────────────────────────────────────

function buildSection8_ResponsiveBehavior(lines: string[], data: DesignData, enriched: EnrichedData): void {
  lines.push('## 8. Responsive Behavior');
  lines.push('');

  // Breakpoints
  if (Object.keys(data.breakpoints).length > 0) {
    lines.push('### Breakpoints');
    lines.push('');
    lines.push('| Name | Width | Key Changes |');
    lines.push('|------|-------|-------------|');

    for (const [name, bp] of Object.entries(data.breakpoints)) {
      const width = bp.min || bp.max || bp.value || '—';
      const desc = bp.description || '';
      lines.push(`| ${name} | ${width} | ${desc} |`);
    }
    lines.push('');
  }

  // Responsive strategies from display patterns
  const responsiveStrategies = enriched.patterns?.responsive || [];
  if (responsiveStrategies.length > 0) {
    lines.push('### Collapsing Strategy');
    for (const strat of responsiveStrategies.slice(0, 8)) {
      lines.push(`- **${strat.section}**: ${strat.strategy}`);
      if (strat.breakpoints?.length > 0) {
        for (const bp of strat.breakpoints) {
          const hidden = (bp.hiddenElements?.length ?? 0) > 0 ? ` (hides: ${bp.hiddenElements!.join(', ')})` : '';
          lines.push(`  - At ${bp.width}px: ${bp.layout}${hidden}`);
        }
      }
    }
    lines.push('');
  }

  // Motion responsive behavior
  const responsiveNotes: string[] = enriched.motion?.responsiveNotes || [];
  if (responsiveNotes.length > 0) {
    lines.push('### Animation Responsiveness');
    for (const note of responsiveNotes) {
      // Replace CSS selectors in the note with semantic names
      const resolved = note.replace(/([a-z]+\.[a-z][\w.-]+(?:\s*\+\s*[a-z]+\.[a-z][\w.-]+)*)/gi, (match) => {
        const name = sem(match, enriched.semanticMap);
        return name !== match ? `**${name}**` : match;
      });
      lines.push(`- ${resolved}`);
    }
    lines.push('');
  }
}

// ── Section 9: Agent Prompt Guide ───────────────────────────────────────────

function buildSection9_AgentPromptGuide(lines: string[], data: DesignData, enriched: EnrichedData): void {
  lines.push('## 9. Agent Prompt Guide');
  lines.push('');

  // Quick color reference
  lines.push('### Quick Color Reference');
  if (data.colors.primary?.value) lines.push(`- Primary: \`${hex(data.colors.primary.value)}\``);
  if (data.colors.secondary?.value) lines.push(`- Secondary: \`${hex(data.colors.secondary.value)}\``);
  if (data.colors.accent?.value) lines.push(`- Accent: \`${hex(data.colors.accent.value)}\``);

  const bgDefault = data.colors.neutral['background-default']?.value || data.colors.neutral['background-Default']?.value;
  if (bgDefault) lines.push(`- Page Background: \`${hex(bgDefault)}\``);

  const textDefault = data.colors.neutral['text-default']?.value || data.colors.neutral['text-Default']?.value;
  if (textDefault) lines.push(`- Body Text: \`${hex(textDefault)}\``);

  const textMuted = data.colors.neutral['text-muted']?.value || data.colors.neutral['text-Muted']?.value || data.colors.neutral['text-subtle']?.value;
  if (textMuted) lines.push(`- Muted Text: \`${hex(textMuted)}\``);

  const borderDefault = data.colors.neutral['border-default']?.value || data.colors.neutral['border-Default']?.value;
  if (borderDefault) lines.push(`- Border: \`${hex(borderDefault)}\``);

  lines.push('');

  // Example component prompts
  lines.push('### Example Component Prompts');
  lines.push('');

  const primaryFont = data.typography.fontFamilies[0] ? resolveFontName(data.typography.fontFamilies[0]) : 'system-ui';
  const primaryColor = data.colors.primary?.value ? hex(data.colors.primary.value) : '#000';
  const bgColor = bgDefault ? hex(bgDefault) : '#fff';
  // Sort scale by size to pick sensible defaults
  const sortedScale = [...data.typography.scale].sort((a, b) => parseFloat(a.size) - parseFloat(b.size));
  const bodyScale = data.typography.scale.find(s =>
    s.usage === 'base' || s.usage === 'Body' || s.usage === 'body'
  ) || sortedScale.find(s => { const px = parseFloat(s.size); return px >= 14 && px <= 18; }) || sortedScale[Math.floor(sortedScale.length / 2)];
  const headingScale = data.typography.scale.find(s =>
    s.usage?.toLowerCase().includes('display') || s.usage?.toLowerCase().includes('hero') || s.usage?.toLowerCase().includes('heading') || s.usage === '4xl' || s.usage === '3xl'
  ) || sortedScale[sortedScale.length - 1];
  const commonRadius = data.borderRadius[Math.floor(data.borderRadius.length / 2)]?.value || '8px';

  // Hero prompt
  if (headingScale) {
    lines.push(`- "Create a hero section on \`${bgColor}\` background. Headline at ${headingScale.size} ${primaryFont} weight ${headingScale.weight}, line-height ${headingScale.lineHeight}, letter-spacing ${headingScale.letterSpacing}${textDefault ? `, color \`${hex(textDefault)}\`` : ''}. CTA button with \`${primaryColor}\` background, ${commonRadius} radius."`);
    lines.push('');
  }

  // Card prompt
  if (bodyScale) {
    lines.push(`- "Design a card: \`${bgColor}\` background, ${borderDefault ? `\`1px solid ${hex(borderDefault)}\` border, ` : ''}${commonRadius} radius. Body text at ${bodyScale.size} ${primaryFont} weight ${bodyScale.weight}${textMuted ? `, color \`${hex(textMuted)}\`` : ''}."`);
    lines.push('');
  }

  // Nav prompt
  lines.push(`- "Build navigation: ${primaryFont} for links${textDefault ? `, \`${hex(textDefault)}\` text` : ''}. Brand CTA \`${primaryColor}\` right-aligned with ${commonRadius} radius."`);
  lines.push('');

  // Iteration guide
  lines.push('### Iteration Guide');

  if (data.typography.fontFamilies.length > 0) {
    lines.push(`1. Always use \`${primaryFont}\` for UI text`);
  }

  const displayScales = data.typography.scale.filter(s => {
    const px = parseFloat(s.size);
    return px >= 24 && s.letterSpacing !== 'normal';
  });
  if (displayScales.length > 0) {
    lines.push(`2. Letter-spacing scales with font size: ${displayScales.map(s => `${s.letterSpacing} at ${s.size}`).join(', ')}`);
  }

  if (data.typography.weights.length >= 2) {
    lines.push(`3. Weight system: ${data.typography.weights.map(w => `${w}`).join(', ')}`);
  }

  if (data.colors.accent?.value) {
    lines.push(`4. Accent color (\`${hex(data.colors.accent.value)}\`) is the only chromatic highlight — everything else follows the neutral palette`);
  }

  if (data.shadows.length > 0) {
    lines.push(`5. ${data.shadows.length} shadow levels available — use lower levels for subtle elevation, higher for modals/popovers`);
  }

  // Animation guide from motion data
  const animations: DistilledAnimation[] = enriched.motion?.animations || [];
  if (animations.length > 0) {
    const entranceAnims = animations.filter(a => a.trigger === 'scroll-into-view');
    const scrollAnims = animations.filter(a => a.trigger === 'scroll-linked');
    const hoverAnims = animations.filter(a => a.trigger === 'hover');

    lines.push('');
    lines.push('### Animation Reference');
    lines.push('');

    if (entranceAnims.length > 0) {
      const sample = entranceAnims[0];
      lines.push(`- **Entrance reveals** (${entranceAnims.length}): ${sample.duration} ${sample.easing}. Typically opacity 0→1 with subtle translate.`);
    }
    if (scrollAnims.length > 0) {
      lines.push(`- **Scroll-linked** (${scrollAnims.length}): Linear easing, tied to scroll position.`);
    }
    if (hoverAnims.length > 0) {
      const sample = hoverAnims[0];
      lines.push(`- **Hover transitions** (${hoverAnims.length}): ${sample.duration} ${sample.easing}.`);
    }
  }

  // Interaction reference
  const interactions = enriched.interactions;
  if (interactions) {
    const toggleCount = interactions.toggles?.length || 0;
    const modalCount = interactions.modals?.length || 0;
    const formCount = interactions.forms?.length || 0;

    if (toggleCount + modalCount + formCount > 0) {
      lines.push('');
      lines.push('### Interaction Patterns');
      if (toggleCount > 0) lines.push(`- ${toggleCount} toggle/accordion pattern(s)`);
      if (modalCount > 0) lines.push(`- ${modalCount} modal/dialog pattern(s)`);
      if (formCount > 0) lines.push(`- ${formCount} form(s)`);
    }
  }

  lines.push('');
}

// ── Section 10: Animations ──────────────────────────────────────────────────

function buildSection10_Animations(lines: string[], enriched: EnrichedData): void {
  const animations: DistilledAnimation[] = enriched.motion?.animations || [];
  if (animations.length === 0) return;

  lines.push('## 10. Animations');
  lines.push('');

  // Summary table
  const summary = enriched.motion?.summary;
  if (summary) {
    lines.push('### Summary');
    lines.push('');
    lines.push('| Type | Count |');
    lines.push('|------|-------|');
    if (summary.entrance > 0) lines.push(`| Entrance reveals | ${summary.entrance} |`);
    if (summary.scrollLinked > 0) lines.push(`| Scroll-linked | ${summary.scrollLinked} |`);
    if (summary.hover > 0) lines.push(`| Hover | ${summary.hover} |`);
    if (summary.focus > 0) lines.push(`| Focus | ${summary.focus} |`);
    if (summary.continuous > 0) lines.push(`| Continuous | ${summary.continuous} |`);
    if (summary.parallax > 0) lines.push(`| Parallax | ${summary.parallax} |`);
    lines.push(`| **Total animated elements** | **${summary.totalAnimatedElements}** |`);
    lines.push('');
  }

  // Group animations by element for cleaner output
  const byElement = new Map<string, DistilledAnimation[]>();
  for (const anim of animations) {
    const key = anim.element || 'unknown';
    if (!byElement.has(key)) byElement.set(key, []);
    byElement.get(key)!.push(anim);
  }

  // Entrance animations — full spec
  const entranceAnims = animations.filter(a => a.trigger === 'scroll-into-view');
  if (entranceAnims.length > 0) {
    lines.push('### Entrance Animations');
    lines.push('');
    for (const anim of entranceAnims) {
      const name = sem(anim.element, enriched.semanticMap);
      lines.push(`**${name}** (\`${anim.element}\`)`);
      const fromProps = Object.entries(anim.from || {}).map(([k, v]) => `${k}: \`${v}\``).join(', ');
      const toProps = Object.entries(anim.to || {}).map(([k, v]) => `${k}: \`${v}\``).join(', ');
      lines.push(`- From: ${fromProps}`);
      lines.push(`- To: ${toProps}`);
      lines.push(`- Duration: ${anim.duration}, Easing: ${anim.easing}`);
      if (anim.triggerPoint) lines.push(`- Trigger: ${anim.triggerPoint}`);
      lines.push('');
    }
  }

  // Scroll-linked animations — full spec with ranges
  const scrollAnims = animations.filter(a => a.trigger === 'scroll-linked');
  if (scrollAnims.length > 0) {
    lines.push('### Scroll-Linked Animations');
    lines.push('');

    // Group scroll animations by element to show multi-property animations together
    const scrollByElement = new Map<string, DistilledAnimation[]>();
    for (const anim of scrollAnims) {
      const key = anim.element;
      if (!scrollByElement.has(key)) scrollByElement.set(key, []);
      scrollByElement.get(key)!.push(anim);
    }

    for (const [element, anims] of scrollByElement) {
      const name = sem(element, enriched.semanticMap);
      lines.push(`**${name}** (\`${element}\`)`);

      // Collect all property transitions
      for (const anim of anims) {
        const fromProps = Object.entries(anim.from || {});
        const toProps = Object.entries(anim.to || {});
        const range = anim.scrollRange
          ? `scroll ${anim.scrollRange.start}–${anim.scrollRange.end}px`
          : 'scroll-driven';

        for (let i = 0; i < fromProps.length; i++) {
          const [prop, fromVal] = fromProps[i];
          const toVal = toProps[i]?.[1] || '—';
          lines.push(`- ${prop}: \`${fromVal}\` → \`${toVal}\` (${range})`);
        }
      }

      // Deduplicate produces/removes — show once per element, not per property
      const allProduces = new Map<string, string>();
      const allRemoves = new Map<string, string>();
      for (const anim of anims) {
        for (const p of ((anim as unknown as Record<string, unknown>).produces as { selector: string; interaction: string; text?: string }[] | undefined) || []) {
          const key = p.selector || p.text || p.interaction;
          allProduces.set(key, p.text ? `${p.text} (${p.interaction})` : p.interaction);
        }
        for (const r of ((anim as unknown as Record<string, unknown>).removes as { selector: string; interaction: string; text?: string }[] | undefined) || []) {
          const key = r.selector || r.text || r.interaction;
          allRemoves.set(key, r.text ? `${r.text} (${r.interaction})` : r.interaction);
        }
      }
      if (allProduces.size > 0) {
        lines.push(`- **Produces:** ${[...allProduces.values()].join(', ')}`);
      }
      if (allRemoves.size > 0) {
        lines.push(`- **Removes:** ${[...allRemoves.values()].join(', ')}`);
      }

      lines.push('');
    }
  }

  // Hover animations
  const hoverAnims = animations.filter(a => a.trigger === 'hover');
  if (hoverAnims.length > 0) {
    lines.push('### Hover Animations');
    lines.push('');
    for (const anim of hoverAnims) {
      const name = sem(anim.element, enriched.semanticMap);
      lines.push(`**${name}** (\`${anim.element}\`)`);
      const fromProps = Object.entries(anim.from || {}).map(([k, v]) => `${k}: \`${v}\``).join(', ');
      const toProps = Object.entries(anim.to || {}).map(([k, v]) => `${k}: \`${v}\``).join(', ');
      lines.push(`- From: ${fromProps}`);
      lines.push(`- To: ${toProps}`);
      lines.push(`- Duration: ${anim.duration}, Easing: ${anim.easing}`);
      lines.push('');
    }
  }

  // CSS keyframe animations
  const keyframes = enriched.motion?.cssKeyframes || [];
  if (keyframes.length > 0) {
    lines.push('### CSS Keyframe Animations');
    lines.push('');
    for (const kf of keyframes) {
      lines.push(`- **${kf.name}**: ${kf.duration} ${kf.iterations === 'infinite' ? '(infinite)' : ''}`);
    }
    lines.push('');
  }

  // Scroll-interaction links — deduplicate by unique produces/removes sets
  const scrollInteractions = enriched.motion?.scrollInteractions;
  if ((scrollInteractions?.animationInteractionLinks?.length ?? 0) > 0) {
    lines.push('### Scroll-State Interaction Map');
    lines.push('');
    lines.push('Animations that change which interactive elements are accessible:');
    lines.push('');

    // Deduplicate: group by unique produces+removes fingerprint
    const seen = new Set<string>();
    for (const link of scrollInteractions!.animationInteractionLinks as AnimationInteractionLink[]) {
      const anim = link.animation || link.element || 'scroll animation';
      const producesItems = (link.produces || []).map(p => p.text || p.selector);
      const removesItems = (link.removes || []).map(r => r.text || r.selector);
      const fingerprint = JSON.stringify({ p: producesItems.sort(), r: removesItems.sort() });

      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      if (producesItems.length > 0) {
        lines.push(`- **${anim}** produces: ${producesItems.join(', ')}`);
      }
      if (removesItems.length > 0) {
        lines.push(`- **${anim}** removes: ${removesItems.join(', ')}`);
      }
    }
    lines.push('');
  }
}

// ── Utility Helpers ─────────────────────────────────────────────────────────

function sizeToRole(size: string): string {
  const px = parseFloat(size);
  if (isNaN(px)) return size;
  if (px >= 48) return 'Display XL';
  if (px >= 36) return 'Display';
  if (px >= 30) return 'Heading 1';
  if (px >= 24) return 'Heading 2';
  if (px >= 20) return 'Heading 3';
  if (px >= 18) return 'Body Large';
  if (px >= 16) return 'Body';
  if (px >= 14) return 'Small';
  if (px >= 12) return 'Caption';
  return 'Micro';
}

function formatCssProp(prop: string): string {
  // camelCase → kebab-case for display
  return prop.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/** Resolve actual font name — if the name is generic (primary, body, heading), use the first entry in the stack */
function resolveFontName(family: { name: string; stack: string }): string {
  const genericNames = ['primary', 'body', 'heading', 'display', 'mono', 'code', 'system', 'sans', 'serif'];
  if (genericNames.includes(family.name.toLowerCase())) {
    const first = parseFontStack(family.stack)[0];
    return first || family.name;
  }
  return family.name;
}

function parseSimpleColor(value: string): { r: number; g: number; b: number } | null {
  // Quick hex parse
  const hexMatch = value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (hexMatch) {
    return { r: parseInt(hexMatch[1], 16), g: parseInt(hexMatch[2], 16), b: parseInt(hexMatch[3], 16) };
  }
  // Quick rgb parse
  const rgbMatch = value.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    return { r: parseInt(rgbMatch[1]), g: parseInt(rgbMatch[2]), b: parseInt(rgbMatch[3]) };
  }
  return null;
}

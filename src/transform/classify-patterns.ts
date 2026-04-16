/**
 * Display Pattern Intelligence
 *
 * Reads existing extraction data (scan-result, analysis-result, motion-distilled,
 * interactions) and classifies display patterns: section types, layout strategies,
 * content patterns, animation intent, responsive strategies, information hierarchy.
 *
 * Uses heuristic classifiers for obvious patterns, with optional Claude API
 * refinement for ambiguous cases.
 *
 * Output: display-patterns.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { log, safeReadJSON } from '../core/utils';
import type {
  ScanResult,
  ElementData,
  AnalysisResult,
  DistilledMotion,
  DistilledAnimation,
  InteractionResult,
  ResponsiveSnapshot,
  DisplayPatterns,
  SectionPattern,
  LayoutStrategy,
  ContentPattern,
  AnimationIntent,
  ResponsiveStrategy,
  InformationHierarchy,
} from '../core/types';

// ── Section Classification ──────────────────────────────────────────────────

/** Keyword signals for section type classification */
const SECTION_SIGNALS: Record<string, { keywords: RegExp[]; childPatterns?: RegExp[]; structuralHints?: string[] }> = {
  hero: {
    keywords: [/hero/i, /banner/i, /jumbotron/i, /splash/i, /landing/i, /masthead/i],
    structuralHints: ['large-heading-with-cta', 'full-width-background'],
  },
  navigation: {
    keywords: [/nav/i, /navbar/i, /menu/i, /topbar/i, /header/i, /appbar/i],
    structuralHints: ['link-list', 'logo-with-links'],
  },
  features: {
    keywords: [/feature/i, /benefit/i, /service/i, /capability/i, /advantage/i, /why[\s-]/i],
    structuralHints: ['icon-title-text-grid', 'repeated-cards'],
  },
  testimonials: {
    keywords: [/testimonial/i, /review/i, /quote/i, /feedback/i, /what[\s-].*say/i, /client/i],
    structuralHints: ['quote-with-avatar', 'star-rating'],
  },
  pricing: {
    keywords: [/pricing/i, /price/i, /plan/i, /tier/i, /subscription/i, /package/i],
    structuralHints: ['price-columns', 'feature-checklist'],
  },
  'case-studies': {
    keywords: [/case[\s-]stud/i, /portfolio/i, /project/i, /work/i, /showcase/i, /success[\s-]stor/i],
    structuralHints: ['image-text-pairs', 'card-grid-with-images'],
  },
  cta: {
    keywords: [/cta/i, /call[\s-]to[\s-]action/i, /get[\s-]started/i, /sign[\s-]up/i, /try[\s-]/i, /start[\s-]/i],
    structuralHints: ['centered-heading-with-button'],
  },
  faq: {
    keywords: [/faq/i, /question/i, /accordion/i, /asked/i, /help/i],
    structuralHints: ['toggle-list', 'details-summary'],
  },
  team: {
    keywords: [/team/i, /people/i, /staff/i, /about[\s-]us/i, /who[\s-]we/i, /leadership/i],
    structuralHints: ['avatar-grid', 'person-cards'],
  },
  stats: {
    keywords: [/stat/i, /number/i, /metric/i, /counter/i, /achievement/i, /result/i],
    structuralHints: ['number-label-grid'],
  },
  footer: {
    keywords: [/footer/i, /bottom/i, /colophon/i],
    structuralHints: ['multi-column-links', 'copyright-text'],
  },
  gallery: {
    keywords: [/gallery/i, /photo/i, /image/i, /media/i, /lightbox/i],
    structuralHints: ['image-grid', 'masonry'],
  },
  contact: {
    keywords: [/contact/i, /reach/i, /touch/i, /email/i, /message/i],
    structuralHints: ['form-with-fields'],
  },
  'content-grid': {
    keywords: [/blog/i, /article/i, /post/i, /news/i, /resource/i, /library/i],
    structuralHints: ['card-grid-with-dates'],
  },
};

/**
 * Classify top-level sections from the DOM tree.
 * Uses keyword matching on selectors/text + structural analysis of children.
 */
function classifySections(scan: ScanResult, analysis: AnalysisResult | null): SectionPattern[] {
  const sections: SectionPattern[] = [];

  // Find top-level section elements (depth <= 3, semantic or large containers)
  const sectionTags = new Set(['section', 'header', 'footer', 'nav', 'main', 'article', 'aside']);
  const candidates = scan.domTree.filter(el => {
    // Standard: semantic tags at shallow depth
    if (el.depth <= 3 && sectionTags.has(el.tag)) return true;
    if (el.tag === 'div' && el.childCount >= 2 && el.depth <= 2) return true;

    // Framework-generated sites (Framer, Webflow, etc.): look for large visible containers
    // by bounding box — a section-like element spans most of the page width and has significant height
    const bbox = el.boundingBox;
    if (bbox && el.depth <= 6 && el.childCount >= 1) {
      const isWide = bbox.width >= 300;
      const isTall = bbox.height >= 100;
      const isTopLevel = el.depth <= 5;
      // Must be a container (div/nav/main/section) not an inline element
      const isContainer = ['div', 'nav', 'main', 'section', 'footer', 'header', 'article'].includes(el.tag);
      if (isWide && isTall && isTopLevel && isContainer) return true;
    }

    // ARIA roles at any depth
    const role = el.attributes?.role;
    if (role && ['navigation', 'banner', 'main', 'contentinfo', 'region', 'complementary'].includes(role)) return true;

    return false;
  });

  // Deduplicate: if a parent and child both match, keep the more specific (deeper) one
  // unless parent is semantic and child is just a div
  const selectorSet = new Set(candidates.map(c => c.selector));
  const filtered = candidates.filter(el => {
    // Keep if no child candidate exists
    const hasChildCandidate = candidates.some(c =>
      c.selector !== el.selector &&
      c.selector.startsWith(el.selector) &&
      c.depth > el.depth
    );
    // Keep parent if it's semantic, drop generic divs that have more specific children
    if (hasChildCandidate && el.tag === 'div' && !sectionTags.has(el.tag)) return false;
    return true;
  });

  for (const el of filtered) {
    const evidence: string[] = [];
    let bestType = 'unknown';
    let bestScore = 0;

    // Combine selector + classes + text for matching
    const searchText = [
      el.selector,
      ...el.classes,
      el.textContent.slice(0, 200),
      el.attributes?.['aria-label'] || '',
      el.attributes?.role || '',
    ].join(' ');

    // Score against each section type
    for (const [type, signals] of Object.entries(SECTION_SIGNALS)) {
      let score = 0;

      // Keyword matching
      for (const kw of signals.keywords) {
        if (kw.test(searchText)) {
          score += 2;
          evidence.push(`keyword: ${kw.source}`);
        }
      }

      // Semantic tag matching
      if (el.tag === 'nav' && type === 'navigation') { score += 3; evidence.push('tag: <nav>'); }
      if (el.tag === 'header' && type === 'hero') { score += 1; evidence.push('tag: <header>'); }
      if (el.tag === 'footer' && type === 'footer') { score += 3; evidence.push('tag: <footer>'); }

      // ARIA role matching
      if (el.attributes?.role === 'navigation' && type === 'navigation') { score += 3; evidence.push('role: navigation'); }
      if (el.attributes?.role === 'banner' && type === 'hero') { score += 2; evidence.push('role: banner'); }
      if (el.attributes?.role === 'contentinfo' && type === 'footer') { score += 2; evidence.push('role: contentinfo'); }

      if (score > bestScore) {
        bestScore = score;
        bestType = type;
      }
    }

    // Structural analysis: examine children
    const children = scan.domTree.filter(c =>
      c.selector.startsWith(el.selector) && c.depth === el.depth + 1
    );

    const contentStructure = analyzeContentStructure(el, children, scan);

    // Structural hints for section type
    if (bestScore < 2) {
      const structuralType = inferSectionFromStructure(el, children, contentStructure);
      if (structuralType) {
        bestType = structuralType.type;
        bestScore = structuralType.score;
        evidence.push(...structuralType.evidence);
      }
    }

    if (bestType === 'unknown' && bestScore < 1) continue;

    sections.push({
      selector: el.selector,
      type: bestType,
      confidence: Math.min(bestScore / 5, 1),
      evidence: [...new Set(evidence)].slice(0, 5),
      contentStructure,
    });
  }

  return sections;
}

/** Analyze what content a section contains */
function analyzeContentStructure(
  el: ElementData,
  children: ElementData[],
  scan: ScanResult,
): SectionPattern['contentStructure'] {
  // Look deeper for headings, images, links, forms
  const descendants = scan.domTree.filter(d =>
    d.selector.startsWith(el.selector) && d.depth > el.depth && d.depth <= el.depth + 4
  );

  const headings = descendants.filter(d => /^h[1-6]$/.test(d.tag));
  const images = descendants.filter(d => d.tag === 'img' || d.tag === 'svg' || d.tag === 'picture');
  const links = descendants.filter(d => d.tag === 'a');
  const buttons = descendants.filter(d => d.tag === 'button' || (d.tag === 'a' && d.classes.some(c => /btn|button|cta/i.test(c))));
  const forms = descendants.filter(d => d.tag === 'form');
  const inputs = descendants.filter(d => ['input', 'textarea', 'select'].includes(d.tag));

  const hasImages = images.length > 0;
  const hasCTA = buttons.length > 0;
  const heading = headings[0]?.textContent.slice(0, 100);
  const subheading = headings[1]?.textContent.slice(0, 100);

  // Count repeated structural children (cards, items)
  const childStructures = children.map(c => `${c.tag}[${c.childCount}]`);
  const structureCounts = new Map<string, number>();
  for (const s of childStructures) {
    structureCounts.set(s, (structureCounts.get(s) || 0) + 1);
  }
  const maxRepeat = Math.max(0, ...structureCounts.values());
  const itemCount = maxRepeat >= 2 ? maxRepeat : children.length;

  // Determine content type
  let contentType: SectionPattern['contentStructure']['contentType'] = 'mixed';
  if (forms.length > 0 || inputs.length > 2) contentType = 'form';
  else if (images.length > 3 && headings.length <= 1) contentType = 'media';
  else if (maxRepeat >= 3) contentType = 'cards';
  else if (links.length > 5 && headings.length <= 1) contentType = 'list';
  else if (headings.length > 0 && images.length === 0 && links.length <= 2) contentType = 'text';

  return { heading, subheading, itemCount, hasImages, hasCTA, contentType };
}

/** Infer section type from structural patterns when keywords don't match */
function inferSectionFromStructure(
  el: ElementData,
  children: ElementData[],
  contentStructure: SectionPattern['contentStructure'],
): { type: string; score: number; evidence: string[] } | null {
  const evidence: string[] = [];

  // Hero: first large section with heading + CTA, few children
  if (el.depth <= 1 && contentStructure.hasCTA && contentStructure.heading && children.length <= 5) {
    const bbox = el.boundingBox;
    if (bbox && bbox.height >= 400) {
      evidence.push('structural: large section with heading + CTA at top');
      return { type: 'hero', score: 3, evidence };
    }
  }

  // Stats: multiple short text items with numbers
  if (contentStructure.contentType === 'cards' && (contentStructure.itemCount || 0) >= 3) {
    const hasNumbers = children.some(c => /\d{2,}/.test(c.textContent));
    if (hasNumbers && !contentStructure.hasImages) {
      evidence.push('structural: repeated items with numbers');
      return { type: 'stats', score: 3, evidence };
    }
  }

  // FAQ: accordion/toggle patterns
  if (children.length >= 3) {
    const hasToggles = children.some(c =>
      c.tag === 'details' || c.attributes?.['aria-expanded'] !== undefined
    );
    if (hasToggles) {
      evidence.push('structural: toggle/details elements');
      return { type: 'faq', score: 4, evidence };
    }
  }

  // Features/cards grid
  if (contentStructure.contentType === 'cards' && (contentStructure.itemCount || 0) >= 3) {
    if (contentStructure.hasImages) {
      evidence.push('structural: card grid with images');
      return { type: 'features', score: 2, evidence };
    }
    evidence.push('structural: repeated card items');
    return { type: 'features', score: 2, evidence };
  }

  // Contact: form section
  if (contentStructure.contentType === 'form') {
    evidence.push('structural: form section');
    return { type: 'contact', score: 3, evidence };
  }

  return null;
}

// ── Layout Classification ───────────────────────────────────────────────────

/** Classify layout strategies from computed styles */
function classifyLayouts(scan: ScanResult, sections: SectionPattern[], snapshots: ResponsiveSnapshot[]): LayoutStrategy[] {
  const layouts: LayoutStrategy[] = [];

  for (const section of sections) {
    const el = scan.domTree.find(e => e.selector === section.selector);
    if (!el) continue;

    const styles = el.computedStyles;
    const layout = detectLayoutPattern(el, styles, scan);
    if (!layout) continue;

    // Check responsive changes
    const responsive = detectResponsiveChanges(el.selector, snapshots);

    layouts.push({
      selector: section.selector,
      pattern: layout.pattern,
      details: layout.details,
      responsive,
    });
  }

  return layouts;
}

/** Detect layout pattern from CSS properties */
function detectLayoutPattern(
  el: ElementData,
  styles: Record<string, string>,
  scan: ScanResult,
): { pattern: string; details: LayoutStrategy['details'] } | null {
  const display = styles.display || '';
  const children = scan.domTree.filter(c =>
    c.selector.startsWith(el.selector) && c.depth === el.depth + 1
  );

  // CSS Grid
  if (display === 'grid' || display === 'inline-grid') {
    const columns = styles.gridTemplateColumns || '';
    const rows = styles.gridTemplateRows || '';
    const gap = styles.gap || styles.gridGap || '';

    const colCount = countGridColumns(columns);
    const rowCount = countGridColumns(rows);

    // Bento: grid with varying column/row spans
    const hasAreas = !!styles.gridTemplateAreas && styles.gridTemplateAreas !== 'none';
    if (hasAreas || (colCount >= 3 && children.length > colCount)) {
      return {
        pattern: 'bento',
        details: { columns: colCount, rows: rowCount || undefined, gap, direction: 'horizontal' },
      };
    }

    return {
      pattern: 'grid',
      details: { columns: colCount, rows: rowCount || undefined, gap, direction: 'horizontal' },
    };
  }

  // Flexbox
  if (display === 'flex' || display === 'inline-flex') {
    const direction = styles.flexDirection || 'row';
    const wrap = styles.flexWrap || 'nowrap';
    const gap = styles.gap || '';
    const overflow = styles.overflowX || styles.overflow || '';

    // Carousel: horizontal flex with overflow hidden/scroll
    if (direction === 'row' && (overflow === 'hidden' || overflow === 'scroll' || overflow === 'auto') && children.length > 2) {
      return {
        pattern: 'carousel',
        details: {
          direction: 'horizontal',
          gap,
          columns: children.length,
        },
      };
    }

    // Split layout: 2 children with flex, row direction
    if (direction === 'row' && children.length === 2 && wrap !== 'wrap') {
      return {
        pattern: 'split',
        details: { columns: 2, direction: 'horizontal', gap, alignment: styles.alignItems },
      };
    }

    // Sidebar: flex row, first child narrow
    if (direction === 'row' && children.length === 2) {
      const child0 = children[0]?.boundingBox;
      const child1 = children[1]?.boundingBox;
      if (child0 && child1 && child0.width < child1.width * 0.4) {
        return {
          pattern: 'sidebar',
          details: { columns: 2, direction: 'horizontal', gap },
        };
      }
    }

    // Stack: column direction
    if (direction === 'column') {
      return {
        pattern: 'stack',
        details: { direction: 'vertical', gap, alignment: styles.alignItems },
      };
    }

    // Wrapping flex = grid-like
    if (wrap === 'wrap' && children.length >= 3) {
      const parentWidth = el.boundingBox?.width || 0;
      const childWidth = children[0]?.boundingBox?.width || 0;
      const estimatedCols = childWidth > 0 ? Math.floor(parentWidth / childWidth) : children.length;
      return {
        pattern: 'grid',
        details: { columns: estimatedCols, gap, direction: 'horizontal' },
      };
    }
  }

  // Hero overlay: position relative/absolute with background
  if (styles.position === 'relative' && children.length >= 1) {
    const hasAbsoluteChild = children.some(c => c.computedStyles.position === 'absolute');
    const hasBgImage = styles.backgroundImage && styles.backgroundImage !== 'none';
    if (hasAbsoluteChild || hasBgImage) {
      const bbox = el.boundingBox;
      if (bbox && bbox.height >= 300) {
        return {
          pattern: 'hero-overlay',
          details: { direction: 'vertical', alignment: styles.justifyContent || styles.alignItems },
        };
      }
    }
  }

  return null;
}

/** Count columns from a grid-template-columns value */
function countGridColumns(value: string): number {
  if (!value || value === 'none') return 0;

  // repeat(3, 1fr) → 3
  const repeatMatch = value.match(/repeat\((\d+)/);
  if (repeatMatch) return parseInt(repeatMatch[1], 10);

  // "1fr 1fr 1fr" → 3
  const parts = value.trim().split(/\s+/).filter(p => p && p !== 'none');
  return parts.length;
}

/** Detect responsive layout changes from snapshots */
function detectResponsiveChanges(selector: string, snapshots: ResponsiveSnapshot[]): LayoutStrategy['responsive'] {
  const changes: LayoutStrategy['responsive'] = [];
  if (snapshots.length < 2) return changes;

  // Sort by breakpoint descending (desktop first)
  const sorted = [...snapshots].sort((a, b) => b.breakpoint - a.breakpoint);
  const desktop = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const snap = sorted[i];
    const desktopEl = desktop.elements.find(e => e.selector === selector);
    const snapEl = snap.elements.find(e => e.selector === selector);

    if (!desktopEl || !snapEl) continue;

    const dDisplay = desktopEl.computedStyles.display;
    const sDisplay = snapEl.computedStyles.display;
    const dDir = desktopEl.computedStyles.flexDirection;
    const sDir = snapEl.computedStyles.flexDirection;
    const dCols = desktopEl.computedStyles.gridTemplateColumns;
    const sCols = snapEl.computedStyles.gridTemplateColumns;

    const diffs: string[] = [];
    if (dDisplay !== sDisplay) diffs.push(`display: ${dDisplay} → ${sDisplay}`);
    if (dDir !== sDir) diffs.push(`flex-direction: ${dDir} → ${sDir}`);
    if (dCols !== sCols) diffs.push(`grid-columns: ${countGridColumns(dCols || '')} → ${countGridColumns(sCols || '')}`);

    if (diffs.length > 0) {
      changes.push({
        breakpoint: snap.breakpoint,
        changeTo: diffs.join(', '),
      });
    }
  }

  return changes;
}

// ── Content Pattern Classification ──────────────────────────────────────────

/** Classify content display patterns (carousels, grids, accordions, etc.) */
function classifyContentPatterns(
  scan: ScanResult,
  analysis: AnalysisResult | null,
  interactions: InteractionResult | null,
  sections: SectionPattern[],
): ContentPattern[] {
  const patterns: ContentPattern[] = [];

  for (const section of sections) {
    const el = scan.domTree.find(e => e.selector === section.selector);
    if (!el) continue;

    const children = scan.domTree.filter(c =>
      c.selector.startsWith(el.selector) && c.depth === el.depth + 1
    );

    const descendants = scan.domTree.filter(d =>
      d.selector.startsWith(el.selector) && d.depth > el.depth
    );

    const styles = el.computedStyles;
    const pattern = detectContentPattern(el, children, descendants, styles, section, interactions);
    if (pattern) patterns.push(pattern);
  }

  return patterns;
}

/** Detect specific content display pattern */
function detectContentPattern(
  el: ElementData,
  children: ElementData[],
  descendants: ElementData[],
  styles: Record<string, string>,
  section: SectionPattern,
  interactions: InteractionResult | null,
): ContentPattern | null {
  const overflow = styles.overflowX || styles.overflow || '';

  // Carousel detection
  if ((overflow === 'hidden' || overflow === 'scroll') && children.length > 2) {
    const hasNavButtons = descendants.some(d =>
      d.tag === 'button' && (/prev|next|arrow|chevron|slide/i.test(d.classes.join(' ') + d.textContent))
    );
    const hasDots = descendants.some(d =>
      /dot|indicator|pagination|bullet/i.test(d.classes.join(' '))
    );

    return {
      selector: el.selector,
      type: section.type === 'testimonials' ? 'testimonial-slider' : 'carousel',
      behavior: {
        itemCount: children.length,
        visibleItems: estimateVisibleItems(el, children),
        hasPagination: hasDots,
        loadingStrategy: 'static',
        interactionType: hasNavButtons ? 'click' : 'drag',
      },
      itemStructure: analyzeItemStructure(children, descendants),
    };
  }

  // Accordion detection
  const hasToggles = children.some(c =>
    c.tag === 'details' || c.attributes?.['aria-expanded'] !== undefined
  );
  if (hasToggles && children.length >= 2) {
    return {
      selector: el.selector,
      type: 'accordion',
      behavior: {
        itemCount: children.filter(c => c.tag === 'details' || c.attributes?.['aria-expanded'] !== undefined).length,
        loadingStrategy: 'static',
        interactionType: 'click',
      },
    };
  }

  // Tabs detection
  const hasTabs = descendants.some(d =>
    d.attributes?.role === 'tablist' || d.attributes?.role === 'tab'
  );
  if (hasTabs) {
    const tabCount = descendants.filter(d => d.attributes?.role === 'tab').length;
    return {
      selector: el.selector,
      type: 'tabs',
      behavior: {
        itemCount: tabCount || children.length,
        loadingStrategy: 'static',
        interactionType: 'click',
      },
    };
  }

  // Card grid detection
  if (section.contentStructure.contentType === 'cards' && (section.contentStructure.itemCount || 0) >= 3) {
    const display = styles.display || '';
    if (display === 'grid' || display === 'flex') {
      // Check for filtering or search
      const hasFiltering = descendants.some(d =>
        /filter|sort|category|tag/i.test(d.classes.join(' ') + d.textContent.slice(0, 50))
      );
      const hasSearch = descendants.some(d =>
        d.tag === 'input' && (d.attributes?.type === 'search' || /search/i.test(d.attributes?.placeholder || ''))
      );

      let type: ContentPattern['type'] = 'card-grid';
      if (section.type === 'pricing') type = 'pricing-table';
      else if (section.type === 'gallery') type = 'image-gallery';
      else if (section.type === 'features') type = 'feature-list';
      else if (section.type === 'stats') type = 'stat-counter';

      return {
        selector: el.selector,
        type,
        behavior: {
          itemCount: section.contentStructure.itemCount || 0,
          hasFiltering,
          hasSearch,
          loadingStrategy: detectLoadingStrategy(el, descendants),
          interactionType: section.contentStructure.hasImages ? 'hover' : 'none',
        },
        itemStructure: analyzeItemStructure(children, descendants),
      };
    }
  }

  // Comparison table
  const hasTable = descendants.some(d => d.tag === 'table');
  if (hasTable || (section.type === 'pricing' && children.length >= 2)) {
    return {
      selector: el.selector,
      type: 'comparison-table',
      behavior: {
        itemCount: children.length,
        loadingStrategy: 'static',
        interactionType: 'none',
      },
    };
  }

  return null;
}

/** Estimate how many items are visible in a carousel */
function estimateVisibleItems(parent: ElementData, children: ElementData[]): number {
  const parentWidth = parent.boundingBox?.width || 0;
  if (parentWidth === 0 || children.length === 0) return 1;

  const childWidth = children[0]?.boundingBox?.width || 0;
  if (childWidth === 0) return 1;

  return Math.max(1, Math.round(parentWidth / childWidth));
}

/** Detect loading strategy from DOM clues */
function detectLoadingStrategy(el: ElementData, descendants: ElementData[]): ContentPattern['behavior']['loadingStrategy'] {
  // Check for lazy loading indicators
  const hasLazy = descendants.some(d =>
    d.attributes?.loading === 'lazy' ||
    d.attributes?.['data-src'] !== undefined ||
    /lazy|skeleton|placeholder/i.test(d.classes.join(' '))
  );
  if (hasLazy) return 'lazy';

  // Check for pagination
  const hasPagination = descendants.some(d =>
    /pagination|page-\d|load-more|show-more/i.test(d.classes.join(' ') + d.textContent.slice(0, 30))
  );
  if (hasPagination) return 'paginated';

  return 'static';
}

/** Analyze the structure of repeated items */
function analyzeItemStructure(
  children: ElementData[],
  descendants: ElementData[],
): ContentPattern['itemStructure'] | undefined {
  if (children.length < 2) return undefined;

  // Analyze the first child's structure as representative
  const firstChild = children[0];
  const childDescendants = descendants.filter(d =>
    d.selector.startsWith(firstChild.selector) && d.depth > firstChild.depth && d.depth <= firstChild.depth + 3
  );

  const elements: string[] = [];
  for (const d of childDescendants) {
    if (d.tag === 'img' || d.tag === 'picture' || d.tag === 'svg') elements.push('image');
    else if (/^h[1-6]$/.test(d.tag)) elements.push('title');
    else if (d.tag === 'p') elements.push('description');
    else if (d.tag === 'a') elements.push('link');
    else if (d.tag === 'span' && /price|cost|\$/i.test(d.textContent)) elements.push('price');
    else if (d.tag === 'time' || d.classes.some(c => /date|time/i.test(c))) elements.push('date');
    else if (d.tag === 'span' && /tag|badge|label|category/i.test(d.classes.join(' '))) elements.push('tag');
  }

  const uniqueElements = [...new Set(elements)];
  if (uniqueElements.length === 0) return undefined;

  // Determine layout of items
  const hasImageFirst = uniqueElements[0] === 'image';
  let layout = 'text-only';
  if (hasImageFirst && uniqueElements.includes('title')) layout = 'image-top-text-bottom';
  else if (uniqueElements.includes('image') && uniqueElements.includes('title')) layout = 'image-text-side-by-side';
  else if (uniqueElements.includes('title') && uniqueElements.includes('description')) layout = 'title-description';

  return { elements: uniqueElements, layout };
}

// ── Animation Intent Classification ─────────────────────────────────────────

/** Classify animation intent from distilled motion data */
function classifyAnimationIntents(motion: DistilledMotion | null): AnimationIntent[] {
  if (!motion) return [];

  const intents: AnimationIntent[] = [];
  const animations = motion.animations || [];

  // Group animations by trigger point for stagger detection
  const byTrigger = new Map<string, DistilledAnimation[]>();
  for (const anim of animations) {
    const key = anim.triggerPoint || anim.trigger;
    if (!byTrigger.has(key)) byTrigger.set(key, []);
    byTrigger.get(key)!.push(anim);
  }

  for (const anim of animations) {
    const intent = classifySingleAnimationIntent(anim);

    // Check for orchestration (staggered groups)
    const key = anim.triggerPoint || anim.trigger;
    const group = byTrigger.get(key) || [];
    let orchestration: AnimationIntent['orchestration'];

    if (group.length >= 3) {
      // Check if delays increment = staggered
      const delays = group
        .map(a => parseFloat(a.delay || '0'))
        .filter(d => !isNaN(d));

      if (delays.length >= 3) {
        const sorted = [...delays].sort((a, b) => a - b);
        const diffs = sorted.slice(1).map((d, i) => d - sorted[i]);
        const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        const isStaggered = diffs.every(d => Math.abs(d - avgDiff) < avgDiff * 0.5);

        if (isStaggered && avgDiff > 0) {
          orchestration = {
            type: 'staggered',
            delay: `${avgDiff.toFixed(0)}ms`,
            groupSelector: group[0]?.element.split(' + ')[0],
          };
        }
      }

      if (!orchestration) {
        orchestration = { type: 'simultaneous' };
      }
    }

    intents.push({
      selector: anim.element,
      trigger: anim.trigger,
      intent,
      orchestration,
    });
  }

  return intents;
}

/** Classify a single animation's intent */
function classifySingleAnimationIntent(anim: DistilledAnimation): AnimationIntent['intent'] {
  const { trigger, from, to } = anim;

  if (trigger === 'parallax') return 'parallax-depth';
  if (trigger === 'hover') return 'hover-feedback';
  if (trigger === 'focus') return 'hover-feedback';
  if (trigger === 'continuous') return 'decorative';

  if (trigger === 'scroll-linked') return 'scroll-progress';

  if (trigger === 'scroll-into-view') {
    // Entrance reveal: opacity 0→1 or transform from offscreen
    const hasOpacityReveal = from.opacity === '0' || parseFloat(from.opacity) < 0.1;
    const hasTransformReveal = from.transform && /translate|scale\(0/i.test(from.transform);

    if (hasOpacityReveal || hasTransformReveal) return 'entrance-reveal';

    // Attention grab: same element animates with scale/rotation
    if (from.transform && /rotate|scale/i.test(from.transform)) return 'attention-grab';
  }

  return 'entrance-reveal';
}

// ── Responsive Strategy Classification ──────────────────────────────────────

/** Build responsive strategies from snapshots */
function classifyResponsiveStrategies(
  scan: ScanResult,
  sections: SectionPattern[],
  layouts: LayoutStrategy[],
): ResponsiveStrategy[] {
  const strategies: ResponsiveStrategy[] = [];
  const snapshots = scan.responsiveSnapshots || [];

  if (snapshots.length < 2) return strategies;

  const sorted = [...snapshots].sort((a, b) => a.breakpoint - b.breakpoint);

  for (const section of sections) {
    const layout = layouts.find(l => l.selector === section.selector);
    const breakpoints: ResponsiveStrategy['breakpoints'] = [];

    for (const snap of sorted) {
      const snapEl = snap.elements.find(e => e.selector === section.selector);
      if (!snapEl) continue;

      const display = snapEl.computedStyles.display;
      const dir = snapEl.computedStyles.flexDirection;
      const cols = snapEl.computedStyles.gridTemplateColumns;

      let layoutDesc = display || 'block';
      if (display === 'grid') layoutDesc = `${countGridColumns(cols || '')}-column grid`;
      else if (display === 'flex' && dir === 'column') layoutDesc = 'vertical stack';
      else if (display === 'flex' && dir === 'row') layoutDesc = 'horizontal flex';
      else if (display === 'none') layoutDesc = 'hidden';

      // Detect hidden elements at this breakpoint
      const hiddenElements = snap.elements
        .filter(e => e.selector.startsWith(section.selector) && e.computedStyles.display === 'none')
        .map(e => e.selector);

      breakpoints.push({
        width: snap.breakpoint,
        layout: layoutDesc,
        hiddenElements: hiddenElements.length > 0 ? hiddenElements.slice(0, 5) : undefined,
      });
    }

    if (breakpoints.length < 2) continue;

    // Build strategy description
    const desktop = breakpoints[breakpoints.length - 1];
    const mobile = breakpoints[0];
    const strategy = desktop.layout !== mobile.layout
      ? `${desktop.layout} at desktop, ${mobile.layout} at mobile`
      : `${desktop.layout} at all breakpoints`;

    strategies.push({
      section: section.selector,
      strategy,
      breakpoints,
    });
  }

  return strategies;
}

// ── Information Hierarchy ───────────────────────────────────────────────────

/** Build information hierarchy from page analysis */
function buildInformationHierarchy(
  scan: ScanResult,
  sections: SectionPattern[],
): InformationHierarchy {
  // Find primary CTA (first prominent button/link)
  // Match by class name OR by text content (for framework-generated sites with opaque classes)
  const ctaTextPatterns = /^(get started|sign up|book|schedule|try|start|contact|subscribe|buy|order|learn more|view|explore)/i;
  const ctaElements = scan.domTree.filter(el =>
    (el.tag === 'a' || el.tag === 'button') &&
    el.boundingBox &&
    el.boundingBox.y < 900 &&
    (
      el.classes.some(c => /btn|button|cta|primary|action/i.test(c)) ||
      ctaTextPatterns.test(el.textContent.trim())
    )
  );

  const primaryCTA = ctaElements[0]
    ? {
        selector: ctaElements[0].selector,
        text: ctaElements[0].textContent.slice(0, 50),
        position: ctaElements[0].boundingBox
          ? `${ctaElements[0].boundingBox.y}px from top`
          : 'unknown',
      }
    : null;

  // Determine above-fold sections
  const aboveFold = sections
    .filter(s => {
      const el = scan.domTree.find(e => e.selector === s.selector);
      return el?.boundingBox && el.boundingBox.y < 900;
    })
    .map(s => s.type);

  // Content flow: ordered section types
  const contentFlow = sections
    .sort((a, b) => {
      const elA = scan.domTree.find(e => e.selector === a.selector);
      const elB = scan.domTree.find(e => e.selector === b.selector);
      return (elA?.boundingBox?.y || 0) - (elB?.boundingBox?.y || 0);
    })
    .map(s => s.type);

  // Social proof detection
  const socialProof: InformationHierarchy['socialProof'] = [];
  for (const section of sections) {
    if (section.type === 'testimonials') {
      socialProof.push({ type: 'testimonials', selector: section.selector });
    }
    if (section.type === 'stats') {
      socialProof.push({ type: 'statistics', selector: section.selector });
    }
  }

  // Also check for trust badges, logos, etc.
  const logoGrids = scan.domTree.filter(el =>
    /logo|partner|client|trusted|brand/i.test(el.classes.join(' '))
  );
  if (logoGrids.length > 0) {
    socialProof.push({ type: 'client-logos', selector: logoGrids[0].selector });
  }

  return { primaryCTA, aboveFold, contentFlow, socialProof };
}

// ── Main Classifier ─────────────────────────────────────────────────────────

/**
 * Classify display patterns from extraction data.
 * Reads scan-result.json, analysis-result.json, motion-distilled.json, interactions.json.
 * Writes display-patterns.json.
 */
export async function classifyPatterns(outputDir: string): Promise<DisplayPatterns> {
  log('PatternClassifier', 'info', 'Starting display pattern classification...');

  // Read extraction data
  const scan = safeReadJSON<ScanResult>(path.join(outputDir, 'scan-result.json'));
  if (!scan) {
    throw new Error('scan-result.json required for pattern classification');
  }

  const analysis = safeReadJSON<AnalysisResult>(path.join(outputDir, 'analysis-result.json'));
  const motion = safeReadJSON<DistilledMotion>(path.join(outputDir, 'motion-distilled.json'));
  const interactions = safeReadJSON<InteractionResult>(path.join(outputDir, 'interactions.json'));

  // Step 1: Classify sections
  let sections = classifySections(scan, analysis);

  // Enrich from design-system.json if available (AI synthesis has better section classification)
  const designSystem = safeReadJSON<Record<string, unknown>>(path.join(outputDir, 'design-system.json'));
  if (designSystem?.components && sections.length < 3) {
    const comps = designSystem.components;
    const aiSections: SectionPattern[] = [];
    const sectionTypeMap: Record<string, string> = {
      navigation: 'navigation', header: 'navigation', nav: 'navigation',
      hero: 'hero', banner: 'hero',
      footer: 'footer',
      testimonials: 'testimonials', reviews: 'testimonials',
      pricing: 'pricing', pricingCards: 'pricing', pricingcards: 'pricing',
      features: 'features', services: 'features',
      projects: 'case-studies', projectCards: 'case-studies', projectcards: 'case-studies', portfolio: 'case-studies', work: 'case-studies',
      team: 'team', about: 'team',
      faq: 'faq', faqaccordion: 'faq', faqAccordion: 'faq',
      contact: 'contact', contactbutton: 'contact', contactButton: 'contact',
      cta: 'cta', bookingcta: 'cta', bookingCta: 'cta',
      stats: 'stats',
      gallery: 'gallery',
      blog: 'content-grid',
      scrollprogressindicator: 'navigation', scrollProgressIndicator: 'navigation',
      dotnavigation: 'navigation', dotNavigation: 'navigation',
    };

    for (const [key, val] of Object.entries(comps)) {
      const type = sectionTypeMap[key.toLowerCase()] || key.toLowerCase();
      const comp = val as Record<string, { selector?: string; behavior?: string; links?: unknown[]; description?: string } & Record<string, unknown>>;
      const selector = comp?.primary?.selector || (comp as unknown as { selector?: string })?.selector || '';

      aiSections.push({
        selector,
        type,
        confidence: 0.8,
        evidence: ['ai-synthesis: design-system.json components'],
        contentStructure: {
          heading: comp?.primary?.behavior || (comp as unknown as { description?: string })?.description || undefined,
          hasImages: false,
          hasCTA: !!comp?.primary?.links?.length,
          contentType: 'mixed',
        },
      });
    }

    if (aiSections.length > sections.length) {
      log('PatternClassifier', 'info', `Enriched sections from design-system.json: ${aiSections.length} (was ${sections.length})`);
      sections = aiSections;
    }
  }

  log('PatternClassifier', 'info', `Classified ${sections.length} sections`);

  // Step 2: Classify layouts
  const layouts = classifyLayouts(scan, sections, scan.responsiveSnapshots || []);
  log('PatternClassifier', 'info', `Classified ${layouts.length} layout strategies`);

  // Step 3: Classify content patterns
  const contentPatterns = classifyContentPatterns(scan, analysis, interactions, sections);
  log('PatternClassifier', 'info', `Classified ${contentPatterns.length} content patterns`);

  // Step 4: Classify animation intents
  const animations = classifyAnimationIntents(motion);
  log('PatternClassifier', 'info', `Classified ${animations.length} animation intents`);

  // Step 5: Build responsive strategies
  const responsive = classifyResponsiveStrategies(scan, sections, layouts);
  log('PatternClassifier', 'info', `Built ${responsive.length} responsive strategies`);

  // Step 6: Build information hierarchy
  const hierarchy = buildInformationHierarchy(scan, sections);

  let patterns: DisplayPatterns = {
    url: scan.url,
    timestamp: new Date().toISOString(),
    sections,
    layouts,
    contentPatterns,
    animations,
    responsive,
    hierarchy,
  };

  // Step 7: AI refinement skipped (classify-with-ai.ts not available)

  // Write output
  const outputPath = path.join(outputDir, 'display-patterns.json');
  fs.writeFileSync(outputPath, JSON.stringify(patterns, null, 2));

  const sizeKB = (Buffer.byteLength(JSON.stringify(patterns), 'utf-8') / 1024).toFixed(1);
  log('PatternClassifier', 'info',
    `Wrote display-patterns.json (${sizeKB} KB) — ` +
    `${sections.length} sections, ${layouts.length} layouts, ` +
    `${contentPatterns.length} content patterns, ${animations.length} animations`
  );

  return patterns;
}

// ── CLI Entry ───────────────────────────────────────────────────────────────

if (require.main === module) {
  const outputDir = process.argv[2] || path.resolve(process.cwd(), 'output');
  classifyPatterns(outputDir).catch(err => {
    log('Patterns', 'error', `Fatal error: ${err}`);
    process.exit(1);
  });
}

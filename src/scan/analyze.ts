import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as csstree from 'css-tree';
import { withBrowser, withRetry, safeReadJSON, isScanResult, log } from '../core/utils';
import { ElementData, ResponsiveSnapshot, ScanResult } from '../core/types/scanner';
import { analyzeCSSArchitecture } from './analyze-css';
import { analyzeAccessibility } from './analyze-accessibility';
import {
  CSSArchitecture,
  AnimationPattern,
  ResponsivePattern,
  FormPattern,
  ScrollDrivenAnimation,
  ReducedMotionData,
  TouchAlternatives,
} from '../core/types/analyzer';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ComponentCandidate {
  selector: string;
  tag: string;
  classes: string[];
  pattern: string;
  instances: number;
  children: string[];
  commonStyles: Record<string, string>;
  variants: { selector: string; styleDiffs: Record<string, string> }[];
  confidence: 'high' | 'medium' | 'low';
  detectionMethod: string;
  likelyCmsDriven: boolean;
}

interface AccessibilityData {
  landmarks: { role: string; label: string; selector: string }[];
  headingHierarchy: { level: number; text: string; selector: string }[];
  ariaPatterns: { selector: string; ariaAttributes: Record<string, string> }[];
  focusOrder: string[];
  contrastIssues: { selector: string; foreground: string; background: string; ratio: number }[];
  missingAlt: string[];
  audit: import('../extras/accessibility').FullAccessibilityAuditResult;
}

interface AnalysisResult {
  url: string;
  timestamp: string;
  components: ComponentCandidate[];
  cssArchitecture: CSSArchitecture;
  animationPatterns: AnimationPattern[];
  responsivePatterns: ResponsivePattern[];
  formPatterns: FormPattern[];
  accessibility: AccessibilityData;
  zIndexMap: { selector: string; value: number }[];
  overflowBehaviors: { selector: string; overflow: string; scrollable: boolean }[];
  scrollDrivenAnimations: ScrollDrivenAnimation[];
  reducedMotion: ReducedMotionData;
  touchAlternatives: TouchAlternatives;
}

// ── Main Analyzer ──────────────────────────────────────────────────────────────

async function analyze(url: string, outputDir: string): Promise<AnalysisResult> {
  const scanResultPath = path.join(outputDir, 'scan-result.json');
  if (!fs.existsSync(scanResultPath)) {
    throw new Error(`Scan results not found at ${scanResultPath}. Run scanner first.`);
  }
  const scanResult = safeReadJSON(scanResultPath, isScanResult) as unknown as ScanResult;

  return await withBrowser(async (browser) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  log('Analyzer', 'info', `Loading ${url}...`);
  await withRetry(() => page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }), { label: 'page.goto', retries: 2 });
  await page.waitForTimeout(2000);

  // ── CSS Architecture Analysis (using css-tree) ──
  log('Analyzer', 'info', 'Analyzing CSS architecture...');
  const cssArchitecture = analyzeCSSArchitecture(scanResult.cssRaw);

  // ── Component Detection (multi-layered) ──
  log('Analyzer', 'info', 'Detecting components...');
  const components = await detectComponents(page, scanResult.domTree);

  // ── Animation Patterns ──
  log('Analyzer', 'info', 'Analyzing animations...');
  const animationPatterns = await analyzeAnimations(page, scanResult);

  // ── Responsive Patterns ──
  log('Analyzer', 'info', 'Analyzing responsive patterns...');
  const responsivePatterns = analyzeResponsivePatterns(scanResult.responsiveSnapshots);

  // ── Form Patterns ──
  log('Analyzer', 'info', 'Analyzing forms...');
  const formPatterns = await analyzeForms(page);

  // ── Accessibility ──
  log('Analyzer', 'info', 'Analyzing accessibility...');
  const accessibility = await analyzeAccessibility(page);

  // ── CSS Scroll-Driven Animations ──
  log('Analyzer', 'info', 'Detecting CSS scroll-driven animations...');
  const scrollDrivenAnimations = detectScrollDrivenAnimations(scanResult.cssRaw);

  // ── Reduced Motion Preferences ──
  log('Analyzer', 'info', 'Detecting reduced-motion support...');
  const reducedMotion = detectReducedMotion(scanResult.cssRaw);

  // ── Touch Device Alternatives ──
  log('Analyzer', 'info', 'Detecting touch device alternatives...');
  const touchAlternatives = detectTouchAlternatives(scanResult.cssRaw, animationPatterns);

  // ── Z-index map ──
  const zIndexMap = scanResult.domTree
    .filter((e: ElementData) => e.computedStyles?.zIndex && e.computedStyles.zIndex !== 'auto')
    .map((e: ElementData) => ({ selector: e.selector, value: parseInt(e.computedStyles.zIndex) }))
    .sort((a: { selector: string; value: number }, b: { selector: string; value: number }) => b.value - a.value);

  // ── Overflow behaviors ──
  const overflowBehaviors = scanResult.domTree
    .filter((e: ElementData) => {
      const styles = e.computedStyles || {};
      return styles['overflow'] !== 'visible' || styles['overflowX'] !== 'visible' || styles['overflowY'] !== 'visible';
    })
    .map((e: ElementData) => ({
      selector: e.selector,
      overflow: `${e.computedStyles['overflowX'] || 'visible'} / ${e.computedStyles['overflowY'] || 'visible'}`,
      scrollable: ['scroll', 'auto'].includes(e.computedStyles['overflowX'] ?? '') || ['scroll', 'auto'].includes(e.computedStyles['overflowY'] ?? ''),
    }));

  const result: AnalysisResult = {
    url,
    timestamp: new Date().toISOString(),
    components,
    cssArchitecture,
    animationPatterns,
    responsivePatterns,
    formPatterns,
    accessibility,
    zIndexMap,
    overflowBehaviors,
    scrollDrivenAnimations,
    reducedMotion,
    touchAlternatives,
  };

  const outputPath = path.join(outputDir, 'analysis-result.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  log('Analyzer', 'info', `Results written to ${outputPath}`);

  return result;
  });
}

// ── Component Detection (multi-layered) ────────────────────────────────────────

async function detectComponents(page: Page, _domTree: ElementData[]): Promise<ComponentCandidate[]> {
  const allComponents: ComponentCandidate[] = [];
  const seenSelectors = new Set<string>();

  // Layer 1: Role-based detection (highest confidence)
  interface RawComponent {
    selector: string;
    tag: string;
    classes: string[];
    pattern: string;
    instances: number;
    confidence: 'high' | 'medium' | 'low';
    detectionMethod: string;
    likelyCmsDriven?: boolean;
  }
  const roleComponents = await page.evaluate((): RawComponent[] => {
    const results: RawComponent[] = [];
    const roleMap: Record<string, string> = {
      'navigation': 'nav',
      'dialog': 'modal',
      'alertdialog': 'modal',
      'tablist': 'tabs',
      'tab': 'tab',
      'tabpanel': 'tab-panel',
      'menu': 'menu',
      'menubar': 'menu',
      'tree': 'tree',
      'grid': 'data-table',
      'toolbar': 'toolbar',
      'search': 'search',
      'banner': 'header',
      'contentinfo': 'footer',
      'complementary': 'sidebar',
      'alert': 'alert',
    };

    // Semantic HTML elements
    const semanticMap: Record<string, string> = {
      'nav': 'nav',
      'header': 'header',
      'footer': 'footer',
      'main': 'main',
      'aside': 'sidebar',
      'dialog': 'modal',
      'details': 'accordion',
      'form': 'form',
      'table': 'table',
    };

    // Role-based
    for (const [role, pattern] of Object.entries(roleMap)) {
      document.querySelectorAll(`[role="${role}"]`).forEach(el => {
        const id = el.id;
        const tag = el.tagName.toLowerCase();
        const cls = Array.from(el.classList).slice(0, 3);
        const selector = id ? `#${id}` : cls.length ? `${tag}.${cls.join('.')}` : tag;

        results.push({
          selector,
          tag,
          classes: Array.from(el.classList),
          pattern,
          instances: 1,
          confidence: 'high',
          detectionMethod: `role="${role}"`,
        });
      });
    }

    // Semantic elements
    for (const [tag, pattern] of Object.entries(semanticMap)) {
      document.querySelectorAll(tag).forEach(el => {
        const id = el.id;
        const cls = Array.from(el.classList).slice(0, 3);
        const selector = id ? `#${id}` : cls.length ? `${tag}.${cls.join('.')}` : tag;

        results.push({
          selector,
          tag,
          classes: Array.from(el.classList),
          pattern,
          instances: 1,
          confidence: 'high',
          detectionMethod: `semantic <${tag}>`,
        });
      });
    }

    return results;
  });

  for (const comp of roleComponents) {
    if (!seenSelectors.has(comp.selector)) {
      seenSelectors.add(comp.selector);
      allComponents.push({
        ...comp,
        children: [],
        commonStyles: {},
        variants: [],
        likelyCmsDriven: comp.likelyCmsDriven ?? false,
      });
    }
  }

  // Layer 2: Structural detection (group by child structure signature)
  const structuralComponents = await page.evaluate((): RawComponent[] => {
    const results: RawComponent[] = [];

    // Build structure signatures: tag + ordered child tags
    interface GroupEntry { selector: string; tag: string; classes: string[]; childCount: number }
    const signatureMap = new Map<string, GroupEntry[]>();

    const allEls = Array.from(document.querySelectorAll('*'));
    for (const domEl of allEls) {
      const childCount = domEl.children.length;
      if (childCount < 2 || childCount > 20) continue;
      const classes = Array.from(domEl.classList);
      if (classes.length === 0) continue;

      const tag = domEl.tagName.toLowerCase();
      const childTags = Array.from(domEl.children)
        .map((c: Element) => c.tagName.toLowerCase())
        .join(',');

      if (childTags.length < 3) continue;

      const id = (domEl as HTMLElement).id;
      const selector = id ? `#${id}` : classes.length ? `${tag}.${classes.slice(0, 3).join('.')}` : tag;

      const signature = `${tag}[${childTags}]`;

      if (!signatureMap.has(signature)) signatureMap.set(signature, []);
      signatureMap.get(signature)!.push({ selector, tag, classes, childCount });
    }

    // Groups with 2+ elements are likely components
    for (const [sig, group] of signatureMap) {
      if (group.length < 2) continue;

      const first = group[0];
      const childPattern = sig.split('[')[1]?.replace(']', '') || '';

      // Infer component type from child structure
      let pattern = 'repeated-group';
      if (childPattern.includes('img') && (childPattern.includes('h') || childPattern.includes('p'))) {
        pattern = 'card';
      } else if (childPattern.includes('li') || childPattern === 'a,a,a' || childPattern.match(/^(a,)+a$/)) {
        pattern = 'list';
      }

      const likelyCmsDriven = group.length >= 3; // repeated structure = likely data-driven
      results.push({
        selector: first.selector,
        tag: first.tag,
        classes: first.classes,
        pattern,
        instances: group.length,
        confidence: 'medium' as const,
        detectionMethod: `structural: ${sig.slice(0, 60)}`,
        likelyCmsDriven,
      });
    }

    return results;
  });

  for (const comp of structuralComponents) {
    if (!seenSelectors.has(comp.selector)) {
      seenSelectors.add(comp.selector);
      allComponents.push({
        ...comp,
        children: [],
        commonStyles: {},
        variants: [],
        likelyCmsDriven: comp.likelyCmsDriven ?? false,
      });
    }
  }

  // Layer 3: Style clustering (group elements with near-identical styles)
  const styleComponents = await page.evaluate((): RawComponent[] => {
    const results: RawComponent[] = [];
    const layoutProps = ['display', 'flexDirection', 'padding', 'borderRadius', 'backgroundColor', 'gap'];

    // Build style signature for each element using live computed styles
    interface StyleGroupEntry { selector: string; tag: string; classes: string[] }
    const styleGroups = new Map<string, StyleGroupEntry[]>();

    const allEls = Array.from(document.querySelectorAll('*'));
    for (const domEl of allEls) {
      const classes = Array.from(domEl.classList);
      const tag = domEl.tagName.toLowerCase();
      if (classes.length === 0) continue;
      if (tag === 'div' && classes.length === 0) continue;

      const computed = window.getComputedStyle(domEl);
      const signature = layoutProps
        .map(p => (computed as unknown as Record<string, string>)[p] || '')
        .join('|');

      const id = (domEl as HTMLElement).id;
      const selector = id ? `#${id}` : `${tag}.${classes.slice(0, 3).join('.')}`;

      if (!styleGroups.has(signature)) styleGroups.set(signature, []);
      styleGroups.get(signature)!.push({ selector, tag, classes });
    }

    for (const [sig, group] of styleGroups) {
      if (group.length < 3) continue;
      if (sig === '||||||' || sig.split('|').every(v => !v || v === 'visible' || v === '0px')) continue;

      const first = group[0];
      results.push({
        selector: first.selector,
        tag: first.tag,
        classes: first.classes,
        pattern: `style-cluster-${first.tag}`,
        instances: group.length,
        confidence: 'medium' as const,
        detectionMethod: 'style-clustering',
      });
    }

    return results;
  });

  for (const comp of styleComponents) {
    if (!seenSelectors.has(comp.selector)) {
      seenSelectors.add(comp.selector);
      allComponents.push({
        ...comp,
        children: [],
        commonStyles: {},
        variants: [],
        likelyCmsDriven: comp.likelyCmsDriven ?? false,
      });
    }
  }

  // Layer 4: Regex name-based detection (lowest confidence, fallback)
  const regexComponents = await page.evaluate((): RawComponent[] => {
    const componentPatterns: Record<string, RegExp[]> = {
      'button': [/btn/i, /button/i, /cta/i],
      'card': [/card/i, /tile/i, /panel/i],
      'nav': [/nav/i, /menu/i, /sidebar/i],
      'header': [/header/i, /hero/i, /banner/i, /masthead/i],
      'footer': [/footer/i, /bottom/i],
      'form': [/form/i, /input/i, /field/i, /search/i],
      'modal': [/modal/i, /dialog/i, /popup/i, /overlay/i],
      'list': [/list/i, /grid/i, /gallery/i, /collection/i],
      'badge': [/badge/i, /tag/i, /chip/i, /label/i, /pill/i],
      'avatar': [/avatar/i, /profile/i, /user-img/i],
      'tab': [/tab/i],
      'accordion': [/accordion/i, /collapse/i, /expand/i],
      'tooltip': [/tooltip/i, /popover/i],
      'breadcrumb': [/breadcrumb/i, /crumb/i],
      'pagination': [/pagination/i, /pager/i],
      'alert': [/alert/i, /notification/i, /toast/i, /snackbar/i],
      'dropdown': [/dropdown/i, /select/i, /combobox/i],
      'carousel': [/carousel/i, /slider/i, /swiper/i, /slideshow/i],
      'table': [/table/i, /datagrid/i],
      'section': [/section/i, /block/i, /container/i, /wrapper/i],
    };

    interface RegexGroupEntry { selector: string; tag: string; classes: string[] }
    const componentMap = new Map<string, RegexGroupEntry[]>();

    const allEls = Array.from(document.querySelectorAll('*'));
    for (const domEl of allEls) {
      const classes = Array.from(domEl.classList);
      const tag = domEl.tagName.toLowerCase();
      const classStr = classes.join(' ') + ' ' + tag;
      const id = (domEl as HTMLElement).id;
      const selector = id ? `#${id}` : classes.length ? `${tag}.${classes.slice(0, 3).join('.')}` : tag;

      for (const [pattern, regexes] of Object.entries(componentPatterns)) {
        if (regexes.some(r => r.test(classStr))) {
          if (!componentMap.has(pattern)) componentMap.set(pattern, []);
          componentMap.get(pattern)!.push({ selector, tag, classes });
          break;
        }
      }
    }

    const results: RawComponent[] = [];
    for (const [pattern, group] of componentMap) {
      if (group.length === 0) continue;
      const first = group[0];
      results.push({
        selector: first.selector,
        tag: first.tag,
        classes: first.classes,
        pattern,
        instances: group.length,
        confidence: 'low' as const,
        detectionMethod: 'class-name-regex',
      });
    }

    return results;
  });

  for (const comp of regexComponents) {
    if (!seenSelectors.has(comp.selector)) {
      seenSelectors.add(comp.selector);
      allComponents.push({
        ...comp,
        children: [],
        commonStyles: {},
        variants: [],
        likelyCmsDriven: comp.likelyCmsDriven ?? false,
      });
    }
  }

  return allComponents.sort((a, b) => {
    const confOrder = { high: 0, medium: 1, low: 2 };
    const confDiff = confOrder[a.confidence] - confOrder[b.confidence];
    if (confDiff !== 0) return confDiff;
    return b.instances - a.instances;
  });
}

// ── Animation Analysis ─────────────────────────────────────────────────────────

async function analyzeAnimations(_page: Page, scanResult: ScanResult): Promise<AnimationPattern[]> {
  const patterns: AnimationPattern[] = [];

  for (const anim of (scanResult.animations || [])) {
    patterns.push({
      element: 'global',
      trigger: 'css',
      properties: [],
      duration: anim.duration,
      timing: anim.timing,
      delay: '',
      keyframes: anim.keyframes,
    });
  }

  for (const el of scanResult.domTree) {
    const styles = el.computedStyles || {};
    if (styles.transition && styles.transition !== 'all 0s ease 0s' && styles.transition !== 'none') {
      const existing = patterns.find(p => p.element === el.selector);
      if (!existing) {
        patterns.push({
          element: el.selector,
          trigger: 'state-change',
          properties: (styles.transitionProperty || 'all').split(',').map((p: string) => p.trim()),
          duration: styles.transitionDuration || '',
          timing: styles.transitionTimingFunction || '',
          delay: styles.transitionDelay || '',
        });
      }
    }

    if (styles.animationName && styles.animationName !== 'none') {
      patterns.push({
        element: el.selector,
        trigger: 'load',
        properties: [],
        duration: styles.animationDuration || '',
        timing: styles.animationTimingFunction || '',
        delay: styles.animationDelay || '',
      });
    }
  }

  return patterns;
}

// ── Responsive Pattern Analysis ────────────────────────────────────────────────

function analyzeResponsivePatterns(snapshots: ResponsiveSnapshot[]): ResponsivePattern[] {
  const patterns: ResponsivePattern[] = [];

  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];
    const changes: ResponsivePattern['changes'] = [];
    const layoutShifts: ResponsivePattern['layoutShifts'] = [];

    type SnapshotElement = ResponsiveSnapshot['elements'][number];
    const prevMap = new Map<string, SnapshotElement>();
    for (const el of prev.elements) {
      prevMap.set(el.selector, el);
    }

    for (const el of curr.elements) {
      const prevEl = prevMap.get(el.selector);
      if (!prevEl) continue;

      for (const [prop, val] of Object.entries(el.computedStyles)) {
        if (prevEl.computedStyles[prop] !== val) {
          changes.push({
            selector: el.selector,
            property: prop,
            fromValue: prevEl.computedStyles[prop] ?? '',
            toValue: val,
          });
        }
      }

      const prevDisplay = prevEl.computedStyles['display'];
      const currDisplay = el.computedStyles['display'];
      if (prevDisplay !== currDisplay) {
        layoutShifts.push({
          selector: el.selector,
          fromLayout: prevDisplay ?? '',
          toLayout: currDisplay ?? '',
        });
      }

      const prevFlex = prevEl.computedStyles['flexDirection'];
      const currFlex = el.computedStyles['flexDirection'];
      if (prevFlex !== currFlex && (prevFlex || currFlex)) {
        layoutShifts.push({
          selector: el.selector,
          fromLayout: `flex-${prevFlex}`,
          toLayout: `flex-${currFlex}`,
        });
      }
    }

    if (changes.length > 0 || layoutShifts.length > 0) {
      patterns.push({
        breakpoint: curr.breakpoint,
        changes: changes.slice(0, 500),
        layoutShifts,
      });
    }
  }

  return patterns;
}

// ── Form Analysis ──────────────────────────────────────────────────────────────

async function analyzeForms(page: Page): Promise<FormPattern[]> {
  return await page.evaluate((): FormPattern[] => {
    const forms: FormPattern[] = [];
    const formEls = document.querySelectorAll('form');

    formEls.forEach((form) => {
      const fields: FormPattern['fields'] = [];
      form.querySelectorAll('input, select, textarea').forEach((fieldEl) => {
        const field = fieldEl as HTMLInputElement;
        const validation: string[] = [];
        if (field.required) validation.push('required');
        if (field.pattern) validation.push(`pattern:${field.pattern}`);
        if (field.minLength > 0) validation.push(`minLength:${field.minLength}`);
        if (field.maxLength > 0 && field.maxLength < 524288) validation.push(`maxLength:${field.maxLength}`);
        if (field.min) validation.push(`min:${field.min}`);
        if (field.max) validation.push(`max:${field.max}`);
        if (field.type === 'email') validation.push('email');
        if (field.type === 'url') validation.push('url');

        fields.push({
          type: field.type || field.tagName.toLowerCase(),
          name: field.name || field.id || '',
          validation,
          placeholder: field.placeholder || '',
          required: field.required || false,
        });
      });

      const submitBtn = form.querySelector('[type="submit"], button:not([type])');
      const errorDisplay = form.querySelector('[class*="error"], [class*="invalid"], [role="alert"]');

      forms.push({
        selector: form.id ? `#${form.id}` : `form`,
        fields,
        submitButton: submitBtn ? (submitBtn as HTMLElement).outerHTML.slice(0, 200) : '',
        errorDisplay: errorDisplay ? (errorDisplay as HTMLElement).outerHTML.slice(0, 200) : '',
      });
    });

    return forms;
  });
}

// ── CSS Scroll-Driven Animation Detection ────────────────────────────────────

function detectScrollDrivenAnimations(cssRaw: { url: string; content: string }[]): ScrollDrivenAnimation[] {
  const results: ScrollDrivenAnimation[] = [];

  const scrollTimelineProps = [
    'animation-timeline',
    'scroll-timeline',
    'scroll-timeline-name',
    'scroll-timeline-axis',
    'view-timeline',
    'view-timeline-name',
    'view-timeline-axis',
    'view-timeline-inset',
  ];

  for (const { content } of cssRaw) {
    // Regex-based detection since css-tree may not fully support these newer properties
    const ruleRegex = /([^{}]+)\{([^}]*(?:animation-timeline|scroll-timeline|view-timeline)[^}]*)\}/g;
    let match;

    while ((match = ruleRegex.exec(content)) !== null) {
      const selector = match[1].trim();
      const declarations = match[2];

      const timelineMatch = declarations.match(/animation-timeline\s*:\s*([^;]+)/);
      const scrollTimelineMatch = declarations.match(/scroll-timeline(?:-name)?\s*:\s*([^;]+)/);
      const viewTimelineMatch = declarations.match(/view-timeline(?:-name)?\s*:\s*([^;]+)/);

      if (timelineMatch) {
        const value = timelineMatch[1].trim();
        const type: 'scroll' | 'view' = value.includes('view(') ? 'view' : 'scroll';
        results.push({ selector, timeline: value, type });
      }

      if (scrollTimelineMatch) {
        results.push({ selector, timeline: scrollTimelineMatch[1].trim(), type: 'scroll' });
      }

      if (viewTimelineMatch) {
        results.push({ selector, timeline: viewTimelineMatch[1].trim(), type: 'view' });
      }
    }

    // Also try AST-based detection
    try {
      const ast = csstree.parse(content, { parseCustomProperty: true });
      csstree.walk(ast, {
        visit: 'Declaration',
        enter(node: csstree.Declaration) {
          if (scrollTimelineProps.includes(node.property)) {
            const value = csstree.generate(node.value);
            const type: 'scroll' | 'view' = node.property.startsWith('view-') ||
              value.includes('view(') ? 'view' : 'scroll';

            const alreadyFound = results.some(r => r.timeline === value);
            if (!alreadyFound) {
              results.push({ selector: '(from AST)', timeline: value, type });
            }
          }
        },
      });
    } catch {
      // CSS parse failed, regex results are sufficient
    }
  }

  return results;
}

// ── Reduced Motion Preference Detection ───────────────────────────────────────

function detectReducedMotion(cssRaw: { url: string; content: string }[]): ReducedMotionData {
  const affectedSelectors: string[] = [];
  const fallbacks: string[] = [];
  let hasReducedMotionSupport = false;

  for (const { content } of cssRaw) {
    try {
      const ast = csstree.parse(content, { parseCustomProperty: true });

      csstree.walk(ast, {
        visit: 'Atrule',
        enter(node: csstree.Atrule) {
          if (node.name === 'media' && node.prelude) {
            const query = csstree.generate(node.prelude);

            if (query.includes('prefers-reduced-motion')) {
              hasReducedMotionSupport = true;

              if (node.block) {
                csstree.walk(node.block, {
                  visit: 'Rule',
                  enter(rule: csstree.Rule) {
                    if (rule.prelude) {
                      const selector = csstree.generate(rule.prelude);
                      affectedSelectors.push(selector);

                      if (rule.block) {
                        csstree.walk(rule.block, {
                          visit: 'Declaration',
                          enter(decl: csstree.Declaration) {
                            const value = csstree.generate(decl.value);
                            fallbacks.push(`${selector} { ${decl.property}: ${value} }`);
                          },
                        });
                      }
                    }
                  },
                });
              }
            }
          }
        },
      });
    } catch {
      // Fallback to regex
      const reducedMotionRegex = /@media\s*\([^)]*prefers-reduced-motion[^)]*\)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)}/g;
      let rmMatch;
      while ((rmMatch = reducedMotionRegex.exec(content)) !== null) {
        hasReducedMotionSupport = true;
        const innerBlock = rmMatch[1];
        const selectorRegex = /([^{}]+)\{([^}]+)\}/g;
        let innerMatch;
        while ((innerMatch = selectorRegex.exec(innerBlock)) !== null) {
          const sel = innerMatch[1].trim();
          affectedSelectors.push(sel);
          fallbacks.push(`${sel} { ${innerMatch[2].trim()} }`);
        }
      }
    }
  }

  return {
    hasReducedMotionSupport,
    affectedSelectors: [...new Set(affectedSelectors)],
    fallbacks: [...new Set(fallbacks)],
  };
}

// ── Touch Device Alternative Detection ────────────────────────────────────────

function detectTouchAlternatives(
  cssRaw: { url: string; content: string }[],
  animationPatterns: AnimationPattern[],
): TouchAlternatives {
  let hasHoverMediaQuery = false;
  const hoverMediaSelectors = new Set<string>();
  const pointerCoarseSelectors = new Set<string>();

  for (const { content } of cssRaw) {
    try {
      const ast = csstree.parse(content, { parseCustomProperty: true });

      csstree.walk(ast, {
        visit: 'Atrule',
        enter(node: csstree.Atrule) {
          if (node.name === 'media' && node.prelude) {
            const query = csstree.generate(node.prelude);

            const isHoverNone = query.includes('hover:none') || query.includes('hover: none');
            const isPointerCoarse = query.includes('pointer:coarse') || query.includes('pointer: coarse');

            if (isHoverNone || isPointerCoarse) {
              hasHoverMediaQuery = true;

              if (node.block) {
                csstree.walk(node.block, {
                  visit: 'Rule',
                  enter(rule: csstree.Rule) {
                    if (rule.prelude) {
                      const sel = csstree.generate(rule.prelude);
                      if (isHoverNone) hoverMediaSelectors.add(sel);
                      if (isPointerCoarse) pointerCoarseSelectors.add(sel);
                    }
                  },
                });
              }
            }
          }
        },
      });
    } catch {
      // Regex fallback
      const hoverNoneRegex = /@media\s*\([^)]*(?:hover\s*:\s*none|pointer\s*:\s*coarse)[^)]*\)/g;
      if (hoverNoneRegex.test(content)) {
        hasHoverMediaQuery = true;
      }
    }
  }

  const hoverAnimations = animationPatterns.filter(a => a.trigger === 'state-change' || a.trigger === 'hover');
  const touchFriendlyCount = hoverMediaSelectors.size + pointerCoarseSelectors.size;

  const coveredSelectors = new Set([...hoverMediaSelectors, ...pointerCoarseSelectors]);
  const hoverOnlyAnimations = hoverAnimations.filter(a => !coveredSelectors.has(a.element)).length;

  return {
    hasHoverMediaQuery,
    hoverOnlyAnimations,
    touchFriendlyCount,
  };
}

export { analyze };

// ── CLI Entry ──────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const url = args[0];
  const outputDir = args[1] || path.resolve(process.cwd(), 'output');

  if (!url) {
    log('Analyzer', 'error', 'Usage: ts-node analyze.ts <url> [output-dir]');
    process.exit(1);
  }

  analyze(url, outputDir)
    .then(() => {
      log('Analyzer', 'info', 'Done.');
      process.exit(0);
    })
    .catch((err) => {
      log('Analyzer', 'error', err);
      process.exit(1);
    });
}

import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { withBrowser, withContext, withRetry, log, escapeCSSSelector } from '../core/utils';

/**
 * Motion Capture Script
 *
 * Captures JS-driven animations (Framer Motion, GSAP, etc.) by:
 * 1. Scrolling through the page incrementally and recording element transforms/opacity
 * 2. Hovering interactive elements and recording transition frames
 * 3. Using getAnimations() API to capture Web Animations
 * 4. Recording intersection observer triggers
 */

// ── Configuration ──────────────────────────────────────────────────────────────

const VIEWPORTS = [375, 768, 1440]; // mobile, tablet, desktop — representative set
const VIEWPORT_HEIGHT = 900;
const SCROLL_STEP = 75; // pixels per scroll step (balances accuracy vs speed)
const SCROLL_STEP_FINE = 25; // pixels per step for fine-grained second pass in active regions
const SCROLL_PAUSE = 60; // ms pause between steps (let animations trigger)
const MAX_CANDIDATES = 200; // cap candidate elements to keep capture fast
const HOVER_RECORD_FRAMES = 20; // number of frames to record per hover
const HOVER_FRAME_INTERVAL = 50; // ms between hover frames
const ANIMATION_PROPERTIES = [
  'transform', 'opacity', 'visibility',
  'width', 'height', 'maxWidth', 'maxHeight',
  'top', 'left', 'right', 'bottom',
  'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'backgroundColor', 'color', 'borderColor',
  'borderRadius', 'boxShadow', 'filter', 'backdropFilter',
  'clipPath', 'scale', 'rotate',
  'fontSize', 'letterSpacing', 'lineHeight',
  'gap', 'flexDirection', 'gridTemplateColumns',
];

// ── Types ──────────────────────────────────────────────────────────────────────

interface ElementMotionData {
  selector: string;
  tag: string;
  classes: string[];
  textPreview: string;
  scrollKeyframes: ScrollKeyframe[];
  hoverTransition: TransitionCapture | null;
  focusTransition: TransitionCapture | null;
  webAnimations: WebAnimationData[];
  motionAttributes: Record<string, string>; // data-framer-*, style attributes
  initialState: Record<string, string>;
  finalState: Record<string, string>;
  triggerPoint: number | null; // scroll Y where animation starts
  animationType: string; // 'entrance', 'scroll-linked', 'hover', 'continuous', 'none'
}

interface ScrollKeyframe {
  scrollY: number;
  styles: Record<string, string>;
  boundingBox: { x: number; y: number; width: number; height: number };
  inViewport: boolean;
}

interface TransitionCapture {
  frames: { time: number; styles: Record<string, string> }[];
  duration: number; // estimated from frame captures
  properties: string[]; // which properties changed
  easing: string; // estimated
}

interface WebAnimationData {
  animationName: string;
  duration: number;
  delay: number;
  easing: string;
  iterations: number;
  direction: string;
  fillMode: string;
  keyframes: Record<string, string>[];
}

interface ViewportMotionData {
  viewportWidth: number;
  pageHeight: number;
  elements: ElementMotionData[];
  globalPatterns: {
    entranceAnimations: { selector: string; type: string; from: Record<string, string>; to: Record<string, string>; triggerScroll: number; duration: string }[];
    scrollLinkedAnimations: { selector: string; property: string; startScroll: number; endScroll: number; startValue: string; endValue: string }[];
    hoverTransitions: { selector: string; properties: string[]; duration: string; easing: string; from: Record<string, string>; to: Record<string, string> }[];
    continuousAnimations: { selector: string; animationName: string; duration: string; iterationCount: string }[];
    parallaxEffects: { selector: string; scrollRatio: number; direction: string }[];
  };
  summary: {
    totalAnimatedElements: number;
    entranceCount: number;
    scrollLinkedCount: number;
    hoverCount: number;
    continuousCount: number;
    parallaxCount: number;
  };
}

interface MotionCaptureResult {
  url: string;
  timestamp: string;
  viewports: ViewportMotionData[];
  crossViewportDiffs: {
    selector: string;
    property: string;
    differences: { viewport: number; value: string }[];
  }[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function buildSelector(tag: string, id: string, classes: string[], index: number): string {
  if (id) return `#${id}`;
  const cls = classes.filter(c => c && !/^\d/.test(c)).slice(0, 3).map(c => `.${c}`).join('');
  return cls ? `${tag}${cls}` : `${tag}[data-idx="${index}"]`;
}

// ── Main Motion Capture ────────────────────────────────────────────────────────

async function captureMotion(url: string, outputDir: string): Promise<MotionCaptureResult> {
  fs.mkdirSync(outputDir, { recursive: true });

  return withBrowser(async (browser) => {
    const allViewportData: ViewportMotionData[] = [];

    for (const vw of VIEWPORTS) {
      log('MotionCapture', 'info', `\n${'='.repeat(60)}`);
      log('MotionCapture', 'info', `  VIEWPORT: ${vw}px`);
      log('MotionCapture', 'info', `${'='.repeat(60)}`);

      await withContext(browser, { viewport: { width: vw, height: VIEWPORT_HEIGHT }, deviceScaleFactor: 2 }, async (context) => {
        const page = await context.newPage();

        await withRetry(() => page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }), { label: 'page.goto', retries: 2 });
        await page.waitForTimeout(3000);

        const viewportData = await captureViewport(page, url, vw);
        allViewportData.push(viewportData);
      });
    }

    // ── Cross-viewport diff analysis ──
    log('MotionCapture', 'info', 'Analyzing cross-viewport differences...');
    const crossViewportDiffs = analyzeCrossViewportDiffs(allViewportData);

    const result: MotionCaptureResult = {
      url,
      timestamp: new Date().toISOString(),
      viewports: allViewportData,
      crossViewportDiffs,
    };

    // Write single output file (already deduplicated during capture)
    const outputPath = path.join(outputDir, 'motion-capture.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    log('MotionCapture', 'info', `Results written to ${outputPath}`);

    // Print summary
    log('MotionCapture', 'info', `\n${'='.repeat(60)}`);
    log('MotionCapture', 'info', '  MOTION CAPTURE SUMMARY');
    log('MotionCapture', 'info', `${'='.repeat(60)}`);
    for (const vp of allViewportData) {
      log('MotionCapture', 'info', `  ${vp.viewportWidth}px: ${vp.summary.totalAnimatedElements} animated elements`);
      log('MotionCapture', 'info', `    entrance: ${vp.summary.entranceCount}, scroll-linked: ${vp.summary.scrollLinkedCount}, hover: ${vp.summary.hoverCount}, parallax: ${vp.summary.parallaxCount}`);
    }
    log('MotionCapture', 'info', `  Cross-viewport differences: ${crossViewportDiffs.length}`);

    return result;
  });
}

// ── Cross-viewport diff analysis ───────────────────────────────────────────────

function analyzeCrossViewportDiffs(viewports: ViewportMotionData[]): MotionCaptureResult['crossViewportDiffs'] {
  const diffs: MotionCaptureResult['crossViewportDiffs'] = [];

  // Build a map of selector → viewport → animation data
  const selectorMap = new Map<string, Map<number, ElementMotionData>>();
  for (const vp of viewports) {
    for (const el of vp.elements) {
      if (!selectorMap.has(el.selector)) selectorMap.set(el.selector, new Map());
      selectorMap.get(el.selector)!.set(vp.viewportWidth, el);
    }
  }

  for (const [selector, vpMap] of selectorMap) {
    // Check if animation type changes across viewports
    const types = new Map<number, string>();
    for (const [vw, el] of vpMap) {
      types.set(vw, el.animationType);
    }
    const uniqueTypes = new Set(types.values());
    if (uniqueTypes.size > 1) {
      diffs.push({
        selector,
        property: 'animationType',
        differences: Array.from(types.entries()).map(([viewport, value]) => ({ viewport, value })),
      });
    }

    // Check if an element is animated at some viewports but not others
    const presentAt = Array.from(vpMap.keys());
    const absentAt = viewports.map(v => v.viewportWidth).filter(vw => !presentAt.includes(vw));
    if (absentAt.length > 0 && presentAt.length > 0) {
      diffs.push({
        selector,
        property: 'existence',
        differences: [
          ...presentAt.map(vw => ({ viewport: vw, value: 'animated' })),
          ...absentAt.map(vw => ({ viewport: vw, value: 'not-animated' })),
        ],
      });
    }

    // Check scroll trigger points differ
    const triggers = new Map<number, number | null>();
    for (const [vw, el] of vpMap) {
      triggers.set(vw, el.triggerPoint);
    }
    const uniqueTriggers = new Set(Array.from(triggers.values()).map(v => v ?? 'null'));
    if (uniqueTriggers.size > 1) {
      diffs.push({
        selector,
        property: 'triggerPoint',
        differences: Array.from(triggers.entries()).map(([viewport, value]) => ({ viewport, value: String(value ?? 'null') })),
      });
    }
  }

  return diffs;
}

// ── Per-viewport capture ───────────────────────────────────────────────────────

async function captureViewport(page: Page, url: string, viewportWidth: number): Promise<ViewportMotionData> {
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  log('Motion', 'info', `Page height: ${pageHeight}px, viewport: ${viewportWidth}x${VIEWPORT_HEIGHT}`);

  // ── Step 1: Identify potentially animated elements ──
  log('MotionCapture', 'info', 'Identifying animated elements...');
  const allCandidates = await identifyAnimatedCandidates(page);
  // Cap candidates to keep scroll capture fast — prioritize elements already in the list order
  // (which naturally prioritizes transforms, opacity, will-change over broad matches like <a>/<button>)
  const candidates = allCandidates.slice(0, MAX_CANDIDATES);
  log('Motion', 'info', `Found ${allCandidates.length} candidates, using top ${candidates.length}`);

  // ── Step 2: Record initial state (before any scroll) ──
  log('MotionCapture', 'info', 'Recording initial states...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  const initialStates = await captureElementStates(page, candidates);

  // ── Step 3: Scroll-based capture ──
  log('MotionCapture', 'info', 'Starting scroll capture...');
  const scrollData = new Map<string, ScrollKeyframe[]>();
  for (const c of candidates) {
    scrollData.set(c.selector, []);
  }

  const totalSteps = Math.ceil(pageHeight / SCROLL_STEP);
  let lastLogPercent = 0;

  // Dedup: track last styles per selector to skip unchanged frames
  const lastStylesMap = new Map<string, string>();
  const isLastStep = (y: number) => y >= pageHeight - SCROLL_STEP;

  for (let scrollY = 0; scrollY <= pageHeight; scrollY += SCROLL_STEP) {
    await page.evaluate((y) => window.scrollTo(0, y), scrollY);
    await page.waitForTimeout(SCROLL_PAUSE);

    const frameData = await page.evaluate(
      ({ selectors, props, scrollY, vpHeight }: { selectors: string[]; props: string[]; scrollY: number; vpHeight: number }) => {
        const results: Record<string, { styles: Record<string, string>; boundingBox: { x: number; y: number; width: number; height: number }; inViewport: boolean }> = {};
        for (const sel of selectors) {
          try {
            const el = document.querySelector(sel);
            if (!el) continue;
            const computed = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            const styles: Record<string, string> = {};
            for (const prop of props) {
              const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
              styles[prop] = computed.getPropertyValue(cssProp);
            }
            results[sel] = {
              styles,
              boundingBox: {
                x: Math.round(rect.x * 100) / 100,
                y: Math.round(rect.y * 100) / 100,
                width: Math.round(rect.width * 100) / 100,
                height: Math.round(rect.height * 100) / 100,
              },
              inViewport: rect.top < vpHeight && rect.bottom > 0,
            };
          } catch { /* skip invalid selectors */ }
        }
        return results;
      },
      {
        selectors: candidates.map(c => escapeCSSSelector(c.selector)),
        props: ANIMATION_PROPERTIES,
        scrollY,
        vpHeight: VIEWPORT_HEIGHT,
      }
    );

    for (const c of candidates) {
      const data = frameData[c.selector];
      if (data) {
        const styleKey = JSON.stringify(data.styles);
        const prev = lastStylesMap.get(c.selector);
        // Only record when styles change, or on first/last frame
        if (styleKey !== prev || scrollY === 0 || isLastStep(scrollY)) {
          scrollData.get(c.selector)!.push({
            scrollY,
            styles: data.styles,
            boundingBox: data.boundingBox,
            inViewport: data.inViewport,
          });
          lastStylesMap.set(c.selector, styleKey);
        }
      }
    }

    const percent = Math.floor((scrollY / pageHeight) * 100);
    if (percent >= lastLogPercent + 10) {
      log('Motion', 'info', `  Scroll progress: ${percent}%`);
      lastLogPercent = percent;
    }
  }

  // ── Step 3b: Fine-grained second pass in active regions ──
  // Identify scroll positions where ANY element had a style change during the first pass.
  const activeScrollYSet = new Set<number>();
  for (const keyframes of scrollData.values()) {
    // keyframes with more than 1 entry (first/last always recorded) indicate real changes
    for (const kf of keyframes) {
      activeScrollYSet.add(kf.scrollY);
    }
  }

  // Build contiguous active regions from the active scroll positions.
  const FINE_BUFFER = 100; // px buffer around each active region
  const sortedActiveYs = Array.from(activeScrollYSet).sort((a, b) => a - b);
  const activeRegions: { start: number; end: number }[] = [];
  for (const y of sortedActiveYs) {
    const regionStart = Math.max(0, y - FINE_BUFFER);
    const regionEnd = Math.min(pageHeight, y + FINE_BUFFER);
    if (activeRegions.length === 0 || regionStart > activeRegions[activeRegions.length - 1].end) {
      activeRegions.push({ start: regionStart, end: regionEnd });
    } else {
      activeRegions[activeRegions.length - 1].end = Math.max(activeRegions[activeRegions.length - 1].end, regionEnd);
    }
  }

  if (activeRegions.length > 0) {
    log('MotionCapture', 'info', `Fine-grained second pass: ${activeRegions.length} active region(s)...`);
    // Dedup map for fine pass — seeded from first-pass results
    const fineLastStylesMap = new Map<string, string>(lastStylesMap);

    for (const region of activeRegions) {
      for (let scrollY = region.start; scrollY <= region.end; scrollY += SCROLL_STEP_FINE) {
        // Skip positions already captured at coarser granularity
        if (scrollY % SCROLL_STEP === 0) continue;

        await page.evaluate((y) => window.scrollTo(0, y), scrollY);
        await page.waitForTimeout(SCROLL_PAUSE);

        const fineFrameData = await page.evaluate(
          ({ selectors, props, scrollY, vpHeight }: { selectors: string[]; props: string[]; scrollY: number; vpHeight: number }) => {
            const results: Record<string, { styles: Record<string, string>; boundingBox: { x: number; y: number; width: number; height: number }; inViewport: boolean }> = {};
            for (const sel of selectors) {
              try {
                const el = document.querySelector(sel);
                if (!el) continue;
                const computed = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                const styles: Record<string, string> = {};
                for (const prop of props) {
                  const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
                  styles[prop] = computed.getPropertyValue(cssProp);
                }
                results[sel] = {
                  styles,
                  boundingBox: {
                    x: Math.round(rect.x * 100) / 100,
                    y: Math.round(rect.y * 100) / 100,
                    width: Math.round(rect.width * 100) / 100,
                    height: Math.round(rect.height * 100) / 100,
                  },
                  inViewport: rect.top < vpHeight && rect.bottom > 0,
                };
              } catch { /* skip invalid selectors */ }
            }
            return results;
          },
          {
            selectors: candidates.map(c => escapeCSSSelector(c.selector)),
            props: ANIMATION_PROPERTIES,
            scrollY,
            vpHeight: VIEWPORT_HEIGHT,
          }
        );

        for (const c of candidates) {
          const data = fineFrameData[c.selector];
          if (data) {
            const styleKey = JSON.stringify(data.styles);
            const prev = fineLastStylesMap.get(c.selector);
            if (styleKey !== prev) {
              // Insert into scrollData sorted by scrollY
              const keyframes = scrollData.get(c.selector)!;
              const insertIdx = keyframes.findIndex(kf => kf.scrollY > scrollY);
              const newFrame: ScrollKeyframe = {
                scrollY,
                styles: data.styles,
                boundingBox: data.boundingBox,
                inViewport: data.inViewport,
              };
              if (insertIdx === -1) {
                keyframes.push(newFrame);
              } else {
                keyframes.splice(insertIdx, 0, newFrame);
              }
              fineLastStylesMap.set(c.selector, styleKey);
            }
          }
        }
      }
    }
  }

  // ── Step 4: Record final state (fully scrolled) ──
  log('MotionCapture', 'info', 'Recording final states...');
  const finalStates = await captureElementStates(page, candidates);

  // ── Step 5: Scroll back to top for hover captures ──
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);

  // ── Step 6: Hover transition captures ──
  log('MotionCapture', 'info', 'Capturing hover transitions...');
  const hoverTransitions = new Map<string, TransitionCapture | null>();
  const focusTransitions = new Map<string, TransitionCapture | null>();

  const interactiveSelectors = candidates
    .filter(c => ['a', 'button'].includes(c.tag) || c.classes.some(cl => /btn|button|cta|link|nav/i.test(cl)))
    .slice(0, 50); // cap at 50

  for (const c of interactiveSelectors) {
    try {
      const escapedSel = escapeCSSSelector(c.selector);
      // Scroll element into view
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.scrollIntoView({ block: 'center' });
      }, escapedSel);
      await page.waitForTimeout(200);

      // Capture hover transition
      const hoverCapture = await captureHoverTransition(page, escapedSel);
      hoverTransitions.set(c.selector, hoverCapture);

      // Capture focus transition
      const focusCapture = await captureFocusTransition(page, escapedSel);
      focusTransitions.set(c.selector, focusCapture);
    } catch (e) {
      log('Motion', 'debug', `Hover/focus capture failed for ${c.selector}: ${(e as Error).message}`);
      hoverTransitions.set(c.selector, null);
      focusTransitions.set(c.selector, null);
    }
  }

  // ── Step 7: Capture Web Animations API data ──
  log('MotionCapture', 'info', 'Capturing Web Animations...');
  const webAnimations = await captureWebAnimations(page, candidates);

  // ── Step 8: Capture Framer Motion / data attributes ──
  log('MotionCapture', 'info', 'Capturing motion attributes...');
  const motionAttributes = await page.evaluate((selectors: string[]) => {
    const results: Record<string, Record<string, string>> = {};
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const attrs: Record<string, string> = {};
        for (const attr of Array.from(el.attributes)) {
          if (attr.name.startsWith('data-framer') ||
              attr.name.startsWith('data-motion') ||
              attr.name === 'style' ||
              attr.name === 'data-projection-id') {
            attrs[attr.name] = attr.value;
          }
        }
        // Also check inline style for transform/opacity/willChange
        const style = (el as HTMLElement).style;
        if (style.transform) attrs['inline-transform'] = style.transform;
        if (style.opacity) attrs['inline-opacity'] = style.opacity;
        if (style.willChange) attrs['inline-willChange'] = style.willChange;
        if (style.transition) attrs['inline-transition'] = style.transition;
        if (Object.keys(attrs).length > 0) results[sel] = attrs;
      } catch { /* skip */ }
    }
    return results;
  }, candidates.map(c => c.selector));

  // ── Step 9: Analyze and classify animations ──
  log('MotionCapture', 'info', 'Analyzing animation patterns...');

  const elements: ElementMotionData[] = [];
  const entranceAnimations: ViewportMotionData['globalPatterns']['entranceAnimations'] = [];
  const scrollLinkedAnimations: ViewportMotionData['globalPatterns']['scrollLinkedAnimations'] = [];
  const hoverTransitionPatterns: ViewportMotionData['globalPatterns']['hoverTransitions'] = [];
  const continuousAnimations: ViewportMotionData['globalPatterns']['continuousAnimations'] = [];
  const parallaxEffects: ViewportMotionData['globalPatterns']['parallaxEffects'] = [];

  for (const c of candidates) {
    const keyframes = scrollData.get(c.selector) || [];
    const hover = hoverTransitions.get(c.selector) || null;
    const focus = focusTransitions.get(c.selector) || null;
    const webAnims = webAnimations[c.selector] || [];
    const motionAttrs = motionAttributes[c.selector] || {};
    const initial = initialStates[c.selector] || {};
    const final = finalStates[c.selector] || {};

    // Classify animation type
    const classification = classifyAnimation(keyframes, hover, webAnims, initial, final);

    if (classification.type === 'none') continue; // skip non-animated elements

    const elementData: ElementMotionData = {
      selector: c.selector,
      tag: c.tag,
      classes: c.classes,
      textPreview: c.textPreview,
      scrollKeyframes: keyframes,
      hoverTransition: hover,
      focusTransition: focus,
      webAnimations: webAnims,
      motionAttributes: motionAttrs,
      initialState: initial,
      finalState: final,
      triggerPoint: classification.triggerPoint,
      animationType: classification.type,
    };

    elements.push(elementData);

    // Categorize into global patterns
    if (classification.type === 'entrance') {
      entranceAnimations.push({
        selector: c.selector,
        type: classification.entranceType ?? '',
        from: classification.from ?? {},
        to: classification.to ?? {},
        triggerScroll: classification.triggerPoint ?? 0,
        duration: classification.estimatedDuration ?? '',
      });
    } else if (classification.type === 'scroll-linked') {
      for (const prop of classification.scrollLinkedProps || []) {
        scrollLinkedAnimations.push({
          selector: c.selector,
          property: prop.property,
          startScroll: prop.startScroll,
          endScroll: prop.endScroll,
          startValue: prop.startValue,
          endValue: prop.endValue,
        });
      }
    } else if (classification.type === 'parallax') {
      parallaxEffects.push({
        selector: c.selector,
        scrollRatio: classification.parallaxRatio ?? 0,
        direction: classification.parallaxDirection ?? '',
      });
    }

    if (hover && hover.properties.length > 0) {
      hoverTransitionPatterns.push({
        selector: c.selector,
        properties: hover.properties,
        duration: `${hover.duration}ms`,
        easing: hover.easing,
        from: hover.frames[0]?.styles || {},
        to: hover.frames[hover.frames.length - 1]?.styles || {},
      });
    }

    for (const wa of webAnims) {
      if (wa.iterations === Infinity || wa.iterations > 1) {
        continuousAnimations.push({
          selector: c.selector,
          animationName: wa.animationName,
          duration: `${wa.duration}ms`,
          iterationCount: wa.iterations === Infinity ? 'infinite' : String(wa.iterations),
        });
      }
    }
  }

  const viewportData: ViewportMotionData = {
    viewportWidth,
    pageHeight,
    elements,
    globalPatterns: {
      entranceAnimations,
      scrollLinkedAnimations,
      hoverTransitions: hoverTransitionPatterns,
      continuousAnimations,
      parallaxEffects,
    },
    summary: {
      totalAnimatedElements: elements.length,
      entranceCount: entranceAnimations.length,
      scrollLinkedCount: scrollLinkedAnimations.length,
      hoverCount: hoverTransitionPatterns.length,
      continuousCount: continuousAnimations.length,
      parallaxCount: parallaxEffects.length,
    },
  };

  log('Motion', 'info', `${viewportWidth}px — animated: ${elements.length}, entrance: ${entranceAnimations.length}, scroll-linked: ${scrollLinkedAnimations.length}, hover: ${hoverTransitionPatterns.length}`);

  return viewportData;
}

// ── Identify candidate animated elements ───────────────────────────────────────

async function identifyAnimatedCandidates(page: Page): Promise<{ selector: string; tag: string; classes: string[]; textPreview: string }[]> {
  return await page.evaluate(() => {
    const results: { selector: string; tag: string; classes: string[]; textPreview: string }[] = [];
    const seen = new Set<string>();
    const allEls = document.querySelectorAll('*');

    for (let i = 0; i < allEls.length; i++) {
      const el = allEls[i] as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'meta', 'link', 'noscript', 'br', 'wbr', 'head', 'html'].includes(tag)) continue;

      const computed = window.getComputedStyle(el);
      const isAnimationCandidate =
        // Has transform (Framer Motion uses transforms extensively)
        (computed.transform && computed.transform !== 'none') ||
        // Has opacity other than 1
        (computed.opacity && computed.opacity !== '1') ||
        // Has willChange indicating planned animation
        (computed.willChange && computed.willChange !== 'auto') ||
        // Has transition defined
        (computed.transition && computed.transition !== 'all 0s ease 0s' && computed.transition !== 'none') ||
        // Has animation defined
        (computed.animationName && computed.animationName !== 'none') ||
        // Has Framer Motion attributes
        el.hasAttribute('data-framer-appear-id') ||
        el.hasAttribute('data-projection-id') ||
        el.getAttribute('style')?.includes('transform') ||
        el.getAttribute('style')?.includes('opacity') ||
        // Is a heading or major content element (likely to animate on scroll)
        ['h1', 'h2', 'h3', 'h4', 'section', 'nav', 'footer'].includes(tag) ||
        // Has overflow hidden (common for reveal animations)
        (computed.overflow === 'hidden' && el.children.length > 0) ||
        // Interactive elements that likely have hover animations
        ['a', 'button'].includes(tag);

      if (!isAnimationCandidate) continue;

      const id = el.id;
      const classes = Array.from(el.classList);
      const cls = classes.filter(c => c && !/^\d/.test(c)).slice(0, 3).map(c => `.${c}`).join('');
      const selector = id ? `#${id}` : cls ? `${tag}${cls}` : `${tag}[data-idx="${i}"]`;

      if (seen.has(selector)) continue;
      seen.add(selector);

      let textPreview = '';
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          textPreview += (child.textContent || '').trim();
        }
      }

      results.push({
        selector,
        tag,
        classes,
        textPreview: textPreview.slice(0, 80),
      });
    }

    return results;
  });
}

// ── Capture element states ─────────────────────────────────────────────────────

async function captureElementStates(page: Page, candidates: { selector: string }[]): Promise<Record<string, Record<string, string>>> {
  return await page.evaluate(
    ({ selectors, props }: { selectors: string[]; props: string[] }) => {
      const results: Record<string, Record<string, string>> = {};
      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel);
          if (!el) continue;
          const computed = window.getComputedStyle(el);
          const styles: Record<string, string> = {};
          for (const prop of props) {
            const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
            styles[prop] = computed.getPropertyValue(cssProp);
          }
          results[sel] = styles;
        } catch { /* skip */ }
      }
      return results;
    },
    { selectors: candidates.map(c => c.selector), props: ANIMATION_PROPERTIES }
  );
}

// ── Capture hover transition frame by frame ────────────────────────────────────

async function captureHoverTransition(page: Page, selector: string): Promise<TransitionCapture | null> {
  const el = await page.$(selector);
  if (!el) return null;

  // Read actual transition properties BEFORE triggering hover
  const transitionMeta = await page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = window.getComputedStyle(el);
    return {
      timingFunction: cs.transitionTimingFunction,
      duration: cs.transitionDuration,
    };
  }, selector);

  // Get base state
  const baseStyles = await getElementStyles(page, selector);
  if (!baseStyles) return null;

  // Start hover
  await el.hover();

  // Record frames over time
  const frames: { time: number; styles: Record<string, string> }[] = [];
  const startTime = Date.now();

  for (let i = 0; i < HOVER_RECORD_FRAMES; i++) {
    await page.waitForTimeout(HOVER_FRAME_INTERVAL);
    const styles = await getElementStyles(page, selector);
    if (styles) {
      frames.push({ time: Date.now() - startTime, styles });
    }
  }

  // Move away
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);

  // Determine which properties changed
  const changedProps: string[] = [];
  if (frames.length > 0) {
    const lastFrame = frames[frames.length - 1].styles;
    for (const prop of ANIMATION_PROPERTIES) {
      if (baseStyles[prop] !== lastFrame[prop]) {
        changedProps.push(prop);
      }
    }
  }

  if (changedProps.length === 0) return null;

  // Determine duration: use computed transitionDuration as primary source.
  // Fall back to frame-based estimation only when transitionDuration is "0s" or absent.
  let duration: number;
  const rawDuration = transitionMeta?.duration;
  let computedDuration = 0;
  if (rawDuration && rawDuration !== '0s') {
    // transitionDuration may be a comma-separated list (e.g. "0.3s, 0.2s") — take the longest
    const parts = rawDuration.split(',').map((s: string) => s.trim());
    for (const part of parts) {
      const ms = part.endsWith('ms') ? parseFloat(part) : parseFloat(part) * 1000;
      if (!isNaN(ms) && ms > computedDuration) computedDuration = ms;
    }
  }
  if (computedDuration > 0) {
    duration = computedDuration;
  } else {
    // Frame-based fallback: find first frame where all properties reached final value
    const finalStyles = frames[frames.length - 1].styles;
    duration = frames[frames.length - 1].time;
    for (let i = 0; i < frames.length; i++) {
      const allSettled = changedProps.every(p => frames[i].styles[p] === finalStyles[p]);
      if (allSettled) {
        duration = frames[i].time;
        break;
      }
    }
  }

  // Determine easing: use actual transitionTimingFunction when available
  const rawEasing = transitionMeta?.timingFunction;
  const easing = (rawEasing && rawEasing !== '' && rawEasing !== 'ease 0s') ? rawEasing.split(',')[0].trim() : 'ease';

  return {
    frames: [{ time: 0, styles: baseStyles }, ...frames],
    duration,
    properties: changedProps,
    easing,
  };
}

// ── Capture focus transition ───────────────────────────────────────────────────

async function captureFocusTransition(page: Page, selector: string): Promise<TransitionCapture | null> {
  const baseStyles = await getElementStyles(page, selector);
  if (!baseStyles) return null;

  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    if (el?.focus) el.focus();
  }, selector);

  await page.waitForTimeout(300);
  const focusStyles = await getElementStyles(page, selector);

  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    if (el?.blur) el.blur();
  }, selector);

  if (!focusStyles) return null;

  const changedProps = ANIMATION_PROPERTIES.filter(p => baseStyles[p] !== focusStyles[p]);
  if (changedProps.length === 0) return null;

  return {
    frames: [
      { time: 0, styles: baseStyles },
      { time: 300, styles: focusStyles },
    ],
    duration: 300,
    properties: changedProps,
    easing: 'ease',
  };
}

// ── Get element styles helper ──────────────────────────────────────────────────

async function getElementStyles(page: Page, selector: string): Promise<Record<string, string> | null> {
  return await page.evaluate(
    ({ sel, props }: { sel: string; props: string[] }) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const computed = window.getComputedStyle(el);
      const styles: Record<string, string> = {};
      for (const prop of props) {
        const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        styles[prop] = computed.getPropertyValue(cssProp);
      }
      return styles;
    },
    { sel: selector, props: ANIMATION_PROPERTIES }
  );
}

// ── Capture Web Animations API ─────────────────────────────────────────────────

async function captureWebAnimations(page: Page, candidates: { selector: string }[]): Promise<Record<string, WebAnimationData[]>> {
  return await page.evaluate((selectors: string[]) => {
    const results: Record<string, WebAnimationData[]> = {};
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const animations = el.getAnimations();
        if (animations.length === 0) continue;
        results[sel] = animations.map(anim => {
          const effect = anim.effect as KeyframeEffect;
          const timing = effect?.getTiming() || {};
          const keyframes = effect?.getKeyframes() || [];
          return {
            animationName: (anim as CSSAnimation).animationName || anim.id || 'unnamed',
            duration: typeof timing.duration === 'number' ? timing.duration : 0,
            delay: timing.delay || 0,
            easing: timing.easing || 'linear',
            iterations: timing.iterations || 1,
            direction: timing.direction || 'normal',
            fillMode: timing.fill || 'none',
            keyframes: keyframes.map((kf: ComputedKeyframe) => {
              const frame: Record<string, string> = {};
              for (const [key, value] of Object.entries(kf)) {
                if (key !== 'offset' && key !== 'computedOffset' && key !== 'easing' && key !== 'composite') {
                  frame[key] = String(value);
                }
              }
              frame['offset'] = String(kf.offset ?? '');
              return frame;
            }),
          };
        });
      } catch { /* skip */ }
    }
    return results;
  }, candidates.map(c => c.selector));
}

// ── Classify animation type ────────────────────────────────────────────────────

function classifyAnimation(
  keyframes: ScrollKeyframe[],
  hover: TransitionCapture | null,
  webAnims: WebAnimationData[],
  initial: Record<string, string>,
  final: Record<string, string>
): {
  type: string;
  triggerPoint: number | null;
  entranceType?: string;
  from?: Record<string, string>;
  to?: Record<string, string>;
  estimatedDuration?: string;
  scrollLinkedProps?: { property: string; startScroll: number; endScroll: number; startValue: string; endValue: string }[];
  parallaxRatio?: number;
  parallaxDirection?: string;
} {
  if (!keyframes.length && !hover && !webAnims.length) {
    return { type: 'none', triggerPoint: null };
  }

  // Check for scroll-linked property changes
  const scrollChanges: { property: string; startScroll: number; endScroll: number; startValue: string; endValue: string }[] = [];

  if (keyframes.length > 1) {
    for (const prop of ANIMATION_PROPERTIES) {
      const values = keyframes.map(kf => kf.styles[prop]).filter(Boolean);
      const uniqueValues = new Set(values);

      if (uniqueValues.size > 1) {
        // Find start and end of change
        let startIdx = 0;
        let endIdx = values.length - 1;
        const firstValue = values[0];
        const lastValue = values[values.length - 1];

        // Find where it starts changing
        for (let i = 1; i < values.length; i++) {
          if (values[i] !== firstValue) { startIdx = i - 1; break; }
        }
        // Find where it stops changing
        for (let i = values.length - 2; i >= 0; i--) {
          if (values[i] !== lastValue) { endIdx = i + 1; break; }
        }

        if (firstValue !== lastValue) {
          scrollChanges.push({
            property: prop,
            startScroll: keyframes[startIdx].scrollY,
            endScroll: keyframes[endIdx].scrollY,
            startValue: firstValue,
            endValue: lastValue,
          });
        }
      }
    }
  }

  // Detect parallax (transform translateY changes proportionally to scroll)
  const transformChanges = scrollChanges.filter(c => c.property === 'transform');
  if (transformChanges.length > 0) {
    const tc = transformChanges[0];
    const scrollDistance = tc.endScroll - tc.startScroll;
    // Check if transform contains translateY that moves proportionally
    const startMatch = tc.startValue.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,[^,]+,\s*([\d.-]+)\)/);
    const endMatch = tc.endValue.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,[^,]+,\s*([\d.-]+)\)/);
    if (startMatch && endMatch) {
      const translateDiff = parseFloat(endMatch[1]) - parseFloat(startMatch[1]);
      if (scrollDistance > 0 && Math.abs(translateDiff) > 10) {
        const ratio = translateDiff / scrollDistance;
        if (Math.abs(ratio) < 1 && Math.abs(ratio) > 0.01) {
          return {
            type: 'parallax',
            triggerPoint: tc.startScroll,
            parallaxRatio: Math.round(ratio * 1000) / 1000,
            parallaxDirection: ratio > 0 ? 'down' : 'up',
          };
        }
      }
    }
  }

  // Detect entrance animations (opacity 0→1 or transform changes when entering viewport)
  const opacityChange = scrollChanges.find(c => c.property === 'opacity');
  if (opacityChange && opacityChange.startValue === '0' && opacityChange.endValue === '1') {
    const from: Record<string, string> = {};
    const to: Record<string, string> = {};
    from.opacity = '0';
    to.opacity = '1';

    const transformChange = scrollChanges.find(c => c.property === 'transform');
    if (transformChange) {
      from.transform = transformChange.startValue;
      to.transform = transformChange.endValue;
    }

    let entranceType = 'fade-in';
    if (transformChange) {
      if (transformChange.startValue.includes('translateY')) entranceType = 'fade-up';
      else if (transformChange.startValue.includes('translateX')) entranceType = 'fade-left';
      else if (transformChange.startValue.includes('scale')) entranceType = 'zoom-in';
      else entranceType = 'fade-transform';
    }

    const scrollDistance = opacityChange.endScroll - opacityChange.startScroll;
    const estimatedDuration = `${Math.round(scrollDistance / 2)}ms`; // rough estimate

    return {
      type: 'entrance',
      triggerPoint: opacityChange.startScroll,
      entranceType,
      from,
      to,
      estimatedDuration,
    };
  }

  // Detect scroll-linked (non-entrance transforms)
  if (scrollChanges.length > 0) {
    return {
      type: 'scroll-linked',
      triggerPoint: scrollChanges[0].startScroll,
      scrollLinkedProps: scrollChanges,
    };
  }

  // Hover-only animation
  if (hover && hover.properties.length > 0) {
    return { type: 'hover', triggerPoint: null };
  }

  // Continuous web animation
  if (webAnims.some(wa => wa.iterations === Infinity || wa.iterations > 1)) {
    return { type: 'continuous', triggerPoint: null };
  }

  return { type: 'none', triggerPoint: null };
}

// ── Summarize keyframes (reduce data) ──────────────────────────────────────────

function summarizeKeyframes(keyframes: ScrollKeyframe[]): ScrollKeyframe[] {
  if (keyframes.length <= 10) return keyframes;

  // Keep only frames where something changes
  const summary: ScrollKeyframe[] = [keyframes[0]];
  let lastStyles = JSON.stringify(keyframes[0].styles);

  for (let i = 1; i < keyframes.length; i++) {
    const currentStyles = JSON.stringify(keyframes[i].styles);
    if (currentStyles !== lastStyles) {
      summary.push(keyframes[i]);
      lastStyles = currentStyles;
    }
  }

  // Always include last frame
  if (summary[summary.length - 1] !== keyframes[keyframes.length - 1]) {
    summary.push(keyframes[keyframes.length - 1]);
  }

  return summary;
}

export { captureMotion };
if (require.main === module) {
  // ── CLI Entry ──────────────────────────────────────────────────────────────────

  const args = process.argv.slice(2);
  const url = args[0];
  const outputDir = args[1] || path.resolve(process.cwd(), 'output');

  if (!url) {
    log('MotionCapture', 'error', 'Usage: ts-node capture-motion.ts <url> [output-dir]');
    process.exit(1);
  }

  captureMotion(url, outputDir)
    .then(() => {
      log('MotionCapture', 'info', 'Done.');
      process.exit(0);
    })
    .catch((err) => {
      log('MotionCapture', 'error', `Error: ${err}`);
      process.exit(1);
    });
}

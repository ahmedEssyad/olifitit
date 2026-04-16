/**
 * Scroll-State Interaction Mapper
 *
 * Captures how interactivity changes across scroll positions.
 * At key scroll positions (derived from motion capture trigger points),
 * identifies visible interactive elements, captures their hover states,
 * and diffs between positions to discover animations that produce/remove
 * interactive elements.
 *
 * Usage: npx ts-node scripts/capture-scroll-interactions.ts <url> [output-dir]
 */

import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { withBrowser, withRetry, log, escapeCSSSelector } from '../core/utils';
import { config } from '../core/config';
import type { InteractionCapture } from './capture-interactions-smart';

// ── Configuration ───────────────────────────────────────────────────────────

const MAX_SCROLL_POSITIONS = config.scrollInteractions.maxScrollPositions;
const MERGE_DISTANCE = config.scrollInteractions.mergeDistance;
const MAX_ELEMENTS_PER_POSITION = config.scrollInteractions.maxElementsPerPosition;
const HOVER_SETTLE_MS = config.scrollInteractions.hoverSettleMs;
const SCROLL_SETTLE_MS = config.scrollInteractions.scrollSettleMs;

const INTERACTIVE_SELECTORS = config.scrollInteractions.interactiveSelectors;

const HOVER_PROPS = config.scrollInteractions.hoverProperties;

// ── Types ───────────────────────────────────────────────────────────────────

interface InteractiveElementAtScroll {
  selector: string;
  tag: string;
  text: string;
  visible: boolean;
  clickable: boolean;
  href?: string;
  hoverChanges: Record<string, string>;
  bounds: { x: number; y: number; width: number; height: number };
}

interface ScrollState {
  scrollY: number;
  label: string;
  interactiveElements: InteractiveElementAtScroll[];
  newSinceLastState: string[];
  removedSinceLastState: string[];
}

interface AnimationInteractionLink {
  animation: string;
  element: string;
  scrollRange: [number, number];
  produces: { selector: string; interaction: string; text?: string }[];
  removes: { selector: string; interaction: string; text?: string }[];
}

interface ScrollProducedChain {
  scrollY: number;
  label: string;
  producedSelector: string;
  interaction: InteractionCapture;
}

interface ScrollInteractionResult {
  url: string;
  timestamp: string;
  viewport: number;
  pageHeight: number;
  scrollStates: ScrollState[];
  animationInteractionLinks: AnimationInteractionLink[];
  scrollProducedChains: ScrollProducedChain[];
  summary: {
    keyScrollPositions: number;
    totalInteractiveElements: number;
    elementsAppeared: number;
    elementsDisappeared: number;
    animationsWithInteractionChanges: number;
    scrollProducedChains: number;
  };
}

// ── Key Scroll Position Derivation ──────────────────────────────────────────

function deriveKeyScrollPositions(outputDir: string, pageHeight: number): { scrollY: number; label: string }[] {
  const motionPath = path.join(outputDir, 'motion-capture.json');
  const positions = new Map<number, string>(); // scrollY → label

  // Always include top
  positions.set(0, 'top');

  if (fs.existsSync(motionPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(motionPath, 'utf-8'));

      // Find desktop viewport data
      const viewports = raw.viewports || [];
      const desktop = viewports.find((v: Record<string, unknown>) => (v.viewportWidth as number) >= 1440) || viewports[viewports.length - 1];

      if (desktop?.globalPatterns) {
        const gp = desktop.globalPatterns;

        // Entrance animation trigger points
        for (const ea of gp.entranceAnimations || []) {
          if (ea.triggerScroll != null) {
            const y = Math.round(ea.triggerScroll);
            const label = `entrance-${cleanSelector(ea.selector)}-${y}`;
            positions.set(y, label);
          }
        }

        // Scroll-linked animation start and end points
        for (const sl of gp.scrollLinkedAnimations || []) {
          if (sl.startScroll != null) {
            positions.set(Math.round(sl.startScroll), `scroll-anim-start-${cleanSelector(sl.selector)}-${sl.startScroll}`);
          }
          if (sl.endScroll != null) {
            positions.set(Math.round(sl.endScroll), `scroll-anim-end-${cleanSelector(sl.selector)}-${sl.endScroll}`);
          }
        }
      }

      // Per-element trigger points
      for (const el of desktop?.elements || []) {
        if (el.triggerPoint != null && el.animationType !== 'none') {
          const y = Math.round(el.triggerPoint);
          if (!positions.has(y)) {
            positions.set(y, `trigger-${cleanSelector(el.selector)}-${y}`);
          }
        }
      }
    } catch (e) {
      log('ScrollInteractions', 'warn', `Failed to read motion-capture.json: ${(e as Error).message}`);
    }
  }

  // If we got very few positions from motion data, add evenly spaced ones
  if (positions.size < 5) {
    const step = Math.min(500, Math.floor(pageHeight / 6));
    for (let y = step; y < pageHeight; y += step) {
      if (!positions.has(y)) {
        positions.set(y, `probe-${y}`);
      }
    }
  }

  // Always include near-bottom
  const bottomY = Math.max(0, pageHeight - 200);
  if (!positions.has(bottomY)) {
    positions.set(bottomY, 'bottom');
  }

  // Sort, merge nearby, and cap
  let sorted = [...positions.entries()]
    .sort((a, b) => a[0] - b[0]);

  // Merge positions within MERGE_DISTANCE
  const merged: [number, string][] = [];
  for (const [y, label] of sorted) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(y - last[0]) < MERGE_DISTANCE) {
      // Keep the one with a more descriptive label
      if (label.length > last[1].length) {
        merged[merged.length - 1] = [y, label];
      }
      continue;
    }
    merged.push([y, label]);
  }

  // Cap
  const capped = merged.slice(0, MAX_SCROLL_POSITIONS);

  return capped.map(([scrollY, label]) => ({ scrollY, label }));
}

function cleanSelector(sel: string): string {
  return (sel || 'unknown')
    .replace(/[#.\[\]=":>()]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 30);
}

// ── Interactive Element Discovery ───────────────────────────────────────────

async function findInteractiveElements(page: Page): Promise<InteractiveElementAtScroll[]> {
  return page.evaluate(
    ({ selectors, maxElements }: { selectors: string[]; maxElements: number }) => {
      const results: InteractiveElementAtScroll[] = [];
      const seen = new Set<string>();
      const vpHeight = window.innerHeight;
      const vpWidth = window.innerWidth;

      for (const sel of selectors) {
        try {
          const els = document.querySelectorAll(sel);
          for (const el of Array.from(els)) {
            if (results.length >= maxElements) break;

            const rect = el.getBoundingClientRect();
            // Must be in or near viewport
            if (rect.bottom < -50 || rect.top > vpHeight + 50) continue;
            if (rect.right < -50 || rect.left > vpWidth + 50) continue;
            if (rect.width === 0 && rect.height === 0) continue;

            const cs = window.getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            if (parseFloat(cs.opacity) < 0.01) continue;
            if (cs.pointerEvents === 'none') continue;

            // Build selector
            const tag = el.tagName.toLowerCase();
            const id = el.id;
            const cls = Array.from(el.classList)
              .filter(c => c && !/^\d/.test(c) && !/[:\\/@]/.test(c))
              .slice(0, 3);
            let selector = '';
            if (id) {
              selector = `#${id}`;
            } else if (cls.length > 0) {
              selector = `${tag}.${cls.join('.')}`;
            } else {
              const parent = el.parentElement;
              if (parent) {
                const pId = parent.id;
                const pCls = Array.from(parent.classList).filter(c => c && !/^\d/.test(c)).slice(0, 2);
                const pSel = pId ? `#${pId}` : pCls.length ? `${parent.tagName.toLowerCase()}.${pCls.join('.')}` : '';
                if (pSel) {
                  selector = `${pSel} > ${tag}`;
                }
              }
              if (!selector) selector = tag;
            }

            if (seen.has(selector)) continue;
            seen.add(selector);

            // Get text content
            let text = '';
            for (const child of Array.from(el.childNodes)) {
              if (child.nodeType === Node.TEXT_NODE) {
                text += (child.textContent || '').trim();
              }
            }
            if (!text && el.getAttribute('aria-label')) text = el.getAttribute('aria-label') || '';

            results.push({
              selector,
              tag,
              text: text.slice(0, 80),
              visible: true,
              clickable: cs.pointerEvents !== 'none' && cs.display !== 'none',
              href: tag === 'a' ? (el as HTMLAnchorElement).getAttribute('href') || undefined : undefined,
              hoverChanges: {}, // filled later
              bounds: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
            });
          }
        } catch { /* invalid selector */ }
      }

      return results;
    },
    { selectors: INTERACTIVE_SELECTORS, maxElements: MAX_ELEMENTS_PER_POSITION }
  );
}

// ── Hover Probe ─────────────────────────────────────────────────────────────

async function probeHoverState(
  page: Page,
  selector: string,
): Promise<Record<string, string>> {
  try {
    const el = await page.$(escapeCSSSelector(selector));
    if (!el) return {};

    // Capture base state
    const baseStyles = await page.evaluate(
      ({ sel, props }: { sel: string; props: string[] }) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = window.getComputedStyle(el);
        const styles: Record<string, string> = {};
        for (const p of props) {
          const cssProp = p.replace(/([A-Z])/g, '-$1').toLowerCase();
          styles[p] = cs.getPropertyValue(cssProp);
        }
        return styles;
      },
      { sel: escapeCSSSelector(selector), props: HOVER_PROPS }
    );

    if (!baseStyles) return {};

    // Hover
    await el.hover();
    await page.waitForTimeout(HOVER_SETTLE_MS);

    // Capture hover state
    const hoverStyles = await page.evaluate(
      ({ sel, props }: { sel: string; props: string[] }) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = window.getComputedStyle(el);
        const styles: Record<string, string> = {};
        for (const p of props) {
          const cssProp = p.replace(/([A-Z])/g, '-$1').toLowerCase();
          styles[p] = cs.getPropertyValue(cssProp);
        }
        return styles;
      },
      { sel: escapeCSSSelector(selector), props: HOVER_PROPS }
    );

    // Move away
    await page.mouse.move(0, 0);
    await page.waitForTimeout(50);

    if (!hoverStyles) return {};

    // Diff
    const changes: Record<string, string> = {};
    for (const p of HOVER_PROPS) {
      if (baseStyles[p] !== hoverStyles[p]) {
        changes[p] = hoverStyles[p];
      }
    }

    return changes;
  } catch {
    return {};
  }
}

// ── Animation-Interaction Linking ───────────────────────────────────────────

function linkAnimationsToInteractions(
  scrollStates: ScrollState[],
  outputDir: string,
): AnimationInteractionLink[] {
  const links: AnimationInteractionLink[] = [];
  const motionPath = path.join(outputDir, 'motion-capture.json');

  if (!fs.existsSync(motionPath)) return links;

  try {
    const raw = JSON.parse(fs.readFileSync(motionPath, 'utf-8'));
    const viewports = raw.viewports || [];
    const desktop = viewports.find((v: Record<string, unknown>) => (v.viewportWidth as number) >= 1440) || viewports[viewports.length - 1];
    if (!desktop?.globalPatterns) return links;

    const gp = desktop.globalPatterns;

    // Collect all animations with scroll ranges
    const animations: { name: string; element: string; start: number; end: number }[] = [];

    for (const sl of gp.scrollLinkedAnimations || []) {
      animations.push({
        name: `scroll-linked-${sl.property}`,
        element: sl.selector,
        start: sl.startScroll,
        end: sl.endScroll,
      });
    }

    for (const ea of gp.entranceAnimations || []) {
      const triggerY = ea.triggerScroll || 0;
      animations.push({
        name: `entrance-${ea.type || 'reveal'}`,
        element: ea.selector,
        start: triggerY,
        end: triggerY + 200, // estimate entrance completion
      });
    }

    // For each animation, find the scroll states just before start and just after end
    for (const anim of animations) {
      const stateBefore = findClosestState(scrollStates, anim.start, 'before');
      const stateAfter = findClosestState(scrollStates, anim.end, 'after');

      if (!stateBefore || !stateAfter) continue;

      const beforeSelectors = new Set(stateBefore.interactiveElements.map(e => e.selector));
      const afterSelectors = new Set(stateAfter.interactiveElements.map(e => e.selector));

      const produced = stateAfter.interactiveElements
        .filter(e => !beforeSelectors.has(e.selector))
        .map(e => ({
          selector: e.selector,
          interaction: classifyInteraction(e),
          text: e.text || undefined,
        }));

      const removed = stateBefore.interactiveElements
        .filter(e => !afterSelectors.has(e.selector))
        .map(e => ({
          selector: e.selector,
          interaction: classifyInteraction(e),
          text: e.text || undefined,
        }));

      if (produced.length > 0 || removed.length > 0) {
        links.push({
          animation: anim.name,
          element: anim.element,
          scrollRange: [anim.start, anim.end],
          produces: produced,
          removes: removed,
        });
      }
    }
  } catch (e) {
    log('ScrollInteractions', 'warn', `Failed to link animations: ${(e as Error).message}`);
  }

  return links;
}

function findClosestState(states: ScrollState[], scrollY: number, direction: 'before' | 'after'): ScrollState | null {
  if (direction === 'before') {
    for (let i = states.length - 1; i >= 0; i--) {
      if (states[i].scrollY <= scrollY) return states[i];
    }
    return states[0] || null;
  } else {
    for (const state of states) {
      if (state.scrollY >= scrollY) return state;
    }
    return states[states.length - 1] || null;
  }
}

function classifyInteraction(el: InteractiveElementAtScroll): string {
  const parts: string[] = [];

  if (el.tag === 'a' && el.href) parts.push('link');
  else if (el.tag === 'button') parts.push('button');
  else if (['input', 'select', 'textarea'].includes(el.tag)) parts.push('form-input');
  else parts.push('clickable');

  if (Object.keys(el.hoverChanges).length > 0) {
    const hk = Object.keys(el.hoverChanges);
    if (hk.includes('transform')) parts.push('hover-transform');
    else if (hk.includes('opacity')) parts.push('hover-opacity');
    else if (hk.includes('boxShadow')) parts.push('hover-shadow');
    else if (hk.includes('backgroundColor') || hk.includes('color')) parts.push('hover-color');
    else parts.push('hover-effect');
  }

  return parts.join(' + ');
}

// ── Main ────────────────────────────────────────────────────────────────────

async function captureScrollInteractions(url: string, outputDir: string): Promise<ScrollInteractionResult> {
  fs.mkdirSync(outputDir, { recursive: true });

  return withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    log('ScrollInteractions', 'info', `Loading ${url}...`);
    await withRetry(() => page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }), { label: 'page.goto', retries: 2 });
    await page.waitForTimeout(2000);

    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    log('ScrollInteractions', 'info', `Page height: ${pageHeight}px`);

    // ── Phase A: Derive key scroll positions ──
    const keyPositions = deriveKeyScrollPositions(outputDir, pageHeight);
    log('ScrollInteractions', 'info', `Key scroll positions: ${keyPositions.length} (${keyPositions.map(p => p.scrollY).join(', ')})`);

    // ── Phase B: Probe at each position ──
    const scrollStates: ScrollState[] = [];
    let prevSelectors = new Set<string>();

    for (const pos of keyPositions) {
      log('ScrollInteractions', 'info', `  Probing scrollY=${pos.scrollY} (${pos.label})...`);

      // Scroll to position
      await page.evaluate((y) => window.scrollTo(0, y), pos.scrollY);
      await page.waitForTimeout(SCROLL_SETTLE_MS);

      // Find interactive elements
      const elements = await findInteractiveElements(page);

      // Probe hover states for each element (lightweight — single diff)
      for (const el of elements) {
        const hoverChanges = await probeHoverState(page, el.selector);
        el.hoverChanges = hoverChanges;
      }

      // Re-scroll after hover probing may have shifted view
      await page.evaluate((y) => window.scrollTo(0, y), pos.scrollY);
      await page.waitForTimeout(100);

      // Diff with previous state
      const currentSelectors = new Set(elements.map(e => e.selector));
      const newSinceLastState = [...currentSelectors].filter(s => !prevSelectors.has(s));
      const removedSinceLastState = [...prevSelectors].filter(s => !currentSelectors.has(s));

      scrollStates.push({
        scrollY: pos.scrollY,
        label: pos.label,
        interactiveElements: elements,
        newSinceLastState,
        removedSinceLastState,
      });

      prevSelectors = currentSelectors;
    }

    // ── Phase C: Link animations to interaction changes ──
    log('ScrollInteractions', 'info', 'Linking animations to interaction changes...');
    const animationInteractionLinks = linkAnimationsToInteractions(scrollStates, outputDir);

    // ── Phase D: Click produced elements and capture interaction chains ──
    const scrollProducedChains: ScrollProducedChain[] = [];
    const MAX_SCROLL_CHAINS = 10;

    // Collect clickable elements that appeared during scroll
    const clickCandidates: { scrollY: number; label: string; selector: string }[] = [];
    for (const state of scrollStates) {
      for (const newSel of state.newSinceLastState) {
        const el = state.interactiveElements.find(e => e.selector === newSel);
        if (el && el.clickable && (el.tag === 'button' || el.tag === 'a' || el.hoverChanges && Object.keys(el.hoverChanges).length > 0)) {
          clickCandidates.push({ scrollY: state.scrollY, label: state.label, selector: newSel });
        }
      }
    }

    if (clickCandidates.length > 0) {
      log('ScrollInteractions', 'info', `Phase D: ${clickCandidates.length} scroll-produced clickable elements to probe...`);

      // Dynamically import to avoid circular dependency
      const { captureGenericClick, findInteractiveAmongAppeared } = await import('./capture-interactions-smart');

      for (const candidate of clickCandidates.slice(0, MAX_SCROLL_CHAINS)) {
        // Scroll to the position where the element appeared
        await page.evaluate((y) => window.scrollTo(0, y), candidate.scrollY);
        await page.waitForTimeout(SCROLL_SETTLE_MS);

        try {
          const chain = await captureGenericClick(page, candidate.selector, `scroll:${candidate.scrollY}`, 0);
          if (chain && (chain.appeared.length > 0 || chain.animations.length > 0)) {
            scrollProducedChains.push({
              scrollY: candidate.scrollY,
              label: candidate.label,
              producedSelector: candidate.selector,
              interaction: chain,
            });
            log('ScrollInteractions', 'info',
              `  Scroll→Click chain: scrollY=${candidate.scrollY} → click ${candidate.selector} → ` +
              `${chain.appeared.length} appeared, ${chain.animations.length} animations` +
              (chain.producedInteractions?.length ? ` → ${chain.producedInteractions.length} deeper` : '')
            );
          }
        } catch (err) {
          log('ScrollInteractions', 'debug', `Click chain failed for ${candidate.selector}: ${(err as Error).message}`);
        }

        // Re-scroll to restore state (Escape to close any opened overlays)
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      }
    }

    // ── Build summary ──
    const allSelectors = new Set<string>();
    let appeared = 0;
    let disappeared = 0;
    for (const state of scrollStates) {
      for (const el of state.interactiveElements) allSelectors.add(el.selector);
      appeared += state.newSinceLastState.length;
      disappeared += state.removedSinceLastState.length;
    }

    const result: ScrollInteractionResult = {
      url,
      timestamp: new Date().toISOString(),
      viewport: 1440,
      pageHeight,
      scrollStates,
      animationInteractionLinks,
      scrollProducedChains,
      summary: {
        keyScrollPositions: scrollStates.length,
        totalInteractiveElements: allSelectors.size,
        elementsAppeared: appeared,
        elementsDisappeared: disappeared,
        animationsWithInteractionChanges: animationInteractionLinks.length,
        scrollProducedChains: scrollProducedChains.length,
      },
    };

    // Write output
    const outputPath = path.join(outputDir, 'scroll-interactions.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

    const sizeKB = (Buffer.byteLength(JSON.stringify(result), 'utf-8') / 1024).toFixed(1);
    log('ScrollInteractions', 'info', `Wrote scroll-interactions.json (${sizeKB} KB)`);
    log('ScrollInteractions', 'info', `${scrollStates.length} scroll states, ${allSelectors.size} interactive elements, ${animationInteractionLinks.length} animation-interaction links`);
    log('ScrollInteractions', 'info', `Elements appeared: ${appeared}, disappeared: ${disappeared}`);

    return result;
  });
}

export { captureScrollInteractions };

// ── CLI Entry ───────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const url = args[0];
  const outputDir = args[1] || path.resolve(process.cwd(), 'output');

  if (!url) {
    log('ScrollInteractions', 'error', 'Usage: ts-node capture-scroll-interactions.ts <url> [output-dir]');
    process.exit(1);
  }

  captureScrollInteractions(url, outputDir)
    .then(() => {
      log('ScrollInteractions', 'info', 'Done.');
      process.exit(0);
    })
    .catch((err) => {
      log('ScrollInteractions', 'error', err);
      process.exit(1);
    });
}

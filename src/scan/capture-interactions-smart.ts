/**
 * Smart Interaction Capture
 *
 * Actually EXECUTES interactive patterns discovered on a page:
 *   - Clicks accordions and captures expand/collapse animations
 *   - Opens modals and captures entrance/exit animations
 *   - Toggles mobile menus and captures slide animations
 *   - Switches tabs and captures panel transitions
 *   - Clicks carousel next/prev and captures slide changes
 *
 * Unlike extract-interactions.ts (which only catalogs), this module
 * triggers each interaction and records what changed.
 */

import { Page, Browser } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { withBrowser, log } from '../core/utils';
import { InteractivePattern } from './animation-intelligence';

// ── Types ──────────────────────────────────────────────────────────────────

export interface InteractionCapture {
  type: string;                    // accordion, modal, tabs, carousel, hamburger, chained-click
  trigger: string;                 // CSS selector of trigger element
  action: string;                  // 'click', 'toggle'
  beforeState: ElementSnapshot[];
  afterState: ElementSnapshot[];
  appeared: string[];              // selectors of elements that appeared
  disappeared: string[];           // selectors that disappeared
  animations: PropertyAnimation[]; // animated properties
  duration: number;                // total animation duration ms
  easing: string;
  chainedFrom?: string;            // selector of the interaction that produced this element
  chainDepth?: number;             // how deep in the interaction chain (0 = root)
  producedInteractions?: InteractionCapture[]; // follow-up interactions on appeared elements
}

export interface ElementSnapshot {
  selector: string;
  tag: string;
  text: string;
  visible: boolean;
  styles: Record<string, string>;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface PropertyAnimation {
  selector: string;
  property: string;
  from: string;
  to: string;
  duration: string;
  easing: string;
}

// ── Snapshot Capture ───────────────────────────────────────────────────────

const SNAPSHOT_PROPS = [
  'display', 'visibility', 'opacity', 'height', 'maxHeight', 'width',
  'transform', 'position', 'top', 'left', 'right', 'bottom',
  'overflow', 'backgroundColor', 'color', 'padding', 'margin',
  'borderRadius', 'boxShadow', 'backdropFilter', 'zIndex',
];

async function captureSnapshot(page: Page, region?: string): Promise<ElementSnapshot[]> {
  return page.evaluate(({ containerSel, props }: { containerSel?: string; props: string[] }) => {
    const container = containerSel ? document.querySelector(containerSel) : document.body;
    if (!container) return [];

    const results: {
      selector: string;
      tag: string;
      text: string;
      visible: boolean;
      styles: Record<string, string>;
      bounds: { x: number; y: number; width: number; height: number };
    }[] = [];
    const elements = container.querySelectorAll('*');

    for (let i = 0; i < Math.min(elements.length, 100); i++) {
      const el = elements[i];
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'meta', 'link', 'noscript'].includes(tag)) continue;

      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      // Build selector
      let selector = '';
      if (el.id) selector = `#${el.id}`;
      else {
        const cls = Array.from(el.classList).filter(c => !/^\d/.test(c)).slice(0, 2);
        selector = cls.length ? `${tag}.${cls.join('.')}` : tag;
      }

      const styles: Record<string, string> = {};
      for (const prop of props) {
        const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        styles[prop] = cs.getPropertyValue(cssProp);
      }

      const visible = cs.display !== 'none' && cs.visibility !== 'hidden' &&
        parseFloat(cs.opacity) > 0.01 && rect.width > 0 && rect.height > 0;

      let text = '';
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) text += (child.textContent || '').trim();
      }

      results.push({
        selector,
        tag,
        text: text.slice(0, 80),
        visible,
        styles,
        bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      });
    }

    return results;
  }, { containerSel: region, props: SNAPSHOT_PROPS });
}

function diffSnapshots(before: ElementSnapshot[], after: ElementSnapshot[]): {
  appeared: string[];
  disappeared: string[];
  animations: PropertyAnimation[];
} {
  const beforeMap = new Map(before.filter(e => e.visible).map(e => [e.selector, e]));
  const afterMap = new Map(after.filter(e => e.visible).map(e => [e.selector, e]));

  const appeared = [...afterMap.keys()].filter(s => !beforeMap.has(s));
  const disappeared = [...beforeMap.keys()].filter(s => !afterMap.has(s));

  const animations: PropertyAnimation[] = [];
  for (const [sel, afterEl] of afterMap) {
    const beforeEl = beforeMap.get(sel);
    if (!beforeEl) continue;

    for (const prop of SNAPSHOT_PROPS) {
      if (beforeEl.styles[prop] !== afterEl.styles[prop]) {
        animations.push({
          selector: sel,
          property: prop,
          from: beforeEl.styles[prop],
          to: afterEl.styles[prop],
          duration: '',  // filled from CSS
          easing: '',
        });
      }
    }
  }

  return { appeared, disappeared, animations };
}

// ── Get animation timing from CSS ──────────────────────────────────────────

async function getTransitionTiming(page: Page, selector: string): Promise<{ duration: number; easing: string }> {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return { duration: 400, easing: 'ease' };
    const cs = getComputedStyle(el);
    const dur = cs.transitionDuration || '0s';
    const durMs = parseFloat(dur) * (dur.includes('ms') ? 1 : 1000);
    return {
      duration: durMs > 0 ? durMs : 400,
      easing: cs.transitionTimingFunction || 'ease',
    };
  }, selector);
}

// ── Interaction Executors ──────────────────────────────────────────────────

async function captureAccordion(page: Page, trigger: string, target: string): Promise<InteractionCapture | null> {
  try {
    const el = await page.$(trigger);
    if (!el || !(await el.isVisible())) return null;

    // Scroll into view
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    const before = await captureSnapshot(page);
    const timing = await getTransitionTiming(page, target || trigger);

    // Click to open
    await el.click();
    await page.waitForTimeout(timing.duration + 150);

    const afterOpen = await captureSnapshot(page);
    const openDiff = diffSnapshots(before, afterOpen);

    // Click to close
    await el.click();
    await page.waitForTimeout(timing.duration + 150);

    return {
      type: 'accordion',
      trigger,
      action: 'toggle',
      beforeState: before.slice(0, 30),
      afterState: afterOpen.slice(0, 30),
      appeared: openDiff.appeared,
      disappeared: openDiff.disappeared,
      animations: openDiff.animations,
      duration: timing.duration,
      easing: timing.easing,
    };
  } catch (err) {
    log('smart-capture', 'debug', `Accordion capture failed for ${trigger}: ${(err as Error).message}`);
    return null;
  }
}

async function captureModal(page: Page, trigger: string, target: string): Promise<InteractionCapture | null> {
  try {
    const el = await page.$(trigger);
    if (!el || !(await el.isVisible())) return null;

    const before = await captureSnapshot(page);

    // Click trigger to open modal
    await el.click();
    await page.waitForTimeout(600); // modals often have longer animations

    const afterOpen = await captureSnapshot(page);
    const openDiff = diffSnapshots(before, afterOpen);

    // Try to close: Escape key, then close button, then overlay click
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // Check if modal closed
    const afterEscape = await captureSnapshot(page);
    const closeDiff = diffSnapshots(afterOpen, afterEscape);
    if (closeDiff.disappeared.length === 0) {
      // Escape didn't work — try close button
      const closeBtn = await page.$('dialog [aria-label*="close" i], [role="dialog"] button:first-of-type, .modal-close, [class*="close"]');
      if (closeBtn) {
        await closeBtn.click();
        await page.waitForTimeout(400);
      }
    }

    return {
      type: 'modal',
      trigger,
      action: 'open',
      beforeState: before.slice(0, 20),
      afterState: afterOpen.slice(0, 30),
      appeared: openDiff.appeared,
      disappeared: [],
      animations: openDiff.animations,
      duration: 600,
      easing: 'ease-out',
    };
  } catch (err) {
    log('smart-capture', 'debug', `Modal capture failed for ${trigger}: ${(err as Error).message}`);
    return null;
  }
}

async function captureTabs(page: Page, triggers: string[], targets: string[]): Promise<InteractionCapture[]> {
  const captures: InteractionCapture[] = [];

  for (let i = 0; i < Math.min(triggers.length, 5); i++) {
    try {
      const tab = await page.$(triggers[i]);
      if (!tab || !(await tab.isVisible())) continue;

      await tab.scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);

      const before = await captureSnapshot(page);

      await tab.click();
      await page.waitForTimeout(350);

      const after = await captureSnapshot(page);
      const diff = diffSnapshots(before, after);

      if (diff.appeared.length > 0 || diff.animations.length > 0) {
        captures.push({
          type: 'tabs',
          trigger: triggers[i],
          action: `switch-to-tab-${i}`,
          beforeState: before.slice(0, 20),
          afterState: after.slice(0, 20),
          appeared: diff.appeared,
          disappeared: diff.disappeared,
          animations: diff.animations,
          duration: 300,
          easing: 'ease',
        });
      }
    } catch (err) {
      log('smart-capture', 'debug', `Tab capture failed: ${(err as Error).message}`);
    }
  }

  return captures;
}

async function captureCarousel(page: Page, triggers: string[], target: string): Promise<InteractionCapture | null> {
  try {
    const nextBtn = triggers.find(t => /next|forward|right/i.test(t));
    if (!nextBtn) return null;

    const btn = await page.$(nextBtn);
    if (!btn || !(await btn.isVisible())) return null;

    await btn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    const before = await captureSnapshot(page, target);

    await btn.click();
    await page.waitForTimeout(500);

    const after = await captureSnapshot(page, target);
    const diff = diffSnapshots(before, after);

    return {
      type: 'carousel',
      trigger: nextBtn,
      action: 'next-slide',
      beforeState: before.slice(0, 15),
      afterState: after.slice(0, 15),
      appeared: diff.appeared,
      disappeared: diff.disappeared,
      animations: diff.animations,
      duration: 500,
      easing: 'ease-in-out',
    };
  } catch (err) {
    log('smart-capture', 'debug', `Carousel capture failed: ${(err as Error).message}`);
    return null;
  }
}

async function captureHamburger(page: Page, trigger: string, target: string): Promise<InteractionCapture | null> {
  try {
    // Switch to mobile viewport
    const currentViewport = page.viewportSize();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(300);

    const btn = await page.$(trigger);
    if (!btn || !(await btn.isVisible())) {
      if (currentViewport) await page.setViewportSize(currentViewport);
      return null;
    }

    const before = await captureSnapshot(page);

    await btn.click();
    await page.waitForTimeout(500);

    const after = await captureSnapshot(page);
    const diff = diffSnapshots(before, after);

    // Close the menu
    await btn.click();
    await page.waitForTimeout(300);

    // Restore viewport
    if (currentViewport) await page.setViewportSize(currentViewport);
    await page.waitForTimeout(200);

    return {
      type: 'hamburger',
      trigger,
      action: 'toggle-menu',
      beforeState: before.slice(0, 20),
      afterState: after.slice(0, 30),
      appeared: diff.appeared,
      disappeared: diff.disappeared,
      animations: diff.animations,
      duration: 400,
      easing: 'ease-out',
    };
  } catch (err) {
    log('smart-capture', 'debug', `Hamburger capture failed: ${(err as Error).message}`);
    // Ensure viewport is restored
    try { await page.setViewportSize({ width: 1440, height: 900 }); } catch {}
    return null;
  }
}

// ── Chained Interaction Capture ───────────────────────────────────────────

const MAX_CHAIN_DEPTH = 3;
const MAX_CHAIN_CLICKS = 5;

/**
 * Find interactive elements among the newly appeared selectors.
 * Returns selectors of clickable/interactive elements that appeared after an interaction.
 */
export async function findInteractiveAmongAppeared(page: Page, appeared: string[]): Promise<string[]> {
  if (appeared.length === 0) return [];

  return page.evaluate((selectors: string[]) => {
    const interactive: string[] = [];

    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of Array.from(els)) {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || '';
        const ariaExpanded = el.getAttribute('aria-expanded');
        const ariaHasPopup = el.getAttribute('aria-haspopup');
        const isClickable =
          tag === 'a' || tag === 'button' ||
          role === 'button' || role === 'tab' || role === 'menuitem' ||
          ariaExpanded !== null || ariaHasPopup !== null ||
          (el as HTMLElement).onclick !== null ||
          el.getAttribute('tabindex') === '0';

        if (!isClickable) continue;

        // Must be visible
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const visible = cs.display !== 'none' && cs.visibility !== 'hidden' &&
          parseFloat(cs.opacity) > 0.01 && rect.width > 0 && rect.height > 0;

        if (visible) interactive.push(sel);
      }
    }

    return [...new Set(interactive)];
  }, appeared);
}

/**
 * Click a single element and capture what happens — the generic click executor.
 * Used for chained interactions where the element type is unknown.
 */
export async function captureGenericClick(
  page: Page,
  selector: string,
  chainedFrom: string,
  depth: number,
): Promise<InteractionCapture | null> {
  try {
    const el = await page.$(selector);
    if (!el || !(await el.isVisible())) return null;

    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);

    const before = await captureSnapshot(page);
    const timing = await getTransitionTiming(page, selector);

    await el.click();
    await page.waitForTimeout(Math.max(timing.duration + 150, 400));

    const after = await captureSnapshot(page);
    const diff = diffSnapshots(before, after);

    // No visible change — skip
    if (diff.appeared.length === 0 && diff.animations.length === 0) return null;

    const capture: InteractionCapture = {
      type: 'chained-click',
      trigger: selector,
      action: 'click',
      beforeState: before.slice(0, 20),
      afterState: after.slice(0, 20),
      appeared: diff.appeared,
      disappeared: diff.disappeared,
      animations: diff.animations,
      duration: timing.duration,
      easing: timing.easing,
      chainedFrom,
      chainDepth: depth,
    };

    // Recursively follow the chain
    if (depth < MAX_CHAIN_DEPTH && diff.appeared.length > 0) {
      const nextInteractive = await findInteractiveAmongAppeared(page, diff.appeared);
      if (nextInteractive.length > 0) {
        capture.producedInteractions = [];
        for (const nextSel of nextInteractive.slice(0, MAX_CHAIN_CLICKS)) {
          const nested = await captureGenericClick(page, nextSel, selector, depth + 1);
          if (nested) capture.producedInteractions.push(nested);
        }
      }
    }

    // Try to undo (press Escape, re-click toggle)
    try {
      const ariaExpanded = await el.getAttribute('aria-expanded');
      if (ariaExpanded === 'true') {
        await el.click();
        await page.waitForTimeout(300);
      } else {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    } catch { /* best effort cleanup */ }

    return capture;
  } catch (err) {
    log('smart-capture', 'debug', `Chained click failed for ${selector}: ${(err as Error).message}`);
    return null;
  }
}

/**
 * After a primary interaction, follow up on any appeared interactive elements.
 * Captures the full chain of interactions that cascade from the original action.
 */
async function captureInteractionChain(
  page: Page,
  primaryCapture: InteractionCapture,
): Promise<void> {
  if (primaryCapture.appeared.length === 0) return;

  const interactiveAppeared = await findInteractiveAmongAppeared(page, primaryCapture.appeared);
  if (interactiveAppeared.length === 0) return;

  log('smart-capture', 'info',
    `  Chain: ${primaryCapture.trigger} produced ${interactiveAppeared.length} interactive elements — following...`
  );

  primaryCapture.producedInteractions = [];

  for (const sel of interactiveAppeared.slice(0, MAX_CHAIN_CLICKS)) {
    const chained = await captureGenericClick(page, sel, primaryCapture.trigger, 1);
    if (chained) {
      primaryCapture.producedInteractions.push(chained);
      log('smart-capture', 'info',
        `  Chain depth 1: clicked ${sel} → ${chained.appeared.length} appeared, ${chained.animations.length} animations` +
        (chained.producedInteractions?.length ? ` → ${chained.producedInteractions.length} deeper chains` : '')
      );
    }
  }
}

// ── Main Capture Function ──────────────────────────────────────────────────

export async function captureInteractionsSmart(
  url: string,
  outputDir: string,
  patterns?: InteractivePattern[],
): Promise<InteractionCapture[]> {
  fs.mkdirSync(outputDir, { recursive: true });

  return withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    log('smart-capture', 'info', `Loading ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);

    // If no patterns provided, detect them
    let activePatterns = patterns;
    if (!activePatterns) {
      const { detectAnimationIntelligence } = await import('./animation-intelligence');
      const guidance = await detectAnimationIntelligence(page);
      activePatterns = guidance.interactivePatterns;
    }

    log('smart-capture', 'info', `${activePatterns.length} interactive patterns to capture`);

    const allCaptures: InteractionCapture[] = [];

    for (const pattern of activePatterns) {
      log('smart-capture', 'info', `Capturing ${pattern.type} (${pattern.triggers.length} triggers)...`);

      switch (pattern.type) {
        case 'accordion': {
          for (let i = 0; i < Math.min(pattern.triggers.length, 5); i++) {
            const capture = await captureAccordion(page, pattern.triggers[i], pattern.targets[i] || '');
            if (capture) {
              await captureInteractionChain(page, capture);
              allCaptures.push(capture);
            }
          }
          break;
        }
        case 'modal': {
          for (const trigger of pattern.triggers.slice(0, 3)) {
            const capture = await captureModal(page, trigger, pattern.targets[0] || '');
            if (capture) {
              await captureInteractionChain(page, capture);
              allCaptures.push(capture);
            }
          }
          break;
        }
        case 'tabs': {
          const captures = await captureTabs(page, pattern.triggers, pattern.targets);
          for (const capture of captures) {
            await captureInteractionChain(page, capture);
          }
          allCaptures.push(...captures);
          break;
        }
        case 'carousel': {
          const capture = await captureCarousel(page, pattern.triggers, pattern.targets[0] || '');
          if (capture) {
            await captureInteractionChain(page, capture);
            allCaptures.push(capture);
          }
          break;
        }
        case 'hamburger': {
          for (const trigger of pattern.triggers.slice(0, 2)) {
            const capture = await captureHamburger(page, trigger, pattern.targets[0] || '');
            if (capture) {
              await captureInteractionChain(page, capture);
              allCaptures.push(capture);
            }
          }
          break;
        }
        case 'dropdown': {
          // Similar to accordion — click trigger, capture expanded state
          for (const trigger of pattern.triggers.slice(0, 3)) {
            const capture = await captureAccordion(page, trigger, '');
            if (capture) {
              capture.type = 'dropdown';
              await captureInteractionChain(page, capture);
              allCaptures.push(capture);
            }
          }
          break;
        }
      }
    }

    await context.close();

    // Write output
    const outputPath = path.join(outputDir, 'interaction-captures.json');
    fs.writeFileSync(outputPath, JSON.stringify(allCaptures, null, 2));
    log('smart-capture', 'info', `Captured ${allCaptures.length} interactions → ${outputPath}`);

    return allCaptures;
  });
}

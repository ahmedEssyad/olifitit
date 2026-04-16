/**
 * Animation Intelligence
 *
 * Pre-analyzes a page to detect animation libraries, trigger points,
 * and interactive patterns. Returns guidance that the motion capture
 * loop uses to scroll smarter.
 */

import { Page } from 'playwright';
import { log } from '../core/utils';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TriggerPoint {
  scrollY: number;
  elements: string[];
  type: string;       // 'aos-entrance', 'gsap-trigger', 'css-animation', 'sticky-threshold', 'snap-point'
  duration?: number;  // ms — how long to wait at this point
}

export interface AnimatedElement {
  selector: string;
  library: string;    // 'css', 'aos', 'gsap', 'framer-motion', 'unknown'
  duration: number;   // ms
  easing: string;
  type: string;       // 'entrance', 'scroll-linked', 'hover', 'continuous'
  triggerScrollY?: number;
}

export interface InteractivePattern {
  type: 'accordion' | 'modal' | 'tabs' | 'carousel' | 'hamburger' | 'dropdown';
  triggers: string[];   // CSS selectors for trigger elements
  targets: string[];    // CSS selectors for content/panel elements
}

export interface AnimationGuidance {
  triggerPoints: TriggerPoint[];
  animatedElements: AnimatedElement[];
  interactivePatterns: InteractivePattern[];
  scrollSnapPoints: number[];
  stickyThresholds: { selector: string; triggerY: number }[];
  libraries: string[];  // detected libraries
}

// ── Main Detection ─────────────────────────────────────────────────────────

export async function detectAnimationIntelligence(page: Page): Promise<AnimationGuidance> {
  log('animation-intel', 'info', 'Analyzing page for animation patterns...');

  const guidance = await page.evaluate(() => {
    const triggerPoints: any[] = [];
    const animatedElements: any[] = [];
    const interactivePatterns: any[] = [];
    const scrollSnapPoints: number[] = [];
    const stickyThresholds: any[] = [];
    const libraries: string[] = [];

    const vpHeight = window.innerHeight;

    // Helper: build selector for an element
    function sel(el: Element): string {
      if (el.id) return `#${el.id}`;
      const tag = el.tagName.toLowerCase();
      const cls = Array.from(el.classList).filter(c => !/^\d/.test(c)).slice(0, 2);
      return cls.length ? `${tag}.${cls.join('.')}` : tag;
    }

    // ── 1. Detect AOS (Animate On Scroll) ──────────────────────────────

    const aosElements = document.querySelectorAll('[data-aos]');
    if (aosElements.length > 0) {
      libraries.push('aos');
      for (const el of Array.from(aosElements)) {
        const rect = el.getBoundingClientRect();
        const scrollY = window.scrollY + rect.top - vpHeight;
        const offset = parseInt(el.getAttribute('data-aos-offset') || '120');
        const duration = parseInt(el.getAttribute('data-aos-duration') || '400');
        const easing = el.getAttribute('data-aos-easing') || 'ease';
        const aosType = el.getAttribute('data-aos') || 'fade-up';

        const triggerY = Math.max(0, scrollY + offset);

        animatedElements.push({
          selector: sel(el),
          library: 'aos',
          duration,
          easing,
          type: 'entrance',
          triggerScrollY: triggerY,
        });

        triggerPoints.push({
          scrollY: triggerY,
          elements: [sel(el)],
          type: `aos-${aosType}`,
          duration: duration + 100,
        });
      }
    }

    // ── 2. Detect GSAP / ScrollTrigger ─────────────────────────────────

    const gsapMarkers = document.querySelectorAll('[data-speed], .gsap-marker-start, .gsap-marker-end, .gsap-marker-scroller-start');
    if (gsapMarkers.length > 0 || (window as any).gsap || (window as any).ScrollTrigger) {
      libraries.push('gsap');

      // Try to read ScrollTrigger instances
      try {
        const ST = (window as any).ScrollTrigger;
        if (ST && typeof ST.getAll === 'function') {
          const triggers = ST.getAll();
          for (const t of triggers) {
            if (t.start !== undefined && t.end !== undefined) {
              triggerPoints.push({
                scrollY: Math.round(t.start),
                elements: [t.trigger ? sel(t.trigger) : 'unknown'],
                type: 'gsap-trigger',
                duration: 500,
              });
            }
          }
        }
      } catch { /* ScrollTrigger not accessible */ }

      // Elements with data-speed (parallax)
      for (const el of Array.from(document.querySelectorAll('[data-speed]'))) {
        animatedElements.push({
          selector: sel(el),
          library: 'gsap',
          duration: 0,
          easing: 'linear',
          type: 'scroll-linked',
        });
      }
    }

    // ── 3. Detect Framer Motion ────────────────────────────────────────

    const framerElements = document.querySelectorAll('[data-framer-appear-id], [data-projection-id], [data-framer-component-type]');
    if (framerElements.length > 0) {
      libraries.push('framer-motion');
      for (const el of Array.from(framerElements)) {
        const rect = el.getBoundingClientRect();
        const triggerY = Math.max(0, window.scrollY + rect.top - vpHeight);
        animatedElements.push({
          selector: sel(el),
          library: 'framer-motion',
          duration: 600, // framer default
          easing: 'ease-out',
          type: 'entrance',
          triggerScrollY: triggerY,
        });
        triggerPoints.push({
          scrollY: triggerY,
          elements: [sel(el)],
          type: 'framer-entrance',
          duration: 700,
        });
      }
    }

    // ── 4. Detect CSS transitions/animations on elements ───────────────

    const allElements = document.querySelectorAll('*');
    for (let i = 0; i < Math.min(allElements.length, 3000); i++) {
      const el = allElements[i];
      const cs = getComputedStyle(el);

      // CSS transitions
      const transitionProp = cs.transitionProperty;
      const transitionDur = cs.transitionDuration;
      if (transitionProp && transitionProp !== 'all' && transitionProp !== 'none' &&
          transitionDur && transitionDur !== '0s') {
        const durMs = parseFloat(transitionDur) * (transitionDur.includes('ms') ? 1 : 1000);
        if (durMs > 50) {
          animatedElements.push({
            selector: sel(el),
            library: 'css',
            duration: durMs,
            easing: cs.transitionTimingFunction || 'ease',
            type: 'hover',
          });
        }
      }

      // CSS animations
      const animName = cs.animationName;
      const animDur = cs.animationDuration;
      if (animName && animName !== 'none' && animDur && animDur !== '0s') {
        const durMs = parseFloat(animDur) * (animDur.includes('ms') ? 1 : 1000);
        const rect = el.getBoundingClientRect();
        const isAboveFold = rect.top < vpHeight;
        animatedElements.push({
          selector: sel(el),
          library: 'css',
          duration: durMs,
          easing: cs.animationTimingFunction || 'ease',
          type: isAboveFold ? 'continuous' : 'entrance',
          triggerScrollY: isAboveFold ? undefined : Math.max(0, window.scrollY + rect.top - vpHeight),
        });
      }
    }

    // ── 5. Detect scroll-snap points ───────────────────────────────────

    const scrollContainers = document.querySelectorAll('*');
    for (let i = 0; i < Math.min(scrollContainers.length, 500); i++) {
      const el = scrollContainers[i];
      const cs = getComputedStyle(el);
      if (cs.scrollSnapType && cs.scrollSnapType !== 'none') {
        // Find snap children
        for (const child of Array.from(el.children)) {
          const childCs = getComputedStyle(child);
          if (childCs.scrollSnapAlign && childCs.scrollSnapAlign !== 'none') {
            const rect = child.getBoundingClientRect();
            scrollSnapPoints.push(Math.round(window.scrollY + rect.top));
          }
        }
      }
    }

    // ── 6. Detect sticky elements ──────────────────────────────────────

    for (let i = 0; i < Math.min(allElements.length, 2000); i++) {
      const el = allElements[i];
      const cs = getComputedStyle(el);
      if (cs.position === 'sticky') {
        const rect = el.getBoundingClientRect();
        const stickyTop = parseInt(cs.top) || 0;
        const triggerY = Math.max(0, window.scrollY + rect.top - stickyTop);
        stickyThresholds.push({ selector: sel(el), triggerY });
      }
    }

    // ── 7. Detect interactive patterns ─────────────────────────────────

    // Accordions
    const accordionTriggers = document.querySelectorAll('[aria-expanded], details > summary, [data-toggle="collapse"]');
    if (accordionTriggers.length > 0) {
      interactivePatterns.push({
        type: 'accordion',
        triggers: Array.from(accordionTriggers).slice(0, 20).map(sel),
        targets: Array.from(accordionTriggers).slice(0, 20).map(el => {
          const controls = el.getAttribute('aria-controls');
          if (controls) return `#${controls}`;
          if (el.tagName === 'SUMMARY') return sel(el.parentElement!);
          return '';
        }).filter(Boolean),
      });
    }

    // Modals
    const modalTriggers = document.querySelectorAll('[aria-haspopup="dialog"], [data-bs-toggle="modal"], [class*="modal-trigger"], button[data-modal]');
    const dialogs = document.querySelectorAll('dialog, [role="dialog"], [class*="modal"]:not([class*="modal-trigger"])');
    if (modalTriggers.length > 0 || dialogs.length > 0) {
      interactivePatterns.push({
        type: 'modal',
        triggers: Array.from(modalTriggers).slice(0, 10).map(sel),
        targets: Array.from(dialogs).slice(0, 10).map(sel),
      });
    }

    // Tabs
    const tabLists = document.querySelectorAll('[role="tablist"]');
    if (tabLists.length > 0) {
      for (const tabList of Array.from(tabLists)) {
        const tabs = tabList.querySelectorAll('[role="tab"]');
        const panels = document.querySelectorAll('[role="tabpanel"]');
        interactivePatterns.push({
          type: 'tabs',
          triggers: Array.from(tabs).map(sel),
          targets: Array.from(panels).map(sel),
        });
      }
    }

    // Carousels
    const carousels = document.querySelectorAll('.swiper, .slick-slider, [data-carousel], [class*="carousel"], .splide');
    if (carousels.length > 0) {
      for (const carousel of Array.from(carousels)) {
        const nextBtn = carousel.querySelector('.swiper-button-next, .slick-next, [class*="next"], [aria-label*="next" i]');
        const prevBtn = carousel.querySelector('.swiper-button-prev, .slick-prev, [class*="prev"], [aria-label*="prev" i]');
        interactivePatterns.push({
          type: 'carousel',
          triggers: [nextBtn, prevBtn].filter(Boolean).map(el => sel(el!)),
          targets: [sel(carousel)],
        });
      }
    }

    // Hamburger menus
    const hamburgers = document.querySelectorAll('[class*="hamburger"], [class*="menu-toggle"], [aria-label*="menu" i][aria-expanded], button[aria-controls][class*="mobile"]');
    if (hamburgers.length > 0) {
      interactivePatterns.push({
        type: 'hamburger',
        triggers: Array.from(hamburgers).slice(0, 5).map(sel),
        targets: Array.from(hamburgers).slice(0, 5).map(el => {
          const controls = el.getAttribute('aria-controls');
          return controls ? `#${controls}` : '';
        }).filter(Boolean),
      });
    }

    // Dropdowns
    const dropdownTriggers = document.querySelectorAll('[aria-haspopup="listbox"], [aria-haspopup="menu"], [data-bs-toggle="dropdown"]');
    if (dropdownTriggers.length > 0) {
      interactivePatterns.push({
        type: 'dropdown',
        triggers: Array.from(dropdownTriggers).slice(0, 10).map(sel),
        targets: [],
      });
    }

    return {
      triggerPoints,
      animatedElements,
      interactivePatterns,
      scrollSnapPoints,
      stickyThresholds,
      libraries,
    };
  });

  // Deduplicate trigger points by scroll position (merge within 50px)
  const merged = mergeTriggerPoints(guidance.triggerPoints);
  guidance.triggerPoints = merged;

  log('animation-intel', 'info',
    `Libraries: ${guidance.libraries.join(', ') || 'none detected'}. ` +
    `${guidance.animatedElements.length} animated elements, ` +
    `${guidance.triggerPoints.length} trigger points, ` +
    `${guidance.interactivePatterns.length} interactive patterns, ` +
    `${guidance.scrollSnapPoints.length} snap points, ` +
    `${guidance.stickyThresholds.length} sticky elements.`
  );

  return guidance;
}

// ── Smart Scroll Position Builder ──────────────────────────────────────────

export interface SmartScrollPosition {
  y: number;
  waitMs: number;
  label: string;
}

export function buildSmartScrollPositions(
  pageHeight: number,
  guidance: AnimationGuidance,
  coarseStep: number = 200,
  fineStep: number = 25,
  fineRadius: number = 150,
): SmartScrollPosition[] {
  const positions = new Map<number, SmartScrollPosition>();

  // 1. Coarse positions (static regions)
  for (let y = 0; y < pageHeight; y += coarseStep) {
    positions.set(y, { y, waitMs: 60, label: 'coarse' });
  }
  positions.set(Math.max(0, pageHeight - 50), { y: Math.max(0, pageHeight - 50), waitMs: 60, label: 'bottom' });

  // 2. Dense positions around trigger points
  for (const trigger of guidance.triggerPoints) {
    const start = Math.max(0, trigger.scrollY - fineRadius);
    const end = Math.min(pageHeight, trigger.scrollY + fineRadius);
    for (let y = start; y <= end; y += fineStep) {
      const existing = positions.get(y);
      const waitMs = Math.max(trigger.duration || 100, existing?.waitMs || 60);
      positions.set(y, { y, waitMs, label: trigger.type });
    }
    // Exact trigger point
    positions.set(trigger.scrollY, {
      y: trigger.scrollY,
      waitMs: (trigger.duration || 400) + 100,
      label: trigger.type,
    });
  }

  // 3. Scroll-snap points
  for (const snapY of guidance.scrollSnapPoints) {
    positions.set(snapY, { y: snapY, waitMs: 300, label: 'snap-point' });
  }

  // 4. Sticky thresholds
  for (const sticky of guidance.stickyThresholds) {
    const y = sticky.triggerY;
    positions.set(Math.max(0, y - 50), { y: Math.max(0, y - 50), waitMs: 100, label: 'pre-sticky' });
    positions.set(y, { y, waitMs: 200, label: 'sticky-threshold' });
    positions.set(y + 50, { y: y + 50, waitMs: 100, label: 'post-sticky' });
  }

  return Array.from(positions.values()).sort((a, b) => a.y - b.y);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function mergeTriggerPoints(points: TriggerPoint[]): TriggerPoint[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.scrollY - b.scrollY);
  const merged: TriggerPoint[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.scrollY - last.scrollY < 50) {
      // Merge: keep higher duration, combine elements
      last.elements = [...new Set([...last.elements, ...curr.elements])];
      last.duration = Math.max(last.duration || 0, curr.duration || 0);
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

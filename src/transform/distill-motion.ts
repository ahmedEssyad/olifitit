/**
 * Motion Distiller
 *
 * Pre-processes the raw motion-capture.json (66MB+) into a compact
 * animation spec (~50-200KB) that the AI synthesizer can fully consume.
 *
 * Extracts:
 *   - Entrance animations (fade-in, slide-up, zoom, etc.) with from/to/trigger
 *   - Scroll-linked animations with scroll ranges and value transitions
 *   - Hover/focus transitions with duration, easing, property changes
 *   - Parallax effects with scroll ratios
 *   - Continuous CSS animations with keyframes
 *   - Cross-viewport responsive animation differences
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils';
import type { ViewportMotionData } from '../core/types/motion';

// ── Types ────────────────────────────────────────────────────────────────────

interface DistilledAnimation {
  element: string;          // selector or descriptive label
  textPreview: string;      // what the element contains
  trigger: 'scroll-into-view' | 'scroll-linked' | 'hover' | 'focus' | 'continuous' | 'parallax';
  from: Record<string, string>;
  to: Record<string, string>;
  intermediateKeyframes?: { offset: number; styles: Record<string, string> }[];
  duration: string;
  easing: string;
  delay?: string;
  triggerPoint?: string;    // e.g. "scrollY: 1200px" or "20% viewport"
  scrollRange?: { start: number; end: number };
  parallaxRatio?: number;
  responsive?: Record<string, Partial<DistilledAnimation>>; // viewport-specific overrides
}

interface AnimationInteractionLink {
  animation: string;
  element: string;
  scrollRange: [number, number];
  produces: { selector: string; interaction: string; text?: string }[];
  removes: { selector: string; interaction: string; text?: string }[];
}

interface DistilledMotion {
  url: string;
  timestamp: string;
  summary: {
    totalAnimatedElements: number;
    entrance: number;
    scrollLinked: number;
    hover: number;
    focus: number;
    continuous: number;
    parallax: number;
  };
  animations: DistilledAnimation[];
  cssKeyframes: { name: string; duration: string; iterations: string; keyframes: Record<string, string>[] }[];
  responsiveNotes: string[];
  scrollInteractions?: {
    keyScrollStates: number;
    animationInteractionLinks: AnimationInteractionLink[];
    interactiveElementTransitions: string[];
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Pick only the properties that actually changed between two style snapshots */
function diffStyles(from: Record<string, string>, to: Record<string, string>): { from: Record<string, string>; to: Record<string, string> } {
  const changedFrom: Record<string, string> = {};
  const changedTo: Record<string, string> = {};

  for (const key of Object.keys(to)) {
    if (from[key] !== to[key] && to[key] !== undefined) {
      changedFrom[key] = from[key] || '';
      changedTo[key] = to[key];
    }
  }

  return { from: changedFrom, to: changedTo };
}

/** Classify an entrance animation type from style changes */
function classifyEntrance(from: Record<string, string>, to: Record<string, string>): string {
  const parts: string[] = [];
  if (from.opacity === '0' || parseFloat(from.opacity) < 0.1) parts.push('fade-in');
  if (from.transform && /translateY/i.test(from.transform)) parts.push('slide-up');
  if (from.transform && /translateX/i.test(from.transform)) parts.push('slide-in');
  if (from.transform && /scale/i.test(from.transform)) parts.push('zoom-in');
  return parts.length > 0 ? parts.join(' + ') : 'reveal';
}

/** Simplify a CSS transform matrix to readable form */
function simplifyTransform(value: string): string {
  if (!value || value === 'none') return 'none';

  // matrix(a, b, c, d, tx, ty)
  const matrixMatch = value.match(/matrix\(\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+)\s*\)/);
  if (matrixMatch) {
    const [, a, b, c, d, tx, ty] = matrixMatch.map(Number);
    const parts: string[] = [];

    // Check for translation
    if (Math.abs(tx) > 0.5 || Math.abs(ty) > 0.5) {
      parts.push(`translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)`);
    }

    // Check for scale (a and d should be equal for uniform scale)
    if (Math.abs(a - 1) > 0.01 || Math.abs(d - 1) > 0.01) {
      if (Math.abs(a - d) < 0.01) {
        parts.push(`scale(${a.toFixed(3)})`);
      } else {
        parts.push(`scale(${a.toFixed(3)}, ${d.toFixed(3)})`);
      }
    }

    // Check for rotation (b and c non-zero)
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01) {
      const angle = Math.atan2(b, a) * (180 / Math.PI);
      parts.push(`rotate(${angle.toFixed(1)}deg)`);
    }

    return parts.length > 0 ? parts.join(' ') : 'none';
  }

  return value;
}

/** Deduplicate animations by merging near-identical ones */
function deduplicateAnimations(anims: DistilledAnimation[]): DistilledAnimation[] {
  const seen = new Map<string, DistilledAnimation>();

  for (const anim of anims) {
    // Key by trigger type + from/to signature
    const fromSig = Object.entries(anim.from).sort().map(([k, v]) => `${k}:${v}`).join(',');
    const toSig = Object.entries(anim.to).sort().map(([k, v]) => `${k}:${v}`).join(',');
    const key = `${anim.trigger}|${fromSig}|${toSig}|${anim.duration}`;

    if (seen.has(key)) {
      // Merge — keep the first one, note this is a repeated pattern
      const existing = seen.get(key)!;
      if (!existing.element.includes(' + ')) {
        existing.element = `${existing.element} + ${anim.element}`;
      } else if (existing.element.split(' + ').length < 3) {
        existing.element = `${existing.element} + ${anim.element}`;
      }
    } else {
      seen.set(key, { ...anim });
    }
  }

  return Array.from(seen.values());
}

// ── Main Distiller ───────────────────────────────────────────────────────────

export function distillMotion(outputDir: string): DistilledMotion {
  const motionPath = path.join(outputDir, 'motion-capture.json');

  if (!fs.existsSync(motionPath)) {
    log('MotionDistiller', 'warn', 'No motion-capture.json found');
    return {
      url: '',
      timestamp: new Date().toISOString(),
      summary: { totalAnimatedElements: 0, entrance: 0, scrollLinked: 0, hover: 0, focus: 0, continuous: 0, parallax: 0 },
      animations: [],
      cssKeyframes: [],
      responsiveNotes: [],
    };
  }

  log('MotionDistiller', 'info', 'Reading motion-capture.json...');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(motionPath, 'utf-8')) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`Failed to parse motion-capture.json: ${(e as Error).message}`);
  }

  const animations: DistilledAnimation[] = [];
  const cssKeyframes: DistilledMotion['cssKeyframes'] = [];
  const responsiveNotes: string[] = [];
  const counts = { entrance: 0, scrollLinked: 0, hover: 0, focus: 0, continuous: 0, parallax: 0 };

  // Use the largest viewport (desktop) as the primary source
  const viewports = (raw.viewports as ViewportMotionData[] | undefined) || [];
  const desktopVP = viewports.find((v) => v.viewportWidth >= 1440) || viewports[viewports.length - 1];
  const mobileVP = viewports.find((v) => v.viewportWidth <= 375);

  if (!desktopVP) {
    log('MotionDistiller', 'warn', 'No viewport data found');
    return {
      url: (raw.url as string) || '',
      timestamp: (raw.timestamp as string) || new Date().toISOString(),
      summary: { totalAnimatedElements: 0, entrance: 0, scrollLinked: 0, hover: 0, focus: 0, continuous: 0, parallax: 0 },
      animations: [],
      cssKeyframes: [],
      responsiveNotes: [],
    };
  }

  // ── Process globalPatterns (already distilled by capture script) ──

  if (desktopVP.globalPatterns) {
    const gp = desktopVP.globalPatterns;

    // Entrance animations
    for (const ea of gp.entranceAnimations || []) {
      const { from: diffFrom, to: diffTo } = diffStyles(ea.from || {}, ea.to || {});
      if (Object.keys(diffFrom).length === 0) continue;

      // Simplify transforms
      if (diffFrom.transform) diffFrom.transform = simplifyTransform(diffFrom.transform);
      if (diffTo.transform) diffTo.transform = simplifyTransform(diffTo.transform);

      animations.push({
        element: ea.selector,
        textPreview: '',
        trigger: 'scroll-into-view',
        from: diffFrom,
        to: diffTo,
        duration: ea.duration || '0.6s',
        easing: ea.easing || 'ease-out',
        triggerPoint: `scrollY: ${ea.triggerScroll}px`,
      });
      counts.entrance++;
    }

    // Scroll-linked animations
    for (const sl of gp.scrollLinkedAnimations || []) {
      animations.push({
        element: sl.selector,
        textPreview: '',
        trigger: 'scroll-linked',
        from: { [sl.property]: simplifyTransform(sl.startValue) },
        to: { [sl.property]: simplifyTransform(sl.endValue) },
        duration: 'scroll-driven',
        easing: sl.easing || 'linear',
        scrollRange: { start: sl.startScroll, end: sl.endScroll },
      });
      counts.scrollLinked++;
    }

    // Hover transitions
    for (const ht of gp.hoverTransitions || []) {
      const { from: diffFrom, to: diffTo } = diffStyles(ht.from || {}, ht.to || {});
      if (Object.keys(diffFrom).length === 0) continue;

      if (diffFrom.transform) diffFrom.transform = simplifyTransform(diffFrom.transform);
      if (diffTo.transform) diffTo.transform = simplifyTransform(diffTo.transform);

      animations.push({
        element: ht.selector,
        textPreview: '',
        trigger: 'hover',
        from: diffFrom,
        to: diffTo,
        duration: ht.duration || '0.3s',
        easing: ht.easing || 'ease',
      });
      counts.hover++;
    }

    // Continuous animations
    for (const ca of gp.continuousAnimations || []) {
      cssKeyframes.push({
        name: ca.animationName,
        duration: ca.duration,
        iterations: ca.iterationCount || 'infinite',
        keyframes: [],
      });
      counts.continuous++;
    }

    // Parallax effects
    for (const pe of gp.parallaxEffects || []) {
      animations.push({
        element: pe.selector,
        textPreview: '',
        trigger: 'parallax',
        from: {},
        to: {},
        duration: 'scroll-driven',
        easing: 'linear',
        parallaxRatio: pe.scrollRatio,
      });
      counts.parallax++;
    }
  }

  // ── Process per-element data for anything globalPatterns missed ──

  const globalSelectors = new Set(animations.map(a => a.element));

  for (const el of desktopVP.elements || []) {
    if (globalSelectors.has(el.selector)) continue;
    if (el.animationType === 'none') continue;

    // Entrance from scroll keyframes
    if (el.animationType === 'entrance' && el.initialState && el.finalState) {
      const { from: diffFrom, to: diffTo } = diffStyles(el.initialState, el.finalState);
      if (Object.keys(diffFrom).length === 0) continue;

      if (diffFrom.transform) diffFrom.transform = simplifyTransform(diffFrom.transform);
      if (diffTo.transform) diffTo.transform = simplifyTransform(diffTo.transform);

      // Extract intermediate keyframes from scrollKeyframes when 3+ distinct style states exist
      let intermediateKeyframes: { offset: number; styles: Record<string, string> }[] | undefined;
      const scrollKfs: { scrollY: number; styles: Record<string, string> }[] = el.scrollKeyframes || [];
      if (scrollKfs.length >= 3) {
        const firstScrollY = scrollKfs[0].scrollY;
        const lastScrollY = scrollKfs[scrollKfs.length - 1].scrollY;
        const scrollSpan = lastScrollY - firstScrollY;

        if (scrollSpan > 0) {
          // Deduplicate consecutive identical style snapshots
          const distinctKfs: typeof scrollKfs = [scrollKfs[0]];
          for (let i = 1; i < scrollKfs.length; i++) {
            const prev = distinctKfs[distinctKfs.length - 1];
            const curr = scrollKfs[i];
            const isSame = Object.keys(curr.styles).every(k => curr.styles[k] === prev.styles[k]);
            if (!isSame) distinctKfs.push(curr);
          }

          if (distinctKfs.length >= 3) {
            intermediateKeyframes = distinctKfs.slice(1, -1).map(kf => {
              const offset = parseFloat(((kf.scrollY - firstScrollY) / scrollSpan).toFixed(3));
              const styles: Record<string, string> = {};
              for (const [prop, val] of Object.entries(kf.styles)) {
                styles[prop] = prop === 'transform' ? simplifyTransform(val) : val;
              }
              return { offset, styles };
            });
          }
        }
      }

      const entranceAnim: DistilledAnimation = {
        element: el.selector,
        textPreview: el.textPreview || '',
        trigger: 'scroll-into-view',
        from: diffFrom,
        to: diffTo,
        duration: '0.6s',
        easing: el.easing || 'ease-out',
        triggerPoint: el.triggerPoint ? `scrollY: ${el.triggerPoint}px` : undefined,
      };
      if (intermediateKeyframes && intermediateKeyframes.length > 0) {
        entranceAnim.intermediateKeyframes = intermediateKeyframes;
      }
      animations.push(entranceAnim);
      counts.entrance++;
    }

    // Hover from element hover data
    if (el.hoverTransition && el.hoverTransition.properties.length > 0) {
      const frames = el.hoverTransition.frames || [];
      if (frames.length >= 2) {
        const firstFrame = frames[0].styles;
        const lastFrame = frames[frames.length - 1].styles;
        const { from: diffFrom, to: diffTo } = diffStyles(firstFrame, lastFrame);

        if (Object.keys(diffFrom).length > 0) {
          if (diffFrom.transform) diffFrom.transform = simplifyTransform(diffFrom.transform);
          if (diffTo.transform) diffTo.transform = simplifyTransform(diffTo.transform);

          animations.push({
            element: el.selector,
            textPreview: el.textPreview || '',
            trigger: 'hover',
            from: diffFrom,
            to: diffTo,
            duration: `${el.hoverTransition.duration}ms`,
            easing: el.hoverTransition.easing || 'ease',
          });
          counts.hover++;
        }
      }
    }

    // Focus transitions
    if (el.focusTransition && el.focusTransition.properties.length > 0) {
      const frames = el.focusTransition.frames || [];
      if (frames.length >= 2) {
        const firstFrame = frames[0].styles;
        const lastFrame = frames[frames.length - 1].styles;
        const { from: diffFrom, to: diffTo } = diffStyles(firstFrame, lastFrame);

        if (Object.keys(diffFrom).length > 0) {
          animations.push({
            element: el.selector,
            textPreview: el.textPreview || '',
            trigger: 'focus',
            from: diffFrom,
            to: diffTo,
            duration: `${el.focusTransition.duration}ms`,
            easing: el.focusTransition.easing || 'ease',
          });
          counts.focus++;
        }
      }
    }

    // Web Animations API
    for (const wa of el.webAnimations || []) {
      const existing = cssKeyframes.find(k => k.name === wa.animationName);
      if (!existing) {
        cssKeyframes.push({
          name: wa.animationName,
          duration: `${wa.duration}ms`,
          iterations: wa.iterations === Infinity ? 'infinite' : String(wa.iterations),
          keyframes: wa.keyframes || [],
        });
        counts.continuous++;
      }

      // If this web animation has more than 2 keyframes, preserve ALL of them
      // as intermediateKeyframes on the corresponding distilled animation entry
      const waKeyframes: Record<string, string>[] = wa.keyframes || [];
      if (waKeyframes.length > 2) {
        const firstKf = waKeyframes[0];
        const lastKf = waKeyframes[waKeyframes.length - 1];
        const { from: waFrom, to: waTo } = diffStyles(firstKf, lastKf);

        if (Object.keys(waFrom).length > 0) {
          if (waFrom.transform) waFrom.transform = simplifyTransform(waFrom.transform);
          if (waTo.transform) waTo.transform = simplifyTransform(waTo.transform);

          // Build intermediate keyframes: all frames except the first and last
          const intermediateKeyframes = waKeyframes.slice(1, -1).map((kf, i) => {
            const offset = (i + 1) / (waKeyframes.length - 1);
            const styles: Record<string, string> = {};
            for (const [prop, val] of Object.entries(kf)) {
              if (prop === 'offset' || prop === 'easing' || prop === 'composite') continue;
              styles[prop] = prop === 'transform' ? simplifyTransform(val as string) : (val as string);
            }
            return { offset: parseFloat(offset.toFixed(3)), styles };
          });

          animations.push({
            element: el.selector,
            textPreview: el.textPreview || '',
            trigger: 'continuous',
            from: waFrom,
            to: waTo,
            intermediateKeyframes,
            duration: `${wa.duration}ms`,
            easing: wa.easing || 'ease',
            delay: wa.delay > 0 ? `${wa.delay}ms` : undefined,
          });
          counts.continuous++;
        }
      }
    }
  }

  // ── Cross-viewport responsive notes ──

  for (const diff of (raw.crossViewportDiffs as { selector: string; property: string; differences: { viewport: number; value: string }[] }[] | undefined) || []) {
    const diffs = diff.differences || [];
    if (diffs.length < 2) continue;

    const values = diffs.map((d) => `${d.viewport}px: ${d.value}`).join(', ');
    responsiveNotes.push(`${diff.selector} — ${diff.property} differs: ${values}`);
  }

  // Check for animations that exist at one viewport but not another
  if (mobileVP && desktopVP) {
    const desktopSelectors = new Set(((desktopVP.elements as { animationType: string; selector: string }[] | undefined) || []).filter((e) => e.animationType !== 'none').map((e) => e.selector));
    const mobileSelectors = new Set(((mobileVP.elements as { animationType: string; selector: string }[] | undefined) || []).filter((e) => e.animationType !== 'none').map((e) => e.selector));

    const desktopOnly = [...desktopSelectors].filter(s => !mobileSelectors.has(s));
    const mobileOnly = [...mobileSelectors].filter(s => !desktopSelectors.has(s));

    if (desktopOnly.length > 0) {
      responsiveNotes.push(`Desktop-only animations (${desktopOnly.length}): ${desktopOnly.slice(0, 5).join(', ')}${desktopOnly.length > 5 ? '...' : ''}`);
    }
    if (mobileOnly.length > 0) {
      responsiveNotes.push(`Mobile-only animations (${mobileOnly.length}): ${mobileOnly.slice(0, 5).join(', ')}${mobileOnly.length > 5 ? '...' : ''}`);
    }
  }

  // ── Deduplicate & finalize ──

  const deduplicated = deduplicateAnimations(animations);

  const totalAnimated = new Set(deduplicated.map(a => a.element.split(' + ')[0])).size;

  const result: DistilledMotion = {
    url: (raw.url as string) || '',
    timestamp: (raw.timestamp as string) || new Date().toISOString(),
    summary: {
      totalAnimatedElements: totalAnimated,
      ...counts,
    },
    animations: deduplicated,
    cssKeyframes,
    responsiveNotes,
  };

  // ── Incorporate scroll-interaction data if available ──

  const scrollInteractionsPath = path.join(outputDir, 'scroll-interactions.json');
  if (fs.existsSync(scrollInteractionsPath)) {
    try {
      const siData = JSON.parse(fs.readFileSync(scrollInteractionsPath, 'utf-8'));
      const links: AnimationInteractionLink[] = siData.animationInteractionLinks || [];
      const transitions: string[] = [];

      // Build human-readable transition notes
      for (const state of siData.scrollStates || []) {
        if (state.newSinceLastState?.length > 0 || state.removedSinceLastState?.length > 0) {
          const parts: string[] = [`At scrollY ${state.scrollY}px (${state.label}):`];
          if (state.newSinceLastState?.length > 0) {
            parts.push(`+${state.newSinceLastState.length} interactive elements appeared`);
          }
          if (state.removedSinceLastState?.length > 0) {
            parts.push(`-${state.removedSinceLastState.length} interactive elements removed`);
          }
          transitions.push(parts.join(' '));
        }
      }

      // Annotate animations with produces/removes
      for (const link of links) {
        for (const anim of deduplicated) {
          if (anim.scrollRange &&
              Math.abs((anim.scrollRange.start || 0) - link.scrollRange[0]) < 50 &&
              Math.abs((anim.scrollRange.end || 0) - link.scrollRange[1]) < 50) {
            (anim as DistilledAnimation & { produces?: unknown; removes?: unknown }).produces = link.produces;
            (anim as DistilledAnimation & { produces?: unknown; removes?: unknown }).removes = link.removes;
          }
        }
      }

      result.scrollInteractions = {
        keyScrollStates: siData.scrollStates?.length || 0,
        animationInteractionLinks: links,
        interactiveElementTransitions: transitions,
      };

      log('MotionDistiller', 'info', `Incorporated scroll-interaction data: ${links.length} animation-interaction links, ${transitions.length} transitions`);
    } catch (e) {
      log('MotionDistiller', 'warn', `Failed to read scroll-interactions.json: ${(e as Error).message}`);
    }
  }

  // Write output
  const outputPath = path.join(outputDir, 'motion-distilled.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  const sizeKB = (Buffer.byteLength(JSON.stringify(result), 'utf-8') / 1024).toFixed(1);
  log('MotionDistiller', 'info', `Wrote motion-distilled.json (${sizeKB} KB) — ${deduplicated.length} animations, ${cssKeyframes.length} CSS keyframes`);

  return result;
}

// ── CLI Entry ────────────────────────────────────────────────────────────────

if (require.main === module) {
  const outputDir = process.argv[2] || path.resolve(process.cwd(), 'output');
  distillMotion(outputDir);
}

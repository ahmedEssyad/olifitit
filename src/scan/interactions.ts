/**
 * Capture hover/focus/active interaction states for interactive elements.
 */

import { Page } from 'playwright';
import { escapeCSSSelector } from '../core/utils';

export async function captureInteractionStates(
  page: Page,
  selector: string
): Promise<{ hover?: Record<string, string>; focus?: Record<string, string>; active?: Record<string, string>; disabled?: Record<string, string>; isDisabled?: boolean }> {
  const stateProps = [
    'color', 'backgroundColor', 'borderColor', 'borderTopColor',
    'boxShadow', 'textDecoration', 'opacity', 'transform',
    'outline', 'outlineColor', 'outlineWidth', 'outlineStyle',
    'cursor', 'filter', 'backdropFilter',
  ];

  const states: { hover?: Record<string, string>; focus?: Record<string, string>; active?: Record<string, string>; disabled?: Record<string, string>; isDisabled?: boolean } = {};

  // Get base styles first
  const baseStyles = await page.evaluate(({ sel, props }: { sel: string; props: string[] }) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const computed = window.getComputedStyle(el);
    const styles: Record<string, string> = {};
    for (const prop of props) {
      const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
      styles[prop] = computed.getPropertyValue(cssProp);
    }
    return styles;
  }, { sel: escapeCSSSelector(selector), props: stateProps });

  if (!baseStyles) return states;

  // Hover state
  try {
    const el = await page.$(escapeCSSSelector(selector));
    if (el) {
      await el.hover();
      await page.waitForTimeout(100);
      const hoverStyles = await page.evaluate(({ sel, props }: { sel: string; props: string[] }) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const computed = window.getComputedStyle(el);
        const styles: Record<string, string> = {};
        for (const prop of props) {
          const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
          styles[prop] = computed.getPropertyValue(cssProp);
        }
        return styles;
      }, { sel: escapeCSSSelector(selector), props: stateProps });

      if (hoverStyles) {
        const diff: Record<string, string> = {};
        for (const prop of stateProps) {
          if (hoverStyles[prop] !== baseStyles[prop]) {
            diff[prop] = hoverStyles[prop];
          }
        }
        if (Object.keys(diff).length > 0) states.hover = diff;
      }
      await page.mouse.move(0, 0);
      await page.waitForTimeout(50);
    }
  } catch { /* element not hoverable */ }

  // Focus state
  try {
    await page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLElement;
      if (el && el.focus) el.focus();
    }, escapeCSSSelector(selector));
    await page.waitForTimeout(100);

    const focusStyles = await page.evaluate(({ sel, props }: { sel: string; props: string[] }) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const computed = window.getComputedStyle(el);
      const styles: Record<string, string> = {};
      for (const prop of props) {
        const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        styles[prop] = computed.getPropertyValue(cssProp);
      }
      return styles;
    }, { sel: escapeCSSSelector(selector), props: stateProps });

    if (focusStyles) {
      const diff: Record<string, string> = {};
      for (const prop of stateProps) {
        if (focusStyles[prop] !== baseStyles[prop]) {
          diff[prop] = focusStyles[prop];
        }
      }
      if (Object.keys(diff).length > 0) states.focus = diff;
    }

    await page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLElement;
      if (el && el.blur) el.blur();
    }, escapeCSSSelector(selector));
  } catch { /* element not focusable */ }

  // Disabled state
  try {
    const disabledData = await page.evaluate(({ sel, props }: { sel: string; props: string[] }) => {
      const el = document.querySelector(sel) as HTMLInputElement | HTMLButtonElement | HTMLSelectElement | null;
      if (!el) return null;

      // Check if element has disabled attribute or is actually disabled
      const isDisabled = el.hasAttribute('disabled') ||
        el.hasAttribute('aria-disabled') ||
        (el as HTMLInputElement | HTMLButtonElement | HTMLSelectElement).disabled === true;

      if (!isDisabled) return null;

      // Capture computed styles in disabled state (already applied since attribute is present)
      const computed = window.getComputedStyle(el);
      const styles: Record<string, string> = {};
      const disabledProps = [...props, 'opacity', 'pointerEvents', 'cursor'];
      for (const prop of disabledProps) {
        const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        styles[prop] = computed.getPropertyValue(cssProp);
      }

      return { isDisabled: true, styles };
    }, { sel: escapeCSSSelector(selector), props: stateProps });

    if (disabledData) {
      states.isDisabled = true;
      // Compute diff between base and disabled styles
      const diff: Record<string, string> = {};
      for (const [prop, val] of Object.entries(disabledData.styles)) {
        if (baseStyles[prop] !== val) {
          diff[prop] = val;
        }
      }
      // Also check extended props not in baseStyles
      if (disabledData.styles.opacity && disabledData.styles.opacity !== '1') {
        diff.opacity = disabledData.styles.opacity;
      }
      if (disabledData.styles.pointerEvents === 'none') {
        diff.pointerEvents = 'none';
      }
      if (disabledData.styles.cursor === 'not-allowed' || disabledData.styles.cursor === 'default') {
        diff.cursor = disabledData.styles.cursor;
      }
      if (Object.keys(diff).length > 0) states.disabled = diff;
    }
  } catch { /* element not disableable */ }

  return states;
}

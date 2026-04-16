/**
 * Interaction Extractor — catalogs all interactive behaviors on a page.
 *
 * Usage: npx ts-node scripts/extract-interactions.ts <url> [output-dir]
 */

import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { withBrowser, withRetry, log } from '../core/utils';

// ── Types ──────────────────────────────────────────────────────────────────────

interface NavigationData {
  internal: { href: string; text: string; selector: string }[];
  external: { href: string; text: string; selector: string }[];
  anchorLinks: { href: string; text: string; selector: string }[];
}

interface ToggleData {
  trigger: string;
  target: string;
  type: 'accordion' | 'toggle' | 'details';
  triggerText: string;
}

interface ModalData {
  trigger: string;
  dialog: string;
  triggerText: string;
}

interface DropdownData {
  trigger: string;
  menu: string;
  options: string[];
  type: 'native' | 'custom';
}

interface FormData {
  selector: string;
  action: string;
  method: string;
  fields: {
    selector: string;
    type: string;
    name: string;
    placeholder: string;
    required: boolean;
    validation: string[];
  }[];
  submitButton: string;
  classification: 'api_endpoint' | 'client_side' | 'page_navigation';
}

interface ScrollBehavior {
  smoothScroll: boolean;
  stickyElements: { selector: string; top: string }[];
  anchorLinks: { href: string; selector: string }[];
}

interface InteractionResult {
  url: string;
  timestamp: string;
  navigation: NavigationData;
  toggles: ToggleData[];
  modals: ModalData[];
  dropdowns: DropdownData[];
  forms: FormData[];
  scrollBehaviors: ScrollBehavior;
}

// ── Main Extractor ─────────────────────────────────────────────────────────────

async function extractInteractions(url: string, outputDir: string): Promise<InteractionResult> {
  return withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    log('Interactions', 'info', `Loading ${url}...`);
    await withRetry(() => page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }), { label: 'page.goto', retries: 2 });
    await page.waitForTimeout(2000);

    // ── Navigation ──
    log('Interactions', 'info', 'Extracting navigation links...');
    const navigation = await extractNavigation(page, url);

    // ── Toggles / Accordions ──
    log('Interactions', 'info', 'Detecting toggles and accordions...');
    const toggles = await extractToggles(page);

    // ── Modals / Dialogs ──
    log('Interactions', 'info', 'Detecting modals and dialogs...');
    const modals = await extractModals(page);

    // ── Dropdowns ──
    log('Interactions', 'info', 'Detecting dropdowns...');
    const dropdowns = await extractDropdowns(page);

    // ── Forms ──
    log('Interactions', 'info', 'Extracting form patterns...');
    const forms = await extractForms(page);

    // ── Scroll behaviors ──
    log('Interactions', 'info', 'Analyzing scroll behaviors...');
    const scrollBehaviors = await extractScrollBehaviors(page);

    const result: InteractionResult = {
      url,
      timestamp: new Date().toISOString(),
      navigation,
      toggles,
      modals,
      dropdowns,
      forms,
      scrollBehaviors,
    };

    const outputPath = path.join(outputDir, 'interactions.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    log('Interactions', 'info', `Results written to ${outputPath}`);
    log('Interactions', 'info', `Found: ${navigation.internal.length} internal links, ${toggles.length} toggles, ${modals.length} modals, ${dropdowns.length} dropdowns, ${forms.length} forms`);

    return result;
  });
}

// ── Navigation Extraction ──────────────────────────────────────────────────────

async function extractNavigation(page: Page, baseUrl: string): Promise<NavigationData> {
  const base = new URL(baseUrl);

  return await page.evaluate((origin: string) => {
    const internal: { href: string; text: string; selector: string }[] = [];
    const external: { href: string; text: string; selector: string }[] = [];
    const anchorLinks: { href: string; text: string; selector: string }[] = [];

    document.querySelectorAll('a[href]').forEach((a) => {
      const anchor = a as HTMLAnchorElement;
      const href = anchor.href;
      const text = anchor.textContent?.trim().slice(0, 100) || '';
      const id = a.id;
      const cls = Array.from(a.classList).slice(0, 3).join('.');
      const selector = id ? `#${id}` : cls ? `a.${cls}` : `a[href="${anchor.getAttribute('href')}"]`;

      try {
        const url = new URL(href);
        if (href.startsWith('#') || anchor.getAttribute('href')?.startsWith('#')) {
          anchorLinks.push({ href: anchor.getAttribute('href') ?? '', text, selector });
        } else if (url.origin === origin) {
          internal.push({ href: url.pathname + url.search, text, selector });
        } else {
          external.push({ href, text, selector });
        }
      } catch {
        // relative URL or invalid
        if (href.startsWith('#')) {
          anchorLinks.push({ href, text, selector });
        } else {
          internal.push({ href, text, selector });
        }
      }
    });

    return { internal, external, anchorLinks };
  }, base.origin);
}

// ── Toggle / Accordion Detection ───────────────────────────────────────────────

async function extractToggles(page: Page): Promise<ToggleData[]> {
  const toggles: ToggleData[] = [];

  // Native <details>/<summary>
  const detailsToggles = await page.evaluate(() => {
    const results: ToggleData[] = [];
    document.querySelectorAll('details').forEach((details) => {
      const summary = details.querySelector('summary');
      if (summary) {
        const id = details.id;
        const cls = Array.from(details.classList).slice(0, 3).join('.');
        results.push({
          trigger: summary.id ? `#${summary.id}` : `details${cls ? '.' + cls : ''} > summary`,
          target: id ? `#${id}` : `details${cls ? '.' + cls : ''}`,
          type: 'details',
          triggerText: summary.textContent?.trim().slice(0, 100) || '',
        });
      }
    });
    return results;
  });
  toggles.push(...detailsToggles);

  // ARIA-based toggles
  const ariaToggles = await page.evaluate(() => {
    const results: any[] = [];
    document.querySelectorAll('[aria-expanded]').forEach((el) => {
      const controls = el.getAttribute('aria-controls');
      const id = el.id;
      const tag = el.tagName.toLowerCase();
      const cls = Array.from(el.classList).slice(0, 3).join('.');
      const selector = id ? `#${id}` : cls ? `${tag}.${cls}` : tag;

      let targetSelector = '';
      if (controls) {
        targetSelector = `#${controls}`;
      }

      results.push({
        trigger: selector,
        target: targetSelector,
        type: 'toggle',
        triggerText: (el as HTMLElement).textContent?.trim().slice(0, 100) || '',
      });
    });
    return results;
  });
  toggles.push(...ariaToggles);

  // Click-test: find elements that toggle siblings visibility
  const clickToggles = await page.evaluate(() => {
    const results: any[] = [];
    // Look for common accordion patterns
    const containers = document.querySelectorAll('[class*="accordion"], [class*="Accordion"], [class*="faq"], [class*="FAQ"], [class*="collapse"], [class*="Collapse"]');
    containers.forEach((container) => {
      const headers = container.querySelectorAll('[class*="header"], [class*="title"], [class*="trigger"], [class*="question"], button, h3, h4');
      headers.forEach((header) => {
        const id = header.id;
        const tag = header.tagName.toLowerCase();
        const cls = Array.from(header.classList).slice(0, 3).join('.');
        const selector = id ? `#${id}` : cls ? `${tag}.${cls}` : '';
        if (selector) {
          results.push({
            trigger: selector,
            target: '',
            type: 'accordion',
            triggerText: (header as HTMLElement).textContent?.trim().slice(0, 100) || '',
          });
        }
      });
    });
    return results;
  });
  toggles.push(...clickToggles);

  return toggles;
}

// ── Modal / Dialog Detection ───────────────────────────────────────────────────

async function extractModals(page: Page): Promise<ModalData[]> {
  return await page.evaluate(() => {
    const modals: any[] = [];

    // Native dialogs
    document.querySelectorAll('dialog, [role="dialog"], [role="alertdialog"]').forEach((dialog) => {
      const id = dialog.id;
      const cls = Array.from(dialog.classList).slice(0, 3).join('.');
      const tag = dialog.tagName.toLowerCase();
      const dialogSelector = id ? `#${id}` : cls ? `${tag}.${cls}` : tag;

      // Find trigger via aria-controls
      let triggerSelector = '';
      let triggerText = '';
      if (id) {
        const trigger = document.querySelector(`[aria-controls="${id}"]`);
        if (trigger) {
          const tId = trigger.id;
          const tCls = Array.from(trigger.classList).slice(0, 3).join('.');
          const tTag = trigger.tagName.toLowerCase();
          triggerSelector = tId ? `#${tId}` : tCls ? `${tTag}.${tCls}` : '';
          triggerText = (trigger as HTMLElement).textContent?.trim().slice(0, 100) || '';
        }
      }

      modals.push({ trigger: triggerSelector, dialog: dialogSelector, triggerText });
    });

    // Common modal patterns by class name
    document.querySelectorAll('[class*="modal"], [class*="Modal"], [class*="popup"], [class*="Popup"], [class*="overlay"], [class*="Overlay"]').forEach((el) => {
      const style = window.getComputedStyle(el);
      // Only consider hidden elements (modals are usually hidden by default)
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        const id = el.id;
        const cls = Array.from(el.classList).slice(0, 3).join('.');
        const tag = el.tagName.toLowerCase();
        const selector = id ? `#${id}` : cls ? `${tag}.${cls}` : '';
        if (selector) {
          modals.push({ trigger: '', dialog: selector, triggerText: '' });
        }
      }
    });

    return modals;
  });
}

// ── Dropdown Detection ─────────────────────────────────────────────────────────

async function extractDropdowns(page: Page): Promise<DropdownData[]> {
  return await page.evaluate(() => {
    const dropdowns: any[] = [];

    // Native selects
    document.querySelectorAll('select').forEach((sel) => {
      const id = sel.id;
      const name = sel.name;
      const selector = id ? `#${id}` : name ? `select[name="${name}"]` : 'select';
      const options = Array.from(sel.options).map(o => o.textContent?.trim() || o.value);

      dropdowns.push({
        trigger: selector,
        menu: selector,
        options,
        type: 'native',
      });
    });

    // Custom dropdowns
    document.querySelectorAll('[role="listbox"], [role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="true"]').forEach((el) => {
      const id = el.id;
      const cls = Array.from(el.classList).slice(0, 3).join('.');
      const tag = el.tagName.toLowerCase();
      const selector = id ? `#${id}` : cls ? `${tag}.${cls}` : '';

      const controls = el.getAttribute('aria-controls');
      const menuSelector = controls ? `#${controls}` : '';

      const options: string[] = [];
      if (controls) {
        const menu = document.getElementById(controls);
        if (menu) {
          menu.querySelectorAll('[role="option"], li').forEach((opt) => {
            options.push((opt as HTMLElement).textContent?.trim() || '');
          });
        }
      }

      if (selector) {
        dropdowns.push({ trigger: selector, menu: menuSelector, options, type: 'custom' });
      }
    });

    return dropdowns;
  });
}

// ── Form Extraction ────────────────────────────────────────────────────────────

async function extractForms(page: Page): Promise<FormData[]> {
  return await page.evaluate(() => {
    const forms: any[] = [];

    document.querySelectorAll('form').forEach((form) => {
      const id = form.id;
      const cls = Array.from(form.classList).slice(0, 3).join('.');
      const formSelector = id ? `#${id}` : cls ? `form.${cls}` : 'form';

      const fields: any[] = [];
      form.querySelectorAll('input, select, textarea').forEach((field: any) => {
        const fId = field.id;
        const fName = field.name;
        const fSelector = fId ? `#${fId}` : fName ? `[name="${fName}"]` : field.tagName.toLowerCase();

        const validation: string[] = [];
        if (field.required) validation.push('required');
        if (field.pattern) validation.push(`pattern:${field.pattern}`);
        if (field.minLength > 0) validation.push(`minLength:${field.minLength}`);
        if (field.maxLength > 0 && field.maxLength < 524288) validation.push(`maxLength:${field.maxLength}`);
        if (field.min) validation.push(`min:${field.min}`);
        if (field.max) validation.push(`max:${field.max}`);
        if (field.type === 'email') validation.push('email');
        if (field.type === 'url') validation.push('url');
        if (field.type === 'tel') validation.push('tel');

        fields.push({
          selector: fSelector,
          type: field.type || field.tagName.toLowerCase(),
          name: fName || '',
          placeholder: field.placeholder || '',
          required: field.required || false,
          validation,
        });
      });

      const submitBtn = form.querySelector('[type="submit"], button:not([type])');
      const submitSelector = submitBtn
        ? (submitBtn.id ? `#${submitBtn.id}` : submitBtn.className ? `button.${Array.from(submitBtn.classList).slice(0, 2).join('.')}` : 'button[type="submit"]')
        : '';

      const action = form.action || '';
      let classification: 'api_endpoint' | 'client_side' | 'page_navigation' = 'page_navigation';
      if (!action || action === '#' || action === '') {
        classification = 'client_side';
      } else if (action.startsWith('/api/') || action.includes('/api/')) {
        classification = 'api_endpoint';
      } else {
        try {
          const formUrl = new URL(action, window.location.href);
          const pageUrl = new URL(window.location.href);
          if (formUrl.origin !== pageUrl.origin) classification = 'api_endpoint';
        } catch {
          classification = 'page_navigation';
        }
      }

      forms.push({
        selector: formSelector,
        action,
        method: form.method?.toUpperCase() || 'GET',
        fields,
        submitButton: submitSelector,
        classification,
      });
    });

    return forms;
  });
}

// ── Scroll Behavior Extraction ─────────────────────────────────────────────────

async function extractScrollBehaviors(page: Page): Promise<ScrollBehavior> {
  return await page.evaluate(() => {
    const html = document.documentElement;
    const htmlStyle = window.getComputedStyle(html);
    const smoothScroll = htmlStyle.scrollBehavior === 'smooth';

    // Find sticky elements
    const stickyElements: { selector: string; top: string }[] = [];
    document.querySelectorAll('*').forEach((el) => {
      const style = window.getComputedStyle(el);
      if (style.position === 'sticky' || style.position === '-webkit-sticky') {
        const id = el.id;
        const cls = Array.from(el.classList).slice(0, 3).join('.');
        const tag = el.tagName.toLowerCase();
        const selector = id ? `#${id}` : cls ? `${tag}.${cls}` : tag;
        stickyElements.push({ selector, top: style.top });
      }
    });

    // Find anchor links
    const anchorLinks: { href: string; selector: string }[] = [];
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
      const anchor = a as HTMLAnchorElement;
      const href = anchor.getAttribute('href') || '';
      if (href !== '#') {
        const id = a.id;
        const cls = Array.from(a.classList).slice(0, 3).join('.');
        anchorLinks.push({
          href,
          selector: id ? `#${id}` : cls ? `a.${cls}` : `a[href="${href}"]`,
        });
      }
    });

    return { smoothScroll, stickyElements, anchorLinks };
  });
}

export { extractInteractions };
if (require.main === module) {
  // ── CLI Entry ──────────────────────────────────────────────────────────────────

  const args = process.argv.slice(2);
  const url = args[0];
  const outputDir = args[1] || path.resolve(process.cwd(), 'output');

  if (!url) {
    log('Interactions', 'error', 'Usage: ts-node extract-interactions.ts <url> [output-dir]');
    process.exit(1);
  }

  extractInteractions(url, outputDir)
    .then(() => {
      log('Interactions', 'info', 'Done.');
      process.exit(0);
    })
    .catch((err) => {
      log('Interactions', 'error', err);
      process.exit(1);
    });
}

import { chromium, Page } from 'playwright';
import { textResponse, validateArgs, validateToolUrl, withNextSteps } from '../helpers';
import { InteractInput } from '../schemas';

// ── Types ───────────────────────────────────────────────────────────────────

interface Action {
  type: 'click' | 'type' | 'hover' | 'scroll' | 'wait' | 'select' | 'focus' | 'screenshot';
  selector?: string;
  value?: string;
  position?: { x?: number; y?: number; selector?: string };
  duration?: number;
  label?: string;
}

interface SnapshotElement {
  tag: string;
  selector: string;
  rect: { x: number; y: number; width: number; height: number };
  visible: boolean;
  styles: Record<string, string>;
}

interface PageSnapshot {
  elements: SnapshotElement[];
  documentHeight: number;
  scrollY: number;
}

interface ActionResult {
  action: { type: string; selector?: string; label?: string };
  index: number;
  success: boolean;
  error?: string;
  screenshot?: string;
  diff: {
    appeared: { tag: string; selector: string; text?: string }[];
    disappeared: string[];
    styleChanges: { selector: string; property: string; from: string; to: string }[];
    domMutations: { added: number; removed: number; attributeChanges: number };
  };
  consoleMessages: { type: string; text: string }[];
  networkRequests: { method: string; url: string; status?: number; resourceType: string }[];
  timing: { actionMs: number; captureMs: number };
}

// ── Snapshot Helpers ─────────────────────────────────────────────────────────

const SNAPSHOT_STYLES = [
  'display', 'opacity', 'visibility', 'transform',
  'backgroundColor', 'color', 'width', 'height', 'position',
];

async function capturePageSnapshot(page: Page): Promise<PageSnapshot> {
  return page.evaluate((styleProps) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const buffer = 200;
    const results: { tag: string; selector: string; rect: { x: number; y: number; width: number; height: number }; visible: boolean; styles: Record<string, string> }[] = [];

    const all = document.querySelectorAll('*');
    let count = 0;
    for (const el of Array.from(all)) {
      if (count >= 100) break;
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'meta', 'link', 'noscript', 'br', 'wbr'].includes(tag)) continue;

      const rect = el.getBoundingClientRect();
      // Skip elements outside viewport + buffer
      if (rect.bottom < -buffer || rect.top > vh + buffer || rect.right < -buffer || rect.left > vw + buffer) continue;
      if (rect.width === 0 && rect.height === 0) continue;

      const cs = window.getComputedStyle(el);
      const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0;

      // Build a minimal unique selector
      // Filter classes with special chars (Tailwind prefixes like phone:, sm:, hover:)
      let selector = '';
      if (el.id) {
        selector = `#${CSS.escape(el.id)}`;
      } else {
        const safeClasses = Array.from(el.classList)
          .filter(c => !/^\d/.test(c) && !/[:\\/@]/.test(c))
          .slice(0, 2);
        selector = safeClasses.length > 0 ? `${tag}.${safeClasses.map(c => CSS.escape(c)).join('.')}` : tag;
        // Disambiguate with nth-of-type if needed
        try {
          const siblings = el.parentElement?.querySelectorAll(`:scope > ${selector}`);
          if (siblings && siblings.length > 1) {
            const idx = Array.from(siblings).indexOf(el) + 1;
            selector = `${selector}:nth-of-type(${idx})`;
          }
        } catch { /* selector still invalid — use tag:nth-of-type fallback */
          const parent = el.parentElement;
          if (parent) {
            const sameTag = Array.from(parent.children).filter(c => c.tagName === el.tagName);
            const idx = sameTag.indexOf(el) + 1;
            selector = `${tag}:nth-of-type(${idx})`;
          }
        }
      }

      const styles: Record<string, string> = {};
      for (const p of styleProps) {
        const val = cs.getPropertyValue(p.replace(/([A-Z])/g, '-$1').toLowerCase());
        if (val) styles[p] = val;
      }

      results.push({
        tag,
        selector,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        visible,
        styles,
      });
      count++;
    }

    return {
      elements: results,
      documentHeight: document.documentElement.scrollHeight,
      scrollY: window.scrollY,
    };
  }, SNAPSHOT_STYLES);
}

async function installMutationObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    interface DseMutations { added: number; removed: number; attributeChanges: number }
    interface DseWindow { __dse_mutations: DseMutations | null; __dse_observer: MutationObserver | null }
    const w = window as unknown as DseWindow;
    w.__dse_mutations = { added: 0, removed: 0, attributeChanges: 0 };
    const observer = new MutationObserver((mutations) => {
      const m = w.__dse_mutations;
      if (!m) return;
      for (const mut of mutations) {
        if (mut.type === 'childList') {
          m.added += mut.addedNodes.length;
          m.removed += mut.removedNodes.length;
        } else if (mut.type === 'attributes') {
          m.attributeChanges++;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    w.__dse_observer = observer;
  });
}

async function collectMutations(page: Page): Promise<{ added: number; removed: number; attributeChanges: number }> {
  return page.evaluate(() => {
    interface DseMutations { added: number; removed: number; attributeChanges: number }
    interface DseWindow { __dse_mutations: DseMutations | null; __dse_observer: MutationObserver | null }
    const w = window as unknown as DseWindow;
    const obs = w.__dse_observer;
    if (obs) obs.disconnect();
    const m: DseMutations = w.__dse_mutations || { added: 0, removed: 0, attributeChanges: 0 };
    w.__dse_mutations = null;
    w.__dse_observer = null;
    return m;
  });
}

// ── Action Executor ─────────────────────────────────────────────────────────

async function performAction(page: Page, action: Action): Promise<{ success: boolean; error?: string }> {
  try {
    switch (action.type) {
      case 'click': {
        if (!action.selector) throw new Error('click requires a selector');
        await page.click(action.selector, { timeout: 5000 });
        // If navigation occurred, wait for it
        await page.waitForLoadState('networkidle').catch(() => {});
        break;
      }
      case 'type': {
        if (!action.selector) throw new Error('type requires a selector');
        if (!action.value) throw new Error('type requires a value');
        await page.fill(action.selector, action.value, { timeout: 5000 });
        break;
      }
      case 'hover': {
        if (!action.selector) throw new Error('hover requires a selector');
        await page.hover(action.selector, { timeout: 5000 });
        break;
      }
      case 'scroll': {
        if (action.position?.selector) {
          await page.locator(action.position.selector).scrollIntoViewIfNeeded({ timeout: 5000 });
        } else {
          const x = action.position?.x ?? 0;
          const y = action.position?.y ?? 0;
          await page.evaluate(({ x, y }) => window.scrollTo(x, y), { x, y });
        }
        break;
      }
      case 'wait': {
        await page.waitForTimeout(action.duration ?? 1000);
        break;
      }
      case 'select': {
        if (!action.selector) throw new Error('select requires a selector');
        if (!action.value) throw new Error('select requires a value');
        await page.selectOption(action.selector, action.value, { timeout: 5000 });
        break;
      }
      case 'focus': {
        if (!action.selector) throw new Error('focus requires a selector');
        await page.focus(action.selector, { timeout: 5000 });
        break;
      }
      case 'screenshot': {
        // Captured separately in the main loop
        break;
      }
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

// ── Diff ────────────────────────────────────────────────────────────────────

function computeDiff(
  before: PageSnapshot,
  after: PageSnapshot,
  mutations: { added: number; removed: number; attributeChanges: number },
) {
  const beforeMap = new Map<string, SnapshotElement>();
  const afterMap = new Map<string, SnapshotElement>();

  for (const el of before.elements) beforeMap.set(el.selector, el);
  for (const el of after.elements) afterMap.set(el.selector, el);

  // Appeared: visible in after but not in before (or was hidden)
  const appeared: { tag: string; selector: string; text?: string }[] = [];
  for (const [sel, el] of afterMap) {
    const prev = beforeMap.get(sel);
    if (el.visible && (!prev || !prev.visible)) {
      appeared.push({ tag: el.tag, selector: el.selector });
    }
  }

  // Disappeared: visible in before but not in after (or now hidden)
  const disappeared: string[] = [];
  for (const [sel, el] of beforeMap) {
    const next = afterMap.get(sel);
    if (el.visible && (!next || !next.visible)) {
      disappeared.push(sel);
    }
  }

  // Style changes on elements present in both
  const styleChanges: { selector: string; property: string; from: string; to: string }[] = [];
  for (const [sel, beforeEl] of beforeMap) {
    const afterEl = afterMap.get(sel);
    if (!afterEl) continue;
    for (const prop of SNAPSHOT_STYLES) {
      const fromVal = beforeEl.styles[prop] || '';
      const toVal = afterEl.styles[prop] || '';
      if (fromVal !== toVal) {
        styleChanges.push({ selector: sel, property: prop, from: fromVal, to: toVal });
      }
    }
  }

  return { appeared: appeared.slice(0, 50), disappeared: disappeared.slice(0, 50), styleChanges: styleChanges.slice(0, 100), domMutations: mutations };
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handleInteract(rawArgs: unknown) {
  const args = validateArgs(InteractInput, rawArgs);
  validateToolUrl(args.url);
  const { url, actions } = args;
  const capture = args.capture || 'diff';

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage();

    // Per-action collectors
    let consoleMessages: { type: string; text: string }[] = [];
    let networkRequests: { method: string; url: string; status?: number; resourceType: string }[] = [];
    let collecting = false;

    page.on('console', (msg) => {
      if (collecting) consoleMessages.push({ type: msg.type(), text: msg.text().slice(0, 200) });
    });
    page.on('response', (resp) => {
      if (collecting) {
        networkRequests.push({
          method: resp.request().method(),
          url: resp.url().slice(0, 200),
          status: resp.status(),
          resourceType: resp.request().resourceType(),
        });
      }
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const results: ActionResult[] = [];

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];

      // Reset collectors
      consoleMessages = [];
      networkRequests = [];
      collecting = true;

      const isPassive = action.type === 'wait' || action.type === 'screenshot';

      // 1. Snapshot before (skip for passive actions)
      const before = isPassive ? null : await capturePageSnapshot(page);

      // 2. Start mutation observer
      if (!isPassive) await installMutationObserver(page);

      // 3. Perform action
      const actionStart = Date.now();
      const { success, error } = await performAction(page, action);
      const actionMs = Date.now() - actionStart;

      // 4. Settle time for animations/network
      if (!isPassive) await page.waitForTimeout(action.type === 'hover' ? 400 : 500);

      // 5. Snapshot after + collect mutations
      const captureStart = Date.now();
      const after = (!isPassive && before) ? await capturePageSnapshot(page) : null;
      const mutations = !isPassive ? await collectMutations(page) : { added: 0, removed: 0, attributeChanges: 0 };
      const captureMs = Date.now() - captureStart;

      collecting = false;

      // 6. Diff (only for non-passive actions)
      const emptyDiff = { appeared: [] as { tag: string; selector: string; text?: string }[], disappeared: [] as string[], styleChanges: [] as { selector: string; property: string; from: string; to: string }[], domMutations: { added: 0, removed: 0, attributeChanges: 0 } };
      const diff = (before && after) ? computeDiff(before, after, mutations) : emptyDiff;

      // 7. Screenshot — ONLY on explicit screenshot actions
      let screenshot: string | undefined;
      if (action.type === 'screenshot') {
        const buf = await page.screenshot({ type: 'jpeg', quality: 60 });
        screenshot = buf.toString('base64');
      }

      // Filter out static asset noise from network requests
      const meaningfulRequests = networkRequests
        .filter(r => !['image', 'font', 'stylesheet', 'media'].includes(r.resourceType))
        .slice(0, 20);

      results.push({
        action: { type: action.type, selector: action.selector, label: action.label },
        index: i,
        success,
        error,
        screenshot,
        diff,
        consoleMessages: consoleMessages.slice(0, 20),
        networkRequests: meaningfulRequests,
        timing: { actionMs, captureMs },
      });
    }

    // Build compact response — strip empty fields
    const compactResults = results.map(r => {
      const out: Record<string, unknown> = {
        action: r.action,
        success: r.success,
      };
      if (r.error) out.error = r.error;
      if (r.screenshot) out.screenshot = `[image #${r.index}]`;

      // Only include diff if something changed
      const d = r.diff;
      const hasChanges = d.appeared.length > 0 || d.disappeared.length > 0 || d.styleChanges.length > 0 || d.domMutations.added > 0 || d.domMutations.removed > 0;
      if (hasChanges) out.diff = d;

      if (r.consoleMessages.length > 0) out.consoleMessages = r.consoleMessages;
      if (r.networkRequests.length > 0) out.networkRequests = r.networkRequests;
      if (r.timing.actionMs > 100) out.timing = r.timing;

      return out;
    });

    const hasScreenshots = results.some(r => r.screenshot);

    if (hasScreenshots) {
      const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [];
      content.push({ type: 'text', text: JSON.stringify({ url, results: compactResults }, null, 2) });
      for (const r of results) {
        if (r.screenshot) {
          content.push({ type: 'image', data: r.screenshot, mimeType: 'image/jpeg' });
        }
      }
      return { content };
    }

    return withNextSteps({ url, results: compactResults }, ["Run interact with additional actions to explore further", "Use captured state changes to inform generate_component"]);
  } finally {
    await browser.close();
  }
}

import { Page } from 'playwright';
import { runFullAccessibilityAudit, AuditableElement, FullAccessibilityAuditResult } from '../extras/accessibility';

interface AccessibilityData {
  landmarks: { role: string; label: string; selector: string }[];
  headingHierarchy: { level: number; text: string; selector: string }[];
  ariaPatterns: { selector: string; ariaAttributes: Record<string, string> }[];
  focusOrder: string[];
  contrastIssues: { selector: string; foreground: string; background: string; ratio: number }[];
  missingAlt: string[];
  audit: FullAccessibilityAuditResult;
}

// ── Accessibility Analysis ─────────────────────────────────────────────────────

export async function analyzeAccessibility(page: Page): Promise<AccessibilityData> {
  // Collect raw data from the page via Playwright evaluate
  type RawLandmark = { role: string; label: string; selector: string };
  type RawHeading = { level: number; text: string; selector: string };
  type RawAriaPattern = { selector: string; ariaAttributes: Record<string, string> };
  type RawAuditElement = {
    tag: string;
    text: string;
    attributes: Record<string, string>;
    styles: Record<string, string>;
    foregroundColor?: string;
    backgroundColor?: string;
  };
  type PageEvalResult = {
    landmarks: RawLandmark[];
    headingHierarchy: RawHeading[];
    ariaPatterns: RawAriaPattern[];
    focusOrder: string[];
    contrastIssues: never[];
    missingAlt: string[];
    auditElements: RawAuditElement[];
  };
  const pageData = await page.evaluate((): PageEvalResult => {
    const landmarks: { role: string; label: string; selector: string }[] = [];
    const landmarkRoles = ['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'search', 'form', 'region'];
    for (const role of landmarkRoles) {
      document.querySelectorAll(`[role="${role}"], ${role === 'banner' ? 'header' : role === 'contentinfo' ? 'footer' : role === 'navigation' ? 'nav' : role === 'complementary' ? 'aside' : role}`)
        .forEach((el) => {
          landmarks.push({
            role,
            label: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || '',
            selector: el.id ? `#${el.id}` : el.tagName.toLowerCase(),
          });
        });
    }

    const headingHierarchy: { level: number; text: string; selector: string }[] = [];
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
      headingHierarchy.push({
        level: parseInt(h.tagName[1]),
        text: (h.textContent || '').trim().slice(0, 100),
        selector: h.id ? `#${h.id}` : `${h.tagName.toLowerCase()}`,
      });
    });

    const ariaPatterns: { selector: string; ariaAttributes: Record<string, string> }[] = [];
    document.querySelectorAll('[aria-label], [aria-labelledby], [aria-describedby], [aria-expanded], [aria-hidden], [aria-live], [aria-controls], [aria-haspopup]')
      .forEach((el) => {
        const attrs: Record<string, string> = {};
        for (const attr of Array.from(el.attributes)) {
          if (attr.name.startsWith('aria-')) {
            attrs[attr.name] = attr.value;
          }
        }
        ariaPatterns.push({
          selector: el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${Array.from(el.classList).slice(0, 2).join('.')}`,
          ariaAttributes: attrs,
        });
      });

    const focusOrder: string[] = [];
    document.querySelectorAll('[tabindex]').forEach((el) => {
      const idx = parseInt(el.getAttribute('tabindex') || '0');
      const sel = el.id ? `#${el.id}` : el.tagName.toLowerCase();
      focusOrder.push(`${sel}[tabindex=${idx}]`);
    });

    const missingAlt: string[] = [];
    document.querySelectorAll('img').forEach((img) => {
      if (!img.getAttribute('alt') && img.getAttribute('alt') !== '') {
        missingAlt.push(img.src?.slice(0, 100) || img.id || 'unknown img');
      }
    });

    const contrastIssues: never[] = [];

    // Collect element data for the full accessibility audit
    const auditElements: { tag: string; text: string; attributes: Record<string, string>; styles: Record<string, string>; foregroundColor?: string; backgroundColor?: string }[] = [];
    const allElements = document.querySelectorAll('*');
    const limit = Math.min(allElements.length, 2000); // cap to avoid memory issues
    for (let i = 0; i < limit; i++) {
      const el = allElements[i] as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const computed = window.getComputedStyle(el);
      const attrs: Record<string, string> = {};
      for (const attr of Array.from(el.attributes)) {
        attrs[attr.name] = attr.value;
      }
      const styles: Record<string, string> = {};
      const stylesToCapture = ['outline', 'boxShadow', 'outlineStyle', 'outlineWidth', 'outlineColor'];
      for (const prop of stylesToCapture) {
        const val = computed.getPropertyValue(prop.replace(/([A-Z])/g, '-$1').toLowerCase());
        if (val) styles[prop] = val;
      }

      auditElements.push({
        tag,
        text: (el.textContent || '').trim().slice(0, 200),
        attributes: attrs,
        styles,
        foregroundColor: computed.color || undefined,
        backgroundColor: computed.backgroundColor || undefined,
      });
    }

    return {
      landmarks,
      headingHierarchy,
      ariaPatterns: ariaPatterns.slice(0, 100),
      focusOrder,
      contrastIssues,
      missingAlt,
      auditElements,
    };
  });

  // Run the full accessibility audit using our Node.js module
  const audit = runFullAccessibilityAudit(pageData.auditElements as AuditableElement[]);

  // Merge contrast issues found by the audit back into the legacy format
  const contrastIssues = pageData.auditElements
    .filter((_: RawAuditElement, i: number) => i < pageData.auditElements.length && pageData.auditElements[i].foregroundColor && pageData.auditElements[i].backgroundColor)
    .map((el: RawAuditElement, i: number) => {
      const result = audit.contrastResults[i];
      if (!result || result.AA) return null;
      return {
        selector: el.attributes?.id ? `#${el.attributes.id}` : el.tag,
        foreground: el.foregroundColor,
        background: el.backgroundColor,
        ratio: result.ratio,
      };
    })
    .filter((x): x is { selector: string; foreground: string; background: string; ratio: number } => x !== null)
    .slice(0, 50);

  return {
    landmarks: pageData.landmarks,
    headingHierarchy: pageData.headingHierarchy,
    ariaPatterns: pageData.ariaPatterns,
    focusOrder: pageData.focusOrder,
    contrastIssues,
    missingAlt: pageData.missingAlt,
    audit,
  };
}

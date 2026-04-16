/**
 * Accessibility audit module for the design-system-extractor pipeline.
 *
 * Provides WCAG 2.1 color contrast checking, heading hierarchy validation,
 * alt text auditing, keyboard navigation mapping, screen reader compatibility
 * checks, and an overall accessibility score.
 */

// ── Color Parsing ─────────────────────────────────────────────────────────────

const RGB_RE = /rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/;
const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const HSL_RE = /hsla?\(\s*([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)/;

interface ColorRGB {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseAlphaValue(raw: string | undefined): number {
  if (raw === undefined) return 1;
  if (raw.endsWith('%')) return parseFloat(raw) / 100;
  return parseFloat(raw);
}

function parseColor(value: string): ColorRGB | null {
  const trimmed = value.trim().toLowerCase();

  // Named colors — common ones
  const named: Record<string, ColorRGB> = {
    white: { r: 255, g: 255, b: 255, a: 1 },
    black: { r: 0, g: 0, b: 0, a: 1 },
    transparent: { r: 0, g: 0, b: 0, a: 0 },
  };
  if (named[trimmed]) return named[trimmed];

  // rgb/rgba
  const rgbMatch = trimmed.match(RGB_RE);
  if (rgbMatch) {
    return {
      r: Math.round(parseFloat(rgbMatch[1])),
      g: Math.round(parseFloat(rgbMatch[2])),
      b: Math.round(parseFloat(rgbMatch[3])),
      a: parseAlphaValue(rgbMatch[4]),
    };
  }

  // hex
  const hexMatch = trimmed.match(HEX_RE);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    } else if (hex.length === 4) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  // hsl/hsla
  const hslMatch = trimmed.match(HSL_RE);
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]) / 360;
    const s = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;
    const a = parseAlphaValue(hslMatch[4]);

    // HSL to RGB conversion
    let r: number, g: number, b: number;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p: number, q: number, t: number): number => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }

    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255),
      a,
    };
  }

  return null;
}

// ── 1. Color Contrast Checking (WCAG 2.1) ────────────────────────────────────

export interface ContrastResult {
  ratio: number;
  AA: boolean;
  AAA: boolean;
  AALarge: boolean;
  AAALarge: boolean;
}

/**
 * Calculate relative luminance per WCAG 2.1 definition.
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
function relativeLuminance(color: ColorRGB): number {
  const srgb = [color.r / 255, color.g / 255, color.b / 255];
  const [rLinear, gLinear, bLinear] = srgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

/**
 * Check color contrast between a foreground and background color.
 * Colors can be any CSS color string (rgb, rgba, hex, hsl, hsla, or named).
 *
 * Returns the contrast ratio and pass/fail for each WCAG level.
 * - AA normal text: >= 4.5:1
 * - AA large text: >= 3:1
 * - AAA normal text: >= 7:1
 * - AAA large text: >= 4.5:1
 */
export function checkColorContrast(foreground: string, background: string): ContrastResult {
  const fg = parseColor(foreground);
  const bg = parseColor(background);

  if (!fg || !bg) {
    return { ratio: 0, AA: false, AAA: false, AALarge: false, AAALarge: false };
  }

  // If foreground has alpha, composite over background
  const compositeFg: ColorRGB = {
    r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
    g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
    b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
    a: 1,
  };

  const lumFg = relativeLuminance(compositeFg);
  const lumBg = relativeLuminance(bg);

  const lighter = Math.max(lumFg, lumBg);
  const darker = Math.min(lumFg, lumBg);
  const ratio = Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;

  return {
    ratio,
    AA: ratio >= 4.5,
    AAA: ratio >= 7,
    AALarge: ratio >= 3,
    AAALarge: ratio >= 4.5,
  };
}

// ── 2. Heading Hierarchy Validation ───────────────────────────────────────────

export interface HeadingValidationResult {
  valid: boolean;
  issues: string[];
}

/**
 * Validate heading hierarchy (h1-h6).
 * - Exactly one h1 should exist
 * - Heading levels should not be skipped (h1 -> h3 without h2 is invalid)
 */
export function validateHeadingHierarchy(
  elements: { tag: string; text: string }[],
): HeadingValidationResult {
  const issues: string[] = [];
  const headings = elements.filter((el) => /^h[1-6]$/i.test(el.tag));

  if (headings.length === 0) {
    issues.push('No headings found on the page');
    return { valid: false, issues };
  }

  // Check for exactly one h1
  const h1s = headings.filter((h) => h.tag.toLowerCase() === 'h1');
  if (h1s.length === 0) {
    issues.push('No h1 element found — every page should have exactly one h1');
  } else if (h1s.length > 1) {
    issues.push(
      `Found ${h1s.length} h1 elements — there should be exactly one. Texts: ${h1s.map((h) => `"${h.text}"`).join(', ')}`,
    );
  }

  // Check for skipped levels
  let previousLevel = 0;
  for (const heading of headings) {
    const level = parseInt(heading.tag[1], 10);
    if (previousLevel > 0 && level > previousLevel + 1) {
      const skipped: string[] = [];
      for (let i = previousLevel + 1; i < level; i++) {
        skipped.push(`h${i}`);
      }
      issues.push(
        `Heading level skipped: h${previousLevel} -> h${level} (missing ${skipped.join(', ')}) at "${heading.text}"`,
      );
    }
    previousLevel = level;
  }

  return { valid: issues.length === 0, issues };
}

// ── 3. Alt Text Audit ─────────────────────────────────────────────────────────

export interface AltTextAuditResult {
  total: number;
  missing: number;
  empty: number;
  decorative: number;
  elements: { selector: string; issue: string }[];
}

/**
 * Audit alt text on image elements.
 * - Missing alt attribute is an error
 * - Empty alt="" is acceptable (marks image as decorative) but noted
 */
export function auditAltText(
  elements: { tag: string; attributes: Record<string, string> }[],
): AltTextAuditResult {
  const images = elements.filter((el) => el.tag.toLowerCase() === 'img');
  const result: AltTextAuditResult = {
    total: images.length,
    missing: 0,
    empty: 0,
    decorative: 0,
    elements: [],
  };

  for (const img of images) {
    const attrs = img.attributes;
    const selector = attrs.id
      ? `img#${attrs.id}`
      : attrs.class
        ? `img.${attrs.class.split(/\s+/)[0]}`
        : attrs.src
          ? `img[src="${attrs.src.slice(0, 80)}"]`
          : 'img';

    if (!('alt' in attrs)) {
      result.missing++;
      result.elements.push({
        selector,
        issue: 'Missing alt attribute — screen readers cannot describe this image',
      });
    } else if (attrs.alt === '') {
      result.empty++;
      result.decorative++;
      result.elements.push({
        selector,
        issue: 'Empty alt="" — image is marked as decorative',
      });
    }
  }

  return result;
}

// ── 4. Keyboard Navigation Audit ──────────────────────────────────────────────

export interface KeyboardNavigationAuditResult {
  focusableElements: number;
  missingTabindex: number;
  negativeTabindex: number;
  customFocusStyles: number;
  issues: string[];
}

// Elements that are natively focusable
const NATIVELY_FOCUSABLE = new Set([
  'a', 'button', 'input', 'select', 'textarea', 'details', 'summary',
]);

// Elements that are interactive and should be focusable
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'tab', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'option', 'switch', 'textbox',
  'combobox', 'listbox', 'slider', 'spinbutton', 'searchbox',
  'treeitem',
]);

/**
 * Audit keyboard navigation.
 * - Check that interactive elements are focusable
 * - Flag tabindex usage (negative tabindex removes from tab order)
 * - Check for custom :focus styles
 */
export function auditKeyboardNavigation(
  elements: { tag: string; attributes: Record<string, string>; styles: Record<string, string> }[],
): KeyboardNavigationAuditResult {
  const issues: string[] = [];
  let focusableElements = 0;
  let missingTabindex = 0;
  let negativeTabindex = 0;
  let customFocusStyles = 0;

  for (const el of elements) {
    const tag = el.tag.toLowerCase();
    const attrs = el.attributes;
    const role = attrs.role;
    const tabindex = attrs.tabindex;
    const hasHref = 'href' in attrs;

    // Determine if the element should be focusable
    const isNativelyFocusable =
      (NATIVELY_FOCUSABLE.has(tag) && (tag !== 'a' || hasHref)) ||
      attrs.contenteditable === 'true';
    const hasInteractiveRole = role ? INTERACTIVE_ROLES.has(role) : false;
    const hasClickHandler = 'onclick' in attrs;
    const shouldBeFocusable = isNativelyFocusable || hasInteractiveRole || hasClickHandler;

    if (shouldBeFocusable) {
      // Check if actually focusable
      if (tabindex !== undefined) {
        const tabIdx = parseInt(tabindex, 10);
        if (tabIdx >= 0) {
          focusableElements++;
        } else {
          negativeTabindex++;
          const selector = attrs.id ? `#${attrs.id}` : `${tag}${attrs.class ? '.' + attrs.class.split(/\s+/)[0] : ''}`;
          issues.push(
            `${selector} has tabindex="${tabindex}" — removed from tab order but is interactive`,
          );
        }
      } else if (isNativelyFocusable) {
        focusableElements++;
      } else {
        // Has interactive role or click handler but no tabindex and not natively focusable
        missingTabindex++;
        const selector = attrs.id ? `#${attrs.id}` : `${tag}${attrs.class ? '.' + attrs.class.split(/\s+/)[0] : ''}`;
        issues.push(
          `${selector} has ${hasInteractiveRole ? `role="${role}"` : 'onclick handler'} but is not keyboard-focusable (needs tabindex="0")`,
        );
      }
    } else if (tabindex !== undefined) {
      // Non-interactive element with tabindex
      const tabIdx = parseInt(tabindex, 10);
      if (tabIdx >= 0) {
        focusableElements++;
      }
      if (tabIdx < 0) {
        negativeTabindex++;
      }
    }

    // Check for custom focus styles (heuristic: outline or box-shadow in styles)
    const styles = el.styles;
    if (shouldBeFocusable && styles) {
      const hasOutline = styles.outline && styles.outline !== 'none' && styles.outline !== '0';
      const hasBoxShadow = styles.boxShadow && styles.boxShadow !== 'none';
      if (hasOutline || hasBoxShadow) {
        customFocusStyles++;
      }
    }
  }

  if (focusableElements === 0 && elements.length > 0) {
    issues.push('No focusable elements detected on the page');
  }

  return {
    focusableElements,
    missingTabindex,
    negativeTabindex,
    customFocusStyles,
    issues,
  };
}

// ── 5. Screen Reader Compatibility Check ──────────────────────────────────────

export interface ScreenReaderAuditResult {
  ariaUsage: number;
  landmarkRoles: string[];
  liveRegions: number;
  issues: string[];
}

const LANDMARK_ROLES = new Set([
  'banner', 'navigation', 'main', 'complementary', 'contentinfo',
  'search', 'form', 'region',
]);

// HTML elements that implicitly have landmark roles
const IMPLICIT_LANDMARKS: Record<string, string> = {
  header: 'banner',
  nav: 'navigation',
  main: 'main',
  aside: 'complementary',
  footer: 'contentinfo',
  form: 'form',
  section: 'region',
};

/**
 * Audit screen reader compatibility.
 * - Check for ARIA landmarks and roles
 * - Check for aria-live regions
 * - Check that interactive elements have accessible labels
 */
export function auditScreenReader(
  elements: { tag: string; attributes: Record<string, string> }[],
): ScreenReaderAuditResult {
  const issues: string[] = [];
  let ariaUsage = 0;
  const landmarkRolesFound = new Set<string>();
  let liveRegions = 0;

  for (const el of elements) {
    const tag = el.tag.toLowerCase();
    const attrs = el.attributes;

    // Count ARIA attribute usage
    const ariaAttrs = Object.keys(attrs).filter((a) => a.startsWith('aria-'));
    ariaUsage += ariaAttrs.length;

    // Check explicit landmark roles
    if (attrs.role && LANDMARK_ROLES.has(attrs.role)) {
      landmarkRolesFound.add(attrs.role);
    }

    // Check implicit landmark roles
    if (IMPLICIT_LANDMARKS[tag]) {
      landmarkRolesFound.add(IMPLICIT_LANDMARKS[tag]);
    }

    // Check for live regions
    if (attrs['aria-live'] || attrs.role === 'alert' || attrs.role === 'status' || attrs.role === 'log') {
      liveRegions++;
    }

    // Check interactive elements have accessible labels
    const isInteractive =
      NATIVELY_FOCUSABLE.has(tag) ||
      (attrs.role && INTERACTIVE_ROLES.has(attrs.role));

    if (isInteractive) {
      const hasLabel =
        attrs['aria-label'] ||
        attrs['aria-labelledby'] ||
        attrs.title;

      // For inputs, also check for associated label via id
      const hasAssociatedLabel = tag === 'input' || tag === 'select' || tag === 'textarea'
        ? attrs.id // Could have a <label for="id"> — we note it but cannot fully verify without DOM traversal
        : false;

      if (!hasLabel && !hasAssociatedLabel && tag !== 'a' && tag !== 'button') {
        // Anchors and buttons get their label from text content, which we
        // cannot reliably check here. For form controls, flag it.
        const selector = attrs.id
          ? `#${attrs.id}`
          : `${tag}${attrs.class ? '.' + attrs.class.split(/\s+/)[0] : ''}`;
        issues.push(
          `${selector} is interactive but may lack an accessible label (no aria-label, aria-labelledby, or title)`,
        );
      }
    }
  }

  // Check for essential landmarks
  const essentialLandmarks = ['main', 'navigation'];
  for (const landmark of essentialLandmarks) {
    if (!landmarkRolesFound.has(landmark)) {
      issues.push(`Missing "${landmark}" landmark role — helps screen reader users navigate`);
    }
  }

  return {
    ariaUsage,
    landmarkRoles: Array.from(landmarkRolesFound).sort(),
    liveRegions,
    issues,
  };
}

// ── 6. Overall Accessibility Score ────────────────────────────────────────────

export interface AccessibilityScoreResult {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: string;
}

export interface AccessibilityAuditInput {
  contrast: ContrastResult[];
  headings: HeadingValidationResult;
  altText: AltTextAuditResult;
  keyboard: KeyboardNavigationAuditResult;
  screenReader: ScreenReaderAuditResult;
}

/**
 * Calculate an overall accessibility score from individual audit results.
 *
 * Weights:
 *   - contrast: 30%
 *   - headings: 15%
 *   - alt text: 20%
 *   - keyboard: 20%
 *   - screen reader: 15%
 */
export function calculateAccessibilityScore(results: AccessibilityAuditInput): AccessibilityScoreResult {
  // Contrast score: percentage of text pairs that pass AA
  let contrastScore = 100;
  if (results.contrast.length > 0) {
    const passing = results.contrast.filter((c) => c.AA).length;
    contrastScore = (passing / results.contrast.length) * 100;
  }

  // Headings score: 100 if valid, deduct per issue (min 0)
  const headingsScore = results.headings.valid
    ? 100
    : Math.max(0, 100 - results.headings.issues.length * 25);

  // Alt text score: percentage of images without issues
  let altTextScore = 100;
  if (results.altText.total > 0) {
    const withIssues = results.altText.missing; // missing is a real error; decorative is acceptable
    altTextScore = ((results.altText.total - withIssues) / results.altText.total) * 100;
  }

  // Keyboard score: based on issues
  let keyboardScore = 100;
  if (results.keyboard.focusableElements > 0 || results.keyboard.missingTabindex > 0) {
    const total = results.keyboard.focusableElements + results.keyboard.missingTabindex;
    keyboardScore = (results.keyboard.focusableElements / total) * 100;
    // Penalize negative tabindex
    if (results.keyboard.negativeTabindex > 0) {
      keyboardScore = Math.max(0, keyboardScore - results.keyboard.negativeTabindex * 5);
    }
  }

  // Screen reader score: based on landmarks and issues
  let screenReaderScore = 100;
  const expectedLandmarks = 2; // main + navigation
  const landmarkScore = Math.min(
    results.screenReader.landmarkRoles.length / expectedLandmarks,
    1,
  ) * 50;
  const ariaScore = results.screenReader.ariaUsage > 0 ? 25 : 0;
  const issueDeduction = results.screenReader.issues.length * 10;
  screenReaderScore = Math.max(0, Math.min(100, landmarkScore + ariaScore + 25 - issueDeduction));

  // Weighted average
  const score = Math.round(
    contrastScore * 0.3 +
    headingsScore * 0.15 +
    altTextScore * 0.2 +
    keyboardScore * 0.2 +
    screenReaderScore * 0.15,
  );

  const clampedScore = Math.max(0, Math.min(100, score));

  let grade: 'A' | 'B' | 'C' | 'D' | 'F';
  if (clampedScore >= 90) grade = 'A';
  else if (clampedScore >= 80) grade = 'B';
  else if (clampedScore >= 70) grade = 'C';
  else if (clampedScore >= 60) grade = 'D';
  else grade = 'F';

  const parts: string[] = [];
  if (contrastScore < 100) parts.push(`contrast issues (${Math.round(contrastScore)}% passing AA)`);
  if (!results.headings.valid) parts.push(`heading hierarchy issues`);
  if (results.altText.missing > 0) parts.push(`${results.altText.missing} images missing alt text`);
  if (results.keyboard.missingTabindex > 0) parts.push(`${results.keyboard.missingTabindex} interactive elements not keyboard-focusable`);
  if (results.screenReader.issues.length > 0) parts.push(`${results.screenReader.issues.length} screen reader issue(s)`);

  const summary = parts.length === 0
    ? `Accessibility score: ${clampedScore}/100 (${grade}) — no major issues detected`
    : `Accessibility score: ${clampedScore}/100 (${grade}) — ${parts.join('; ')}`;

  return { score: clampedScore, grade, summary };
}

// ── 7. Full Accessibility Audit (integration helper) ──────────────────────────

export interface FullAccessibilityAuditResult {
  contrastResults: ContrastResult[];
  headings: HeadingValidationResult;
  altText: AltTextAuditResult;
  keyboard: KeyboardNavigationAuditResult;
  screenReader: ScreenReaderAuditResult;
  score: AccessibilityScoreResult;
}

export interface AuditableElement {
  tag: string;
  text?: string;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  foregroundColor?: string;
  backgroundColor?: string;
}

/**
 * Run a full accessibility audit on a set of elements.
 * This is the main integration point — call this from the pipeline.
 */
export function runFullAccessibilityAudit(
  elements: AuditableElement[],
): FullAccessibilityAuditResult {
  // 1. Contrast checks for elements with both foreground and background colors
  const contrastResults: ContrastResult[] = [];
  for (const el of elements) {
    if (el.foregroundColor && el.backgroundColor) {
      contrastResults.push(checkColorContrast(el.foregroundColor, el.backgroundColor));
    }
  }

  // 2. Heading hierarchy
  const headingElements = elements
    .filter((el) => /^h[1-6]$/i.test(el.tag))
    .map((el) => ({ tag: el.tag, text: el.text || '' }));
  const headings = validateHeadingHierarchy(headingElements);

  // 3. Alt text
  const altText = auditAltText(elements);

  // 4. Keyboard navigation
  const keyboard = auditKeyboardNavigation(elements);

  // 5. Screen reader
  const screenReader = auditScreenReader(elements);

  // 6. Score
  const score = calculateAccessibilityScore({
    contrast: contrastResults,
    headings,
    altText,
    keyboard,
    screenReader,
  });

  return {
    contrastResults,
    headings,
    altText,
    keyboard,
    screenReader,
    score,
  };
}

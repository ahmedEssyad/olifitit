/**
 * Stable CSS selector generation utilities.
 *
 * NOTE: These functions run in Node context. The browser-context equivalents
 * (escapeClass, genSelector) are defined inline inside page.evaluate() in
 * elements.ts and MUST stay there — see BROWSER-CONTEXT comments.
 */

/**
 * Escapes special characters in a CSS class name token (browser-safe, no imports).
 */
export function escapeClassToken(cls: string): string {
  return cls
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/:/g, '\\:')
    .replace(/\//g, '\\/')
    .replace(/@/g, '\\@')
    .replace(/%/g, '\\%')
    .replace(/!/g, '\\!')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\.(?=\d)/g, '\\.');
}

export function generateStableSelector(el: Element, index: number): string {
  // 1. ID is most stable
  if (el.id) return `#${el.id}`;

  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList).filter(c => c && !c.match(/^[0-9]/));

  // 2. Try tag.class combo if unique in document
  if (classes.length > 0) {
    const classStr = classes.slice(0, 3).map(c => `.${escapeClassToken(c)}`).join('');
    const candidate = `${tag}${classStr}`;
    try {
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    } catch { /* invalid selector chars */ }
  }

  // 3. Try with distinguishing attributes
  const distinguishingAttrs = ['role', 'type', 'name', 'aria-label', 'data-testid', 'data-id', 'href'];
  for (const attr of distinguishingAttrs) {
    const val = el.getAttribute(attr);
    if (val) {
      const candidate = `${tag}[${attr}="${val.replace(/"/g, '\\"').slice(0, 80)}"]`;
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      } catch { /* */ }
    }
  }

  // 4. Try parent > tag.class
  const parent = el.parentElement;
  if (parent) {
    let parentSel = '';
    if (parent.id) {
      parentSel = `#${parent.id}`;
    } else {
      const parentTag = parent.tagName.toLowerCase();
      const parentClasses = Array.from(parent.classList).filter(c => c && !c.match(/^[0-9]/));
      if (parentClasses.length > 0) {
        parentSel = `${parentTag}.${parentClasses.slice(0, 2).map(escapeClassToken).join('.')}`;
      }
    }

    if (parentSel) {
      if (classes.length > 0) {
        const candidate = `${parentSel} > ${tag}.${classes.slice(0, 2).map(escapeClassToken).join('.')}`;
        try {
          if (document.querySelectorAll(candidate).length === 1) return candidate;
        } catch { /* */ }
      }

      // 5. parent > tag:nth-child(n) as last resort with parent context
      const siblings = Array.from(parent.children);
      const sameTagSiblings = siblings.filter(s => s.tagName === el.tagName);
      if (sameTagSiblings.length > 1) {
        const nthIndex = sameTagSiblings.indexOf(el) + 1;
        return `${parentSel} > ${tag}:nth-of-type(${nthIndex})`;
      }
      return `${parentSel} > ${tag}`;
    }
  }

  // 6. Absolute fallback
  if (classes.length > 0) {
    return `${tag}.${classes.slice(0, 3).map(escapeClassToken).join('.')}`;
  }
  return `${tag}:nth-of-type(${index + 1})`;
}

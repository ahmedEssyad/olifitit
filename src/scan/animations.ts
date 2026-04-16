/**
 * Extract @keyframes animations and animation shorthand properties from raw CSS.
 */

function extractKeyframesBlocks(css: string): { name: string; body: string }[] {
  const results: { name: string; body: string }[] = [];
  const marker = '@keyframes';
  let pos = 0;

  while (pos < css.length) {
    const idx = css.indexOf(marker, pos);
    if (idx === -1) break;

    // Extract name (skip whitespace after @keyframes)
    let nameStart = idx + marker.length;
    while (nameStart < css.length && /\s/.test(css[nameStart])) nameStart++;
    let nameEnd = nameStart;
    while (nameEnd < css.length && /[\w-]/.test(css[nameEnd])) nameEnd++;
    const name = css.slice(nameStart, nameEnd);

    if (!name) { pos = nameEnd; continue; }

    // Find opening brace
    let braceStart = nameEnd;
    while (braceStart < css.length && css[braceStart] !== '{') braceStart++;
    if (braceStart >= css.length) break;

    // Count braces to find matching close
    let depth = 0;
    let bodyStart = braceStart + 1;
    let bodyEnd = braceStart;
    for (let i = braceStart; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) {
          bodyEnd = i;
          break;
        }
      }
    }

    if (depth === 0) {
      results.push({ name, body: css.slice(bodyStart, bodyEnd).trim() });
    }

    pos = bodyEnd + 1;
  }

  return results;
}

export function extractAnimationsFromCSS(cssContents: { url: string; content: string }[]): { name: string; keyframes: string; duration: string; timing: string }[] {
  const animations: { name: string; keyframes: string; duration: string; timing: string }[] = [];
  const seen = new Set<string>();

  for (const { content } of cssContents) {
    const blocks = extractKeyframesBlocks(content);
    for (const { name, body } of blocks) {
      if (!seen.has(name)) {
        seen.add(name);
        animations.push({
          name,
          keyframes: body,
          duration: '',
          timing: '',
        });
      }
    }

    const animationRegex = /animation\s*:\s*([^;]+)/g;
    let match;
    while ((match = animationRegex.exec(content)) !== null) {
      const parts = match[1].trim().split(/\s+/);
      for (const anim of animations) {
        if (parts.includes(anim.name)) {
          const nameIdx = parts.indexOf(anim.name);
          if (parts[nameIdx + 1]) anim.duration = parts[nameIdx + 1];
          if (parts[nameIdx + 2]) anim.timing = parts[nameIdx + 2];
        }
      }
    }
  }

  return animations;
}

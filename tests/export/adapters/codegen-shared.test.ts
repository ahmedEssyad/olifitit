import { describe, it, expect } from 'vitest';
import {
  camelCase,
  kebabCase,
  cssProperty,
  generateClassName,
  filterStyles,
  collapseShorthands,
  collapseBoxProp,
  buildHoverMap,
  deriveComponentName,
  type ExtractedElement,
  type HoverAnimation,
} from '../../../src/export/adapters/codegen-shared';

// ── camelCase ──────────────────────────────────────────────────────────────

describe('camelCase', () => {
  it('should convert hyphenated string', () => {
    expect(camelCase('my-component-name')).toBe('myComponentName');
  });

  it('should handle single word', () => {
    expect(camelCase('nav')).toBe('nav');
  });

  it('should handle empty string', () => {
    expect(camelCase('')).toBe('');
  });
});

// ── kebabCase ──────────────────────────────────────────────────────────────

describe('kebabCase', () => {
  it('should convert camelCase to kebab', () => {
    expect(kebabCase('backgroundColor')).toBe('background-color');
  });

  it('should handle already-kebab', () => {
    expect(kebabCase('color')).toBe('color');
  });
});

// ── cssProperty ────────────────────────────────────────────────────────────

describe('cssProperty', () => {
  it('should convert camelCase CSS prop', () => {
    expect(cssProperty('borderTopColor')).toBe('border-top-color');
  });

  it('should handle single word', () => {
    expect(cssProperty('color')).toBe('color');
  });
});

// ── generateClassName ──────────────────────────────────────────────────────

describe('generateClassName', () => {
  it('should use ARIA role when available', () => {
    const usedNames = new Set<string>(['root']);
    const child: ExtractedElement = { tag: 'nav', role: 'navigation', styles: {} };
    const result = generateClassName(child, 0, [], usedNames);
    expect(result).toBe('navigation');
    expect(usedNames.has('navigation')).toBe(true);
  });

  it('should find semantic words in class names', () => {
    const usedNames = new Set<string>(['root']);
    const child: ExtractedElement = { tag: 'div', classes: 'main-nav-button primary', styles: {} };
    const result = generateClassName(child, 0, [], usedNames);
    expect(['nav', 'button']).toContain(result);
  });

  it('should deduplicate by appending counter', () => {
    const usedNames = new Set<string>(['root']);
    const child1: ExtractedElement = { tag: 'a', text: 'Home', styles: {} };
    const child2: ExtractedElement = { tag: 'a', text: 'Home', styles: {} };
    const siblings = [child1, child2];
    const name1 = generateClassName(child1, 0, siblings, usedNames);
    const name2 = generateClassName(child2, 1, siblings, usedNames);
    expect(name1).not.toBe(name2);
  });

  it('should fall back to tag name', () => {
    const usedNames = new Set<string>(['root']);
    const child: ExtractedElement = { tag: 'span', styles: { display: 'block' } };
    const result = generateClassName(child, 0, [], usedNames);
    expect(result).toBe('span');
  });
});

// ── filterStyles ───────────────────────────────────────────────────────────

describe('filterStyles', () => {
  it('should strip browser defaults for tag', () => {
    const result = filterStyles({ display: 'block' }, 'div', false);
    expect(result['display']).toBeUndefined();
  });

  it('should strip UNIVERSAL_DEFAULTS', () => {
    const result = filterStyles({ position: 'static', opacity: '1' }, 'div', false);
    expect(result['position']).toBeUndefined();
    expect(result['opacity']).toBeUndefined();
  });

  it('should keep 0px margin for h1 (non-zero default tag)', () => {
    const result = filterStyles({ marginTop: '0px' }, 'h1', false);
    expect(result['marginTop'] ?? result['margin']).toBeDefined();
  });

  it('should strip 0px margin for div (zero default tag)', () => {
    const result = filterStyles({ marginTop: '0px' }, 'div', false);
    expect(result['marginTop']).toBeUndefined();
  });

  it('should skip SKIP_PROPERTIES', () => {
    const result = filterStyles({ colorScheme: 'normal', fontFeatureSettings: 'normal' }, 'div', false);
    expect(result['colorScheme']).toBeUndefined();
    expect(result['fontFeatureSettings']).toBeUndefined();
  });

  it('should convert rgb colors to hex', () => {
    const result = filterStyles({ color: 'rgb(255, 0, 0)' }, 'div', false);
    expect(result['color']).toBe('#ff0000');
  });

  it('should keep meaningful non-default styles', () => {
    const result = filterStyles({ display: 'flex', gap: '8px', color: '#333' }, 'div', false);
    expect(result['display']).toBe('flex');
    expect(result['gap']).toBe('8px');
    expect(result['color']).toBe('#333');
  });
});

// ── collapseShorthands / collapseBoxProp ───────────────────────────────────

describe('collapseShorthands', () => {
  it('should collapse 4 equal sides to single value', () => {
    const result = collapseShorthands({
      paddingTop: '8px', paddingRight: '8px', paddingBottom: '8px', paddingLeft: '8px',
    });
    expect(result['padding']).toBe('8px');
    expect(result['paddingTop']).toBeUndefined();
    expect(result['paddingRight']).toBeUndefined();
    expect(result['paddingBottom']).toBeUndefined();
    expect(result['paddingLeft']).toBeUndefined();
  });

  it('should collapse TB=same, RL=same to two values', () => {
    const result = collapseShorthands({
      paddingTop: '8px', paddingRight: '16px', paddingBottom: '8px', paddingLeft: '16px',
    });
    expect(result['padding']).toBe('8px 16px');
  });

  it('should not collapse when any side is undefined', () => {
    const result = collapseShorthands({
      paddingTop: '8px', paddingRight: '16px',
    });
    expect(result['padding']).toBeUndefined();
    expect(result['paddingTop']).toBe('8px');
    expect(result['paddingRight']).toBe('16px');
  });
});

// ── buildHoverMap ──────────────────────────────────────────────────────────

describe('buildHoverMap', () => {
  it('should match hover animations by text content', () => {
    const hoverAnims: HoverAnimation[] = [
      {
        element: 'a.nav-link',
        text: 'Learn More',
        changes: { color: { from: '#333', to: '#ff0000' } },
      },
    ];
    const childEntries = [
      {
        child: { tag: 'a', text: 'Learn More', styles: {} } as ExtractedElement,
        className: 'learnMoreLink',
      },
    ];
    const root: ExtractedElement = { tag: 'nav', styles: {} };

    const map = buildHoverMap(hoverAnims, childEntries, root);
    expect(map.has('learnMoreLink')).toBe(true);
    expect(map.get('learnMoreLink')!['color']).toBeDefined();
  });

  it('should return empty map when no hover anims provided', () => {
    const map = buildHoverMap(undefined, [], { tag: 'div', styles: {} });
    expect(map.size).toBe(0);
  });
});

// ── deriveComponentName ────────────────────────────────────────────────────

describe('deriveComponentName', () => {
  it('should return PascalCase from selector', () => {
    const result = deriveComponentName('nav.main-nav');
    expect(result).toBe('NavMainNav');
  });

  it('should use nameMap for known components', () => {
    expect(deriveComponentName('header')).toBe('Header');
    expect(deriveComponentName('nav')).toBe('Navbar');
    expect(deriveComponentName('footer')).toBe('Footer');
  });

  it('should pass through already-PascalCase input', () => {
    expect(deriveComponentName('MyComponent')).toBe('MyComponent');
  });

  it('should return Component for empty after cleaning', () => {
    expect(deriveComponentName('#.[]')).toBe('Component');
  });
});

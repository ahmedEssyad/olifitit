import { describe, it, expect } from 'vitest';
import { generateComponentCode } from '../../../src/export/adapters/component-codegen';

// ── Test Helpers ───────────────────────────────────────────────────────────

function makeExtraction(overrides: Record<string, any> = {}) {
  return {
    url: 'https://example.com',
    component: overrides.component ?? 'nav.main-nav',
    desktop_1440: overrides.desktop_1440 ?? {
      element: {
        tag: 'nav',
        classes: 'main-nav',
        styles: { display: 'flex', gap: '8px', padding: '16px', backgroundColor: '#ffffff' },
      },
      children: overrides.children ?? [
        { tag: 'a', text: 'Home', classes: 'nav-link', styles: { color: '#333333', textDecoration: 'none' } },
        { tag: 'a', text: 'About', classes: 'nav-link', styles: { color: '#333333', textDecoration: 'none' } },
      ],
    },
    animations: overrides.animations,
    responsiveChanges: overrides.responsiveChanges,
  };
}

// ── generateComponentCode ──────────────────────────────────────────────────

describe('generateComponentCode', () => {
  it('should return null when desktop_1440 is null', () => {
    const extraction = {
      url: 'https://example.com',
      component: 'nav',
      desktop_1440: null,
    };
    const result = generateComponentCode(extraction);
    expect(result).toBeNull();
  });

  it('should produce valid TSX with correct component name', () => {
    const extraction = makeExtraction();
    const result = generateComponentCode(extraction)!;
    expect(result).not.toBeNull();
    expect(result.tsx).toContain('export default function');
    expect(result.componentName).toBe('NavMainNav');
    expect(result.tsx).toContain('import styles from');
  });

  it('should produce CSS module with .root class', () => {
    const extraction = makeExtraction();
    const result = generateComponentCode(extraction)!;
    expect(result.css).toContain('.root {');
    expect(result.css).toContain('display: flex');
    expect(result.css).toContain('gap: 8px');
  });

  it('should generate unique class names for children', () => {
    const extraction = makeExtraction({
      children: [
        { tag: 'a', text: 'Home', styles: { color: '#333' } },
        { tag: 'a', text: 'About', styles: { color: '#333' } },
        { tag: 'a', text: 'Contact', styles: { color: '#333' } },
      ],
    });
    const result = generateComponentCode(extraction)!;
    // All anchor tags should have unique class names in CSS
    const classMatches = result.css.match(/^\.[a-zA-Z]/gm) || [];
    const unique = new Set(classMatches);
    expect(unique.size).toBe(classMatches.length);
  });

  it('should include hover styles in CSS when simple hover animations present', () => {
    const extraction = makeExtraction({
      animations: {
        hover: [
          {
            element: 'a.nav-link',
            text: 'Home',
            changes: { color: { from: '#333333', to: '#ff0000' } },
          },
        ],
      },
    });
    const result = generateComponentCode(extraction)!;
    expect(result.css).toContain(':hover');
  });

  it('should filter out browser default styles', () => {
    const extraction = makeExtraction({
      desktop_1440: {
        element: {
          tag: 'div',
          styles: { display: 'block', position: 'static', opacity: '1', gap: '8px' },
        },
        children: [],
      },
      component: 'section',
    });
    const result = generateComponentCode(extraction)!;
    // display: block is default for div — should not appear
    expect(result.css).not.toMatch(/display:\s*block/);
    // position: static is universal default — should not appear
    expect(result.css).not.toMatch(/position:\s*static/);
    // gap: 8px is not a default — should appear
    expect(result.css).toContain('gap: 8px');
  });
});

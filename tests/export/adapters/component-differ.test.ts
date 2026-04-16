import { describe, it, expect } from 'vitest';
import {
  parseCssModule,
  matchClasses,
  diffStyles,
  generateDiffReport,
  applyPatch,
  type DiffResult,
  type CssModuleMap,
} from '../../../src/export/adapters/component-differ';

// ── parseCssModule ─────────────────────────────────────────────────────────

describe('parseCssModule', () => {
  it('should parse simple class rule with properties', () => {
    const css = '.nav { display: flex; gap: 8px; }';
    const map = parseCssModule(css);
    expect(map.has('nav')).toBe(true);
    const entry = map.get('nav')!;
    expect(entry.properties['display']).toBe('flex');
    expect(entry.properties['gap']).toBe('8px');
  });

  it('should parse pseudo-state selectors into pseudoStates', () => {
    const css = '.btn { color: red; }\n.btn:hover { color: blue; }';
    const map = parseCssModule(css);
    expect(map.has('btn')).toBe(true);
    const entry = map.get('btn')!;
    expect(entry.properties['color']).toBe('red');
    expect(entry.pseudoStates['hover']['color']).toBe('blue');
  });

  it('should strip CSS module hash suffixes from class names', () => {
    const css = '.nav_abc123 { display: flex; }';
    const map = parseCssModule(css);
    expect(map.has('nav')).toBe(true);
  });

  it('should parse @media rules and attach to existing classes', () => {
    const css = `.nav { display: flex; }
@media (max-width: 768px) { .nav { flex-direction: column; } }`;
    const map = parseCssModule(css);
    const entry = map.get('nav')!;
    expect(entry.mediaQueries).toHaveLength(1);
    expect(entry.mediaQueries[0].query).toContain('max-width');
    expect(entry.mediaQueries[0].properties['flex-direction']).toBe('column');
  });

  it('should merge multiple rules for the same class', () => {
    const css = '.nav { display: flex; }\n.nav { gap: 10px; }';
    const map = parseCssModule(css);
    const entry = map.get('nav')!;
    expect(entry.properties['display']).toBe('flex');
    expect(entry.properties['gap']).toBe('10px');
  });

  it('should return empty map for empty CSS string', () => {
    const map = parseCssModule('');
    expect(map.size).toBe(0);
  });

  it('should track line numbers from source positions', () => {
    const css = `.nav {\n  display: flex;\n  gap: 8px;\n}`;
    const map = parseCssModule(css);
    const entry = map.get('nav')!;
    expect(entry.startLine).toBeGreaterThan(0);
    expect(entry.endLine).toBeGreaterThanOrEqual(entry.startLine);
  });
});

// ── matchClasses ───────────────────────────────────────────────────────────

describe('matchClasses', () => {
  const makeUserClasses = (classes: Record<string, Record<string, string>>): CssModuleMap => {
    const map: CssModuleMap = new Map();
    for (const [name, properties] of Object.entries(classes)) {
      map.set(name, {
        className: name,
        properties,
        pseudoStates: {},
        mediaQueries: [],
        startLine: 1,
        endLine: 1,
      });
    }
    return map;
  };

  it('should apply manual mappings with confidence 1.0', () => {
    const userClasses = makeUserClasses({
      nav: { display: 'flex' },
      logo: { width: '100px' },
    });
    const root = { tag: 'nav', styles: { display: 'flex' } };
    const children = [{ tag: 'img', classes: 'brand-logo', styles: { width: '100px' } }];

    const mappings = matchClasses(userClasses, root, children, 'nav=root,logo=brand');
    const navMapping = mappings.find(m => m.userClass === 'nav');
    expect(navMapping).toBeDefined();
    expect(navMapping!.confidence).toBe(1.0);
    expect(navMapping!.matchMethod).toBe('manual');
  });

  it('should match by name similarity when class names overlap with labels', () => {
    const userClasses = makeUserClasses({
      navLink: { color: 'blue' },
    });
    const root = { tag: 'nav', styles: {} };
    const children = [
      { tag: 'a', classes: 'nav-link', text: 'Home', styles: { color: 'blue' } },
    ];

    const mappings = matchClasses(userClasses, root, children);
    const linkMapping = mappings.find(m => m.userClass === 'navLink');
    expect(linkMapping).toBeDefined();
  });

  it('should match by style overlap when names differ', () => {
    const userClasses = makeUserClasses({
      wrapper: { display: 'flex', gap: '8px', padding: '16px', 'justify-content': 'center', 'align-items': 'center' },
    });
    const root = { tag: 'div', styles: { display: 'flex', gap: '8px', padding: '16px', justifyContent: 'center', alignItems: 'center' } };
    const children: any[] = [];

    const mappings = matchClasses(userClasses, root, children);
    expect(mappings.length).toBeGreaterThan(0);
  });

  it('should not duplicate matches (greedy assignment)', () => {
    const userClasses = makeUserClasses({
      link1: { color: 'blue', display: 'inline' },
      link2: { color: 'red', display: 'inline' },
    });
    const root = { tag: 'nav', styles: {} };
    const children = [
      { tag: 'a', text: 'Home', styles: { color: 'blue', display: 'inline' } },
    ];

    const mappings = matchClasses(userClasses, root, children);
    const targetLabels = mappings.map(m => m.targetLabel);
    const unique = new Set(targetLabels);
    expect(unique.size).toBe(targetLabels.length);
  });

  it('should give root bonus to user classes with layout properties', () => {
    const userClasses = makeUserClasses({
      container: {
        display: 'flex',
        position: 'relative',
        'flex-direction': 'column',
        'justify-content': 'center',
        'align-items': 'center',
      },
    });
    const root = { tag: 'div', styles: { display: 'flex', position: 'relative', flexDirection: 'column' } };
    const children: any[] = [];

    const mappings = matchClasses(userClasses, root, children);
    const rootMapping = mappings.find(m => m.targetLabel === 'root');
    expect(rootMapping).toBeDefined();
  });
});

// ── diffStyles ─────────────────────────────────────────────────────────────

describe('diffStyles', () => {
  const makeMap = (entries: Record<string, Record<string, string>>): CssModuleMap => {
    const map: CssModuleMap = new Map();
    for (const [name, properties] of Object.entries(entries)) {
      map.set(name, {
        className: name,
        properties,
        pseudoStates: {},
        mediaQueries: [],
        startLine: 1,
        endLine: 5,
      });
    }
    return map;
  };

  it('should detect CHANGE when user and target values differ', () => {
    const userClasses = makeMap({ nav: { color: '#ff0000' } });
    const mappings = [{
      userClass: 'nav',
      targetElement: { tag: 'nav', styles: { color: '#0000ff' } },
      targetLabel: 'root',
      confidence: 1.0,
      matchMethod: 'manual',
    }];
    const result = diffStyles(userClasses, mappings);
    const changeEntry = result.diffs[0]?.entries.find(e => e.type === 'CHANGE');
    expect(changeEntry).toBeDefined();
    expect(changeEntry!.property).toBe('color');
  });

  it('should detect ADD when target has property user lacks', () => {
    const userClasses = makeMap({ nav: { display: 'flex' } });
    const mappings = [{
      userClass: 'nav',
      targetElement: { tag: 'nav', styles: { display: 'flex', gap: '8px' } },
      targetLabel: 'root',
      confidence: 1.0,
      matchMethod: 'manual',
    }];
    const result = diffStyles(userClasses, mappings);
    const addEntry = result.diffs[0]?.entries.find(e => e.type === 'ADD' && e.property === 'gap');
    expect(addEntry).toBeDefined();
    expect(addEntry!.targetValue).toBe('8px');
  });

  it('should detect REMOVE when user has property target lacks', () => {
    const userClasses = makeMap({ nav: { display: 'flex', border: '1px solid red' } });
    const mappings = [{
      userClass: 'nav',
      targetElement: { tag: 'nav', styles: { display: 'flex' } },
      targetLabel: 'root',
      confidence: 1.0,
      matchMethod: 'manual',
    }];
    const result = diffStyles(userClasses, mappings);
    const removeEntry = result.diffs[0]?.entries.find(e => e.type === 'REMOVE' && e.property === 'border');
    expect(removeEntry).toBeDefined();
  });

  it('should sort entries CHANGE first, then ADD, then REMOVE', () => {
    const userClasses = makeMap({ nav: { color: 'red', border: '1px solid' } });
    const mappings = [{
      userClass: 'nav',
      targetElement: { tag: 'nav', styles: { color: 'blue', gap: '8px' } },
      targetLabel: 'root',
      confidence: 1.0,
      matchMethod: 'manual',
    }];
    const result = diffStyles(userClasses, mappings);
    const types = result.diffs[0]?.entries.map(e => e.type) || [];
    const changeIdx = types.indexOf('CHANGE');
    const addIdx = types.indexOf('ADD');
    const removeIdx = types.indexOf('REMOVE');
    if (changeIdx >= 0 && addIdx >= 0) expect(changeIdx).toBeLessThan(addIdx);
    if (addIdx >= 0 && removeIdx >= 0) expect(addIdx).toBeLessThan(removeIdx);
  });

  it('should report unmatched user classes', () => {
    const userClasses = makeMap({ nav: { display: 'flex' }, footer: { padding: '10px' } });
    const mappings = [{
      userClass: 'nav',
      targetElement: { tag: 'nav', styles: { display: 'flex' } },
      targetLabel: 'root',
      confidence: 1.0,
      matchMethod: 'manual',
    }];
    const result = diffStyles(userClasses, mappings);
    expect(result.unmatchedUserClasses).toContain('footer');
  });
});

// ── generateDiffReport ─────────────────────────────────────────────────────

describe('generateDiffReport', () => {
  it('should say no differences when diffs array is empty', () => {
    const result: DiffResult = {
      diffs: [],
      unmatchedUserClasses: [],
      unmatchedTargetElements: [],
      missingHoverStates: [],
      missingMediaQueries: [],
    };
    const report = generateDiffReport(result, 'test.module.css', 'https://example.com', 'nav');
    expect(report).toContain('No style differences found');
  });

  it('should include CHANGE and ADD labels', () => {
    const result: DiffResult = {
      diffs: [{
        userClass: 'nav',
        targetLabel: 'root',
        targetTag: 'nav',
        confidence: 1.0,
        matchMethod: 'manual',
        entries: [
          { property: 'color', type: 'CHANGE', userValue: 'red', targetValue: 'blue' },
          { property: 'gap', type: 'ADD', targetValue: '8px' },
        ],
      }],
      unmatchedUserClasses: [],
      unmatchedTargetElements: [],
      missingHoverStates: [],
      missingMediaQueries: [],
    };
    const report = generateDiffReport(result, 'test.module.css', 'https://example.com', 'nav');
    expect(report).toContain('CHANGE');
    expect(report).toContain('ADD');
    expect(report).toContain('color');
    expect(report).toContain('gap');
  });
});

// ── applyPatch ─────────────────────────────────────────────────────────────

describe('applyPatch', () => {
  it('should replace changed property values in CSS', () => {
    const css = `.nav {\n  color: red;\n  display: flex;\n}`;
    const result: DiffResult = {
      diffs: [{
        userClass: 'nav',
        targetLabel: 'root',
        targetTag: 'nav',
        confidence: 1.0,
        matchMethod: 'manual',
        entries: [
          { property: 'color', type: 'CHANGE', userValue: 'red', targetValue: 'blue' },
        ],
      }],
      unmatchedUserClasses: [],
      unmatchedTargetElements: [],
      missingHoverStates: [],
      missingMediaQueries: [],
    };
    const patched = applyPatch(css, result);
    expect(patched).toContain('color: blue');
    expect(patched).not.toContain('color: red');
  });

  it('should insert ADD properties before closing brace', () => {
    const css = `.nav {\n  display: flex;\n}`;
    const result: DiffResult = {
      diffs: [{
        userClass: 'nav',
        targetLabel: 'root',
        targetTag: 'nav',
        confidence: 1.0,
        matchMethod: 'manual',
        entries: [
          { property: 'gap', type: 'ADD', targetValue: '8px' },
        ],
      }],
      unmatchedUserClasses: [],
      unmatchedTargetElements: [],
      missingHoverStates: [],
      missingMediaQueries: [],
    };
    const patched = applyPatch(css, result);
    expect(patched).toContain('gap: 8px');
  });

  it('should append missing hover states at end', () => {
    const css = `.btn {\n  color: red;\n}`;
    const result: DiffResult = {
      diffs: [],
      unmatchedUserClasses: [],
      unmatchedTargetElements: [],
      missingHoverStates: [
        { className: 'btn', properties: { color: 'blue', opacity: '0.8' } },
      ],
      missingMediaQueries: [],
    };
    const patched = applyPatch(css, result);
    expect(patched).toContain('.btn:hover {');
    expect(patched).toContain('color: blue');
    expect(patched).toContain('opacity: 0.8');
  });
});

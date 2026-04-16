import * as csstree from 'css-tree';
import { log } from '../core/utils';
import { CSSArchitecture } from '../core/types/analyzer';

// ── CSS Architecture Analysis (css-tree based) ─────────────────────────────────

export function analyzeCSSArchitecture(cssRaw: { url: string; content: string }[]): CSSArchitecture {
  const customProperties = new Map<string, { value: string; count: number }>();
  const mediaQueries: { query: string; properties: string[] }[] = [];
  const classNames: string[] = [];
  const layers: string[] = [];
  const containerQueries: { name: string; condition: string; selectors: string[] }[] = [];
  const fluidTypography: { selector: string; value: string }[] = [];
  let minWidthCount = 0;
  let maxWidthCount = 0;
  const allCSS = cssRaw.map(c => c.content).join('\n');

  for (const { content } of cssRaw) {
    let ast: csstree.CssNode;
    try {
      ast = csstree.parse(content, { parseCustomProperty: true });
    } catch (e) {
      log('Analyzer', 'debug', `CSS parse failed, falling back to regex: ${(e as Error).message}`);
      continue;
    }

    // Walk the AST
    csstree.walk(ast, {
      visit: 'Declaration',
      enter(node: csstree.Declaration) {
        // Custom properties
        if (node.property.startsWith('--')) {
          const value = csstree.generate(node.value);
          const existing = customProperties.get(node.property);
          if (existing) {
            existing.count++;
          } else {
            customProperties.set(node.property, { value, count: 1 });
          }
        }
      },
    });

    // Extract var() usages
    csstree.walk(ast, {
      visit: 'Function',
      enter(node: csstree.FunctionNode) {
        if (node.name === 'var') {
          const firstChild = node.children.first;
          if (firstChild && firstChild.type === 'Identifier') {
            const name = '--' + firstChild.name;
            const existing = customProperties.get(name);
            if (existing) existing.count++;
          }
        }
      },
    });

    // Extract class selectors
    csstree.walk(ast, {
      visit: 'ClassSelector',
      enter(node: csstree.ClassSelector) {
        classNames.push(node.name);
      },
    });

    // Extract media queries
    csstree.walk(ast, {
      visit: 'Atrule',
      enter(node: csstree.Atrule) {
        if (node.name === 'media' && node.prelude) {
          const query = csstree.generate(node.prelude);
          const props = new Set<string>();

          if (node.block) {
            csstree.walk(node.block, {
              visit: 'Declaration',
              enter(decl: csstree.Declaration) {
                props.add(decl.property);
              },
            });
          }

          mediaQueries.push({ query, properties: Array.from(props) });

          // Count min-width vs max-width for mobile-first/desktop-first detection
          if (query.includes('min-width')) minWidthCount++;
          if (query.includes('max-width')) maxWidthCount++;
        }

        // @layer
        if (node.name === 'layer' && node.prelude) {
          const layerName = csstree.generate(node.prelude);
          if (!layers.includes(layerName)) layers.push(layerName);
        }

        // @container — extract name, condition, and selectors inside
        if (node.name === 'container' && node.prelude) {
          const containerQuery = csstree.generate(node.prelude);
          const selectors: string[] = [];

          if (node.block) {
            csstree.walk(node.block, {
              visit: 'Rule',
              enter(rule: csstree.Rule) {
                if (rule.prelude) {
                  selectors.push(csstree.generate(rule.prelude));
                }
              },
            });
          }

          // Parse container name from the prelude (e.g., "sidebar (min-width: 400px)")
          const parts = containerQuery.match(/^(\S+)\s+(.+)$/);
          const name = parts ? parts[1] : '';
          const condition = parts ? parts[2] : containerQuery;

          containerQueries.push({ name, condition, selectors });
        }
      },
    });

    // Detect fluid typography: clamp() or calc() with viewport units in font-size
    csstree.walk(ast, {
      visit: 'Declaration',
      enter(node: csstree.Declaration) {
        if (node.property === 'font-size') {
          const value = csstree.generate(node.value);
          const isFluid = value.includes('clamp(') ||
            (value.includes('calc(') && /\d+v[wh]/.test(value));
          if (isFluid) {
            // Walk up to find the selector for this declaration
            // We need to find the parent rule
            // css-tree doesn't provide parent references easily, so we track via regex fallback
            fluidTypography.push({ selector: '(from AST)', value });
          }
        }
      },
    });

    // Regex-based fluid typography detection for better selector capture
    const fluidRegex = /([^{}]+)\{[^}]*font-size\s*:\s*((?:clamp\([^)]+\)|calc\([^)]*\d+v[wh][^)]*\)))[^}]*\}/g;
    let fluidMatch;
    while ((fluidMatch = fluidRegex.exec(content)) !== null) {
      const selector = fluidMatch[1].trim();
      const value = fluidMatch[2].trim();
      // Avoid duplicates from AST pass — replace the '(from AST)' entries
      const astIdx = fluidTypography.findIndex(f => f.selector === '(from AST)' && f.value === value);
      if (astIdx >= 0) {
        fluidTypography[astIdx].selector = selector;
      } else {
        fluidTypography.push({ selector, value });
      }
    }
  }

  // Detect methodology from class naming patterns
  const hasBEM = classNames.some(c => c.includes('__')) || classNames.some(c => c.includes('--'));
  const hasUtility = classNames.filter(c => /^(p|m|w|h|flex|grid|text|bg|border|rounded|gap|space|font)-/.test(c)).length > 20;
  const hasTailwind = allCSS.includes('tailwindcss') || classNames.some(c => /^(sm|md|lg|xl|2xl):/.test(c));
  const hasModules = cssRaw.some(c => c.url.includes('.module.'));

  let methodology = 'custom';
  if (hasTailwind || hasUtility) methodology = 'utility-first (Tailwind-like)';
  else if (hasBEM) methodology = 'BEM';
  else if (hasModules) methodology = 'CSS Modules';

  // Extract naming patterns from class names
  const prefixFrequency = new Map<string, number>();
  for (const cls of classNames) {
    const parts = cls.split(/[-_]/);
    const prefix = parts[0];
    if (prefix) prefixFrequency.set(prefix, (prefixFrequency.get(prefix) || 0) + 1);
  }

  const namingPatterns = Array.from(prefixFrequency.entries())
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([pattern, frequency]) => {
      const examples = classNames
        .filter(c => c.startsWith(pattern))
        .slice(0, 5)
        .map(c => `.${c}`);
      return { pattern, examples: [...new Set(examples)], frequency };
    });

  const customPropertiesArr = Array.from(customProperties.entries())
    .map(([name, { value, count }]) => ({ name, value, usageCount: count }))
    .sort((a, b) => b.usageCount - a.usageCount);

  // Determine CSS strategy
  let cssStrategy: 'mobile-first' | 'desktop-first' | 'mixed' = 'mixed';
  if (minWidthCount > 0 && maxWidthCount === 0) {
    cssStrategy = 'mobile-first';
  } else if (maxWidthCount > 0 && minWidthCount === 0) {
    cssStrategy = 'desktop-first';
  } else if (minWidthCount > maxWidthCount * 2) {
    cssStrategy = 'mobile-first';
  } else if (maxWidthCount > minWidthCount * 2) {
    cssStrategy = 'desktop-first';
  }

  // Remove any fluid typography entries that still have placeholder selectors
  const cleanedFluidTypography = fluidTypography.filter(f => f.selector !== '(from AST)');

  return {
    methodology,
    namingPatterns,
    specificityConcerns: [],
    customProperties: customPropertiesArr,
    mediaQueries,
    layers,
    containerQueries,
    fluidTypography: cleanedFluidTypography,
    cssStrategy,
    cssStrategyDetails: { minWidthCount, maxWidthCount },
  };
}

/**
 * Component Differ — "Make Mine Match"
 *
 * Parses a user's CSS module, matches classes to an extracted component,
 * diffs the styles, and produces a patched CSS file.
 */

import * as csstree from 'css-tree';
import { rgbToHex, parseRgb } from './utils';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ParsedCssClass {
  className: string;
  properties: Record<string, string>;
  pseudoStates: Record<string, Record<string, string>>;
  mediaQueries: { query: string; properties: Record<string, string> }[];
  startLine: number;
  endLine: number;
}

export type CssModuleMap = Map<string, ParsedCssClass>;

interface ExtractedElement {
  tag: string;
  id?: string;
  classes?: string;
  role?: string;
  text?: string;
  styles: Record<string, string>;
}

export interface StyleDiffEntry {
  property: string;
  type: 'CHANGE' | 'ADD' | 'REMOVE';
  userValue?: string;
  targetValue?: string;
}

export interface ClassDiff {
  userClass: string;
  targetLabel: string;
  targetTag: string;
  confidence: number;
  matchMethod: string;
  entries: StyleDiffEntry[];
}

export interface MissingHover {
  className: string;
  properties: Record<string, string>;
}

export interface MissingMedia {
  query: string;
  className: string;
  properties: Record<string, string>;
}

export interface DiffResult {
  diffs: ClassDiff[];
  unmatchedUserClasses: string[];
  unmatchedTargetElements: { label: string; tag: string; keyStyles: string[] }[];
  missingHoverStates: MissingHover[];
  missingMediaQueries: MissingMedia[];
}

export interface MatchResult {
  report: string;
  patchedCss: string;
  diffs: DiffResult;
}

// ── CSS Module Parser ───────────────────────────────────────────────────────

export function parseCssModule(cssContent: string): CssModuleMap {
  const map: CssModuleMap = new Map();

  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(cssContent, { positions: true });
  } catch (e) {
    throw new Error(`Failed to parse CSS: ${(e as Error).message}`);
  }

  // Walk top-level rules
  csstree.walk(ast, {
    visit: 'Rule',
    enter(node: csstree.Rule) {
      if (!node.prelude || node.prelude.type !== 'SelectorList') return;

      // Find class selector and optional pseudo-class
      let className = '';
      let pseudoName = '';

      csstree.walk(node.prelude, {
        visit: 'ClassSelector',
        enter(cls: csstree.ClassSelector) {
          if (!className) className = cls.name;
        },
      });

      csstree.walk(node.prelude, {
        visit: 'PseudoClassSelector',
        enter(pseudo: csstree.PseudoClassSelector) {
          pseudoName = pseudo.name;
        },
      });

      if (!className) return;

      // Strip CSS module hash if present (e.g., nav_abc123 → nav)
      const cleanName = className.replace(/_[a-zA-Z0-9]{5,}$/, '');

      // Extract declarations
      const properties: Record<string, string> = {};
      if (node.block) {
        csstree.walk(node.block, {
          visit: 'Declaration',
          enter(decl: csstree.Declaration) {
            properties[decl.property] = csstree.generate(decl.value).trim();
          },
        });
      }

      // Get or create entry
      if (!map.has(cleanName)) {
        map.set(cleanName, {
          className: cleanName,
          properties: {},
          pseudoStates: {},
          mediaQueries: [],
          startLine: node.loc?.start?.line || 0,
          endLine: node.loc?.end?.line || 0,
        });
      }

      const entry = map.get(cleanName)!;

      if (pseudoName) {
        entry.pseudoStates[pseudoName] = { ...entry.pseudoStates[pseudoName], ...properties };
      } else {
        Object.assign(entry.properties, properties);
        if (node.loc) {
          if (!entry.startLine || node.loc.start.line < entry.startLine) entry.startLine = node.loc.start.line;
          if (node.loc.end.line > entry.endLine) entry.endLine = node.loc.end.line;
        }
      }
    },
  });

  // Walk @media rules
  csstree.walk(ast, {
    visit: 'Atrule',
    enter(node: csstree.Atrule) {
      if (node.name !== 'media' || !node.prelude || !node.block) return;
      const query = csstree.generate(node.prelude);

      csstree.walk(node.block, {
        visit: 'Rule',
        enter(rule: csstree.Rule) {
          let className = '';
          csstree.walk(rule.prelude!, {
            visit: 'ClassSelector',
            enter(cls: csstree.ClassSelector) {
              if (!className) className = cls.name;
            },
          });
          if (!className) return;

          const cleanName = className.replace(/_[a-zA-Z0-9]{5,}$/, '');
          const properties: Record<string, string> = {};
          if (rule.block) {
            csstree.walk(rule.block, {
              visit: 'Declaration',
              enter(decl: csstree.Declaration) {
                properties[decl.property] = csstree.generate(decl.value).trim();
              },
            });
          }

          const entry = map.get(cleanName);
          if (entry) {
            entry.mediaQueries.push({ query, properties });
          }
        },
      });
    },
  });

  return map;
}

// ── Class Matching ──────────────────────────────────────────────────────────

interface ClassMapping {
  userClass: string;
  targetElement: ExtractedElement;
  targetLabel: string;
  confidence: number;
  matchMethod: string;
}

export function matchClasses(
  userClasses: CssModuleMap,
  root: ExtractedElement,
  children: ExtractedElement[],
  manualMap?: string,
): ClassMapping[] {
  // Build target list with labels
  const targets: { element: ExtractedElement; label: string }[] = [
    { element: root, label: 'root' },
  ];

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const label = deriveLabel(child, i);
    targets.push({ element: child, label });
  }

  // Parse manual map
  const manual = new Map<string, string>();
  if (manualMap) {
    for (const pair of manualMap.split(',')) {
      const [user, target] = pair.split('=').map(s => s.trim());
      if (user && target) manual.set(user, target);
    }
  }

  const mappings: ClassMapping[] = [];
  const matchedTargets = new Set<number>();
  const matchedUsers = new Set<string>();

  // Tier 1: Manual overrides
  for (const [userClass, targetKey] of manual) {
    if (!userClasses.has(userClass)) continue;
    const targetIdx = targets.findIndex(t => t.label === targetKey || t.element.tag === targetKey);
    if (targetIdx >= 0 && !matchedTargets.has(targetIdx)) {
      mappings.push({
        userClass,
        targetElement: targets[targetIdx].element,
        targetLabel: targets[targetIdx].label,
        confidence: 1.0,
        matchMethod: 'manual',
      });
      matchedTargets.add(targetIdx);
      matchedUsers.add(userClass);
    }
  }

  // Build all candidate scores
  const candidates: { userClass: string; targetIdx: number; score: number; method: string }[] = [];

  for (const [userClass, parsed] of userClasses) {
    if (matchedUsers.has(userClass)) continue;

    for (let ti = 0; ti < targets.length; ti++) {
      if (matchedTargets.has(ti)) continue;
      const target = targets[ti];

      // Tier 2: Name similarity
      const nameScore = nameSimilarity(userClass, target.label, target.element.tag);

      // Tier 3: Style overlap
      const userProps = new Set(Object.keys(parsed.properties));
      const targetProps = new Set(
        Object.keys(normalizeExtractedStyles(target.element.styles))
      );
      const styleScore = jaccardSimilarity(userProps, targetProps);

      // Root bonus: user class with layout properties (display, position, flex)
      // gets a strong boost when matching against the root element
      let rootBonus = 0;
      if (target.label === 'root') {
        const layoutProps = ['display', 'position', 'flex-direction', 'justify-content',
          'align-items', 'z-index', 'backdrop-filter', 'width', 'height'];
        const hasLayout = layoutProps.filter(p => parsed.properties[p]).length;
        if (hasLayout >= 3) rootBonus = 0.3;
      }

      const totalScore = Math.max(nameScore, styleScore) + rootBonus;

      if (totalScore >= 0.15) {
        candidates.push({
          userClass,
          targetIdx: ti,
          score: totalScore,
          method: nameScore >= styleScore ? 'name' : 'style',
        });
      }
    }
  }

  // Greedy assignment by descending score
  candidates.sort((a, b) => b.score - a.score);

  for (const c of candidates) {
    if (matchedUsers.has(c.userClass) || matchedTargets.has(c.targetIdx)) continue;

    mappings.push({
      userClass: c.userClass,
      targetElement: targets[c.targetIdx].element,
      targetLabel: targets[c.targetIdx].label,
      confidence: Math.round(c.score * 100) / 100,
      matchMethod: c.method,
    });
    matchedUsers.add(c.userClass);
    matchedTargets.add(c.targetIdx);
  }

  return mappings;
}

function deriveLabel(child: ExtractedElement, index: number): string {
  if (child.role && child.role !== 'presentation') return child.role;
  if (child.classes) {
    const words = child.classes.toLowerCase().split(/[\s._-]+/);
    const semantic = words.find(w =>
      ['logo', 'brand', 'nav', 'link', 'btn', 'button', 'cta', 'menu', 'icon',
       'title', 'heading', 'image', 'text', 'group', 'list', 'badge', 'avatar',
       'social', 'contact', 'search', 'price', 'feature'].includes(w)
    );
    if (semantic) return semantic;
  }
  if (child.text && child.text.length <= 15) {
    return child.text.toLowerCase().replace(/\s+/g, '-');
  }
  if (child.tag === 'a') return `link-${index}`;
  if (child.tag === 'img') return `image-${index}`;
  return `${child.tag}-${index}`;
}

function nameSimilarity(userClass: string, targetLabel: string, targetTag: string): number {
  const userTokens = tokenize(userClass);
  const targetTokens = tokenize(targetLabel);

  const score = jaccardSimilarity(new Set(userTokens), new Set(targetTokens));

  // Bonus for tag name containment
  let bonus = 0;
  if (userClass.toLowerCase().includes(targetTag)) bonus += 0.15;
  if (targetLabel.includes(userClass.toLowerCase())) bonus += 0.1;

  return Math.min(1, score + bonus);
}

function tokenize(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s\-_./]+/)
    .filter(w => w.length > 1);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

// ── Style Normalization ─────────────────────────────────────────────────────

const SKIP_DIFF_PROPS = new Set([
  'position: static', 'visibility: visible', 'overflow: visible',
  'opacity: 1', 'font-style: normal', 'text-transform: none',
  'cursor: auto', 'pointer-events: auto', 'box-sizing: border-box',
  'float: none', 'clear: none',
]);

function normalizeExtractedStyles(styles: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [camelProp, value] of Object.entries(styles)) {
    if (!value || value === 'none' || value === 'normal' || value === '') continue;

    const kebabProp = camelProp.replace(/([A-Z])/g, '-$1').toLowerCase();

    // Skip defaults
    if (SKIP_DIFF_PROPS.has(`${kebabProp}: ${value}`)) continue;
    if (value === '0px' && /^(margin|padding|top|right|bottom|left|gap)/.test(kebabProp)) continue;
    if (value === 'auto' && /^(width|height|margin|top|right|bottom|left)/.test(kebabProp)) continue;
    if (value === 'rgba(0, 0, 0, 0)' && kebabProp === 'background-color') continue;

    // Normalize color values
    let normalized = value;
    if (parseRgb(value)) {
      normalized = rgbToHex(value);
    }

    result[kebabProp] = normalized;
  }

  return result;
}

function normalizeValue(value: string): string {
  if (parseRgb(value)) return rgbToHex(value);
  return value.trim();
}

// ── Style Diffing ───────────────────────────────────────────────────────────

interface HoverAnimChange {
  to: string;
}

interface HoverAnim {
  text?: string;
  changes: Record<string, HoverAnimChange>;
}

export function diffStyles(
  userClasses: CssModuleMap,
  mappings: ClassMapping[],
  hoverAnims?: HoverAnim[],
  responsiveChanges?: Record<string, unknown>,
): DiffResult {
  const diffs: ClassDiff[] = [];
  const missingHoverStates: MissingHover[] = [];
  const missingMediaQueries: MissingMedia[] = [];

  for (const mapping of mappings) {
    const userParsed = userClasses.get(mapping.userClass);
    if (!userParsed) continue;

    const targetStyles = normalizeExtractedStyles(mapping.targetElement.styles);
    const userStyles = userParsed.properties;
    const entries: StyleDiffEntry[] = [];

    // All properties in either set
    const allProps = new Set([...Object.keys(userStyles), ...Object.keys(targetStyles)]);

    for (const prop of allProps) {
      const userVal = userStyles[prop] ? normalizeValue(userStyles[prop]) : undefined;
      const targetVal = targetStyles[prop];

      if (userVal && targetVal && userVal !== targetVal) {
        entries.push({ property: prop, type: 'CHANGE', userValue: userVal, targetValue: targetVal });
      } else if (!userVal && targetVal) {
        entries.push({ property: prop, type: 'ADD', targetValue: targetVal });
      } else if (userVal && !targetVal) {
        entries.push({ property: prop, type: 'REMOVE', userValue: userVal });
      }
    }

    // Sort: CHANGE first, then ADD, then REMOVE
    entries.sort((a, b) => {
      const order = { CHANGE: 0, ADD: 1, REMOVE: 2 };
      return order[a.type] - order[b.type];
    });

    if (entries.length > 0) {
      diffs.push({
        userClass: mapping.userClass,
        targetLabel: mapping.targetLabel,
        targetTag: mapping.targetElement.tag,
        confidence: mapping.confidence,
        matchMethod: mapping.matchMethod,
        entries,
      });
    }

    // Check for missing hover states
    if (hoverAnims) {
      for (const hover of hoverAnims) {
        const hoverText = hover.text?.toLowerCase().trim();
        const elText = mapping.targetElement.text?.toLowerCase().trim();
        if (hoverText && elText && hoverText === elText) {
          const userHover = userParsed.pseudoStates['hover'] || {};
          const missing: Record<string, string> = {};
          for (const [prop, { to }] of Object.entries(hover.changes)) {
            const kebab = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
            if (!userHover[kebab]) {
              missing[kebab] = parseRgb(to) ? rgbToHex(to) : to;
            }
          }
          if (Object.keys(missing).length > 0) {
            missingHoverStates.push({ className: mapping.userClass, properties: missing });
          }
        }
      }
    }
  }

  // Unmatched classes
  const matchedUsers = new Set(mappings.map(m => m.userClass));
  const unmatchedUserClasses = [...userClasses.keys()].filter(k => !matchedUsers.has(k));

  const matchedTargetLabels = new Set(mappings.map(m => m.targetLabel));
  const unmatchedTargetElements: DiffResult['unmatchedTargetElements'] = [];

  return {
    diffs,
    unmatchedUserClasses,
    unmatchedTargetElements,
    missingHoverStates,
    missingMediaQueries,
  };
}

// ── Report Generator ────────────────────────────────────────────────────────

export function generateDiffReport(
  result: DiffResult,
  fileName: string,
  targetUrl: string,
  targetComponent: string,
): string {
  const lines: string[] = [];

  lines.push(`══ Style Diff: ${fileName} vs ${new URL(targetUrl).hostname} ${targetComponent} ══`);
  lines.push('');

  if (result.diffs.length === 0) {
    lines.push('No style differences found. Your component already matches!');
    return lines.join('\n');
  }

  for (const diff of result.diffs) {
    const conf = diff.confidence < 0.5 ? ' (low confidence)' : '';
    lines.push(`.${diff.userClass} → ${diff.targetLabel} (${diff.targetTag})${conf}`);

    for (const entry of diff.entries) {
      switch (entry.type) {
        case 'CHANGE':
          lines.push(`  CHANGE  ${entry.property}: ${entry.userValue} → ${entry.targetValue}`);
          break;
        case 'ADD':
          lines.push(`  ADD     ${entry.property}: ${entry.targetValue}`);
          break;
        case 'REMOVE':
          lines.push(`  REMOVE  ${entry.property}: ${entry.userValue}`);
          break;
      }
    }
    lines.push('');
  }

  if (result.missingHoverStates.length > 0) {
    lines.push('MISSING hover states:');
    for (const h of result.missingHoverStates) {
      const props = Object.entries(h.properties).map(([p, v]) => `${p}: ${v}`).join('; ');
      lines.push(`  .${h.className}:hover { ${props} }`);
    }
    lines.push('');
  }

  if (result.unmatchedUserClasses.length > 0) {
    lines.push(`Unmatched classes in your file: ${result.unmatchedUserClasses.map(c => `.${c}`).join(', ')}`);
    lines.push('  Use --map "yourClass=targetLabel" to manually map these.');
    lines.push('');
  }

  // Summary
  const changes = result.diffs.reduce((sum, d) => sum + d.entries.filter(e => e.type === 'CHANGE').length, 0);
  const adds = result.diffs.reduce((sum, d) => sum + d.entries.filter(e => e.type === 'ADD').length, 0);
  const removes = result.diffs.reduce((sum, d) => sum + d.entries.filter(e => e.type === 'REMOVE').length, 0);
  lines.push(`Summary: ${changes} changes, ${adds} additions, ${removes} removals across ${result.diffs.length} matched classes`);

  return lines.join('\n');
}

// ── Patch Generator ─────────────────────────────────────────────────────────

export function applyPatch(originalCss: string, result: DiffResult): string {
  const cssLines = originalCss.split('\n');
  const insertions = new Map<number, string[]>(); // line number → lines to insert before

  for (const diff of result.diffs) {
    // Find the closing brace of this class's rule block
    // Simple approach: search for `.className {` and find its `}`
    const classPattern = new RegExp(`\\.${escapeRegex(diff.userClass)}\\s*\\{`);
    let blockStart = -1;
    let blockEnd = -1;
    let braceDepth = 0;

    for (let i = 0; i < cssLines.length; i++) {
      if (blockStart === -1) {
        if (classPattern.test(cssLines[i]) && !cssLines[i].includes(':hover') && !cssLines[i].includes(':focus')) {
          blockStart = i;
          braceDepth = (cssLines[i].match(/\{/g) || []).length - (cssLines[i].match(/\}/g) || []).length;
          if (braceDepth === 0) { blockEnd = i; break; }
        }
      } else {
        braceDepth += (cssLines[i].match(/\{/g) || []).length;
        braceDepth -= (cssLines[i].match(/\}/g) || []).length;
        if (braceDepth <= 0) { blockEnd = i; break; }
      }
    }

    if (blockStart === -1 || blockEnd === -1) continue;

    // Apply CHANGE entries: find and replace the property line
    for (const entry of diff.entries) {
      if (entry.type === 'CHANGE' && entry.targetValue) {
        const propPattern = new RegExp(`(\\s*${escapeRegex(entry.property)}\\s*:\\s*)([^;]+)(;?)`);
        for (let i = blockStart; i <= blockEnd; i++) {
          if (propPattern.test(cssLines[i])) {
            cssLines[i] = cssLines[i].replace(propPattern, `$1${entry.targetValue}$3`);
            break;
          }
        }
      }
    }

    // ADD entries: insert before the closing brace
    const addEntries = diff.entries.filter(e => e.type === 'ADD' && e.targetValue);
    if (addEntries.length > 0) {
      // Detect indentation from existing properties
      let indent = '  ';
      for (let i = blockStart + 1; i < blockEnd; i++) {
        const match = cssLines[i].match(/^(\s+)/);
        if (match) { indent = match[1]; break; }
      }

      const newLines = addEntries.map(e => `${indent}${e.property}: ${e.targetValue};`);
      if (!insertions.has(blockEnd)) insertions.set(blockEnd, []);
      insertions.get(blockEnd)!.push(...newLines);
    }
  }

  // Apply insertions (reverse order to preserve line numbers)
  const insertionLines = [...insertions.entries()].sort((a, b) => b[0] - a[0]);
  for (const [lineNum, newLines] of insertionLines) {
    cssLines.splice(lineNum, 0, ...newLines);
  }

  // Append missing hover states
  if (result.missingHoverStates.length > 0) {
    cssLines.push('');
    cssLines.push('/* Added hover states from target */');
    for (const h of result.missingHoverStates) {
      cssLines.push('');
      cssLines.push(`.${h.className}:hover {`);
      for (const [prop, value] of Object.entries(h.properties)) {
        cssLines.push(`  ${prop}: ${value};`);
      }
      cssLines.push('}');
    }
  }

  return cssLines.join('\n');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

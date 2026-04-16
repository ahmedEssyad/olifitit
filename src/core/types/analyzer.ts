// ═══════════════════════════════════════════════════════════════════════════════
// Analyzer (scripts/analyze.ts)
// ═══════════════════════════════════════════════════════════════════════════════

export interface ComponentCandidate {
  selector: string;
  tag: string;
  classes: string[];
  pattern: string;
  instances: number;
  children: string[];
  commonStyles: Record<string, string>;
  variants: { selector: string; styleDiffs: Record<string, string> }[];
  confidence: 'high' | 'medium' | 'low';
  detectionMethod: string;
  likely_cms_driven: boolean;
}

export interface CSSArchitecture {
  methodology: string;
  namingPatterns: { pattern: string; examples: string[]; frequency: number }[];
  specificityConcerns: string[];
  customProperties: { name: string; value: string; usageCount: number }[];
  mediaQueries: { query: string; properties: string[] }[];
  layers: string[];
  containerQueries: { name: string; condition: string; selectors: string[] }[];
  fluidTypography: { selector: string; value: string }[];
  cssStrategy: 'mobile-first' | 'desktop-first' | 'mixed';
  cssStrategyDetails: { minWidthCount: number; maxWidthCount: number };
}

export interface AnimationPattern {
  element: string;
  trigger: string;
  properties: string[];
  duration: string;
  timing: string;
  delay: string;
  keyframes?: string;
}

export interface ResponsivePattern {
  breakpoint: number;
  changes: {
    selector: string;
    property: string;
    fromValue: string;
    toValue: string;
  }[];
  layoutShifts: {
    selector: string;
    fromLayout: string;
    toLayout: string;
  }[];
}

export interface FormPattern {
  selector: string;
  fields: {
    type: string;
    name: string;
    validation: string[];
    placeholder: string;
    required: boolean;
  }[];
  submitButton: string;
  errorDisplay: string;
}

export interface AccessibilityData {
  landmarks: { role: string; label: string; selector: string }[];
  headingHierarchy: { level: number; text: string; selector: string }[];
  ariaPatterns: { selector: string; ariaAttributes: Record<string, string> }[];
  focusOrder: string[];
  contrastIssues: { selector: string; foreground: string; background: string; ratio: number }[];
  missingAlt: string[];
}

export interface ScrollDrivenAnimation {
  selector: string;
  timeline: string;
  type: 'scroll' | 'view';
}

export interface ReducedMotionData {
  hasReducedMotionSupport: boolean;
  affectedSelectors: string[];
  fallbacks: string[];
}

export interface TouchAlternatives {
  hasHoverMediaQuery: boolean;
  hoverOnlyAnimations: number;
  touchFriendlyCount: number;
}

export interface AnalysisResult {
  url: string;
  timestamp: string;
  components: ComponentCandidate[];
  cssArchitecture: CSSArchitecture;
  animationPatterns: AnimationPattern[];
  responsivePatterns: ResponsivePattern[];
  formPatterns: FormPattern[];
  accessibility: AccessibilityData;
  zIndexMap: { selector: string; value: number }[];
  overflowBehaviors: { selector: string; overflow: string; scrollable: boolean }[];
  scrollDrivenAnimations: ScrollDrivenAnimation[];
  reducedMotion: ReducedMotionData;
  touchAlternatives: TouchAlternatives;
}

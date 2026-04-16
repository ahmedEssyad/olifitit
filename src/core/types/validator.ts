// ═══════════════════════════════════════════════════════════════════════════════
// Validator (scripts/validate.ts)
// ═══════════════════════════════════════════════════════════════════════════════

export interface ValidationResult {
  url: string;
  mode: 'rebuild' | 'site';
  timestamp: string;
  overallScore: number;
  screenshotComparisons: {
    breakpoint: number;
    originalPath: string;
    comparedPath: string;
    diffPixels: number;
    totalPixels: number;
    matchPercentage: number;
    diffImagePath: string;
    status?: 'error';
    error?: string;
  }[];
  domDiscrepancies: {
    selector: string;
    issue: string;
    expected: string;
    actual: string;
    severity: 'critical' | 'major' | 'minor';
  }[];
  missingElements: string[];
  extraElements: string[];
  styleDiscrepancies: {
    selector: string;
    property: string;
    specValue: string;
    actualValue: string;
  }[];
  interactionDiscrepancies: {
    selector: string;
    state: string;
    issue: string;
  }[];
  recommendations: string[];
}

export interface Correction {
  component: string;
  breakpoint: number;
  issue: string;
  expected: string;
  actual: string;
  selector: string;
  severity: 'critical' | 'major' | 'minor';
}

export interface DiffReport {
  corrections: Correction[];
  improved: string[];
  degraded: string[];
  overallDelta: string;
}

export interface ValidateCLIOptions {
  url: string;
  outputDir: string;
  mode: 'rebuild' | 'site' | 'diff';
  rebuildUrl: string;
}

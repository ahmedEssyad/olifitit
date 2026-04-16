// ═══════════════════════════════════════════════════════════════════════════════
// Performance Intelligence (src/scan/capture-performance.ts)
// ═══════════════════════════════════════════════════════════════════════════════

export interface LighthouseScores {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
}

export interface LighthouseMetrics {
  fcp: number;
  lcp: number;
  cls: number;
  inp: number;
  ttfb: number;
  si: number;
  tbt: number;
}

export interface ResourceBreakdown {
  totalSize: number;
  byType: Record<string, number>;
  renderBlocking: string[];
  largestResources: { url: string; size: number; type: string }[];
  unusedBytes: number;
}

export interface AnimationPerformance {
  compositorOnly: number;
  layoutTriggers: number;
  issues: string[];
}

export interface ImageOptimization {
  unoptimized: { url: string; format: string; size: number; suggestedFormat: string; potentialSavings: number }[];
  missingLazy: string[];
  missingSizes: string[];
}

export interface FontPerformance {
  strategy: string;
  preloaded: boolean;
  totalSize: number;
  count: number;
  issues: string[];
}

export interface OptimizationOpportunity {
  category: string;
  impact: 'high' | 'medium' | 'low';
  description: string;
  potentialSavings?: number;
}

export interface PerformanceCaptureResult {
  url: string;
  timestamp: string;
  lighthouse: {
    scores: LighthouseScores;
    metrics: LighthouseMetrics;
  };
  resources: ResourceBreakdown;
  animations: AnimationPerformance;
  images: ImageOptimization;
  fonts: FontPerformance;
  optimizationOpportunities: OptimizationOpportunity[];
  score: number;
}

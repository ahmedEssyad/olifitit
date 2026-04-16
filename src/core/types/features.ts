// ═══════════════════════════════════════════════════════════════════════════════
// Feature Extraction (scripts/transform/extract-features.ts)
// ═══════════════════════════════════════════════════════════════════════════════

export interface SiteFeatures {
  url: string;
  timestamp: string;
  siteType: string;
  description: string;
  pages: PageFeature[];
  features: Feature[];
  userFlows: UserFlow[];
  integrations: Integration[];
  contentStrategy: ContentStrategy;
}

export interface PageFeature {
  url: string;
  title: string;
  purpose: string;
  features: string[];
}

export interface Feature {
  id: string;
  name: string;
  category: string;
  description: string;
  implementation: {
    selector?: string;
    interactionType: string;
    components: string[];
    animations?: string[];
  };
  pages: string[];
}

export interface UserFlow {
  name: string;
  steps: { action: string; page?: string; result: string }[];
}

export interface Integration {
  type: 'api' | 'third-party' | 'analytics' | 'payment' | 'auth';
  url?: string;
  service?: string;
  purpose: string;
}

export interface ContentStrategy {
  primaryCTA: string;
  contentTypes: string[];
  navigationPattern: string;
  informationArchitecture: string;
}

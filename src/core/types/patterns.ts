// ═══════════════════════════════════════════════════════════════════════════════
// Display Pattern Intelligence (scripts/classify-patterns.ts)
// ═══════════════════════════════════════════════════════════════════════════════

export interface SectionPattern {
  selector: string;
  type: 'hero' | 'features' | 'testimonials' | 'pricing' | 'case-studies' | 'cta' | 'faq' | 'team' | 'stats' | 'footer' | 'navigation' | 'content-grid' | 'gallery' | 'contact' | string;
  confidence: number;
  evidence: string[];
  contentStructure: {
    heading?: string;
    subheading?: string;
    itemCount?: number;
    hasImages: boolean;
    hasCTA: boolean;
    contentType: 'text' | 'cards' | 'list' | 'media' | 'form' | 'mixed';
  };
}

export interface LayoutStrategy {
  selector: string;
  pattern: 'grid' | 'masonry' | 'carousel' | 'timeline' | 'split' | 'stack' | 'hero-overlay' | 'sidebar' | 'bento' | string;
  details: {
    columns?: number;
    rows?: number;
    gap?: string;
    itemAspectRatio?: string;
    direction?: 'horizontal' | 'vertical';
    alignment?: string;
  };
  responsive: {
    breakpoint: number;
    changeTo: string;
  }[];
}

export interface ContentPattern {
  selector: string;
  type: 'card-grid' | 'carousel' | 'accordion' | 'tabs' | 'timeline' | 'comparison-table' | 'image-gallery' | 'testimonial-slider' | 'pricing-table' | 'feature-list' | 'stat-counter' | string;
  behavior: {
    itemCount: number;
    visibleItems?: number;
    hasFiltering?: boolean;
    hasPagination?: boolean;
    hasSearch?: boolean;
    loadingStrategy: 'static' | 'lazy' | 'infinite-scroll' | 'paginated';
    interactionType: 'none' | 'click' | 'hover' | 'scroll' | 'drag';
  };
  itemStructure?: {
    elements: string[];
    layout: string;
  };
}

export interface AnimationIntent {
  selector: string;
  trigger: string;
  intent: 'entrance-reveal' | 'scroll-progress' | 'hover-feedback' | 'attention-grab' | 'state-transition' | 'parallax-depth' | 'loading-indicator' | 'decorative';
  orchestration?: {
    type: 'staggered' | 'sequential' | 'simultaneous';
    delay?: string;
    groupSelector?: string;
  };
}

export interface ResponsiveStrategy {
  section: string;
  strategy: string;
  breakpoints: {
    width: number;
    layout: string;
    hiddenElements?: string[];
    addedElements?: string[];
  }[];
}

export interface InformationHierarchy {
  primaryCTA: { selector: string; text: string; position: string } | null;
  aboveFold: string[];
  contentFlow: string[];
  socialProof: { type: string; selector: string }[];
}

export interface DisplayPatterns {
  url: string;
  timestamp: string;
  sections: SectionPattern[];
  layouts: LayoutStrategy[];
  contentPatterns: ContentPattern[];
  animations: AnimationIntent[];
  responsive: ResponsiveStrategy[];
  hierarchy: InformationHierarchy;
}

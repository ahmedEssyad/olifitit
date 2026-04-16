// ═══════════════════════════════════════════════════════════════════════════════
// Scanner (scripts/scan.ts)
// ═══════════════════════════════════════════════════════════════════════════════

export interface ElementData {
  selector: string;
  tag: string;
  id: string;
  classes: string[];
  attributes: Record<string, string>;
  textContent: string;
  computedStyles: Record<string, string>;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  childCount: number;
  depth: number;
  isInteractive: boolean;
  interactionStates?: {
    hover?: Record<string, string>;
    focus?: Record<string, string>;
    active?: Record<string, string>;
    disabled?: Record<string, string>;
    isDisabled?: boolean;
  };
  pseudoElements?: {
    before?: Record<string, string>;
    after?: Record<string, string>;
  };
}

export interface ResponsiveSnapshot {
  breakpoint: number;
  screenshotPath: string;
  elements: {
    selector: string;
    boundingBox: { x: number; y: number; width: number; height: number } | null;
    computedStyles: Record<string, string>;
  }[];
}

export interface AssetInfo {
  type: 'image' | 'svg' | 'font' | 'css' | 'video' | 'favicon';
  url: string;
  localPath?: string;
  mimeType?: string;
  faviconRel?: string;
}

export interface LinkTag {
  rel: string;
  href: string;
  sizes?: string;
  type?: string;
}

export interface ScanResult {
  url: string;
  timestamp: string;
  pageTitle: string;
  pageMetadata: Record<string, string>;
  linkTags: LinkTag[];
  domTree: ElementData[];
  responsiveSnapshots: ResponsiveSnapshot[];
  assets: AssetInfo[];
  apiCalls: { url: string; method: string; status: number; contentType: string; bodyPreview: string; timestamp: number }[];
  cssRaw: { url: string; content: string }[];
  colorPalette: string[];
  typographyMap: { fontFamily: string; fontSize: string; fontWeight: string; lineHeight: string; usageCount: number; selector: string }[];
  spacingValues: string[];
  opacityScale: string[];
  cssCustomProperties: { name: string; value: string; source: string }[];
  aspectRatios: { selector: string; value: string }[];
  animations: { name: string; keyframes: string; duration: string; timing: string }[];
  interactiveElements: ElementData[];
  authDetection: { detected: boolean; indicators: string[] };
}

export interface SiteMap {
  baseUrl: string;
  pages: { url: string; title: string; slug: string; links: string[] }[];
  timestamp: string;
}

export interface ScanCLIOptions {
  url: string;
  outputDir: string;
  crawl: boolean;
  authCookie?: string;
  authHeader?: string;
}

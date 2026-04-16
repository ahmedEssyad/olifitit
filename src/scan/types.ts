/**
 * Shared types for the scan module.
 * Duplicate interface definitions are re-exported from the main types.ts.
 */

export type { ElementData, ResponsiveSnapshot, AssetInfo, LinkTag, ScanResult, SiteMap } from '../core/types';

// CLIOptions is kept locally — it is named ScanCLIOptions in types.ts but
// used as CLIOptions throughout the scan sub-module for historical reasons.
export interface CLIOptions {
  url: string;
  outputDir: string;
  crawl: boolean;
  authCookie?: string;
  authHeader?: string;
}

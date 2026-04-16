/**
 * Liftit — Design System Extractor
 *
 * Lift any site's design. Paste a URL, get the code.
 *
 * @packageDocumentation
 */

// Core utilities
export { log, createLogger } from './core/logger';
export { PipelineError, NetworkError, TimeoutError, BrowserError, ValidationError, ConfigError } from './core/errors';
export { withBrowser, withRetry, safeReadJSON } from './core/utils';
export { loadConfig } from './core/config';
export { validateUrl, normalizePath, sanitizeSelector } from './core/security';

// Types
export type { ScanResult, ElementData } from './core/types/scanner';
export type { AnalysisResult, ComponentCandidate } from './core/types/analyzer';
export type { MotionCaptureResult, ViewportMotionData } from './core/types/motion';
export type { DistilledMotion, DistilledAnimation } from './core/types/distiller';
export type { DisplayPatterns } from './core/types/patterns';

// Export adapters
export { readDesignData } from './export/adapters/reader';
export type { DesignData } from './export/adapters/reader';
export { generateTailwindConfig } from './export/adapters/tailwind';
export { generateCSSVariables } from './export/adapters/css-variables';
export { generateShadcnTheme } from './export/adapters/shadcn';
export { generateDesignMd } from './export/adapters/design-md';
export { generateComponentCode } from './export/adapters/component-codegen';
export { generateW3CDesignTokens } from './export/adapters/w3c-design-tokens';
export { generateStyleDictionary } from './export/adapters/style-dictionary';

// Project generation
export { generateProject } from './export/generate-project';

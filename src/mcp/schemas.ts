/**
 * Zod validation schemas for all MCP tool inputs.
 *
 * Each schema mirrors the inputSchema defined in tools.ts exactly.
 * Inferred TypeScript types are exported alongside each schema.
 */

import { z } from 'zod';

// ── Brand override schema ───────────────────────────────────────────────────

export const BrandInput = z.object({
  colors: z.object({
    primary: z.string(),
    secondary: z.string().optional(),
    accent: z.string().optional(),
    background: z.string().optional(),
    surface: z.string().optional(),
    text: z.string().optional(),
    textMuted: z.string().optional(),
    border: z.string().optional(),
  }).optional(),
  fonts: z.object({
    body: z.string().optional(),
    heading: z.string().optional(),
    mono: z.string().optional(),
  }).optional(),
}).optional();

export type BrandInput = z.infer<typeof BrandInput>;

// ── extract_design_system ────────────────────────────────────────────────────

export const ExtractDesignSystemInput = z.object({
  url: z.string(),
  crawl: z.boolean().optional(),
  auth_cookie: z.string().optional(),
  auth_header: z.string().optional(),
  output_dir: z.string().optional(),
  brand: BrandInput,
});

export type ExtractDesignSystemInput = z.infer<typeof ExtractDesignSystemInput>;

// ── extract_component ────────────────────────────────────────────────────────

export const ExtractComponentInput = z.object({
  url: z.string(),
  component: z.string(),
  include_children: z.boolean().optional(),
});

export type ExtractComponentInput = z.infer<typeof ExtractComponentInput>;

// ── get_design_tokens ────────────────────────────────────────────────────────

export const GetDesignTokensInput = z.object({
  url: z.string(),
});

export type GetDesignTokensInput = z.infer<typeof GetDesignTokensInput>;

// ── copy_assets ──────────────────────────────────────────────────────────────

export const CopyAssetsInput = z.object({
  output_dir: z.string(),
  rebuild_dir: z.string(),
});

export type CopyAssetsInput = z.infer<typeof CopyAssetsInput>;

// ── validate_rebuild ─────────────────────────────────────────────────────────

export const ValidateRebuildInput = z.object({
  url: z.string(),
  output_dir: z.string(),
  rebuild_url: z.string().optional(),
});

export type ValidateRebuildInput = z.infer<typeof ValidateRebuildInput>;

// ── validate_site ────────────────────────────────────────────────────────────

export const ValidateSiteInput = z.object({
  url: z.string(),
  output_dir: z.string(),
});

export type ValidateSiteInput = z.infer<typeof ValidateSiteInput>;

// ── validate_diff ────────────────────────────────────────────────────────────

export const ValidateDiffInput = z.object({
  url: z.string(),
  output_dir: z.string(),
  rebuild_url: z.string().optional(),
});

export type ValidateDiffInput = z.infer<typeof ValidateDiffInput>;

// ── run_pipeline ─────────────────────────────────────────────────────────────

export const RunPipelineInput = z.object({
  url: z.string(),
  output_dir: z.string().optional(),
  rebuild_dir: z.string().optional(),
  crawl: z.boolean().optional(),
  auth_cookie: z.string().optional(),
  auth_header: z.string().optional(),
  full: z.boolean().optional(),
  rebuild_url: z.string().optional(),
});

export type RunPipelineInput = z.infer<typeof RunPipelineInput>;

// ── describe_extraction ─────────────────────────────────────────────────────

export const DescribeExtractionInput = z.object({
  output_dir: z.string().optional(),
});

export type DescribeExtractionInput = z.infer<typeof DescribeExtractionInput>;

// ── suggest_workflow ────────────────────────────────────────────────────────

export const SuggestWorkflowInput = z.object({
  goal: z.string().optional(),
});

export type SuggestWorkflowInput = z.infer<typeof SuggestWorkflowInput>;

// ── get_site_features ───────────────────────────────────────────────────────

export const GetSiteFeaturesInput = z.object({
  output_dir: z.string().optional(),
  refresh: z.boolean().optional(),
});

export type GetSiteFeaturesInput = z.infer<typeof GetSiteFeaturesInput>;

// ── get_performance_report ───────────────────────────────────────────────────

export const GetPerformanceReportInput = z.object({
  url: z.string().optional(),
  output_dir: z.string().optional(),
});

export type GetPerformanceReportInput = z.infer<typeof GetPerformanceReportInput>;

// ── get_display_patterns ────────────────────────────────────────────────────

export const GetDisplayPatternsInput = z.object({
  output_dir: z.string().optional(),
  refresh: z.boolean().optional(),
});

export type GetDisplayPatternsInput = z.infer<typeof GetDisplayPatternsInput>;

// ── interact ─────────────────────────────────────────────────────────────────

const InteractActionPosition = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  selector: z.string().optional(),
});

const InteractAction = z.object({
  type: z.enum(['click', 'type', 'hover', 'scroll', 'wait', 'select', 'focus', 'screenshot']),
  selector: z.string().optional(),
  value: z.string().optional(),
  position: InteractActionPosition.optional(),
  duration: z.number().optional(),
  label: z.string().optional(),
});

export const InteractInput = z.object({
  url: z.string(),
  actions: z.array(InteractAction),
  capture: z.enum(['screenshot', 'styles', 'both', 'diff']).optional(),
});

export type InteractInput = z.infer<typeof InteractInput>;

// ── export_tailwind ──────────────────────────────────────────────────────────

export const ExportTailwindInput = z.object({
  input_dir: z.string().optional(),
  output_dir: z.string().optional(),
  brand: BrandInput,
});

export type ExportTailwindInput = z.infer<typeof ExportTailwindInput>;

// ── export_css_variables ─────────────────────────────────────────────────────

export const ExportCSSVariablesInput = z.object({
  input_dir: z.string().optional(),
  output_dir: z.string().optional(),
  prefix: z.string().optional(),
  brand: BrandInput,
});

export type ExportCSSVariablesInput = z.infer<typeof ExportCSSVariablesInput>;

// ── export_shadcn ────────────────────────────────────────────────────────────

export const ExportShadcnInput = z.object({
  input_dir: z.string().optional(),
  output_dir: z.string().optional(),
  brand: BrandInput,
});

export type ExportShadcnInput = z.infer<typeof ExportShadcnInput>;

// ── export_w3c_tokens ───────────────────────────────────────────────────────

export const ExportW3CTokensInput = z.object({
  input_dir: z.string().optional(),
  output_dir: z.string().optional(),
  brand: BrandInput,
});

export type ExportW3CTokensInput = z.infer<typeof ExportW3CTokensInput>;

// ── export_style_dictionary ─────────────────────────────────────────────────

export const ExportStyleDictionaryInput = z.object({
  input_dir: z.string().optional(),
  output_dir: z.string().optional(),
  brand: BrandInput,
});

export type ExportStyleDictionaryInput = z.infer<typeof ExportStyleDictionaryInput>;

// ── generate_component ───────────────────────────────────────────────────────

export const GenerateComponentInput = z.object({
  url: z.string(),
  component: z.string(),
  name: z.string().optional(),
  framework: z.enum(['react', 'vue', 'svelte']).optional(),
  brand: BrandInput,
});

export type GenerateComponentInput = z.infer<typeof GenerateComponentInput>;

// ── match_component ──────────────────────────────────────────────────────────

export const MatchComponentInput = z.object({
  url: z.string(),
  component: z.string(),
  css_content: z.string(),
  class_map: z.string().optional(),
});

export type MatchComponentInput = z.infer<typeof MatchComponentInput>;

// ── rebuild_site ─────────────────────────────────────────────────────────────

export const RebuildSiteInput = z.object({
  url: z.string(),
  output_dir: z.string().optional(),
  rebuild_dir: z.string().optional(),
  crawl: z.boolean().optional(),
  auth_cookie: z.string().optional(),
  auth_header: z.string().optional(),
  skip_extraction: z.boolean().optional(),
  brand: BrandInput,
});

export type RebuildSiteInput = z.infer<typeof RebuildSiteInput>;

// ── cross_browser_check ─────────────────────────────────────────────────────

export const CrossBrowserInput = z.object({
  url: z.string(),
  output_dir: z.string().optional(),
  browsers: z.array(z.enum(['chromium', 'firefox', 'webkit'])).optional(),
});

export type CrossBrowserInput = z.infer<typeof CrossBrowserInput>;

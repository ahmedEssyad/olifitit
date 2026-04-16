// ═══════════════════════════════════════════════════════════════════════════════
// Orchestrator (scripts/orchestrate.ts)
// ═══════════════════════════════════════════════════════════════════════════════

export interface OrchestratorCLIOptions {
  url: string;
  outputDir: string;
  step: string;
  full: boolean;
  crawl: boolean;
  rebuildUrl: string;
  authCookie?: string;
  authHeader?: string;
}

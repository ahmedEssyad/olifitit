// ═══════════════════════════════════════════════════════════════════════════════
// Utilities (scripts/utils.ts)
// ═══════════════════════════════════════════════════════════════════════════════

export interface StepResult {
  step: string;
  status: 'success' | 'failed' | 'skipped';
  durationMs: number;
  error?: string;
  outputFiles?: string[];
}

export interface BrowserOptions {
  headless?: boolean;
  args?: string[];
}

export interface RetryOptions {
  retries?: number;
  backoffMs?: number;
  label?: string;
}

/**
 * Error hierarchy for the design-system-extractor pipeline.
 *
 * Provides typed, serializable error classes for every failure mode:
 *   - PipelineError (base)
 *   - NetworkError
 *   - TimeoutError
 *   - BrowserError
 *   - ValidationError
 *   - ConfigError
 */

// ── Base Error ───────────────────────────────────────────────────────────────

export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly step: string,
    public readonly phase: string,
    public readonly recoverable: boolean,
    public readonly code: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'PipelineError';
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      step: this.step,
      phase: this.phase,
      recoverable: this.recoverable,
      cause: this.cause
        ? { name: this.cause.name, message: this.cause.message }
        : undefined,
    };
  }
}

// ── Network Errors ───────────────────────────────────────────────────────────

export type NetworkErrorCode =
  | 'NETWORK_UNREACHABLE'
  | 'NETWORK_TIMEOUT'
  | 'HTTP_ERROR';

export class NetworkError extends PipelineError {
  constructor(
    message: string,
    step: string,
    phase: string,
    code: NetworkErrorCode,
    recoverable = true,
    cause?: Error,
  ) {
    super(message, step, phase, recoverable, code, cause);
    this.name = 'NetworkError';
  }
}

// ── Timeout Errors ───────────────────────────────────────────────────────────

export type TimeoutErrorCode =
  | 'OPERATION_TIMEOUT'
  | 'NAVIGATION_TIMEOUT'
  | 'EVALUATE_TIMEOUT';

export class TimeoutError extends PipelineError {
  public readonly timeoutMs: number;

  constructor(
    message: string,
    step: string,
    phase: string,
    code: TimeoutErrorCode,
    timeoutMs: number,
    recoverable = true,
    cause?: Error,
  ) {
    super(message, step, phase, recoverable, code, cause);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      timeoutMs: this.timeoutMs,
    };
  }
}

// ── Browser Errors ───────────────────────────────────────────────────────────

export type BrowserErrorCode =
  | 'BROWSER_LAUNCH_FAILED'
  | 'SELECTOR_FAILED'
  | 'EVALUATE_FAILED'
  | 'CONTEXT_FAILED';

export class BrowserError extends PipelineError {
  constructor(
    message: string,
    step: string,
    phase: string,
    code: BrowserErrorCode,
    recoverable = false,
    cause?: Error,
  ) {
    super(message, step, phase, recoverable, code, cause);
    this.name = 'BrowserError';
  }
}

// ── Validation Errors ────────────────────────────────────────────────────────

export type ValidationErrorCode =
  | 'INVALID_INPUT'
  | 'SCHEMA_MISMATCH'
  | 'INVALID_URL'
  | 'INVALID_PATH';

export class ValidationError extends PipelineError {
  public readonly field?: string;
  public readonly details?: string;

  constructor(
    message: string,
    step: string,
    phase: string,
    code: ValidationErrorCode,
    field?: string,
    details?: string,
    recoverable = false,
    cause?: Error,
  ) {
    super(message, step, phase, recoverable, code, cause);
    this.name = 'ValidationError';
    this.field = field;
    this.details = details;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      field: this.field,
      details: this.details,
    };
  }
}

// ── Config Errors ────────────────────────────────────────────────────────────

export type ConfigErrorCode = 'CONFIG_PARSE_FAILED' | 'CONFIG_INVALID';

export class ConfigError extends PipelineError {
  public readonly configPath?: string;

  constructor(
    message: string,
    step: string,
    phase: string,
    code: ConfigErrorCode,
    configPath?: string,
    recoverable = false,
    cause?: Error,
  ) {
    super(message, step, phase, recoverable, code, cause);
    this.name = 'ConfigError';
    this.configPath = configPath;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      configPath: this.configPath,
    };
  }
}

/**
 * Structured logger for the design-system-extractor pipeline.
 *
 * Provides:
 *   - Logger class with debug/info/warn/error/timing methods
 *   - JSON and human-readable output formats
 *   - LOG_LEVEL env var support
 *   - Backward-compatible log() function matching the existing API in utils.ts
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'human' | 'json';

// ── Level ordering (lower = more verbose) ────────────────────────────────────

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function parseLogLevel(value: string | undefined): LogLevel {
  if (value && value.toLowerCase() in LEVEL_ORDER) {
    return value.toLowerCase() as LogLevel;
  }
  return 'info';
}

// ── Logger Class ─────────────────────────────────────────────────────────────

export class Logger {
  private readonly minLevel: number;

  constructor(
    public readonly correlationId?: string,
    public readonly format: LogFormat = 'human',
  ) {
    this.minLevel = LEVEL_ORDER[parseLogLevel(process.env.LOG_LEVEL)];
  }

  debug(step: string, message: string, data?: Record<string, unknown>): void {
    this.emit('debug', step, message, undefined, data);
  }

  info(step: string, message: string, data?: Record<string, unknown>): void {
    this.emit('info', step, message, undefined, data);
  }

  warn(step: string, message: string, data?: Record<string, unknown>): void {
    this.emit('warn', step, message, undefined, data);
  }

  error(
    step: string,
    message: string,
    error?: Error,
    data?: Record<string, unknown>,
  ): void {
    this.emit('error', step, message, error, data);
  }

  timing(step: string, label: string, durationMs: number): void {
    this.emit('info', step, `${label} completed in ${durationMs}ms`, undefined, {
      durationMs,
      label,
    });
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private emit(
    level: LogLevel,
    step: string,
    message: string,
    error?: Error,
    data?: Record<string, unknown>,
  ): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;

    if (this.format === 'json') {
      this.emitJSON(level, step, message, error, data);
    } else {
      this.emitHuman(level, step, message, error);
    }
  }

  private emitJSON(
    level: LogLevel,
    step: string,
    message: string,
    error?: Error,
    data?: Record<string, unknown>,
  ): void {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      step,
      message,
      correlationId: this.correlationId,
      data: data ?? undefined,
    };
    if (error) {
      entry.error = { name: error.name, message: error.message, stack: error.stack };
    }
    const line = JSON.stringify(entry);
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  private emitHuman(
    level: LogLevel,
    step: string,
    message: string,
    error?: Error,
  ): void {
    const ts = new Date().toISOString();
    const prefix = `[${ts}] [${step}] [${level.toUpperCase()}]`;
    const text = error ? `${message} — ${error.message}` : message;
    if (level === 'error') {
      console.error(`${prefix} ${text}`);
    } else if (level === 'warn') {
      console.warn(`${prefix} ${text}`);
    } else {
      console.log(`${prefix} ${text}`);
    }
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createLogger(correlationId?: string): Logger {
  const format: LogFormat = process.env.LOG_FORMAT === 'json' ? 'json' : 'human';
  return new Logger(correlationId, format);
}

// ── Backward-compatible free function ────────────────────────────────────────

const defaultLogger = new Logger();

/**
 * Drop-in replacement for the original `log(step, level, message)` from utils.ts.
 */
export function log(step: string, level: LogLevel, message: string): void {
  defaultLogger[level](step, message);
}

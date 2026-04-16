import { describe, it, expect, vi } from 'vitest';
import { log, Logger, createLogger } from '../../src/core/logger';

describe('log()', () => {
  it('produces output without throwing', () => {
    expect(() => log('test-step', 'info', 'hello world')).not.toThrow();
  });

  it('works with all log levels', () => {
    expect(() => log('test', 'debug', 'debug msg')).not.toThrow();
    expect(() => log('test', 'info', 'info msg')).not.toThrow();
    expect(() => log('test', 'warn', 'warn msg')).not.toThrow();
    expect(() => log('test', 'error', 'error msg')).not.toThrow();
  });
});

describe('Logger class', () => {
  it('respects log level filtering', () => {
    const origLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'warn';
    try {
      const logger = new Logger();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      logger.debug('step', 'should not appear');
      logger.info('step', 'should not appear');
      expect(consoleSpy).not.toHaveBeenCalled();

      logger.warn('step', 'should appear');
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    } finally {
      if (origLevel === undefined) {
        delete process.env.LOG_LEVEL;
      } else {
        process.env.LOG_LEVEL = origLevel;
      }
    }
  });

  it('emits error level messages', () => {
    const origLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'error';
    try {
      const logger = new Logger();
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logger.error('step', 'bad thing');
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    } finally {
      if (origLevel === undefined) {
        delete process.env.LOG_LEVEL;
      } else {
        process.env.LOG_LEVEL = origLevel;
      }
    }
  });
});

describe('createLogger', () => {
  it('creates a Logger with correlationId', () => {
    const logger = createLogger('req-123');
    expect(logger).toBeInstanceOf(Logger);
    expect(logger.correlationId).toBe('req-123');
  });

  it('creates a Logger without correlationId', () => {
    const logger = createLogger();
    expect(logger).toBeInstanceOf(Logger);
    expect(logger.correlationId).toBeUndefined();
  });
});

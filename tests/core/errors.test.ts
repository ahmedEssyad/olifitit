import { describe, it, expect } from 'vitest';
import {
  PipelineError,
  NetworkError,
  TimeoutError,
  BrowserError,
  ValidationError,
  ConfigError,
} from '../../src/core/errors';

describe('PipelineError', () => {
  it('constructor sets all fields', () => {
    const cause = new Error('root cause');
    const err = new PipelineError('msg', 'scan', 'init', true, 'SOME_CODE', cause);
    expect(err.message).toBe('msg');
    expect(err.step).toBe('scan');
    expect(err.phase).toBe('init');
    expect(err.recoverable).toBe(true);
    expect(err.code).toBe('SOME_CODE');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('PipelineError');
  });

  it('toJSON() serializes correctly', () => {
    const cause = new Error('oops');
    const err = new PipelineError('msg', 'scan', 'init', false, 'CODE', cause);
    const json = err.toJSON();
    expect(json).toEqual({
      name: 'PipelineError',
      message: 'msg',
      code: 'CODE',
      step: 'scan',
      phase: 'init',
      recoverable: false,
      cause: { name: 'Error', message: 'oops' },
    });
  });

  it('toJSON() omits cause when undefined', () => {
    const err = new PipelineError('msg', 'scan', 'init', true, 'CODE');
    const json = err.toJSON();
    expect(json.cause).toBeUndefined();
  });

  it('is instanceof Error and PipelineError', () => {
    const err = new PipelineError('msg', 'scan', 'init', true, 'CODE');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PipelineError);
  });
});

describe('NetworkError', () => {
  it('constructor sets fields and name', () => {
    const err = new NetworkError('net fail', 'scan', 'fetch', 'NETWORK_UNREACHABLE');
    expect(err.name).toBe('NetworkError');
    expect(err.code).toBe('NETWORK_UNREACHABLE');
    expect(err.recoverable).toBe(true); // default
  });

  it('is instanceof PipelineError', () => {
    const err = new NetworkError('net fail', 'scan', 'fetch', 'HTTP_ERROR', false);
    expect(err).toBeInstanceOf(PipelineError);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.recoverable).toBe(false);
  });
});

describe('TimeoutError', () => {
  it('constructor sets timeoutMs', () => {
    const err = new TimeoutError('timed out', 'scan', 'nav', 'NAVIGATION_TIMEOUT', 30000);
    expect(err.timeoutMs).toBe(30000);
    expect(err.code).toBe('NAVIGATION_TIMEOUT');
    expect(err.name).toBe('TimeoutError');
  });

  it('toJSON includes timeoutMs', () => {
    const err = new TimeoutError('timed out', 'scan', 'nav', 'OPERATION_TIMEOUT', 5000);
    const json = err.toJSON();
    expect(json.timeoutMs).toBe(5000);
    expect(json.name).toBe('TimeoutError');
    expect(json.code).toBe('OPERATION_TIMEOUT');
  });

  it('is instanceof PipelineError', () => {
    const err = new TimeoutError('t', 's', 'p', 'EVALUATE_TIMEOUT', 100);
    expect(err).toBeInstanceOf(PipelineError);
  });
});

describe('BrowserError', () => {
  it('constructor sets code and defaults recoverable to false', () => {
    const err = new BrowserError('launch fail', 'scan', 'init', 'BROWSER_LAUNCH_FAILED');
    expect(err.code).toBe('BROWSER_LAUNCH_FAILED');
    expect(err.recoverable).toBe(false);
    expect(err.name).toBe('BrowserError');
  });

  it('is instanceof PipelineError', () => {
    const err = new BrowserError('x', 's', 'p', 'SELECTOR_FAILED');
    expect(err).toBeInstanceOf(PipelineError);
  });
});

describe('ValidationError', () => {
  it('constructor sets field and details', () => {
    const err = new ValidationError('bad input', 'scan', 'validate', 'INVALID_INPUT', 'url', 'must be https');
    expect(err.field).toBe('url');
    expect(err.details).toBe('must be https');
    expect(err.code).toBe('INVALID_INPUT');
    expect(err.name).toBe('ValidationError');
  });

  it('toJSON includes field and details', () => {
    const err = new ValidationError('bad', 's', 'p', 'SCHEMA_MISMATCH', 'data', 'wrong shape');
    const json = err.toJSON();
    expect(json.field).toBe('data');
    expect(json.details).toBe('wrong shape');
  });

  it('is instanceof PipelineError', () => {
    const err = new ValidationError('x', 's', 'p', 'INVALID_URL');
    expect(err).toBeInstanceOf(PipelineError);
  });
});

describe('ConfigError', () => {
  it('constructor sets configPath', () => {
    const err = new ConfigError('parse fail', 'config', 'load', 'CONFIG_PARSE_FAILED', '/path/.liftitrc.json');
    expect(err.configPath).toBe('/path/.liftitrc.json');
    expect(err.code).toBe('CONFIG_PARSE_FAILED');
    expect(err.name).toBe('ConfigError');
  });

  it('toJSON includes configPath', () => {
    const err = new ConfigError('invalid', 'config', 'validate', 'CONFIG_INVALID', '/some/path');
    const json = err.toJSON();
    expect(json.configPath).toBe('/some/path');
  });

  it('is instanceof PipelineError', () => {
    const err = new ConfigError('x', 's', 'p', 'CONFIG_INVALID');
    expect(err).toBeInstanceOf(PipelineError);
  });
});

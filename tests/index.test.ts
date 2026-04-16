import { describe, it, expect } from 'vitest';

describe('Library entry point (src/index.ts)', () => {
  it('should export core utilities', async () => {
    const lib = await import('../src/index');
    expect(lib.log).toBeDefined();
    expect(lib.createLogger).toBeDefined();
    expect(lib.withRetry).toBeDefined();
    expect(lib.safeReadJSON).toBeDefined();
  });

  it('should export error classes', async () => {
    const lib = await import('../src/index');
    expect(lib.PipelineError).toBeDefined();
    expect(lib.ValidationError).toBeDefined();
    expect(lib.TimeoutError).toBeDefined();
    expect(lib.NetworkError).toBeDefined();
    expect(lib.BrowserError).toBeDefined();
    expect(lib.ConfigError).toBeDefined();
  });

  it('should export adapter functions', async () => {
    const lib = await import('../src/index');
    expect(lib.generateTailwindConfig).toBeDefined();
    expect(lib.generateCSSVariables).toBeDefined();
    expect(lib.generateShadcnTheme).toBeDefined();
    expect(lib.generateDesignMd).toBeDefined();
    expect(lib.generateComponentCode).toBeDefined();
    expect(lib.readDesignData).toBeDefined();
  });

  it('should export security utilities', async () => {
    const lib = await import('../src/index');
    expect(lib.validateUrl).toBeDefined();
    expect(lib.normalizePath).toBeDefined();
    expect(lib.sanitizeSelector).toBeDefined();
  });

  it('should export project generator', async () => {
    const lib = await import('../src/index');
    expect(lib.generateProject).toBeDefined();
  });
});

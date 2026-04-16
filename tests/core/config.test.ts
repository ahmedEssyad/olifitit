import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, loadConfig } from '../../src/core/config';

describe('DEFAULT_CONFIG', () => {
  it('has expected structure', () => {
    expect(Array.isArray(DEFAULT_CONFIG.browser.breakpoints)).toBe(true);
    expect(DEFAULT_CONFIG.browser.breakpoints.length).toBeGreaterThan(0);
    expect(typeof DEFAULT_CONFIG.browser.viewportHeight).toBe('number');

    expect(typeof DEFAULT_CONFIG.scan.maxElements).toBe('number');
    expect(DEFAULT_CONFIG.scan.maxElements).toBeGreaterThan(0);
    expect(typeof DEFAULT_CONFIG.scan.maxPages).toBe('number');
    expect(Array.isArray(DEFAULT_CONFIG.scan.interactiveSelectors)).toBe(true);
    expect(Array.isArray(DEFAULT_CONFIG.scan.styleProperties)).toBe(true);

    expect(Array.isArray(DEFAULT_CONFIG.motion.viewports)).toBe(true);
    expect(typeof DEFAULT_CONFIG.motion.scrollStep).toBe('number');

    expect(typeof DEFAULT_CONFIG.validation.pixelmatchThreshold).toBe('number');
    expect(DEFAULT_CONFIG.validation.pixelmatchThreshold).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_CONFIG.validation.pixelmatchThreshold).toBeLessThanOrEqual(1);

    expect(typeof DEFAULT_CONFIG.logging.verbose).toBe('boolean');
  });
});

describe('loadConfig', () => {
  it('returns defaults with no overrides', () => {
    const cfg = loadConfig();
    expect(cfg.browser.breakpoints).toEqual(DEFAULT_CONFIG.browser.breakpoints);
    expect(cfg.scan.maxElements).toBe(DEFAULT_CONFIG.scan.maxElements);
    expect(cfg.logging.verbose).toBe(DEFAULT_CONFIG.logging.verbose);
  });

  it('merges overrides correctly', () => {
    const cfg = loadConfig({ logging: { verbose: true } });
    expect(cfg.logging.verbose).toBe(true);
    // Other values remain default
    expect(cfg.scan.maxElements).toBe(DEFAULT_CONFIG.scan.maxElements);
  });

  it('overrides nested values', () => {
    const cfg = loadConfig({ browser: { viewportHeight: 1200 } });
    expect(cfg.browser.viewportHeight).toBe(1200);
    // Breakpoints should remain from default
    expect(cfg.browser.breakpoints).toEqual(DEFAULT_CONFIG.browser.breakpoints);
  });

  it('returns a frozen object', () => {
    const cfg = loadConfig();
    expect(Object.isFrozen(cfg)).toBe(true);
  });
});

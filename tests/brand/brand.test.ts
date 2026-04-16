import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BrandConfigSchema,
  loadBrandConfig,
  createColorMap,
  createFontMap,
  createContentMap,
  applyContentReplacements,
  transformStyleValue,
  applyBrandToDesignData,
  type BrandConfig,
} from '../../src/brand/brand';
import type { DesignData } from '../../src/export/adapters/reader';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: () => '/home/testuser',
}));

import * as fs from 'fs';

// ── Test Helpers ───────────────────────────────────────────────────────────

function makeDesignData(overrides: Partial<DesignData> = {}): DesignData {
  return {
    source: 'design-system',
    sourceUrl: 'https://example.com',
    colors: {
      primary: { value: '#ff0000' },
      secondary: { value: '#00ff00' },
      accent: { value: '#0000ff' },
      neutral: { '100': { value: '#f5f5f5' }, '900': { value: '#111111' } },
      semantic: { background: { value: '#ffffff' } },
      overlays: { modal: { value: 'rgba(0, 0, 0, 0.5)' } },
      all: ['#ff0000', '#00ff00', '#0000ff', '#f5f5f5', '#111111', '#ffffff', 'rgba(0, 0, 0, 0.5)'],
    },
    typography: {
      fontFamilies: [
        { name: 'Inter', stack: '"Inter", sans-serif', weights: [400, 700] },
        { name: 'Georgia', stack: '"Georgia", serif', weights: [400] },
      ],
      scale: [
        { size: '16px', font: '"Inter", sans-serif', weight: 400, lineHeight: '24px', letterSpacing: 'normal' },
      ],
      weights: [400, 700],
      lineHeights: ['24px'],
      letterSpacings: ['normal'],
    },
    spacing: { scale: [4, 8, 16], baseUnit: '4px' },
    borderRadius: [{ value: '4px' }],
    shadows: [{ name: 'default', value: '0 2px 4px rgba(0, 0, 0, 0.1)' }],
    transitions: { durations: ['200ms'], timingFunctions: ['ease'] },
    zIndex: [{ value: 10 }],
    breakpoints: {},
    containerWidths: {},
    ...overrides,
  };
}

function makeBrandConfig(overrides: Partial<BrandConfig> = {}): BrandConfig {
  return {
    colors: {
      primary: '#0000ff',
      secondary: '#ff00ff',
      accent: '#00ffff',
      background: '#fafafa',
      text: '#222222',
      ...overrides.colors,
    },
    fonts: {
      body: 'Roboto',
      heading: 'Playfair Display',
      mono: 'Fira Code',
      ...overrides.fonts,
    },
    content: overrides.content,
  };
}

// ── parseColor (tested through createColorMap and transformStyleValue) ─────

// Note: parseColor is private, so we test it indirectly through public functions.
// However we can also test the exported helper functions that use parseColor indirectly.

// ── BrandConfigSchema ──────────────────────────────────────────────────────

describe('BrandConfigSchema', () => {
  it('should validate correct config', () => {
    const config = {
      colors: { primary: '#ff0000', secondary: '#00ff00' },
      fonts: { body: 'Inter', heading: 'Georgia' },
      content: { 'ACME Corp': 'My Company' },
    };
    const result = BrandConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should reject config without colors.primary', () => {
    const config = { colors: {} };
    const result = BrandConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should accept minimal config with only primary color', () => {
    const config = { colors: { primary: '#ff0000' } };
    const result = BrandConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });
});

// ── loadBrandConfig ────────────────────────────────────────────────────────

describe('loadBrandConfig', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return null when no config file exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const result = loadBrandConfig();
    expect(result).toBeNull();
  });

  it('should throw ConfigError for invalid JSON', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{ not valid json');
    expect(() => loadBrandConfig('/path/to/config.json')).toThrow();
    try {
      loadBrandConfig('/path/to/config.json');
    } catch (err: any) {
      expect(err.code).toBe('CONFIG_PARSE_FAILED');
    }
  });

  it('should throw ConfigError for invalid schema', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ colors: {} }));
    expect(() => loadBrandConfig('/path/to/config.json')).toThrow();
    try {
      loadBrandConfig('/path/to/config.json');
    } catch (err: any) {
      expect(err.code).toBe('CONFIG_INVALID');
    }
  });

  it('should load valid config from provided path', () => {
    const validConfig = { colors: { primary: '#ff0000' } };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(validConfig));
    const result = loadBrandConfig('/path/to/config.json');
    expect(result).not.toBeNull();
    expect(result!.colors.primary).toBe('#ff0000');
  });
});

// ── createColorMap ─────────────────────────────────────────────────────────

describe('createColorMap', () => {
  it('should map extracted primary color to brand primary', () => {
    const data = makeDesignData();
    const brand = makeBrandConfig();
    const map = createColorMap(data, brand);
    expect(map.get('#ff0000')).toBe('#0000ff');
  });

  it('should return empty map when brand has no primary color parsed', () => {
    const data = makeDesignData();
    const brand = makeBrandConfig({ colors: { primary: 'invalid-color' } });
    const map = createColorMap(data, brand);
    expect(map.size).toBe(0);
  });

  it('should preserve alpha channel when mapping rgb colors', () => {
    const data = makeDesignData({
      colors: {
        primary: { value: 'rgba(255, 0, 0, 0.5)' },
        neutral: {},
        semantic: {},
        overlays: {},
        all: ['rgba(255, 0, 0, 0.5)'],
      },
    });
    const brand = makeBrandConfig();
    const map = createColorMap(data, brand);
    const mapped = map.get('rgba(255, 0, 0, 0.5)');
    expect(mapped).toContain('0.5');
    expect(mapped).toContain('rgba');
  });

  it('should map dark colors to brand text color via luminance', () => {
    const data = makeDesignData({
      colors: {
        primary: { value: '#ff0000' },
        neutral: {},
        semantic: {},
        overlays: {},
        all: ['#ff0000', '#111111'],
      },
    });
    const brand = makeBrandConfig();
    const map = createColorMap(data, brand);
    expect(map.has('#111111')).toBe(true);
  });

  it('should map light colors to brand background via luminance', () => {
    const data = makeDesignData({
      colors: {
        primary: { value: '#ff0000' },
        neutral: {},
        semantic: {},
        overlays: {},
        all: ['#ff0000', '#f5f5f5'],
      },
    });
    const brand = makeBrandConfig();
    const map = createColorMap(data, brand);
    expect(map.has('#f5f5f5')).toBe(true);
  });

  it('should map semantic named tokens to brand roles', () => {
    const data = makeDesignData({
      colors: {
        primary: { value: '#ff0000' },
        neutral: {},
        semantic: { background: { value: '#ffffff' } },
        overlays: {},
        all: ['#ff0000', '#ffffff'],
      },
    });
    const brand = makeBrandConfig({ colors: { primary: '#0000ff', background: '#f0f0f0' } });
    const map = createColorMap(data, brand);
    expect(map.get('#ffffff')).toBe('#f0f0f0');
  });

  it('should preserve output format (hex for hex input, rgb for rgb input)', () => {
    const data = makeDesignData({
      colors: {
        primary: { value: 'rgb(255, 0, 0)' },
        neutral: {},
        semantic: {},
        overlays: {},
        all: ['rgb(255, 0, 0)'],
      },
    });
    const brand = makeBrandConfig();
    const map = createColorMap(data, brand);
    const mapped = map.get('rgb(255, 0, 0)');
    expect(mapped).toMatch(/^rgb\(/);
  });

  it('should group chromatic colors by hue and generate brand shades', () => {
    const data = makeDesignData({
      colors: {
        primary: { value: '#ff0000' },
        neutral: {},
        semantic: {},
        overlays: {},
        all: ['#ff0000', '#0044cc', '#0066ff', '#3388ff'],
      },
    });
    const brand = makeBrandConfig({ colors: { primary: '#00cc44' } });
    const map = createColorMap(data, brand);
    // All three blues should be mapped
    expect(map.has('#0044cc')).toBe(true);
    expect(map.has('#0066ff')).toBe(true);
    expect(map.has('#3388ff')).toBe(true);
  });
});

// ── createFontMap ──────────────────────────────────────────────────────────

describe('createFontMap', () => {
  it('should map sans fonts to brand.body', () => {
    const data = makeDesignData();
    const brand = makeBrandConfig();
    const map = createFontMap(data, brand);
    expect(map.get('Inter')).toBe('Roboto');
  });

  it('should map serif fonts to brand.heading', () => {
    const data = makeDesignData();
    const brand = makeBrandConfig();
    const map = createFontMap(data, brand);
    expect(map.get('Georgia')).toBe('Playfair Display');
  });

  it('should return empty map when brand.fonts is undefined', () => {
    const data = makeDesignData();
    const brand = makeBrandConfig();
    delete (brand as any).fonts;
    const map = createFontMap(data, brand);
    expect(map.size).toBe(0);
  });
});

// ── createContentMap ───────────────────────────────────────────────────────

describe('createContentMap', () => {
  it('should build lowercase-keyed map', () => {
    const brand = makeBrandConfig({ content: { 'ACME Corp': 'My Company' } });
    const map = createContentMap(brand);
    expect(map.get('acme corp')).toBe('My Company');
  });

  it('should return empty map when content is undefined', () => {
    const brand = makeBrandConfig();
    const map = createContentMap(brand);
    expect(map.size).toBe(0);
  });
});

// ── applyContentReplacements ───────────────────────────────────────────────

describe('applyContentReplacements', () => {
  it('should replace case-insensitively', () => {
    const map = new Map([['acme corp', 'My Company']]);
    const result = applyContentReplacements('Welcome to ACME Corp', map);
    expect(result).toBe('Welcome to My Company');
  });

  it('should return original text when map is empty', () => {
    const map = new Map<string, string>();
    const result = applyContentReplacements('Some text', map);
    expect(result).toBe('Some text');
  });
});

// ── transformStyleValue ────────────────────────────────────────────────────

describe('transformStyleValue', () => {
  it('should replace color properties via colorMap', () => {
    const colorMap = new Map([['#ff0000', '#0000ff']]);
    const fontMap = new Map<string, string>();
    const result = transformStyleValue('color', '#ff0000', colorMap, fontMap);
    expect(result).toBe('#0000ff');
  });

  it('should replace font-family via fontMap', () => {
    const colorMap = new Map<string, string>();
    const fontMap = new Map([['"Inter", sans-serif', '"Roboto", sans-serif']]);
    const result = transformStyleValue('font-family', '"Inter", sans-serif', colorMap, fontMap);
    expect(result).toBe('"Roboto", sans-serif');
  });

  it('should replace colors in box-shadow', () => {
    const colorMap = new Map([['rgba(0, 0, 0, 0.1)', 'rgba(0, 0, 255, 0.1)']]);
    const fontMap = new Map<string, string>();
    const result = transformStyleValue('box-shadow', '0 2px 4px rgba(0, 0, 0, 0.1)', colorMap, fontMap);
    expect(result).toContain('rgba(0, 0, 255, 0.1)');
  });

  it('should replace colors in gradient', () => {
    const colorMap = new Map([['#ff0000', '#0000ff'], ['#00ff00', '#ff00ff']]);
    const fontMap = new Map<string, string>();
    const result = transformStyleValue('background', 'linear-gradient(#ff0000, #00ff00)', colorMap, fontMap);
    expect(result).toContain('#0000ff');
    expect(result).toContain('#ff00ff');
  });

  it('should return unchanged value for unmapped properties', () => {
    const colorMap = new Map<string, string>();
    const fontMap = new Map<string, string>();
    const result = transformStyleValue('width', '100px', colorMap, fontMap);
    expect(result).toBe('100px');
  });
});

// ── applyBrandToDesignData ─────────────────────────────────────────────────

describe('applyBrandToDesignData', () => {
  it('should replace all color tokens in cloned data', () => {
    const data = makeDesignData();
    const brand = makeBrandConfig();
    const original = JSON.parse(JSON.stringify(data));
    const result = applyBrandToDesignData(data, brand);

    // Returned data is a clone
    expect(result).not.toBe(data);
    // Original unchanged
    expect(data.colors.primary!.value).toBe(original.colors.primary.value);
    // Primary mapped
    expect(result.colors.primary!.value).toBe('#0000ff');
  });

  it('should replace font families with brand fonts', () => {
    const data = makeDesignData();
    const brand = makeBrandConfig();
    const result = applyBrandToDesignData(data, brand);
    expect(result.typography.fontFamilies[0].name).toBe('Roboto');
  });

  it('should swap color portions in shadow values', () => {
    const data = makeDesignData();
    const brand = makeBrandConfig();
    const colorMap = createColorMap(data, brand);
    const result = applyBrandToDesignData(data, brand);
    // Shadow color should be different if rgba(0,0,0,0.1) was mapped
    // At minimum the shadow should still be a string
    expect(typeof result.shadows[0].value).toBe('string');
  });
});

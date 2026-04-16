import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readDesignData } from '../../../src/export/adapters/reader';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('../../../src/brand/brand', () => ({
  applyBrandToDesignData: vi.fn((data: any) => ({ ...data, _branded: true })),
}));

import * as fs from 'fs';

// ── Test Fixtures ──────────────────────────────────────────────────────────

const designSystemJson = {
  metadata: { sourceUrl: 'https://example.com' },
  tokens: {
    colors: {
      primary: { value: '#ff0000' },
      secondary: { value: '#00ff00' },
      accent: { value: '#0000ff' },
      neutral: { '100': { value: '#f5f5f5' }, '900': { value: '#111' } },
      semantic: { background: { value: '#fff' } },
      overlays: { modal: { value: 'rgba(0,0,0,0.5)' } },
      all: ['#ff0000'],
    },
    typography: {
      fontFamilies: [
        { name: 'Inter', stack: '"Inter", sans-serif', weights: [400, 700] },
      ],
      scale: [
        { size: '16px', font: 'Inter', weight: 400, lineHeight: '24px', letterSpacing: 'normal' },
      ],
      weights: [400, 700],
      lineHeights: ['24px'],
      letterSpacings: ['normal'],
    },
    spacing: { scale: [4, 8, 16], baseUnit: '4px' },
    borderRadius: [{ value: '4px' }],
    shadows: [{ name: 'sm', value: '0 1px 2px rgba(0,0,0,.1)' }],
    transitions: { durations: ['200ms'], timingFunctions: ['ease'] },
    zIndex: { scale: [10, 100] },
  },
  layout: {
    breakpoints: { sm: { min: '640px' } },
    containerWidths: { md: '768px' },
  },
};

const scanResultJson = {
  url: 'https://example.com',
  colorPalette: ['#ff0000', '#00ff00'],
  typographyMap: [
    { fontFamily: '"Inter", sans-serif', fontSize: '16px', fontWeight: '400', lineHeight: '24px' },
    { fontFamily: '"Inter", sans-serif', fontSize: '24px', fontWeight: '700', lineHeight: '32px' },
  ],
  spacingValues: ['16px', '8px', '32px', '0px'],
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('readDesignData', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should read from design-system.json when it exists', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      return String(p).includes('design-system.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(designSystemJson));

    const data = readDesignData('/tmp/output');
    expect(data.source).toBe('design-system');
    expect(data.colors.primary?.value).toBe('#ff0000');
    expect(data.typography.fontFamilies).toHaveLength(1);
    expect(data.spacing.scale).toEqual([4, 8, 16]);
  });

  it('should fall back to scan-result.json when design-system.json missing', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      return String(p).includes('scan-result.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(scanResultJson));

    const data = readDesignData('/tmp/output');
    expect(data.source).toBe('scan-result');
  });

  it('should throw when neither file exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(() => readDesignData('/tmp/output')).toThrow('No design data found');
  });

  it('should apply brand overrides when brand config provided', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      return String(p).includes('design-system.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(designSystemJson));

    const brand = { colors: { primary: '#0000ff' } } as any;
    const data = readDesignData('/tmp/output', brand);
    expect((data as any)._branded).toBe(true);
  });

  it('should handle missing optional fields gracefully', () => {
    const minimal = {
      metadata: { sourceUrl: 'https://example.com' },
      tokens: {
        colors: { all: [] },
        typography: {},
        spacing: {},
      },
      layout: {},
    };
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      return String(p).includes('design-system.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(minimal));

    const data = readDesignData('/tmp/output');
    expect(data.shadows).toEqual([]);
    expect(data.zIndex).toEqual([]);
    expect(data.breakpoints).toEqual({});
  });

  it('readFromScanResult should build fontFamilies from typographyMap', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      return String(p).includes('scan-result.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(scanResultJson));

    const data = readDesignData('/tmp/output');
    expect(data.typography.fontFamilies).toHaveLength(1);
    expect(data.typography.fontFamilies[0].name).toBe('Inter');
    expect(data.typography.fontFamilies[0].weights).toEqual([400, 700]);
  });

  it('readFromScanResult should parse spacing values to sorted numbers', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      return String(p).includes('scan-result.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(scanResultJson));

    const data = readDesignData('/tmp/output');
    expect(data.spacing.scale).toEqual([8, 16, 32]);
  });
});

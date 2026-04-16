import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateTailwindConfig } from '../../../src/export/adapters/tailwind';
import type { DesignData } from '../../../src/export/adapters/reader';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import * as fs from 'fs';

// ── Test Helpers ───────────────────────────────────────────────────────────

function makeDesignData(overrides: Partial<DesignData> = {}): DesignData {
  return {
    source: 'design-system',
    sourceUrl: 'https://example.com',
    colors: {
      primary: { value: 'rgb(255, 0, 0)' },
      secondary: { value: 'rgb(0, 255, 0)' },
      accent: { value: '#0000ff' },
      neutral: { '100': { value: '#f5f5f5' }, '900': { value: '#111111' } },
      semantic: { background: { value: '#ffffff' } },
      overlays: { modal: { value: 'rgba(0, 0, 0, 0.5)' } },
      all: [],
    },
    typography: {
      fontFamilies: [
        { name: 'Inter', stack: '"Inter", Arial, sans-serif', weights: [400, 700] },
      ],
      scale: [
        { size: '14px', font: 'Inter', weight: 400, lineHeight: '22.4px', letterSpacing: 'normal' },
        { size: '32px', font: 'Inter', weight: 700, lineHeight: '38.4px', letterSpacing: '-0.02em' },
        { size: '18px', font: 'Inter', weight: 400, lineHeight: '27px', letterSpacing: 'normal' },
      ],
      weights: [400, 700],
      lineHeights: ['22.4px', '27px', '38.4px'],
      letterSpacings: ['normal', '-0.02em'],
    },
    spacing: { scale: [4, 8, 16, 32], baseUnit: '4px' },
    borderRadius: [{ value: '4px' }, { value: '8px' }],
    shadows: [{ name: 'sm', value: '0 1px 2px rgba(0,0,0,0.05)' }],
    transitions: { durations: ['200ms'], timingFunctions: ['ease'] },
    zIndex: [{ value: 10 }, { value: 100 }],
    breakpoints: { sm: { min: '640px' }, lg: { min: '1024px' } },
    containerWidths: {},
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('generateTailwindConfig', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should generate valid TypeScript config string', () => {
    const data = makeDesignData();
    generateTailwindConfig(data, { outputDir: '/tmp/out' });
    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain('import type { Config }');
    expect(written).toContain('const config: Config');
    expect(written).toContain('export default config');
  });

  it('should include primary/secondary/accent colors as hex', () => {
    const data = makeDesignData();
    generateTailwindConfig(data, { outputDir: '/tmp/out' });
    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain('primary: "#ff0000"');
    expect(written).toContain('secondary: "#00ff00"');
  });

  it('should build fontSize tuples with lineHeight and letterSpacing', () => {
    const data = makeDesignData();
    generateTailwindConfig(data, { outputDir: '/tmp/out' });
    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain('lineHeight:');
    expect(written).toContain('letterSpacing:');
  });

  it('should sort font sizes by pixel value ascending', () => {
    const data = makeDesignData();
    generateTailwindConfig(data, { outputDir: '/tmp/out' });
    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    // Extract fontSize entries — they use the tuple format: name: ["Npx", { lineHeight... }]
    const fontSizeSection = written.match(/fontSize:\s*\{[\s\S]*?\n\s{4}\}/)?.[0] || '';
    const sizeMatches = [...fontSizeSection.matchAll(/\["(\d+)px"/g)].map(m => parseInt(m[1]));
    expect(sizeMatches.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < sizeMatches.length; i++) {
      expect(sizeMatches[i]).toBeGreaterThanOrEqual(sizeMatches[i - 1]);
    }
  });

  it('should assign standard Tailwind size names', () => {
    const data = makeDesignData();
    generateTailwindConfig(data, { outputDir: '/tmp/out' });
    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain('xs:');
    expect(written).toContain('sm:');
    expect(written).toContain('base:');
  });

  it('should handle empty design data gracefully', () => {
    const data = makeDesignData({
      colors: { neutral: {}, semantic: {}, overlays: {}, all: [] },
      typography: { fontFamilies: [], scale: [], weights: [], lineHeights: [], letterSpacings: [] },
      spacing: { scale: [], baseUnit: '4px' },
      borderRadius: [],
      shadows: [],
      zIndex: [],
      breakpoints: {},
    });
    generateTailwindConfig(data, { outputDir: '/tmp/out' });
    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain('const config: Config');
    expect(written).not.toContain('undefined');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCSSVariables } from '../../../src/export/adapters/css-variables';
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
      secondary: { value: '#00ff00' },
      neutral: { '100': { value: '#f5f5f5' } },
      semantic: { background: { value: '#ffffff' } },
      overlays: { modalBg: { value: 'rgba(0, 0, 0, 0.5)' } },
      all: [],
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
    shadows: [{ name: 'sm', value: '0 1px 2px rgba(0,0,0,0.05)' }],
    transitions: { durations: ['200ms'], timingFunctions: ['ease'] },
    zIndex: [{ value: 10 }],
    breakpoints: { sm: { min: '640px' } },
    containerWidths: {},
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('generateCSSVariables', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should generate :root block with color variables', () => {
    const data = makeDesignData();
    generateCSSVariables(data, { outputDir: '/tmp/out' });
    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain(':root {');
    expect(written).toContain('--color-primary:');
    expect(written).toContain('--color-secondary:');
  });

  it('should apply prefix to all variable names when provided', () => {
    const data = makeDesignData();
    generateCSSVariables(data, { outputDir: '/tmp/out', prefix: 'ds' });
    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain('--ds-color-primary:');
    // All custom property declarations should use the prefix
    const lines = written.split('\n').filter(l => l.includes('--'));
    for (const line of lines) {
      if (line.trim().startsWith('--')) {
        expect(line).toContain('--ds-');
      }
    }
  });

  it('should include typography and spacing sections', () => {
    const data = makeDesignData();
    generateCSSVariables(data, { outputDir: '/tmp/out' });
    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain('Typography');
    expect(written).toContain('Spacing');
    expect(written).toContain('--font-');
    expect(written).toContain('--space-');
  });

  it('should preserve rgba for overlay colors', () => {
    const data = makeDesignData();
    generateCSSVariables(data, { outputDir: '/tmp/out' });
    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain('rgba(0, 0, 0, 0.5)');
  });

  it('should handle empty design data without errors', () => {
    const data = makeDesignData({
      colors: { neutral: {}, semantic: {}, overlays: {}, all: [] },
      typography: { fontFamilies: [], scale: [], weights: [], lineHeights: [], letterSpacings: [] },
      spacing: { scale: [], baseUnit: '4px' },
      borderRadius: [],
      shadows: [],
      zIndex: [],
      breakpoints: {},
      transitions: { durations: [], timingFunctions: [] },
    });
    generateCSSVariables(data, { outputDir: '/tmp/out' });
    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain(':root {');
    expect(written).toContain('}');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateDesignMd } from '../../../src/export/adapters/design-md';
import type { DesignData } from '../../../src/export/adapters/reader';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
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
        { size: '16px', font: 'Inter', weight: 400, lineHeight: '24px', letterSpacing: 'normal' },
        { size: '32px', font: 'Inter', weight: 700, lineHeight: '38.4px', letterSpacing: '-0.02em' },
      ],
      weights: [400, 700],
      lineHeights: ['24px', '38.4px'],
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

function getWrittenContent(): string {
  const calls = vi.mocked(fs.writeFileSync).mock.calls;
  if (calls.length === 0) return '';
  return calls[0][1] as string;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('generateDesignMd', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
  });

  it('should return the output file path', () => {
    const data = makeDesignData();
    const result = generateDesignMd(data, { outputDir: '/tmp/out', inputDir: '/tmp/in' });
    expect(result).toContain('DESIGN.md');
  });

  it('should write a markdown file to disk', () => {
    const data = makeDesignData();
    generateDesignMd(data, { outputDir: '/tmp/out', inputDir: '/tmp/in' });
    expect(fs.writeFileSync).toHaveBeenCalled();
    const content = getWrittenContent();
    expect(content.length).toBeGreaterThan(100);
  });

  it('should include design system header', () => {
    const data = makeDesignData();
    generateDesignMd(data, { outputDir: '/tmp/out', inputDir: '/tmp/in' });
    const content = getWrittenContent();
    expect(content).toContain('Design System');
  });

  it('should include color tokens', () => {
    const data = makeDesignData();
    generateDesignMd(data, { outputDir: '/tmp/out', inputDir: '/tmp/in' });
    const content = getWrittenContent();
    // Should contain hex color from primary rgb(255, 0, 0) -> #ff0000
    expect(content.toLowerCase()).toMatch(/#ff0000|primary|rgb\(255/);
  });

  it('should include typography information', () => {
    const data = makeDesignData();
    generateDesignMd(data, { outputDir: '/tmp/out', inputDir: '/tmp/in' });
    const content = getWrittenContent();
    expect(content).toContain('Inter');
  });

  it('should include spacing data', () => {
    const data = makeDesignData();
    generateDesignMd(data, { outputDir: '/tmp/out', inputDir: '/tmp/in' });
    const content = getWrittenContent();
    expect(content.toLowerCase()).toMatch(/spacing|4px|8px|16px/);
  });
});

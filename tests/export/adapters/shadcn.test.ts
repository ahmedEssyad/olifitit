import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateShadcnTheme } from '../../../src/export/adapters/shadcn';
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
      primary: { value: 'rgb(59, 130, 246)' },
      secondary: { value: 'rgb(30, 30, 30)' },
      accent: { value: 'rgb(239, 68, 68)' },
      neutral: {
        '50': { value: 'rgb(250, 250, 250)' },
        '100': { value: 'rgb(245, 245, 245)' },
        '200': { value: 'rgb(229, 229, 229)' },
        '400': { value: 'rgb(163, 163, 163)' },
        '500': { value: 'rgb(115, 115, 115)' },
        '800': { value: 'rgb(38, 38, 38)' },
        '900': { value: 'rgb(23, 23, 23)' },
        '950': { value: 'rgb(10, 10, 10)' },
      },
      semantic: {},
      overlays: {},
      all: [],
    },
    typography: {
      fontFamilies: [
        { name: 'Inter', stack: '"Inter", sans-serif', weights: [400, 700] },
      ],
      scale: [],
      weights: [400, 700],
      lineHeights: [],
      letterSpacings: [],
    },
    spacing: { scale: [4, 8, 16], baseUnit: '4px' },
    borderRadius: [{ value: '6px' }, { value: '10px' }],
    shadows: [{ name: 'sm', value: '0 1px 2px rgba(0,0,0,0.05)' }],
    transitions: { durations: [], timingFunctions: [] },
    zIndex: [],
    breakpoints: { sm: { min: '640px' } },
    containerWidths: {},
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('generateShadcnTheme', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should generate globals.css with :root HSL variables', () => {
    const data = makeDesignData();
    generateShadcnTheme(data, { outputDir: '/tmp/out' });

    // First writeFileSync call is globals.css, second is tailwind.config.ts
    const globalsCss = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(globalsCss).toContain(':root {');
    expect(globalsCss).toContain('--background:');
    expect(globalsCss).toContain('--primary:');
  });

  it('should generate dark mode variables in .dark selector', () => {
    const data = makeDesignData();
    generateShadcnTheme(data, { outputDir: '/tmp/out' });

    const globalsCss = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(globalsCss).toContain('.dark {');
  });

  it('should generate tailwind.config.ts with shadcn color structure', () => {
    const data = makeDesignData();
    generateShadcnTheme(data, { outputDir: '/tmp/out' });

    const tailwindConfig = vi.mocked(fs.writeFileSync).mock.calls[1][1] as string;
    expect(tailwindConfig).toContain('hsl(var(--primary))');
    expect(tailwindConfig).toContain('darkMode: ["class"]');
    expect(tailwindConfig).toContain('require("tailwindcss-animate")');
  });

  it('should map all 18+ shadcn semantic slots', () => {
    const data = makeDesignData();
    generateShadcnTheme(data, { outputDir: '/tmp/out' });

    const globalsCss = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    const expectedSlots = [
      '--background:', '--foreground:', '--card:', '--card-foreground:',
      '--popover:', '--popover-foreground:', '--primary:', '--primary-foreground:',
      '--secondary:', '--secondary-foreground:', '--muted:', '--muted-foreground:',
      '--accent:', '--accent-foreground:', '--destructive:', '--destructive-foreground:',
      '--border:', '--input:', '--ring:',
    ];
    for (const slot of expectedSlots) {
      expect(globalsCss).toContain(slot);
    }
  });

  it('should pick default radius from borderRadius data', () => {
    const data = makeDesignData();
    generateShadcnTheme(data, { outputDir: '/tmp/out' });

    const globalsCss = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(globalsCss).toContain('--radius:');
  });
});

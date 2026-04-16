import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('../../src/core/utils', () => ({
  log: vi.fn(),
}));

import * as fs from 'fs';

// We need to test the internal helper functions. Since they are not exported,
// we test them indirectly through the main distillMotion export.
// However, some helpers can be tested by importing the module and checking
// the output of distillMotion.

// For testing helper functions directly, we re-implement the logic check
// through the main exported function's output.

import { distillMotion } from '../../src/transform/distill-motion';

// ── distillMotion (main export) ────────────────────────────────────────────

describe('distillMotion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return empty result when motion-capture.json missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const result = distillMotion('/tmp/output');
    expect(result.summary.totalAnimatedElements).toBe(0);
    expect(result.animations).toEqual([]);
  });

  it('should return empty result when no viewport data found', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      url: 'https://example.com',
      timestamp: '2024-01-01T00:00:00Z',
      viewports: [],
    }));
    const result = distillMotion('/tmp/output');
    expect(result.summary.totalAnimatedElements).toBe(0);
  });

  it('should process scroll-triggered entrance animations', () => {
    const motionData = {
      url: 'https://example.com',
      timestamp: '2024-01-01T00:00:00Z',
      viewports: [{
        viewportWidth: 1440,
        globalPatterns: {
          entranceAnimations: [{
            selector: '.hero-title',
            from: { opacity: '0', transform: 'translateY(20px)' },
            to: { opacity: '1', transform: 'none' },
            duration: '0.6s',
            easing: 'ease-out',
            triggerScroll: 200,
          }],
        },
        elements: [],
        hoverTransitions: [],
        focusTransitions: [],
        cssAnimations: [],
      }],
    };

    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      return String(p).includes('motion-capture.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(motionData));

    const result = distillMotion('/tmp/output');
    expect(result.animations.length).toBeGreaterThan(0);
    expect(result.summary.entrance).toBeGreaterThan(0);
  });

  it('should process hover transitions', () => {
    const motionData = {
      url: 'https://example.com',
      timestamp: '2024-01-01T00:00:00Z',
      viewports: [{
        viewportWidth: 1440,
        globalPatterns: {
          hoverTransitions: [{
            selector: '.btn',
            from: { color: '#333' },
            to: { color: '#ff0000' },
            duration: '0.2s',
            easing: 'ease',
          }],
        },
        elements: [],
        hoverTransitions: [],
        focusTransitions: [],
        cssAnimations: [],
      }],
    };

    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      return String(p).includes('motion-capture.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(motionData));

    const result = distillMotion('/tmp/output');
    const hoverAnims = result.animations.filter(a => a.trigger === 'hover');
    expect(hoverAnims.length).toBeGreaterThan(0);
    expect(result.summary.hover).toBeGreaterThan(0);
  });

  it('should throw for invalid JSON in motion-capture.json', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('not valid json');
    expect(() => distillMotion('/tmp/output')).toThrow('Failed to parse motion-capture.json');
  });
});

// ── Helper function tests via indirect observation ─────────────────────────
// These test the internal helper functions by verifying their effects on
// the distillMotion output.

describe('distillMotion helpers (tested via output)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('classifyEntrance should detect fade-in from opacity 0', () => {
    const motionData = {
      url: 'https://example.com',
      timestamp: '2024-01-01T00:00:00Z',
      viewports: [{
        viewportWidth: 1440,
        globalPatterns: {
          entranceAnimations: [{
            selector: '.fade-el',
            from: { opacity: '0' },
            to: { opacity: '1' },
            duration: '0.5s',
            easing: 'ease',
            triggerScroll: 300,
          }],
        },
        elements: [],
        hoverTransitions: [],
        focusTransitions: [],
        cssAnimations: [],
      }],
    };
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).includes('motion-capture.json')
    );
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(motionData));

    const result = distillMotion('/tmp/output');
    expect(result.summary.entrance).toBeGreaterThan(0);
  });

  it('deduplicateAnimations should merge identical animations', () => {
    const motionData = {
      url: 'https://example.com',
      timestamp: '2024-01-01T00:00:00Z',
      viewports: [{
        viewportWidth: 1440,
        globalPatterns: {
          entranceAnimations: [
            {
              selector: '.card-1',
              from: { opacity: '0' },
              to: { opacity: '1' },
              duration: '0.6s',
              easing: 'ease-out',
              triggerScroll: 500,
            },
            {
              selector: '.card-2',
              from: { opacity: '0' },
              to: { opacity: '1' },
              duration: '0.6s',
              easing: 'ease-out',
              triggerScroll: 500,
            },
          ],
        },
        elements: [],
        hoverTransitions: [],
        focusTransitions: [],
        cssAnimations: [],
      }],
    };
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).includes('motion-capture.json')
    );
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(motionData));

    const result = distillMotion('/tmp/output');
    // Deduplicated: two identical animations (same from/to/duration/trigger)
    // should be merged into 1
    expect(result.animations.length).toBe(1);
    expect(result.animations[0].element).toContain('+');
  });
});

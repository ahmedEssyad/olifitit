import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  validateArgs,
  safeJsonResponse,
  cleanupTempDir,
  listOutputFiles,
  withNextSteps,
} from '../../src/mcp/helpers';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock('os', () => ({
  tmpdir: () => '/tmp',
}));

vi.mock('../../src/core/security', () => ({
  validateUrl: vi.fn(),
}));

import * as fs from 'fs';

// ── validateArgs ───────────────────────────────────────────────────────────

describe('validateArgs', () => {
  it('should return parsed data for valid input', () => {
    const schema = z.object({ url: z.string() });
    const result = validateArgs(schema, { url: 'https://example.com' });
    expect(result).toEqual({ url: 'https://example.com' });
  });

  it('should throw ValidationError for invalid input', () => {
    const schema = z.object({ url: z.string() });
    expect(() => validateArgs(schema, {})).toThrow();
    try {
      validateArgs(schema, {});
    } catch (err: any) {
      expect(err.code).toBe('INVALID_INPUT');
    }
  });
});

// ── safeJsonResponse ───────────────────────────────────────────────────────

describe('safeJsonResponse', () => {
  it('should return full JSON when under size limit', () => {
    const data = { result: 'ok', value: 42 };
    const json = safeJsonResponse(data);
    expect(json).toBe(JSON.stringify(data, null, 2));
  });

  it('should summarize when over size limit', () => {
    const data = {
      overallScore: 95,
      screenshotComparisons: [
        { breakpoint: '1440px', matchPercentage: 99, pixels: 'x'.repeat(200) },
      ],
      domDiscrepancies: [{ id: 1 }, { id: 2 }],
    };
    const json = safeJsonResponse(data, 100);
    const parsed = JSON.parse(json);
    expect(parsed._note).toContain('summarized');
    expect(parsed.overallScore).toBe(95);
  });
});

// ── cleanupTempDir ─────────────────────────────────────────────────────────

describe('cleanupTempDir', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should not delete when isTemp is false', () => {
    cleanupTempDir('/some/dir', false);
    expect(fs.rmSync).not.toHaveBeenCalled();
  });

  it('should delete when isTemp is true', () => {
    cleanupTempDir('/some/dir', true);
    expect(fs.rmSync).toHaveBeenCalledWith('/some/dir', { recursive: true, force: true });
  });
});

// ── listOutputFiles ────────────────────────────────────────────────────────

describe('listOutputFiles', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return files that exist with sizes', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = String(p);
      return s.includes('scan-result.json') || s.includes('design-system.json');
    });
    vi.mocked(fs.statSync).mockReturnValue({ size: 10240 } as any);

    const files = listOutputFiles('/tmp/output');
    expect(files.length).toBe(2);
    expect(files[0].sizeKB).toBeCloseTo(10, 0);
  });
});

// ── withNextSteps ──────────────────────────────────────────────────────────

describe('withNextSteps', () => {
  it('should inject nextSteps array into response', () => {
    const result = withNextSteps({ score: 95 }, ['run export_tokens']);
    const text = result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.nextSteps).toEqual(['run export_tokens']);
    expect(parsed.score).toBe(95);
  });

  it('should handle string data input', () => {
    const result = withNextSteps('ok', ['next step']);
    const text = result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.result).toBe('ok');
    expect(parsed.nextSteps).toEqual(['next step']);
  });
});

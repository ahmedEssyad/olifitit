import { describe, it, expect } from 'vitest';
import {
  ExtractDesignSystemInput,
  ExtractComponentInput,
  InteractInput,
  RunPipelineInput,
} from '../../src/mcp/schemas';

describe('ExtractDesignSystemInput', () => {
  it('accepts valid input with required fields only', () => {
    const result = ExtractDesignSystemInput.safeParse({ url: 'https://example.com' });
    expect(result.success).toBe(true);
  });

  it('accepts valid input with all optional fields', () => {
    const result = ExtractDesignSystemInput.safeParse({
      url: 'https://example.com',
      crawl: true,
      auth_cookie: 'session=abc',
      auth_header: 'Authorization: Bearer xyz',
      output_dir: './out',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing url', () => {
    const result = ExtractDesignSystemInput.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid url type', () => {
    const result = ExtractDesignSystemInput.safeParse({ url: 123 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid crawl type', () => {
    const result = ExtractDesignSystemInput.safeParse({ url: 'https://x.com', crawl: 'yes' });
    expect(result.success).toBe(false);
  });
});

describe('ExtractComponentInput', () => {
  it('accepts valid input', () => {
    const result = ExtractComponentInput.safeParse({
      url: 'https://example.com',
      component: 'nav.main-nav',
    });
    expect(result.success).toBe(true);
  });

  it('accepts with optional include_children', () => {
    const result = ExtractComponentInput.safeParse({
      url: 'https://example.com',
      component: 'header',
      include_children: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing component', () => {
    const result = ExtractComponentInput.safeParse({ url: 'https://example.com' });
    expect(result.success).toBe(false);
  });

  it('rejects missing url', () => {
    const result = ExtractComponentInput.safeParse({ component: 'nav' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid types', () => {
    const result = ExtractComponentInput.safeParse({ url: 42, component: true });
    expect(result.success).toBe(false);
  });
});

describe('InteractInput', () => {
  it('accepts valid input with actions', () => {
    const result = InteractInput.safeParse({
      url: 'https://example.com',
      actions: [{ type: 'click', selector: '#btn' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts multiple actions with all fields', () => {
    const result = InteractInput.safeParse({
      url: 'https://example.com',
      actions: [
        { type: 'click', selector: '#btn', label: 'click button' },
        { type: 'type', selector: 'input', value: 'hello' },
        { type: 'hover', selector: '.card' },
        { type: 'scroll', position: { x: 0, y: 500 } },
        { type: 'wait', duration: 1000 },
        { type: 'screenshot', label: 'final state' },
      ],
      capture: 'both',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing url', () => {
    const result = InteractInput.safeParse({
      actions: [{ type: 'click', selector: '#btn' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing actions', () => {
    const result = InteractInput.safeParse({ url: 'https://example.com' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid action type', () => {
    const result = InteractInput.safeParse({
      url: 'https://example.com',
      actions: [{ type: 'destroy', selector: '#btn' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid capture value', () => {
    const result = InteractInput.safeParse({
      url: 'https://example.com',
      actions: [{ type: 'click', selector: '#btn' }],
      capture: 'video',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid capture values', () => {
    for (const capture of ['screenshot', 'styles', 'both', 'diff']) {
      const result = InteractInput.safeParse({
        url: 'https://example.com',
        actions: [{ type: 'click' }],
        capture,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe('RunPipelineInput', () => {
  it('accepts valid input with required fields only', () => {
    const result = RunPipelineInput.safeParse({ url: 'https://example.com' });
    expect(result.success).toBe(true);
  });

  it('accepts all optional fields', () => {
    const result = RunPipelineInput.safeParse({
      url: 'https://example.com',
      output_dir: './output',
      rebuild_dir: './rebuild',
      crawl: true,
      auth_cookie: 'k=v',
      auth_header: 'Auth: Bearer x',
      full: true,
      rebuild_url: 'http://localhost:3000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing url', () => {
    const result = RunPipelineInput.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid url type', () => {
    const result = RunPipelineInput.safeParse({ url: false });
    expect(result.success).toBe(false);
  });

  it('rejects invalid optional field types', () => {
    const result = RunPipelineInput.safeParse({
      url: 'https://example.com',
      crawl: 'yes',
      full: 'true',
    });
    expect(result.success).toBe(false);
  });
});

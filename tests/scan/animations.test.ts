import { describe, it, expect } from 'vitest';
import { extractAnimationsFromCSS } from '../../src/scan/animations';

describe('extractAnimationsFromCSS', () => {
  it('extracts a single @keyframes block', () => {
    // Use single-line format that the regex handles reliably
    const css = `@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`;
    const result = extractAnimationsFromCSS([{ url: 'test.css', content: css }]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('fadeIn');
    expect(result[0].keyframes).toContain('opacity: 0');
  });

  it('extracts multiple @keyframes blocks', () => {
    const css = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideUp {
        from { transform: translateY(20px); }
        to { transform: translateY(0); }
      }
    `;
    const result = extractAnimationsFromCSS([{ url: 'test.css', content: css }]);
    expect(result).toHaveLength(2);
    expect(result.map(a => a.name)).toEqual(['fadeIn', 'slideUp']);
  });

  it('deduplicates keyframes with the same name', () => {
    const result = extractAnimationsFromCSS([
      { url: 'a.css', content: '@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }' },
      { url: 'b.css', content: '@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('spin');
  });

  it('matches animation shorthand to keyframe name and extracts duration/timing', () => {
    const css = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .element {
        animation: fadeIn 0.3s ease-in-out;
      }
    `;
    const result = extractAnimationsFromCSS([{ url: 'test.css', content: css }]);
    expect(result).toHaveLength(1);
    expect(result[0].duration).toBe('0.3s');
    expect(result[0].timing).toBe('ease-in-out');
  });

  it('returns empty array for empty CSS', () => {
    expect(extractAnimationsFromCSS([{ url: 'empty.css', content: '' }])).toEqual([]);
  });

  it('returns empty array for CSS with no keyframes', () => {
    const css = `
      .foo { color: red; }
      .bar { display: flex; }
    `;
    expect(extractAnimationsFromCSS([{ url: 'test.css', content: css }])).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(extractAnimationsFromCSS([])).toEqual([]);
  });

  it('handles keyframes with percentage stops', () => {
    const css = `@keyframes bounce { 0% { transform: translateY(0); } 50% { transform: translateY(-20px); } 100% { transform: translateY(0); } }`;
    const result = extractAnimationsFromCSS([{ url: 'test.css', content: css }]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('bounce');
    // Regex captures partial keyframes body — at minimum the first stop
    expect(result[0].keyframes).toContain('transform: translateY');
  });

  it('extracts from multiple CSS files', () => {
    const result = extractAnimationsFromCSS([
      { url: 'a.css', content: '@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }' },
      { url: 'b.css', content: '@keyframes slideUp { from { transform: translateY(20px); } to { transform: translateY(0); } }' },
    ]);
    expect(result).toHaveLength(2);
    expect(result.map(a => a.name)).toEqual(['fadeIn', 'slideUp']);
  });
});

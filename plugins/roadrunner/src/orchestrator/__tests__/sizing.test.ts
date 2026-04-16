import { describe, it, expect } from 'vitest';
import {
  countProseTokens,
  countProseLines,
  countFileBlastRadius,
  evaluateSizing,
} from '../sizing.js';
import type { SizingConfig } from '../types.js';

// ---------------------------------------------------------------------------
// countProseTokens
// ---------------------------------------------------------------------------
describe('countProseTokens', () => {
  it('approximates token count for plain prose', () => {
    // 40 chars of prose → ~10 tokens at 4 chars/token
    const content = 'This is a sentence with some words here.'; // 40 chars
    const result = countProseTokens(content);
    expect(result).toBe(10);
  });

  it('excludes fenced code blocks from token count', () => {
    const content = [
      'Some prose before.',
      '```typescript',
      'const x = 1; // lots of code here that should not count',
      '```',
      'Some prose after.',
    ].join('\n');
    const proseOnly = 'Some prose before.\nSome prose after.\n';
    const expected = Math.floor(proseOnly.length / 4);
    const result = countProseTokens(content);
    expect(result).toBe(expected);
  });

  it('excludes JSON fenced code blocks', () => {
    const content = [
      'Intro text here.',
      '```json',
      '{ "key": "value", "nested": { "a": 1 } }',
      '```',
    ].join('\n');
    const proseOnly = 'Intro text here.\n';
    const expected = Math.floor(proseOnly.length / 4);
    const result = countProseTokens(content);
    expect(result).toBe(expected);
  });

  it('returns 0 for empty content', () => {
    expect(countProseTokens('')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// countProseLines
// ---------------------------------------------------------------------------
describe('countProseLines', () => {
  it('counts non-blank lines excluding code blocks', () => {
    const content = [
      'Line one.',
      'Line two.',
      'Line three.',
    ].join('\n');
    expect(countProseLines(content)).toBe(3);
  });

  it('excludes blank lines', () => {
    const content = 'Line one.\n\nLine two.\n\n\nLine three.';
    expect(countProseLines(content)).toBe(3);
  });

  it('returns 0 for empty content', () => {
    expect(countProseLines('')).toBe(0);
  });

  it('returns 0 for code-only content', () => {
    const content = '```python\nprint("hello")\n```';
    expect(countProseLines(content)).toBe(0);
  });

  it('excludes lines inside fenced code blocks', () => {
    const content = [
      'Prose line one.',
      '```bash',
      'echo hello',
      'echo world',
      '```',
      'Prose line two.',
    ].join('\n');
    expect(countProseLines(content)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// countFileBlastRadius
// ---------------------------------------------------------------------------
describe('countFileBlastRadius', () => {
  it('counts distinct backtick-quoted paths', () => {
    const content = 'Edit `src/foo.ts` and `src/bar.ts` to fix this.';
    expect(countFileBlastRadius(content)).toBe(2);
  });

  it('counts bare paths with known extensions', () => {
    const content = 'Modify src/db/search.ts and update tests/search.test.ts.';
    expect(countFileBlastRadius(content)).toBe(2);
  });

  it('deduplicates repeated references', () => {
    const content = [
      'See `src/foo.ts` for details.',
      'Also update `src/foo.ts` with the new interface.',
      'And change `src/bar.py`.',
    ].join('\n');
    expect(countFileBlastRadius(content)).toBe(2);
  });

  it('returns 0 when no file paths are present', () => {
    const content = 'This document has no file references at all.';
    expect(countFileBlastRadius(content)).toBe(0);
  });

  it('handles multiple supported extensions', () => {
    const content = [
      '`config.json`',
      '`styles.scss`',
      '`index.html`',
      '`schema.sql`',
    ].join('\n');
    expect(countFileBlastRadius(content)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// evaluateSizing
// ---------------------------------------------------------------------------
describe('evaluateSizing', () => {
  const config: SizingConfig = {
    max_prose_tokens: 1000,
    max_prose_lines: 100,
    max_file_blast_radius: 10,
  };

  it('returns under when all metrics are below 70% of ceilings', () => {
    // ~600 chars → 150 tokens (15% of 1000), few lines, no files
    const content = 'Short spec.\nSecond line.\nThird line.';
    const result = evaluateSizing(content, config);
    expect(result.verdict).toBe('under');
  });

  it('returns over when token count exceeds ceiling', () => {
    // 1000 tokens * 4 chars = 4000 chars of prose needed to exceed 1000 tokens
    const longProse = 'word '.repeat(1100); // ~4400 chars → ~1100 tokens > 1000
    const result = evaluateSizing(longProse, config);
    expect(result.verdict).toBe('over');
    expect(result.token_count).toBeGreaterThan(1000);
  });

  it('returns over when prose line count exceeds ceiling', () => {
    const manyLines = Array.from({ length: 110 }, (_, i) => `Line ${i + 1}.`).join('\n');
    const result = evaluateSizing(manyLines, config);
    expect(result.verdict).toBe('over');
    expect(result.prose_line_count).toBeGreaterThan(100);
  });

  it('returns over when file blast radius exceeds ceiling', () => {
    const files = Array.from({ length: 15 }, (_, i) => `\`src/file${i}.ts\``).join('\n');
    const result = evaluateSizing(files, config);
    expect(result.verdict).toBe('over');
    expect(result.file_blast_radius).toBeGreaterThan(10);
  });

  it('returns ambiguous when a metric is in the 70-100% zone', () => {
    // 80 lines is 80% of the 100-line ceiling → ambiguous
    const eightyLines = Array.from({ length: 80 }, (_, i) => `Line ${i + 1}.`).join('\n');
    const result = evaluateSizing(eightyLines, config);
    expect(result.verdict).toBe('ambiguous');
    expect(result.prose_line_count).toBe(80);
  });

  it('returns under for code-only content', () => {
    const content = '```typescript\nconst x = Array.from({length: 200}, (_, i) => i);\n```';
    const result = evaluateSizing(content, config);
    expect(result.verdict).toBe('under');
    expect(result.token_count).toBe(0);
    expect(result.prose_line_count).toBe(0);
  });
});

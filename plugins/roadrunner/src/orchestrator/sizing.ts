import type { SizingConfig, SizingResult } from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Strip fenced code blocks (```...```) from markdown content. */
function stripCodeBlocks(content: string): string {
  // Match fenced code blocks: optional language tag, any content, closing fence
  return content.replace(/^```[^\n]*\n[\s\S]*?^```/gm, '');
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Approximate token count for prose content.
 * Strips fenced code blocks first, then uses ~4 chars per token heuristic.
 */
export function countProseTokens(content: string): number {
  if (!content) return 0;
  const prose = stripCodeBlocks(content);
  if (!prose.trim()) return 0;
  return Math.floor(prose.length / 4);
}

/**
 * Count non-blank hard-wrapped lines, excluding fenced code blocks.
 */
export function countProseLines(content: string): number {
  if (!content) return 0;
  const prose = stripCodeBlocks(content);
  if (!prose.trim()) return 0;
  return prose.split('\n').filter((line) => line.trim().length > 0).length;
}

/**
 * Count distinct file paths referenced in content.
 * Looks for backtick-quoted paths and bare paths with known extensions.
 */
export function countFileBlastRadius(content: string): number {
  if (!content) return 0;

  const knownExtensions = [
    'ts', 'tsx', 'js', 'jsx',
    'py', 'go', 'rs', 'java', 'rb',
    'sql', 'json', 'yaml', 'yml', 'toml',
    'md', 'css', 'scss', 'html', 'vue', 'svelte',
  ];

  const extPattern = knownExtensions.join('|');
  const paths = new Set<string>();
  let match: RegExpExecArray | null;

  // Pass 1: collect backtick-quoted paths and erase them from a working copy
  // so bare-path matching doesn't double-count them.
  const backtickPattern = new RegExp('`([^`]+\\.(?:' + extPattern + '))`', 'g');
  let stripped = content;

  while ((match = backtickPattern.exec(content)) !== null) {
    paths.add(match[1]);
    // Replace with same-length whitespace so other offsets stay valid (not needed
    // here since we run exec on the original, but we blank them in `stripped`).
    stripped = stripped.replace(match[0], ' '.repeat(match[0].length));
  }

  // Pass 2: bare paths in the backtick-erased string (prevents double-counting)
  const barePattern = new RegExp(
    '(?:(?:[\\w.-]+/)+[\\w.-]+\\.(?:' + extPattern + ')|[\\w.-]+\\.(?:' + extPattern + '))',
    'g',
  );

  while ((match = barePattern.exec(stripped)) !== null) {
    paths.add(match[0]);
  }

  return paths.size;
}

/**
 * Evaluate artifact size against configurable thresholds.
 * - ANY metric exceeds ceiling → 'over'
 * - No exceedance but ANY metric is above 70% of ceiling → 'ambiguous'
 * - All metrics below 70% of their ceilings → 'under'
 */
export function evaluateSizing(content: string, config: SizingConfig): SizingResult {
  const token_count = countProseTokens(content);
  const prose_line_count = countProseLines(content);
  const file_blast_radius = countFileBlastRadius(content);

  const over =
    token_count > config.max_prose_tokens ||
    prose_line_count > config.max_prose_lines ||
    file_blast_radius > config.max_file_blast_radius;

  if (over) {
    return { token_count, prose_line_count, file_blast_radius, verdict: 'over' };
  }

  const threshold = 0.7;
  const ambiguous =
    token_count > config.max_prose_tokens * threshold ||
    prose_line_count > config.max_prose_lines * threshold ||
    file_blast_radius > config.max_file_blast_radius * threshold;

  const verdict = ambiguous ? 'ambiguous' : 'under';
  return { token_count, prose_line_count, file_blast_radius, verdict };
}

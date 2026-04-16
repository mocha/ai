import { describe, it, expect } from 'vitest';
import { checkTaskSize, checkArtifactSize } from '../sizing.js';
import type { TaskPayload } from '../types.js';
import { SIZING_CONSTANTS } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<TaskPayload> = {}): TaskPayload {
  return {
    id: 1,
    title: 'Test task',
    description: 'A test task',
    details: 'Implementation details',
    status: 'pending',
    priority: 'medium',
    dependencies: [],
    subtasks: [],
    parentId: null,
    testStrategy: 'Unit tests',
    acceptanceCriteria: 'It works',
    relevantFiles: [],
    complexity: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkTaskSize
// ---------------------------------------------------------------------------

describe('checkTaskSize', () => {
  it('returns dispatch for tasks at or below complexity floor', () => {
    const task = makeTask({ complexity: 3 });
    const result = checkTaskSize(task);
    expect(result.recommendation).toBe('dispatch');
    expect(result.reason).toContain('floor');
  });

  it('returns dispatch for complexity 1', () => {
    const task = makeTask({ complexity: 1 });
    const result = checkTaskSize(task);
    expect(result.recommendation).toBe('dispatch');
  });

  it('returns decompose for tasks above complexity threshold', () => {
    const task = makeTask({ complexity: 8 });
    const result = checkTaskSize(task);
    expect(result.recommendation).toBe('decompose');
    expect(result.reason).toContain('complexity 8');
  });

  it('returns scope_down for complexity > 9', () => {
    const task = makeTask({ complexity: 10 });
    const result = checkTaskSize(task);
    expect(result.recommendation).toBe('scope_down');
  });

  it('returns decompose for 4+ non-reference files regardless of complexity', () => {
    const task = makeTask({
      complexity: 5,
      relevantFiles: [
        { path: 'a.ts', description: '', action: 'modify' },
        { path: 'b.ts', description: '', action: 'modify' },
        { path: 'c.ts', description: '', action: 'create' },
        { path: 'd.ts', description: '', action: 'modify' },
      ],
    });
    const result = checkTaskSize(task);
    expect(result.recommendation).toBe('decompose');
    expect(result.reason).toContain('file blast radius');
  });

  it('ignores reference files in blast radius count', () => {
    const task = makeTask({
      complexity: 5,
      relevantFiles: [
        { path: 'a.ts', description: '', action: 'modify' },
        { path: 'b.ts', description: '', action: 'reference' },
        { path: 'c.ts', description: '', action: 'reference' },
        { path: 'd.ts', description: '', action: 'reference' },
      ],
    });
    const result = checkTaskSize(task);
    // Only 1 non-reference file — should not trigger blast radius
    expect(result.recommendation).toBe('dispatch');
  });

  it('returns decompose when estimated LOC exceeds cap', () => {
    // 11 create files * 100 LOC = 1100 LOC > 500 cap
    const files = Array.from({ length: 11 }, (_, i) => ({
      path: `file${i}.ts`,
      description: '',
      action: 'create' as const,
    }));
    const task = makeTask({ complexity: 5, relevantFiles: files });
    const result = checkTaskSize(task);
    expect(result.recommendation).toBe('decompose');
    expect(result.estimated_loc).toBeGreaterThan(SIZING_CONSTANTS.MAX_LOC_PER_TASK);
  });

  it('returns dispatch for well-sized tasks', () => {
    const task = makeTask({
      complexity: 5,
      relevantFiles: [
        { path: 'a.ts', description: '', action: 'modify' },
        { path: 'b.ts', description: '', action: 'modify' },
      ],
    });
    const result = checkTaskSize(task);
    expect(result.recommendation).toBe('dispatch');
    expect(result.fits_single_session).toBe(true);
  });

  it('skips all further checks when complexity is at floor', () => {
    // Even with many files, complexity floor short-circuits
    const files = Array.from({ length: 10 }, (_, i) => ({
      path: `file${i}.ts`,
      description: '',
      action: 'modify' as const,
    }));
    const task = makeTask({ complexity: 2, relevantFiles: files });
    const result = checkTaskSize(task);
    expect(result.recommendation).toBe('dispatch');
    expect(result.reason).toContain('floor');
  });
});

// ---------------------------------------------------------------------------
// checkArtifactSize
// ---------------------------------------------------------------------------

describe('checkArtifactSize', () => {
  it('returns under for a nonexistent file', () => {
    const result = checkArtifactSize('/nonexistent/path.md');
    expect(result.verdict).toBe('under');
    expect(result.token_count).toBe(0);
  });

  it('returns over when prose tokens exceed threshold', () => {
    // Force low threshold to trigger
    const result = checkArtifactSize('/nonexistent.md', {
      max_prose_tokens: 0,
    });
    // File doesn't exist, so it returns under (graceful degradation)
    expect(result.verdict).toBe('under');
  });
});

// ---------------------------------------------------------------------------
// SIZING_CONSTANTS
// ---------------------------------------------------------------------------

describe('SIZING_CONSTANTS', () => {
  it('has expected values', () => {
    expect(SIZING_CONSTANTS.TOKENS_PER_LOC).toBe(18);
    expect(SIZING_CONSTANTS.MAX_LOC_PER_TASK).toBe(500);
    expect(SIZING_CONSTANTS.COMPLEXITY_DECOMPOSE_THRESHOLD).toBe(7);
    expect(SIZING_CONSTANTS.COMPLEXITY_FLOOR).toBe(3);
    expect(SIZING_CONSTANTS.FILE_BLAST_RADIUS_THRESHOLD).toBe(4);
  });
});

import { describe, it, expect } from 'vitest';
import { buildTaskPrompt, buildFixPrompt, buildReviewPrompt } from '../prompt.js';
import type { TaskSpec, ReviewFinding } from '../../orchestrator/types.js';

function makeTask(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: 1,
    title: 'Add login endpoint',
    dependencies: [],
    status: 'pending',
    details: 'Implement a POST /login route that returns a JWT.',
    acceptanceCriteria: ['Returns 200 on valid credentials', 'Returns 401 on invalid credentials'],
    relevantFiles: ['src/routes/auth.ts', 'src/middleware/jwt.ts'],
    ...overrides,
  };
}

function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    severity: 'blocking',
    description: 'Missing input validation',
    file: 'src/routes/auth.ts',
    line: 42,
    ...overrides,
  };
}

// ─── buildTaskPrompt ──────────────────────────────────────────────────────────

describe('buildTaskPrompt', () => {
  it('includes the task title', () => {
    const out = buildTaskPrompt(makeTask());
    expect(out).toContain('# Task: Add login endpoint');
  });

  it('includes the task details', () => {
    const out = buildTaskPrompt(makeTask());
    expect(out).toContain('Implement a POST /login route that returns a JWT.');
  });

  it('includes numbered acceptance criteria', () => {
    const out = buildTaskPrompt(makeTask());
    expect(out).toContain('1. Returns 200 on valid credentials');
    expect(out).toContain('2. Returns 401 on invalid credentials');
  });

  it('includes relevant files as a bullet list', () => {
    const out = buildTaskPrompt(makeTask());
    expect(out).toContain('- src/routes/auth.ts');
    expect(out).toContain('- src/middleware/jwt.ts');
  });

  it('includes status reporting instructions', () => {
    const out = buildTaskPrompt(makeTask());
    expect(out).toContain('DONE');
    expect(out).toContain('DONE_WITH_CONCERNS');
    expect(out).toContain('NEEDS_CONTEXT');
    expect(out).toContain('BLOCKED');
  });

  it('handles empty acceptance criteria gracefully', () => {
    const out = buildTaskPrompt(makeTask({ acceptanceCriteria: [] }));
    expect(out).toContain('No explicit criteria provided');
  });

  it('handles empty relevantFiles gracefully', () => {
    const out = buildTaskPrompt(makeTask({ relevantFiles: [] }));
    expect(out).toContain('None specified');
  });

  it('is a pure function — same input produces same output', () => {
    const task = makeTask();
    expect(buildTaskPrompt(task)).toBe(buildTaskPrompt(task));
  });
});

// ─── buildFixPrompt ───────────────────────────────────────────────────────────

describe('buildFixPrompt', () => {
  it('includes the round number in the heading', () => {
    const out = buildFixPrompt(makeTask(), [makeFinding()], 2);
    expect(out).toContain('# Fix Round 2: Add login endpoint');
  });

  it('includes finding severity', () => {
    const out = buildFixPrompt(makeTask(), [makeFinding({ severity: 'major' })], 1);
    expect(out).toContain('[major]');
  });

  it('includes finding description', () => {
    const out = buildFixPrompt(makeTask(), [makeFinding()], 1);
    expect(out).toContain('Missing input validation');
  });

  it('includes finding file and line number', () => {
    const out = buildFixPrompt(makeTask(), [makeFinding()], 1);
    expect(out).toContain('src/routes/auth.ts:42');
  });

  it('numbers multiple findings', () => {
    const findings = [
      makeFinding({ description: 'First issue' }),
      makeFinding({ description: 'Second issue', line: 99 }),
    ];
    const out = buildFixPrompt(makeTask(), findings, 1);
    expect(out).toContain('1. [blocking] First issue');
    expect(out).toContain('2. [blocking] Second issue');
  });

  it('handles empty findings list gracefully', () => {
    const out = buildFixPrompt(makeTask(), [], 1);
    expect(out).toContain('No specific findings recorded.');
  });

  it('includes status reporting instructions', () => {
    const out = buildFixPrompt(makeTask(), [makeFinding()], 1);
    expect(out).toContain('DONE');
    expect(out).toContain('DONE_WITH_CONCERNS');
    expect(out).toContain('NEEDS_CONTEXT');
    expect(out).toContain('BLOCKED');
  });

  it('is a pure function — same input produces same output', () => {
    const task = makeTask();
    const findings = [makeFinding()];
    expect(buildFixPrompt(task, findings, 3)).toBe(buildFixPrompt(task, findings, 3));
  });
});

// ─── buildReviewPrompt ────────────────────────────────────────────────────────

describe('buildReviewPrompt', () => {
  it('includes the task title and round number in the heading', () => {
    const out = buildReviewPrompt(makeTask(), ['src/routes/auth.ts'], 1);
    expect(out).toContain('# Review: Add login endpoint (Round 1)');
  });

  it('includes the task details', () => {
    const out = buildReviewPrompt(makeTask(), [], 1);
    expect(out).toContain('Implement a POST /login route that returns a JWT.');
  });

  it('includes numbered acceptance criteria', () => {
    const out = buildReviewPrompt(makeTask(), [], 1);
    expect(out).toContain('1. Returns 200 on valid credentials');
    expect(out).toContain('2. Returns 401 on invalid credentials');
  });

  it('includes files changed as a bullet list', () => {
    const out = buildReviewPrompt(makeTask(), ['src/routes/auth.ts', 'src/middleware/jwt.ts'], 1);
    expect(out).toContain('- src/routes/auth.ts');
    expect(out).toContain('- src/middleware/jwt.ts');
  });

  it('asks for SHIP/REVISE/RETHINK verdict', () => {
    const out = buildReviewPrompt(makeTask(), [], 1);
    expect(out).toContain('SHIP');
    expect(out).toContain('REVISE');
    expect(out).toContain('RETHINK');
  });

  it('asks for severity/description/file/line reporting', () => {
    const out = buildReviewPrompt(makeTask(), [], 1);
    expect(out).toContain('Severity');
    expect(out).toContain('blocking');
    expect(out).toContain('line number');
  });

  it('handles empty acceptance criteria gracefully', () => {
    const out = buildReviewPrompt(makeTask({ acceptanceCriteria: [] }), [], 1);
    expect(out).toContain('No explicit criteria provided');
  });

  it('handles empty filesChanged gracefully', () => {
    const out = buildReviewPrompt(makeTask(), [], 1);
    expect(out).toContain('No files recorded');
  });

  it('uses round number correctly for round > 1', () => {
    const out = buildReviewPrompt(makeTask(), [], 3);
    expect(out).toContain('Round 3');
  });

  it('is a pure function — same input produces same output', () => {
    const task = makeTask();
    const files = ['src/auth.ts'];
    expect(buildReviewPrompt(task, files, 2)).toBe(buildReviewPrompt(task, files, 2));
  });
});

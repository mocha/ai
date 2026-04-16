import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createReviewHandler } from '../handler.js';
import type { RunReview } from '../../orchestrator/commands.js';
import type { OrchestratorEvent, ReviewComplete } from '../../orchestrator/events.js';
import type { ReviewConfig } from '../types.js';

/**
 * Integration test: Post-implementation flow
 *
 * Tests the full RUN_REVIEW → spec compliance → panel review → verdict → REVIEW_COMPLETE pipeline.
 */

const MOCK_EXPERT_OUTPUT = `# Expert

## Domain Vocabulary

### 1. Architecture
- event-driven

### 2. Testing
- vitest

### 3. Quality
- TypeScript strict

## Anti-Patterns
1. Context bloat`;

const MOCK_SPEC_SHIP = `## Strengths
- All requirements met

## Issues

## Missing

## Verdict
SHIP`;

const MOCK_SPEC_REVISE = `## Strengths
- Good structure

## Issues
- [blocking] Missing error handling for edge case in requirement 2 | src/handler.ts:42
- [major] Acceptance criterion 3 not implemented

## Missing
- [major] No validation for empty input

## Verdict
REVISE`;

const MOCK_PANEL_SHIP = `## Strengths
- Clean code

## Issues
- [suggestion] Consider extracting helper | src/handler.ts:100

## Missing

## Verdict
SHIP`;

const MOCK_PANEL_REVISE = `## Strengths
- Reasonable approach

## Issues
- [blocking] Race condition in concurrent dispatch | src/bus.ts:30
- [major] Missing test for error path

## Missing

## Verdict
REVISE`;

const MOCK_PANEL_RETHINK = `## Strengths
- Interesting idea

## Issues
- [blocking] Fundamental architecture mismatch — this approach cannot scale

## Missing
- [blocking] No error handling strategy at all

## Verdict
RETHINK`;

function makeConfig(tmpDir: string): ReviewConfig {
  return {
    artifact_root: path.join(tmpDir, '.roadrunner'),
    claude_bin: 'claude',
    methodology_path: '/path/to/_shared',
    project_root: tmpDir,
  };
}

function makeRunReview(overrides: Partial<RunReview> = {}): RunReview {
  return {
    type: 'RUN_REVIEW',
    task_id: 1,
    worktree_path: '/tmp/worktree',
    task_spec: {
      id: 1,
      title: 'Add retry logic',
      dependencies: [],
      status: 'review',
      details: 'Implement exponential backoff retry',
      acceptanceCriteria: ['Retries 3 times', 'Uses backoff', 'Logs retries'],
      relevantFiles: ['src/handler.ts'],
    },
    worker_result: {
      status: 'DONE',
      result_path: '/tmp/result.md',
      cost_usd: 0.05,
      duration_ms: 5000,
      files_changed: ['src/handler.ts', 'src/handler.test.ts'],
      concerns: null,
    },
    risk: 'standard',
    round: 1,
    ...overrides,
  };
}

function lastReviewEvent(events: OrchestratorEvent[]): ReviewComplete | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'REVIEW_COMPLETE') return events[i] as ReviewComplete;
  }
  return undefined;
}

describe('Post-implementation integration: RUN_REVIEW → REVIEW_COMPLETE', () => {
  let tmpDir: string;
  let events: OrchestratorEvent[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'post-impl-'));
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'handler.ts'), 'export function handler() {}');
    events = [];
  });

  it('SHIP path: spec passes + all panelists SHIP → REVIEW_COMPLETE with SHIP', async () => {
    const config = makeConfig(tmpDir);
    let callIdx = 0;
    const responses = [
      // Spec compliance: expert gen + review
      { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 },
      { stdout: MOCK_SPEC_SHIP, stderr: '', exit_code: 0 },
      // Panel: 3 expert gens + 3 reviews
      { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 },
      { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 },
      { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 },
      { stdout: MOCK_PANEL_SHIP, stderr: '', exit_code: 0 },
      { stdout: MOCK_PANEL_SHIP, stderr: '', exit_code: 0 },
      { stdout: MOCK_PANEL_SHIP, stderr: '', exit_code: 0 },
    ];
    const mockDispatcher = vi.fn().mockImplementation(async () => responses[callIdx++]);

    const handler = createReviewHandler(config, (e) => events.push(e), mockDispatcher);
    handler(makeRunReview());
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1), { timeout: 5000 });

    const event = lastReviewEvent(events);
    expect(event).toBeDefined();
    expect(event!.verdict).toBe('SHIP');
    expect(event!.gate).toBe('code_quality');
  });

  it('REVISE path: spec passes + panel finds issues → REVIEW_COMPLETE with REVISE', async () => {
    const config = makeConfig(tmpDir);
    let callIdx = 0;
    const responses = [
      { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 },
      { stdout: MOCK_SPEC_SHIP, stderr: '', exit_code: 0 },
      { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 },
      { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 },
      { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 },
      { stdout: MOCK_PANEL_SHIP, stderr: '', exit_code: 0 },
      { stdout: MOCK_PANEL_REVISE, stderr: '', exit_code: 0 },
      { stdout: MOCK_PANEL_SHIP, stderr: '', exit_code: 0 },
    ];
    const mockDispatcher = vi.fn().mockImplementation(async () => responses[callIdx++]);

    const handler = createReviewHandler(config, (e) => events.push(e), mockDispatcher);
    handler(makeRunReview());
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1), { timeout: 5000 });

    const event = lastReviewEvent(events);
    expect(event).toBeDefined();
    expect(event!.verdict).toBe('REVISE');
    expect(event!.gate).toBe('code_quality');
    expect(event!.findings.length).toBeGreaterThan(0);
  });

  it('RETHINK path: one panelist RETHINK vetoes → REVIEW_COMPLETE with RETHINK', async () => {
    const config = makeConfig(tmpDir);
    let callIdx = 0;
    const responses = [
      { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 },
      { stdout: MOCK_SPEC_SHIP, stderr: '', exit_code: 0 },
      { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 },
      { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 },
      { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 },
      { stdout: MOCK_PANEL_SHIP, stderr: '', exit_code: 0 },
      { stdout: MOCK_PANEL_RETHINK, stderr: '', exit_code: 0 },  // One Rethink vetoes
      { stdout: MOCK_PANEL_SHIP, stderr: '', exit_code: 0 },
    ];
    const mockDispatcher = vi.fn().mockImplementation(async () => responses[callIdx++]);

    const handler = createReviewHandler(config, (e) => events.push(e), mockDispatcher);
    handler(makeRunReview());
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1), { timeout: 5000 });

    const event = lastReviewEvent(events);
    expect(event).toBeDefined();
    expect(event!.verdict).toBe('RETHINK');
    expect(event!.gate).toBe('code_quality');
  });

  it('spec compliance failure: REVISE with spec_compliance gate', async () => {
    const config = makeConfig(tmpDir);
    let callIdx = 0;
    const responses = [
      { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 },
      { stdout: MOCK_SPEC_REVISE, stderr: '', exit_code: 0 },
    ];
    const mockDispatcher = vi.fn().mockImplementation(async () => responses[callIdx++]);

    const handler = createReviewHandler(config, (e) => events.push(e), mockDispatcher);
    handler(makeRunReview());
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1), { timeout: 5000 });

    const event = lastReviewEvent(events);
    expect(event).toBeDefined();
    expect(event!.verdict).toBe('REVISE');
    expect(event!.gate).toBe('spec_compliance');
    expect(event!.findings.some(f => f.severity === 'blocking')).toBe(true);
  });

  it('spec compliance 3x failure: RETHINK escalation', async () => {
    const config = makeConfig(tmpDir);
    let callIdx = 0;
    const mockDispatcher = vi.fn().mockImplementation(async () => {
      // Alternate between expert output and spec revise
      const idx = callIdx++;
      return idx % 2 === 0
        ? { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 }
        : { stdout: MOCK_SPEC_REVISE, stderr: '', exit_code: 0 };
    });

    const handler = createReviewHandler(config, (e) => events.push(e), mockDispatcher);

    // Failure 1
    handler(makeRunReview());
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1), { timeout: 5000 });
    expect(lastReviewEvent(events)!.verdict).toBe('REVISE');
    expect(lastReviewEvent(events)!.gate).toBe('spec_compliance');

    // Failure 2
    handler(makeRunReview());
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(2), { timeout: 5000 });
    expect(lastReviewEvent(events)!.verdict).toBe('REVISE');

    // Failure 3 → RETHINK
    handler(makeRunReview());
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(3), { timeout: 5000 });
    expect(lastReviewEvent(events)!.verdict).toBe('RETHINK');
    expect(lastReviewEvent(events)!.gate).toBe('spec_compliance');
  });

  it('trivial risk: auto-SHIP without calling CLI', async () => {
    const config = makeConfig(tmpDir);
    const mockDispatcher = vi.fn();

    const handler = createReviewHandler(config, (e) => events.push(e), mockDispatcher);
    handler(makeRunReview({ risk: 'trivial' }));
    await vi.waitFor(() => expect(events.length).toBe(1));

    const event = lastReviewEvent(events);
    expect(event!.verdict).toBe('SHIP');
    expect(event!.gate).toBe('code_quality');
    expect(mockDispatcher).not.toHaveBeenCalled();
  });

  it('verdict JSON written to .roadrunner/verdicts/', async () => {
    const config = makeConfig(tmpDir);
    let callIdx = 0;
    const responses = [
      { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 },
      { stdout: MOCK_SPEC_SHIP, stderr: '', exit_code: 0 },
      { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 },
      { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 },
      { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 },
      { stdout: MOCK_PANEL_SHIP, stderr: '', exit_code: 0 },
      { stdout: MOCK_PANEL_SHIP, stderr: '', exit_code: 0 },
      { stdout: MOCK_PANEL_SHIP, stderr: '', exit_code: 0 },
    ];
    const mockDispatcher = vi.fn().mockImplementation(async () => responses[callIdx++]);

    const handler = createReviewHandler(config, (e) => events.push(e), mockDispatcher);
    handler(makeRunReview());
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1), { timeout: 5000 });

    const verdictPath = path.join(config.artifact_root, 'verdicts', 'TASK-1.json');
    expect(fs.existsSync(verdictPath)).toBe(true);

    const verdict = JSON.parse(fs.readFileSync(verdictPath, 'utf8'));
    expect(verdict.verdict).toBe('SHIP');
    expect(verdict.gate).toBe('code_quality');
    expect(verdict.task_id).toBe(1);
  });
});

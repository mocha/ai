import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createReviewHandler } from '../handler.js';
import type { OrchestratorCommand, GenerateExpert, RunReview } from '../../orchestrator/commands.js';
import type { OrchestratorEvent } from '../../orchestrator/events.js';
import type { ReviewConfig, SubAgentResult } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_EXPERT_OUTPUT = `# Expert Prompt

## Domain Vocabulary

### 1. Architecture
- event-driven pipeline

### 2. Testing
- vitest

### 3. Types
- TypeScript strict mode

## Anti-Patterns
1. Context bloat

## Operational Guidance
Focus on correctness.`;

const MOCK_REVIEW_SHIP = `## Strengths
- Clean implementation

## Issues

## Missing

## Verdict
SHIP`;

const MOCK_REVIEW_REVISE = `## Strengths
- Good structure

## Issues
- [blocking] Missing error handling | src/handler.ts:42
- [major] No test coverage | src/handler.ts

## Missing
- [major] Missing validation for edge cases

## Verdict
REVISE`;

function makeConfig(tmpDir: string): ReviewConfig {
  return {
    artifact_root: path.join(tmpDir, '.roadrunner'),
    claude_bin: 'claude',
    methodology_path: '/path/to/_shared',
    project_root: tmpDir,
  };
}

function makeGenerateExpert(overrides: Partial<GenerateExpert> = {}): GenerateExpert {
  return {
    type: 'GENERATE_EXPERT',
    task_id: 1,
    task: {
      id: 1,
      title: 'Test task',
      dependencies: [],
      status: 'pending',
      details: 'Implement feature X',
      acceptanceCriteria: ['Handles Y'],
      relevantFiles: ['src/handler.ts'],
    },
    risk: 'standard',
    codebase_context: {
      entry_points: [],
      recent_changes: [],
      related_tests: [],
    },
    ...overrides,
  };
}

function makeRunReview(overrides: Partial<RunReview> = {}): RunReview {
  return {
    type: 'RUN_REVIEW',
    task_id: 1,
    worktree_path: '/tmp/worktree',
    task_spec: {
      id: 1,
      title: 'Test task',
      dependencies: [],
      status: 'pending',
      details: 'Implement feature X',
      acceptanceCriteria: ['Handles Y'],
      relevantFiles: ['src/handler.ts'],
    },
    worker_result: {
      status: 'DONE',
      result_path: '/tmp/result.md',
      cost_usd: 0.05,
      duration_ms: 5000,
      files_changed: ['src/handler.ts'],
      concerns: null,
    },
    risk: 'standard',
    round: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createReviewHandler', () => {
  let tmpDir: string;
  let events: OrchestratorEvent[];
  let callCount: number;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'handler-test-'));
    // Create the files referenced in tasks so drift validation passes
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'handler.ts'), 'export function handler() {}');
    events = [];
    callCount = 0;
  });

  function createHandler(responseSequence?: SubAgentResult[]) {
    const config = makeConfig(tmpDir);
    const sendEvent = (event: OrchestratorEvent) => events.push(event);
    const mockDispatcher = vi.fn().mockImplementation(async () => {
      const idx = callCount++;
      if (responseSequence && idx < responseSequence.length) {
        return responseSequence[idx];
      }
      // Default: return expert prompt for odd calls, review output for even
      return { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 };
    });

    return {
      handler: createReviewHandler(config, sendEvent, mockDispatcher),
      sendEvent,
      mockDispatcher,
      config,
    };
  }

  describe('GENERATE_EXPERT', () => {
    it('emits EXPERT_READY with drift pass for standard risk', async () => {
      const { handler } = createHandler();

      handler(makeGenerateExpert());
      await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1));

      const event = events.find(e => e.type === 'EXPERT_READY');
      expect(event).toBeDefined();
      expect(event!.type).toBe('EXPERT_READY');
      if (event!.type === 'EXPERT_READY') {
        expect(event!.task_id).toBe(1);
        expect(event!.drift_check).toBe('pass');
        expect(event!.expert_prompt_path).toContain('TASK-1.md');
      }
    });

    it('trivial risk short-circuits with empty expert path', async () => {
      const { handler } = createHandler();

      handler(makeGenerateExpert({ risk: 'trivial' }));
      await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1));

      const event = events.find(e => e.type === 'EXPERT_READY');
      expect(event).toBeDefined();
      if (event!.type === 'EXPERT_READY') {
        expect(event!.expert_prompt_path).toBe('');
        expect(event!.drift_check).toBe('pass');
      }
    });

    it('reports drift failure when referenced file is missing', async () => {
      const { handler } = createHandler();

      handler(makeGenerateExpert({
        task: {
          id: 1,
          title: 'Test',
          dependencies: [],
          status: 'pending',
          details: '',
          acceptanceCriteria: [],
          relevantFiles: ['src/nonexistent.ts'],
        },
      }));
      await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1));

      const event = events.find(e => e.type === 'EXPERT_READY');
      expect(event).toBeDefined();
      if (event!.type === 'EXPERT_READY') {
        expect(event!.drift_check).toBe('fail');
        expect(event!.drift_details).toContain('nonexistent.ts');
      }
    });
  });

  describe('RUN_REVIEW', () => {
    it('emits SHIP for trivial risk (auto-SHIP)', async () => {
      const { handler } = createHandler();

      handler(makeRunReview({ risk: 'trivial' }));
      await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1));

      const event = events.find(e => e.type === 'REVIEW_COMPLETE');
      expect(event).toBeDefined();
      if (event!.type === 'REVIEW_COMPLETE') {
        expect(event!.verdict).toBe('SHIP');
        expect(event!.gate).toBe('code_quality');
      }
    });

    it('emits SHIP when spec and panel both pass', async () => {
      // Sequence: expert gen (for spec reviewer), spec compliance review, expert gen (for panelists x3), panel reviews x3
      const responses = [
        { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 }, // expert for spec reviewer
        { stdout: MOCK_REVIEW_SHIP, stderr: '', exit_code: 0 },   // spec compliance: SHIP
        { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 }, // expert for panel 1
        { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 }, // expert for panel 2
        { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 }, // expert for panel 3
        { stdout: MOCK_REVIEW_SHIP, stderr: '', exit_code: 0 },   // panel 1: SHIP
        { stdout: MOCK_REVIEW_SHIP, stderr: '', exit_code: 0 },   // panel 2: SHIP
        { stdout: MOCK_REVIEW_SHIP, stderr: '', exit_code: 0 },   // panel 3: SHIP
      ];
      const { handler } = createHandler(responses);

      handler(makeRunReview());
      await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1), { timeout: 5000 });

      const event = events.find(e => e.type === 'REVIEW_COMPLETE');
      expect(event).toBeDefined();
      if (event!.type === 'REVIEW_COMPLETE') {
        expect(event!.verdict).toBe('SHIP');
        expect(event!.gate).toBe('code_quality');
      }
    });

    it('emits REVISE with spec_compliance gate when spec fails', async () => {
      const responses = [
        { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 }, // expert for spec reviewer
        { stdout: MOCK_REVIEW_REVISE, stderr: '', exit_code: 0 }, // spec compliance: REVISE
      ];
      const { handler } = createHandler(responses);

      handler(makeRunReview());
      await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1), { timeout: 5000 });

      const event = events.find(e => e.type === 'REVIEW_COMPLETE');
      expect(event).toBeDefined();
      if (event!.type === 'REVIEW_COMPLETE') {
        expect(event!.verdict).toBe('REVISE');
        expect(event!.gate).toBe('spec_compliance');
        expect(event!.findings.length).toBeGreaterThan(0);
      }
    });

    it('emits RETHINK after 3 consecutive spec compliance failures', async () => {
      // Use a single handler and send the command 3 times
      events = [];
      const config = makeConfig(tmpDir);
      let localCallCount = 0;
      const mockDispatcher = vi.fn().mockImplementation(async () => {
        localCallCount++;
        // All expert generations return expert output
        // All reviews return REVISE
        if (localCallCount % 2 === 1) {
          return { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 };
        }
        return { stdout: MOCK_REVIEW_REVISE, stderr: '', exit_code: 0 };
      });

      const singleHandler = createReviewHandler(config, (event) => events.push(event), mockDispatcher);

      // Failure 1
      singleHandler(makeRunReview());
      await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1), { timeout: 5000 });
      expect(events[events.length - 1]).toMatchObject({ type: 'REVIEW_COMPLETE', verdict: 'REVISE', gate: 'spec_compliance' });

      // Failure 2
      singleHandler(makeRunReview());
      await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(2), { timeout: 5000 });
      expect(events[events.length - 1]).toMatchObject({ type: 'REVIEW_COMPLETE', verdict: 'REVISE', gate: 'spec_compliance' });

      // Failure 3 → RETHINK
      singleHandler(makeRunReview());
      await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(3), { timeout: 5000 });
      expect(events[events.length - 1]).toMatchObject({ type: 'REVIEW_COMPLETE', verdict: 'RETHINK', gate: 'spec_compliance' });
    });

    it('sends DISPATCH_ERROR on handler exception', async () => {
      const config = makeConfig(tmpDir);
      const mockDispatcher = vi.fn().mockRejectedValue(new Error('CLI crashed'));

      const handler = createReviewHandler(config, (event) => events.push(event), mockDispatcher);

      handler(makeRunReview());
      await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1), { timeout: 5000 });

      const event = events.find(e => e.type === 'DISPATCH_ERROR');
      expect(event).toBeDefined();
      if (event!.type === 'DISPATCH_ERROR') {
        expect(event!.failed_command).toBe('RUN_REVIEW');
        expect(event!.error_message).toContain('CLI crashed');
      }
    });
  });

  describe('command routing', () => {
    it('ignores commands not meant for Layer 4', async () => {
      const { handler, mockDispatcher } = createHandler();

      handler({ type: 'DISPATCH_WORKER', task_id: 1, expert_prompt_path: '', task_spec: makeRunReview().task_spec, worktree_branch: 'task-1', max_turns: 20, model: 'sonnet' } as OrchestratorCommand);

      // Should not have called the dispatcher
      expect(mockDispatcher).not.toHaveBeenCalled();
      expect(events).toHaveLength(0);
    });
  });
});

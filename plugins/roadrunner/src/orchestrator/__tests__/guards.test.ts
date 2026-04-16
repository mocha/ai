import { describe, it, expect } from 'vitest';
import { createDefaultContext } from '../context.js';
import type { OrchestratorContext } from '../context.js';
import type { OrchestratorEvent } from '../events.js';
import {
  shouldSkipPrepare,
  shouldSkipBrainstorm,
  shouldSkipSpecReview,
  shouldSkipWritePlan,
  shouldSkipPlanReview,
  isShip,
  isRevise,
  isRethink,
  belowMaxRounds,
  atMaxRounds,
  workerSucceeded,
  workerBlocked,
  shouldDecompose,
  isProceed,
  isAbort,
  isRetry,
  isSkip,
  isAbortEscalation,
  driftPass,
  driftFail,
  allTasksComplete,
  requiresUserApproval,
  sizingClearlyUnder,
  sizingClearlyOver,
  isTaskReady,
  isAllComplete,
  isAllBlocked,
  decompositionRecommended,
  isSingle,
  isMultiple,
} from '../guards.js';

function makeContext(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return { ...createDefaultContext(), ...overrides };
}

// ---------------------------------------------------------------------------
// 1. Stage skipping
// ---------------------------------------------------------------------------
describe('Stage skipping guards', () => {
  describe('shouldSkipPrepare', () => {
    it('returns false when prepare is in path', () => {
      const ctx = makeContext({ path: ['prepare', 'brainstorm', 'develop'] });
      expect(shouldSkipPrepare({ context: ctx })).toBe(false);
    });

    it('returns true when prepare is NOT in path', () => {
      const ctx = makeContext({ path: ['develop', 'finish'] });
      expect(shouldSkipPrepare({ context: ctx })).toBe(true);
    });

    it('returns true when path is empty', () => {
      const ctx = makeContext({ path: [] });
      expect(shouldSkipPrepare({ context: ctx })).toBe(true);
    });
  });

  describe('shouldSkipBrainstorm', () => {
    it('returns false when brainstorm is in path', () => {
      const ctx = makeContext({ path: ['prepare', 'brainstorm', 'develop'] });
      expect(shouldSkipBrainstorm({ context: ctx })).toBe(false);
    });

    it('returns true when brainstorm is NOT in path', () => {
      const ctx = makeContext({ path: ['prepare', 'develop'] });
      expect(shouldSkipBrainstorm({ context: ctx })).toBe(true);
    });
  });

  describe('shouldSkipSpecReview', () => {
    it('returns false when spec_review is in path', () => {
      const ctx = makeContext({ path: ['prepare', 'spec_review', 'write_plan'] });
      expect(shouldSkipSpecReview({ context: ctx })).toBe(false);
    });

    it('returns true when spec_review is NOT in path', () => {
      const ctx = makeContext({ path: ['prepare', 'write_plan'] });
      expect(shouldSkipSpecReview({ context: ctx })).toBe(true);
    });
  });

  describe('shouldSkipWritePlan', () => {
    it('returns false when write_plan is in path', () => {
      const ctx = makeContext({ path: ['spec_review', 'write_plan', 'plan_review'] });
      expect(shouldSkipWritePlan({ context: ctx })).toBe(false);
    });

    it('returns true when write_plan is NOT in path', () => {
      const ctx = makeContext({ path: ['develop', 'finish'] });
      expect(shouldSkipWritePlan({ context: ctx })).toBe(true);
    });
  });

  describe('shouldSkipPlanReview', () => {
    it('returns false when plan_review is in path', () => {
      const ctx = makeContext({ path: ['write_plan', 'plan_review', 'develop'] });
      expect(shouldSkipPlanReview({ context: ctx })).toBe(false);
    });

    it('returns true when plan_review is NOT in path', () => {
      const ctx = makeContext({ path: ['write_plan', 'develop'] });
      expect(shouldSkipPlanReview({ context: ctx })).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Verdict routing
// ---------------------------------------------------------------------------
describe('Verdict routing guards', () => {
  describe('isShip', () => {
    it('returns true when last_review_verdict is SHIP', () => {
      const ctx = makeContext({ last_review_verdict: 'SHIP' });
      expect(isShip({ context: ctx })).toBe(true);
    });

    it('returns false when last_review_verdict is REVISE', () => {
      const ctx = makeContext({ last_review_verdict: 'REVISE' });
      expect(isShip({ context: ctx })).toBe(false);
    });

    it('returns false when last_review_verdict is null', () => {
      const ctx = makeContext({ last_review_verdict: null });
      expect(isShip({ context: ctx })).toBe(false);
    });
  });

  describe('isRevise', () => {
    it('returns true when last_review_verdict is REVISE', () => {
      const ctx = makeContext({ last_review_verdict: 'REVISE' });
      expect(isRevise({ context: ctx })).toBe(true);
    });

    it('returns false when last_review_verdict is SHIP', () => {
      const ctx = makeContext({ last_review_verdict: 'SHIP' });
      expect(isRevise({ context: ctx })).toBe(false);
    });

    it('returns false when last_review_verdict is RETHINK', () => {
      const ctx = makeContext({ last_review_verdict: 'RETHINK' });
      expect(isRevise({ context: ctx })).toBe(false);
    });
  });

  describe('isRethink', () => {
    it('returns true when last_review_verdict is RETHINK', () => {
      const ctx = makeContext({ last_review_verdict: 'RETHINK' });
      expect(isRethink({ context: ctx })).toBe(true);
    });

    it('returns false when last_review_verdict is SHIP', () => {
      const ctx = makeContext({ last_review_verdict: 'SHIP' });
      expect(isRethink({ context: ctx })).toBe(false);
    });

    it('returns false when last_review_verdict is null', () => {
      const ctx = makeContext({ last_review_verdict: null });
      expect(isRethink({ context: ctx })).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Round limits
// ---------------------------------------------------------------------------
describe('Round limit guards', () => {
  describe('belowMaxRounds', () => {
    it('returns true when review_round is below max (round 1 of max 2)', () => {
      const ctx = makeContext({ review_round: 1, max_review_rounds: 2 });
      expect(belowMaxRounds({ context: ctx })).toBe(true);
    });

    it('returns false when review_round equals max (round 2 of max 2)', () => {
      const ctx = makeContext({ review_round: 2, max_review_rounds: 2 });
      expect(belowMaxRounds({ context: ctx })).toBe(false);
    });

    it('returns false when review_round exceeds max', () => {
      const ctx = makeContext({ review_round: 3, max_review_rounds: 2 });
      expect(belowMaxRounds({ context: ctx })).toBe(false);
    });
  });

  describe('atMaxRounds', () => {
    it('returns false when review_round is below max (round 1 of max 2)', () => {
      const ctx = makeContext({ review_round: 1, max_review_rounds: 2 });
      expect(atMaxRounds({ context: ctx })).toBe(false);
    });

    it('returns true when review_round equals max (round 2 of max 2)', () => {
      const ctx = makeContext({ review_round: 2, max_review_rounds: 2 });
      expect(atMaxRounds({ context: ctx })).toBe(true);
    });

    it('returns true when review_round exceeds max', () => {
      const ctx = makeContext({ review_round: 5, max_review_rounds: 2 });
      expect(atMaxRounds({ context: ctx })).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Worker status routing
// ---------------------------------------------------------------------------
describe('Worker status routing guards', () => {
  const baseWorkerEvent = {
    type: 'WORKER_COMPLETE' as const,
    task_id: 1,
    result_path: '/tmp/result.md',
    cost_usd: 0.01,
    duration_ms: 1000,
    files_changed: [],
    concerns: null,
  };

  describe('workerSucceeded', () => {
    it('returns true for DONE status', () => {
      const event = { ...baseWorkerEvent, status: 'DONE' as const };
      expect(workerSucceeded({ context: makeContext(), event })).toBe(true);
    });

    it('returns true for DONE_WITH_CONCERNS status', () => {
      const event = { ...baseWorkerEvent, status: 'DONE_WITH_CONCERNS' as const };
      expect(workerSucceeded({ context: makeContext(), event })).toBe(true);
    });

    it('returns false for NEEDS_CONTEXT status', () => {
      const event = { ...baseWorkerEvent, status: 'NEEDS_CONTEXT' as const };
      expect(workerSucceeded({ context: makeContext(), event })).toBe(false);
    });

    it('returns false for BLOCKED status', () => {
      const event = { ...baseWorkerEvent, status: 'BLOCKED' as const };
      expect(workerSucceeded({ context: makeContext(), event })).toBe(false);
    });

    it('returns false when event is undefined', () => {
      expect(workerSucceeded({ context: makeContext() })).toBe(false);
    });

    it('returns false for non-WORKER_COMPLETE events', () => {
      const event: OrchestratorEvent = { type: 'FINISH_COMPLETE', summary: 'done' };
      expect(workerSucceeded({ context: makeContext(), event })).toBe(false);
    });
  });

  describe('workerBlocked', () => {
    it('returns true for NEEDS_CONTEXT status', () => {
      const event = { ...baseWorkerEvent, status: 'NEEDS_CONTEXT' as const };
      expect(workerBlocked({ context: makeContext(), event })).toBe(true);
    });

    it('returns true for BLOCKED status', () => {
      const event = { ...baseWorkerEvent, status: 'BLOCKED' as const };
      expect(workerBlocked({ context: makeContext(), event })).toBe(true);
    });

    it('returns false for DONE status', () => {
      const event = { ...baseWorkerEvent, status: 'DONE' as const };
      expect(workerBlocked({ context: makeContext(), event })).toBe(false);
    });

    it('returns false for DONE_WITH_CONCERNS status', () => {
      const event = { ...baseWorkerEvent, status: 'DONE_WITH_CONCERNS' as const };
      expect(workerBlocked({ context: makeContext(), event })).toBe(false);
    });

    it('returns false when event is undefined', () => {
      expect(workerBlocked({ context: makeContext() })).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Decomposition
// ---------------------------------------------------------------------------
describe('Decomposition guard', () => {
  it('returns true when decompose is true', () => {
    const ctx = makeContext({ decompose: true });
    expect(shouldDecompose({ context: ctx })).toBe(true);
  });

  it('returns false when decompose is false', () => {
    const ctx = makeContext({ decompose: false });
    expect(shouldDecompose({ context: ctx })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. User decisions
// ---------------------------------------------------------------------------
describe('User decision guards', () => {
  describe('isProceed', () => {
    it('returns true for USER_APPROVE with proceed decision', () => {
      const event: OrchestratorEvent = { type: 'USER_APPROVE', stage: 'spec_review', decision: 'proceed' };
      expect(isProceed({ context: makeContext(), event })).toBe(true);
    });

    it('returns false for USER_APPROVE with abort decision', () => {
      const event: OrchestratorEvent = { type: 'USER_APPROVE', stage: 'spec_review', decision: 'abort' };
      expect(isProceed({ context: makeContext(), event })).toBe(false);
    });

    it('returns false for non-USER_APPROVE events', () => {
      const event: OrchestratorEvent = { type: 'FINISH_COMPLETE', summary: 'done' };
      expect(isProceed({ context: makeContext(), event })).toBe(false);
    });

    it('returns false when event is undefined', () => {
      expect(isProceed({ context: makeContext() })).toBe(false);
    });
  });

  describe('isAbort', () => {
    it('returns true for USER_APPROVE with abort decision', () => {
      const event: OrchestratorEvent = { type: 'USER_APPROVE', stage: 'spec_review', decision: 'abort' };
      expect(isAbort({ context: makeContext(), event })).toBe(true);
    });

    it('returns false for USER_APPROVE with proceed decision', () => {
      const event: OrchestratorEvent = { type: 'USER_APPROVE', stage: 'spec_review', decision: 'proceed' };
      expect(isAbort({ context: makeContext(), event })).toBe(false);
    });

    it('returns false when event is undefined', () => {
      expect(isAbort({ context: makeContext() })).toBe(false);
    });
  });

  describe('isRetry', () => {
    it('returns true for USER_ESCALATION_RESPONSE with retry action', () => {
      const event: OrchestratorEvent = { type: 'USER_ESCALATION_RESPONSE', task_id: 1, action: 'retry' };
      expect(isRetry({ context: makeContext(), event })).toBe(true);
    });

    it('returns false for USER_ESCALATION_RESPONSE with skip action', () => {
      const event: OrchestratorEvent = { type: 'USER_ESCALATION_RESPONSE', task_id: 1, action: 'skip' };
      expect(isRetry({ context: makeContext(), event })).toBe(false);
    });

    it('returns false when event is undefined', () => {
      expect(isRetry({ context: makeContext() })).toBe(false);
    });
  });

  describe('isSkip', () => {
    it('returns true for USER_ESCALATION_RESPONSE with skip action', () => {
      const event: OrchestratorEvent = { type: 'USER_ESCALATION_RESPONSE', task_id: 1, action: 'skip' };
      expect(isSkip({ context: makeContext(), event })).toBe(true);
    });

    it('returns false for USER_ESCALATION_RESPONSE with retry action', () => {
      const event: OrchestratorEvent = { type: 'USER_ESCALATION_RESPONSE', task_id: 1, action: 'retry' };
      expect(isSkip({ context: makeContext(), event })).toBe(false);
    });

    it('returns false when event is undefined', () => {
      expect(isSkip({ context: makeContext() })).toBe(false);
    });
  });

  describe('isAbortEscalation', () => {
    it('returns true for USER_ESCALATION_RESPONSE with abort action', () => {
      const event: OrchestratorEvent = { type: 'USER_ESCALATION_RESPONSE', task_id: 1, action: 'abort' };
      expect(isAbortEscalation({ context: makeContext(), event })).toBe(true);
    });

    it('returns false for USER_ESCALATION_RESPONSE with retry action', () => {
      const event: OrchestratorEvent = { type: 'USER_ESCALATION_RESPONSE', task_id: 1, action: 'retry' };
      expect(isAbortEscalation({ context: makeContext(), event })).toBe(false);
    });

    it('returns false for USER_ESCALATION_RESPONSE with skip action', () => {
      const event: OrchestratorEvent = { type: 'USER_ESCALATION_RESPONSE', task_id: 1, action: 'skip' };
      expect(isAbortEscalation({ context: makeContext(), event })).toBe(false);
    });

    it('returns false when event is undefined', () => {
      expect(isAbortEscalation({ context: makeContext() })).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Drift check
// ---------------------------------------------------------------------------
describe('Drift check guards', () => {
  const baseExpertReady = {
    type: 'EXPERT_READY' as const,
    task_id: 1,
    expert_prompt_path: '/tmp/expert.md',
    drift_details: null,
  };

  describe('driftPass', () => {
    it('returns true for EXPERT_READY with drift_check pass', () => {
      const event: OrchestratorEvent = { ...baseExpertReady, drift_check: 'pass' };
      expect(driftPass({ context: makeContext(), event })).toBe(true);
    });

    it('returns false for EXPERT_READY with drift_check fail', () => {
      const event: OrchestratorEvent = { ...baseExpertReady, drift_check: 'fail' };
      expect(driftPass({ context: makeContext(), event })).toBe(false);
    });

    it('returns false when event is undefined', () => {
      expect(driftPass({ context: makeContext() })).toBe(false);
    });

    it('returns false for non-EXPERT_READY events', () => {
      const event: OrchestratorEvent = { type: 'FINISH_COMPLETE', summary: 'done' };
      expect(driftPass({ context: makeContext(), event })).toBe(false);
    });
  });

  describe('driftFail', () => {
    it('returns true for EXPERT_READY with drift_check fail', () => {
      const event: OrchestratorEvent = { ...baseExpertReady, drift_check: 'fail' };
      expect(driftFail({ context: makeContext(), event })).toBe(true);
    });

    it('returns false for EXPERT_READY with drift_check pass', () => {
      const event: OrchestratorEvent = { ...baseExpertReady, drift_check: 'pass' };
      expect(driftFail({ context: makeContext(), event })).toBe(false);
    });

    it('returns false when event is undefined', () => {
      expect(driftFail({ context: makeContext() })).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 8. Task completion
// ---------------------------------------------------------------------------
describe('Task completion guard', () => {
  it('returns true when tasks_complete equals task_count and task_count > 0', () => {
    const ctx = makeContext({ tasks_complete: 3, task_count: 3 });
    expect(allTasksComplete({ context: ctx })).toBe(true);
  });

  it('returns true when tasks_complete exceeds task_count and task_count > 0', () => {
    const ctx = makeContext({ tasks_complete: 4, task_count: 3 });
    expect(allTasksComplete({ context: ctx })).toBe(true);
  });

  it('returns false when tasks_complete is less than task_count', () => {
    const ctx = makeContext({ tasks_complete: 2, task_count: 3 });
    expect(allTasksComplete({ context: ctx })).toBe(false);
  });

  it('returns false when task_count is 0 (no tasks registered yet)', () => {
    const ctx = makeContext({ tasks_complete: 0, task_count: 0 });
    expect(allTasksComplete({ context: ctx })).toBe(false);
  });

  it('returns false when tasks_complete is 0 and task_count > 0', () => {
    const ctx = makeContext({ tasks_complete: 0, task_count: 5 });
    expect(allTasksComplete({ context: ctx })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. User approval gate
// ---------------------------------------------------------------------------
describe('User approval gate guard', () => {
  it('returns true for critical risk', () => {
    const ctx = makeContext({ risk: 'critical' });
    expect(requiresUserApproval({ context: ctx })).toBe(true);
  });

  it('returns false for elevated risk', () => {
    const ctx = makeContext({ risk: 'elevated' });
    expect(requiresUserApproval({ context: ctx })).toBe(false);
  });

  it('returns false for standard risk', () => {
    const ctx = makeContext({ risk: 'standard' });
    expect(requiresUserApproval({ context: ctx })).toBe(false);
  });

  it('returns false for trivial risk', () => {
    const ctx = makeContext({ risk: 'trivial' });
    expect(requiresUserApproval({ context: ctx })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. Sizing guards
// ---------------------------------------------------------------------------
describe('Sizing guards', () => {
  describe('sizingClearlyUnder', () => {
    it('returns true when last_sizing_result verdict is under', () => {
      const ctx = makeContext({
        last_sizing_result: { token_count: 100, prose_line_count: 10, file_blast_radius: 1, verdict: 'under' },
      });
      expect(sizingClearlyUnder({ context: ctx })).toBe(true);
    });

    it('returns false when last_sizing_result verdict is over', () => {
      const ctx = makeContext({
        last_sizing_result: { token_count: 5000, prose_line_count: 300, file_blast_radius: 10, verdict: 'over' },
      });
      expect(sizingClearlyUnder({ context: ctx })).toBe(false);
    });

    it('returns false when last_sizing_result verdict is ambiguous', () => {
      const ctx = makeContext({
        last_sizing_result: { token_count: 2000, prose_line_count: 150, file_blast_radius: 3, verdict: 'ambiguous' },
      });
      expect(sizingClearlyUnder({ context: ctx })).toBe(false);
    });

    it('returns false when last_sizing_result is null', () => {
      const ctx = makeContext({ last_sizing_result: null });
      expect(sizingClearlyUnder({ context: ctx })).toBe(false);
    });
  });

  describe('sizingClearlyOver', () => {
    it('returns true when last_sizing_result verdict is over', () => {
      const ctx = makeContext({
        last_sizing_result: { token_count: 5000, prose_line_count: 300, file_blast_radius: 10, verdict: 'over' },
      });
      expect(sizingClearlyOver({ context: ctx })).toBe(true);
    });

    it('returns false when last_sizing_result verdict is under', () => {
      const ctx = makeContext({
        last_sizing_result: { token_count: 100, prose_line_count: 10, file_blast_radius: 1, verdict: 'under' },
      });
      expect(sizingClearlyOver({ context: ctx })).toBe(false);
    });

    it('returns false when last_sizing_result verdict is ambiguous', () => {
      const ctx = makeContext({
        last_sizing_result: { token_count: 2000, prose_line_count: 150, file_blast_radius: 3, verdict: 'ambiguous' },
      });
      expect(sizingClearlyOver({ context: ctx })).toBe(false);
    });

    it('returns false when last_sizing_result is null', () => {
      const ctx = makeContext({ last_sizing_result: null });
      expect(sizingClearlyOver({ context: ctx })).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 11. Query result guards
// ---------------------------------------------------------------------------
describe('Query result guards', () => {
  describe('isTaskReady', () => {
    it('returns true for QUERY_RESULT with task_ready outcome', () => {
      const event: OrchestratorEvent = {
        type: 'QUERY_RESULT',
        outcome: 'task_ready',
        task: { id: 1, title: 'Task 1', dependencies: [], status: 'pending', details: '', acceptanceCriteria: [], relevantFiles: [] },
      };
      expect(isTaskReady({ context: makeContext(), event })).toBe(true);
    });

    it('returns false for QUERY_RESULT with all_complete outcome', () => {
      const event: OrchestratorEvent = { type: 'QUERY_RESULT', outcome: 'all_complete' };
      expect(isTaskReady({ context: makeContext(), event })).toBe(false);
    });

    it('returns false for QUERY_RESULT with all_blocked outcome', () => {
      const event: OrchestratorEvent = { type: 'QUERY_RESULT', outcome: 'all_blocked' };
      expect(isTaskReady({ context: makeContext(), event })).toBe(false);
    });

    it('returns false when event is undefined', () => {
      expect(isTaskReady({ context: makeContext() })).toBe(false);
    });

    it('returns false for non-QUERY_RESULT events', () => {
      const event: OrchestratorEvent = { type: 'FINISH_COMPLETE', summary: 'done' };
      expect(isTaskReady({ context: makeContext(), event })).toBe(false);
    });
  });

  describe('isAllComplete', () => {
    it('returns true for QUERY_RESULT with all_complete outcome', () => {
      const event: OrchestratorEvent = { type: 'QUERY_RESULT', outcome: 'all_complete' };
      expect(isAllComplete({ context: makeContext(), event })).toBe(true);
    });

    it('returns false for QUERY_RESULT with task_ready outcome', () => {
      const event: OrchestratorEvent = {
        type: 'QUERY_RESULT',
        outcome: 'task_ready',
        task: { id: 1, title: 'Task 1', dependencies: [], status: 'pending', details: '', acceptanceCriteria: [], relevantFiles: [] },
      };
      expect(isAllComplete({ context: makeContext(), event })).toBe(false);
    });

    it('returns false when event is undefined', () => {
      expect(isAllComplete({ context: makeContext() })).toBe(false);
    });
  });

  describe('isAllBlocked', () => {
    it('returns true for QUERY_RESULT with all_blocked outcome', () => {
      const event: OrchestratorEvent = {
        type: 'QUERY_RESULT',
        outcome: 'all_blocked',
        blocked_task_ids: [1, 2],
        blocked_reasons: ['missing context', 'ambiguous spec'],
      };
      expect(isAllBlocked({ context: makeContext(), event })).toBe(true);
    });

    it('returns false for QUERY_RESULT with all_complete outcome', () => {
      const event: OrchestratorEvent = { type: 'QUERY_RESULT', outcome: 'all_complete' };
      expect(isAllBlocked({ context: makeContext(), event })).toBe(false);
    });

    it('returns false when event is undefined', () => {
      expect(isAllBlocked({ context: makeContext() })).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 12. Decomposition recommended
// ---------------------------------------------------------------------------
describe('decompositionRecommended guard', () => {
  it('returns true for PREPARE_COMPLETE with decomposition_recommended true', () => {
    const event: OrchestratorEvent = {
      type: 'PREPARE_COMPLETE',
      spec_path: '/tmp/spec.md',
      decomposition_recommended: true,
      decomposition_rationale: 'Complex multi-component feature',
    };
    expect(decompositionRecommended({ context: makeContext(), event })).toBe(true);
  });

  it('returns false for PREPARE_COMPLETE with decomposition_recommended false', () => {
    const event: OrchestratorEvent = {
      type: 'PREPARE_COMPLETE',
      spec_path: '/tmp/spec.md',
      decomposition_recommended: false,
      decomposition_rationale: null,
    };
    expect(decompositionRecommended({ context: makeContext(), event })).toBe(false);
  });

  it('returns true for BRAINSTORM_COMPLETE with decomposition_recommended true', () => {
    const event: OrchestratorEvent = {
      type: 'BRAINSTORM_COMPLETE',
      spec_path: '/tmp/spec.md',
      decomposition_recommended: true,
      decomposition_rationale: 'Multiple independent tasks',
    };
    expect(decompositionRecommended({ context: makeContext(), event })).toBe(true);
  });

  it('returns false for BRAINSTORM_COMPLETE with decomposition_recommended false', () => {
    const event: OrchestratorEvent = {
      type: 'BRAINSTORM_COMPLETE',
      spec_path: '/tmp/spec.md',
      decomposition_recommended: false,
      decomposition_rationale: null,
    };
    expect(decompositionRecommended({ context: makeContext(), event })).toBe(false);
  });

  it('returns true for PLAN_COMPLETE with decomposition_recommended true', () => {
    const event: OrchestratorEvent = {
      type: 'PLAN_COMPLETE',
      plan_path: '/tmp/plan.md',
      decomposition_recommended: true,
      decomposition_rationale: 'Large plan scope',
    };
    expect(decompositionRecommended({ context: makeContext(), event })).toBe(true);
  });

  it('returns false when event is undefined', () => {
    expect(decompositionRecommended({ context: makeContext() })).toBe(false);
  });

  it('returns false for events without decomposition_recommended field', () => {
    const event: OrchestratorEvent = { type: 'FINISH_COMPLETE', summary: 'done' };
    expect(decompositionRecommended({ context: makeContext(), event })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 13. Haiku sizing guards
// ---------------------------------------------------------------------------
describe('Haiku sizing guards', () => {
  describe('isSingle', () => {
    it('returns true for HAIKU_SIZING_RESULT with single answer', () => {
      const event: OrchestratorEvent = { type: 'HAIKU_SIZING_RESULT', answer: 'single', rationale: 'Small enough' };
      expect(isSingle({ context: makeContext(), event })).toBe(true);
    });

    it('returns false for HAIKU_SIZING_RESULT with multiple answer', () => {
      const event: OrchestratorEvent = { type: 'HAIKU_SIZING_RESULT', answer: 'multiple', rationale: 'Too large' };
      expect(isSingle({ context: makeContext(), event })).toBe(false);
    });

    it('returns false when event is undefined', () => {
      expect(isSingle({ context: makeContext() })).toBe(false);
    });

    it('returns false for non-HAIKU_SIZING_RESULT events', () => {
      const event: OrchestratorEvent = { type: 'FINISH_COMPLETE', summary: 'done' };
      expect(isSingle({ context: makeContext(), event })).toBe(false);
    });
  });

  describe('isMultiple', () => {
    it('returns true for HAIKU_SIZING_RESULT with multiple answer', () => {
      const event: OrchestratorEvent = { type: 'HAIKU_SIZING_RESULT', answer: 'multiple', rationale: 'Too large' };
      expect(isMultiple({ context: makeContext(), event })).toBe(true);
    });

    it('returns false for HAIKU_SIZING_RESULT with single answer', () => {
      const event: OrchestratorEvent = { type: 'HAIKU_SIZING_RESULT', answer: 'single', rationale: 'Small enough' };
      expect(isMultiple({ context: makeContext(), event })).toBe(false);
    });

    it('returns false when event is undefined', () => {
      expect(isMultiple({ context: makeContext() })).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 14. Guard combinations
// ---------------------------------------------------------------------------
describe('Guard combinations', () => {
  it('isShip AND requiresUserApproval: both true at critical risk with SHIP verdict', () => {
    const ctx = makeContext({ risk: 'critical', last_review_verdict: 'SHIP' });
    expect(isShip({ context: ctx }) && requiresUserApproval({ context: ctx })).toBe(true);
  });

  it('isShip AND requiresUserApproval: isShip true but requiresUserApproval false at standard risk', () => {
    const ctx = makeContext({ risk: 'standard', last_review_verdict: 'SHIP' });
    expect(isShip({ context: ctx })).toBe(true);
    expect(requiresUserApproval({ context: ctx })).toBe(false);
    expect(isShip({ context: ctx }) && requiresUserApproval({ context: ctx })).toBe(false);
  });

  it('isRevise AND belowMaxRounds: both true at round 1 of max 2 with REVISE verdict', () => {
    const ctx = makeContext({ last_review_verdict: 'REVISE', review_round: 1, max_review_rounds: 2 });
    expect(isRevise({ context: ctx }) && belowMaxRounds({ context: ctx })).toBe(true);
  });

  it('isRevise AND belowMaxRounds: isRevise true but belowMaxRounds false at max round', () => {
    const ctx = makeContext({ last_review_verdict: 'REVISE', review_round: 2, max_review_rounds: 2 });
    expect(isRevise({ context: ctx })).toBe(true);
    expect(belowMaxRounds({ context: ctx })).toBe(false);
    expect(isRevise({ context: ctx }) && belowMaxRounds({ context: ctx })).toBe(false);
  });

  it('workerSucceeded AND allTasksComplete: dispatches to finish when last task completes', () => {
    const ctx = makeContext({ tasks_complete: 3, task_count: 3 });
    const event: OrchestratorEvent = {
      type: 'WORKER_COMPLETE',
      task_id: 3,
      status: 'DONE',
      result_path: '/tmp/result.md',
      cost_usd: 0.05,
      duration_ms: 2000,
      files_changed: ['src/foo.ts'],
      concerns: null,
    };
    expect(workerSucceeded({ context: ctx, event }) && allTasksComplete({ context: ctx })).toBe(true);
  });
});

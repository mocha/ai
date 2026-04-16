import { describe, it, expect, beforeEach } from 'vitest';
import { createActor, type AnyActor } from 'xstate';
import { orchestratorMachine } from '../machine.js';
import { setDispatcher } from '../actions.js';
import type { OrchestratorContext } from '../context.js';
import type { OrchestratorEvent } from '../events.js';
import type { Stage } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dispatched: any[] = [];

function createTestActor() {
  dispatched = [];
  setDispatcher((cmd) => dispatched.push(cmd));
  return createActor(orchestratorMachine);
}

/**
 * Build a persisted snapshot with overridden state value and context fields.
 * This lets tests start in any state without replaying the full event history.
 */
function makeSnapshot(stateValue: any, contextOverrides: Partial<OrchestratorContext> = {}) {
  dispatched = [];
  setDispatcher((cmd) => dispatched.push(cmd));
  const actor = createActor(orchestratorMachine);
  actor.start();
  const snapshot = actor.getPersistedSnapshot();
  actor.stop();
  return {
    ...snapshot,
    value: stateValue,
    context: { ...snapshot.context, ...contextOverrides },
  };
}

function actorFromSnapshot(stateValue: any, contextOverrides: Partial<OrchestratorContext> = {}) {
  const snap = makeSnapshot(stateValue, contextOverrides);
  const actor = createActor(orchestratorMachine, { snapshot: snap as any });
  actor.start();
  return actor;
}

/** Helper to get a readable string from the snapshot value */
function stateOf(actor: AnyActor): any {
  return actor.getSnapshot().value;
}

/** Helper to get context from actor */
function contextOf(actor: AnyActor): OrchestratorContext {
  return actor.getSnapshot().context;
}

/** Standard task for events that need one */
const testTask = {
  id: 1,
  title: 'Test task',
  dependencies: [] as number[],
  status: 'pending',
  details: 'details',
  acceptanceCriteria: ['test'],
  relevantFiles: ['src/test.ts'],
};

/** Trivial path: only triage, develop, finish */
const trivialPath: Stage[] = ['triage', 'develop', 'finish'];

/** Standard path with spec_review and write_plan */
const standardPath: Stage[] = ['triage', 'prepare', 'brainstorm', 'spec_review', 'write_plan', 'plan_review', 'develop', 'finish'];

/** Elevated path: skips brainstorm */
const elevatedPath: Stage[] = ['triage', 'prepare', 'spec_review', 'write_plan', 'plan_review', 'develop', 'finish'];

// ---------------------------------------------------------------------------
// 1. Happy path: trivial risk
// ---------------------------------------------------------------------------
describe('Happy path: trivial risk (skip everything except develop)', () => {
  let actor: AnyActor;

  beforeEach(() => {
    actor = createTestActor();
    actor.start();
  });

  it('starts in idle, advances to triage on START', () => {
    expect(stateOf(actor)).toBe('idle');
    actor.send({ type: 'START', input: { type: 'raw-idea', content: 'test', user_risk_override: null } });
    expect(stateOf(actor)).toBe('triage');
    expect(dispatched.some((c: any) => c.type === 'RUN_TRIAGE')).toBe(true);
  });

  it('full trivial pipeline from triage to done', () => {
    actor.send({ type: 'START', input: { type: 'raw-idea', content: 'test', user_risk_override: null } });

    // TRIAGE_COMPLETE with trivial path (no decompose)
    actor.send({
      type: 'TRIAGE_COMPLETE',
      input_type: 'raw-idea',
      risk: 'trivial',
      path: trivialPath,
      existing_artifact: null,
      external_ref: null,
      decompose: false,
      domain_clusters: [],
    } as OrchestratorEvent);

    // trivial path: no prepare, no brainstorm, no spec_review, no write_plan, no plan_review
    // decompose: false => shouldNotDecompose fires => develop.next_task
    // The machine goes: prepare (skip) -> brainstorm (skip) -> size_check_pre_spec (skip spec_review -> write_plan skip -> size_check_pre_plan skip plan_review -> develop)
    // Actually: triage -> prepare. prepare has always: shouldSkipPrepare (path doesn't include 'prepare') -> brainstorm.
    // brainstorm has always: shouldSkipBrainstorm (not in path) -> size_check_pre_spec.
    // size_check_pre_spec has always: shouldSkipSpecReview (not in path) -> write_plan.
    // write_plan has always: shouldSkipWritePlan (not in path) -> size_check_pre_plan.
    // size_check_pre_plan has always: shouldSkipPlanReview (not in path) -> develop.
    // develop initial: decompose. decompose has always: shouldNotDecompose (decompose=false) -> next_task.
    // So we should land in develop.next_task.
    expect(stateOf(actor)).toEqual({ develop: 'next_task' });

    // QUERY_RESULT with task_ready
    actor.send({
      type: 'QUERY_RESULT',
      outcome: 'task_ready',
      task: testTask,
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ develop: 'generate_expert' });

    // EXPERT_READY with drift pass
    actor.send({
      type: 'EXPERT_READY',
      task_id: 1,
      expert_prompt_path: '/tmp/expert.md',
      drift_check: 'pass',
      drift_details: null,
    } as OrchestratorEvent);

    // dispatch_worker -> always -> await_worker
    expect(stateOf(actor)).toEqual({ develop: 'await_worker' });

    // WORKER_COMPLETE with DONE
    actor.send({
      type: 'WORKER_COMPLETE',
      task_id: 1,
      status: 'DONE',
      result_path: '/tmp/result.md',
      cost_usd: 0.05,
      duration_ms: 5000,
      files_changed: ['src/test.ts'],
      concerns: null,
    } as OrchestratorEvent);

    // review_task: dispatching_review -> always -> awaiting_review
    expect(stateOf(actor)).toEqual({ develop: { review_task: 'awaiting_review' } });

    // REVIEW_COMPLETE with SHIP
    actor.send({
      type: 'REVIEW_COMPLETE',
      task_id: 1,
      verdict: 'SHIP',
      round: 1,
      report_path: '/tmp/report.md',
      findings: [],
      gate: 'code_quality',
    } as OrchestratorEvent);

    // route_verdict -> isShip -> exit_ship (final) -> onDone: not abort, not revise -> next_task
    expect(stateOf(actor)).toEqual({ develop: 'next_task' });

    // QUERY_RESULT with all_complete
    actor.send({
      type: 'QUERY_RESULT',
      outcome: 'all_complete',
    } as OrchestratorEvent);

    // finish_develop (final) -> develop.onDone: not abort -> finish
    expect(stateOf(actor)).toBe('finish');

    // FINISH_COMPLETE
    actor.send({
      type: 'FINISH_COMPLETE',
      summary: 'All done',
    } as OrchestratorEvent);

    expect(stateOf(actor)).toBe('done');
    expect(actor.getSnapshot().status).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// 2. Compound spec_review: SHIP at standard risk (no approval gate)
// ---------------------------------------------------------------------------
describe('Compound spec_review: SHIP at standard risk', () => {
  it('advances to write_plan after SHIP without approval gate', () => {
    // Start in spec_review with standard risk and spec_review in path
    const actor = actorFromSnapshot(
      { spec_review: 'awaiting_review' },
      {
        risk: 'standard',
        path: standardPath,
        max_review_rounds: 2,
      },
    );

    actor.send({
      type: 'REVIEW_COMPLETE',
      task_id: -1,
      verdict: 'SHIP',
      round: 1,
      report_path: '/tmp/report.md',
      findings: [],
      gate: 'code_quality',
    } as OrchestratorEvent);

    // route_verdict -> isShipNoApproval -> exit (final) -> onDone -> write_plan
    expect(stateOf(actor)).toBe('write_plan');
  });
});

// ---------------------------------------------------------------------------
// 3. Compound spec_review: SHIP at critical risk needs approval
// ---------------------------------------------------------------------------
describe('Compound spec_review: SHIP at critical risk needs approval', () => {
  it('goes to awaiting_approval then write_plan on proceed', () => {
    const actor = actorFromSnapshot(
      { spec_review: 'awaiting_review' },
      {
        risk: 'critical',
        path: ['triage', 'prepare', 'brainstorm', 'spec_review', 'write_plan', 'plan_review', 'develop', 'finish'],
        max_review_rounds: 3,
      },
    );

    actor.send({
      type: 'REVIEW_COMPLETE',
      task_id: -1,
      verdict: 'SHIP',
      round: 1,
      report_path: '/tmp/report.md',
      findings: [],
      gate: 'code_quality',
    } as OrchestratorEvent);

    // route_verdict -> isShipAndRequiresApproval -> awaiting_approval
    expect(stateOf(actor)).toEqual({ spec_review: 'awaiting_approval' });

    actor.send({
      type: 'USER_APPROVE',
      stage: 'spec_review',
      decision: 'proceed',
    } as OrchestratorEvent);

    // exit (final) -> onDone -> write_plan
    expect(stateOf(actor)).toBe('write_plan');
  });

  it('goes to done on abort from approval gate', () => {
    const actor = actorFromSnapshot(
      { spec_review: 'awaiting_approval' },
      {
        risk: 'critical',
        path: standardPath,
        last_review_verdict: 'SHIP',
      },
    );

    actor.send({
      type: 'USER_APPROVE',
      stage: 'spec_review',
      decision: 'abort',
    } as OrchestratorEvent);

    expect(stateOf(actor)).toBe('done');
    expect(contextOf(actor).abort_reason).toContain('abort');
  });
});

// ---------------------------------------------------------------------------
// 4. Compound spec_review: REVISE loop then escalation
// ---------------------------------------------------------------------------
describe('Compound spec_review: REVISE loop', () => {
  it('loops on REVISE below max, escalates at max', () => {
    const actor = actorFromSnapshot(
      { spec_review: 'awaiting_review' },
      {
        risk: 'standard',
        path: standardPath,
        max_review_rounds: 2,
        review_round: 0,
      },
    );

    // Round 1 REVISE: review_round goes from 0->1, belowMax (1 < 2) -> dispatching_review -> awaiting_review
    actor.send({
      type: 'REVIEW_COMPLETE',
      task_id: -1,
      verdict: 'REVISE',
      round: 1,
      report_path: '/tmp/report.md',
      findings: [],
      gate: 'code_quality',
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ spec_review: 'awaiting_review' });
    expect(contextOf(actor).review_round).toBe(1);

    // Round 2 REVISE: review_round goes from 1->2, NOT belowMax (2 >= 2) -> escalate
    actor.send({
      type: 'REVIEW_COMPLETE',
      task_id: -1,
      verdict: 'REVISE',
      round: 2,
      report_path: '/tmp/report2.md',
      findings: [],
      gate: 'code_quality',
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ spec_review: 'escalate' });
    expect(contextOf(actor).review_round).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Compound spec_review: RETHINK escalation
// ---------------------------------------------------------------------------
describe('Compound spec_review: RETHINK escalation', () => {
  it('RETHINK verdict escalates, skip exits to write_plan', () => {
    const actor = actorFromSnapshot(
      { spec_review: 'awaiting_review' },
      {
        risk: 'standard',
        path: standardPath,
        max_review_rounds: 2,
        review_round: 0,
      },
    );

    // RETHINK: storeReviewResult sets last_review_verdict='RETHINK', review_round=1
    // route_verdict: not SHIP, not REVISE-and-belowMax (it's RETHINK not REVISE) -> fallthrough escalate
    actor.send({
      type: 'REVIEW_COMPLETE',
      task_id: -1,
      verdict: 'RETHINK',
      round: 1,
      report_path: '/tmp/report.md',
      findings: [],
      gate: 'code_quality',
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ spec_review: 'escalate' });

    // User skips
    actor.send({
      type: 'USER_ESCALATION_RESPONSE',
      task_id: -1,
      action: 'skip',
    } as OrchestratorEvent);

    // exit (final) -> onDone -> write_plan
    expect(stateOf(actor)).toBe('write_plan');
  });

  it('retry from escalation resets review round and returns to dispatching_review', () => {
    const actor = actorFromSnapshot(
      { spec_review: 'escalate' },
      {
        risk: 'standard',
        path: standardPath,
        max_review_rounds: 2,
        review_round: 2,
        last_review_verdict: 'RETHINK',
      },
    );

    actor.send({
      type: 'USER_ESCALATION_RESPONSE',
      task_id: -1,
      action: 'retry',
    } as OrchestratorEvent);

    // dispatching_review -> always -> awaiting_review
    expect(stateOf(actor)).toEqual({ spec_review: 'awaiting_review' });
    expect(contextOf(actor).review_round).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. QUERY_RESULT routing in develop.next_task
// ---------------------------------------------------------------------------
describe('QUERY_RESULT routing in develop.next_task', () => {
  function makeNextTaskActor() {
    return actorFromSnapshot(
      { develop: 'next_task' },
      {
        risk: 'trivial',
        path: trivialPath,
        decompose: false,
      },
    );
  }

  it('task_ready -> generate_expert', () => {
    const actor = makeNextTaskActor();
    actor.send({
      type: 'QUERY_RESULT',
      outcome: 'task_ready',
      task: testTask,
    } as OrchestratorEvent);
    expect(stateOf(actor)).toEqual({ develop: 'generate_expert' });
  });

  it('all_complete -> finish (via finish_develop)', () => {
    const actor = makeNextTaskActor();
    actor.send({
      type: 'QUERY_RESULT',
      outcome: 'all_complete',
    } as OrchestratorEvent);
    // finish_develop (final) -> develop.onDone -> finish
    expect(stateOf(actor)).toBe('finish');
  });

  it('all_blocked -> escalate_blocked', () => {
    const actor = makeNextTaskActor();
    actor.send({
      type: 'QUERY_RESULT',
      outcome: 'all_blocked',
      blocked_task_ids: [1, 2],
      blocked_reasons: ['dependency unmet'],
    } as OrchestratorEvent);
    expect(stateOf(actor)).toEqual({ develop: 'escalate_blocked' });
  });
});

// ---------------------------------------------------------------------------
// 7. Escalate_blocked: user responses
// ---------------------------------------------------------------------------
describe('Escalate_blocked: user responses', () => {
  function makeBlockedActor() {
    return actorFromSnapshot(
      { develop: 'escalate_blocked' },
      {
        risk: 'standard',
        path: standardPath,
        decompose: false,
      },
    );
  }

  it('retry -> next_task', () => {
    const actor = makeBlockedActor();
    actor.send({
      type: 'USER_ESCALATION_RESPONSE',
      task_id: 1,
      action: 'retry',
    } as OrchestratorEvent);
    expect(stateOf(actor)).toEqual({ develop: 'next_task' });
  });

  it('skip -> finish (via finish_develop)', () => {
    const actor = makeBlockedActor();
    actor.send({
      type: 'USER_ESCALATION_RESPONSE',
      task_id: 1,
      action: 'skip',
    } as OrchestratorEvent);
    // finish_develop (final) -> develop.onDone -> finish
    expect(stateOf(actor)).toBe('finish');
  });

  it('abort -> done (via abort -> develop.onDone with hasAbortReason)', () => {
    const actor = makeBlockedActor();
    actor.send({
      type: 'USER_ESCALATION_RESPONSE',
      task_id: 1,
      action: 'abort',
    } as OrchestratorEvent);
    // abort (final) -> develop.onDone: hasAbortReason -> done
    expect(stateOf(actor)).toBe('done');
    expect(contextOf(actor).abort_reason).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. DISPATCH_ERROR global handler
// ---------------------------------------------------------------------------
describe('DISPATCH_ERROR global handler', () => {
  it('records error in context without changing state', () => {
    const actor = actorFromSnapshot('triage', { risk: 'standard', path: standardPath });

    actor.send({
      type: 'DISPATCH_ERROR',
      failed_command: 'RUN_TRIAGE',
      error_message: 'network timeout',
      attempts: 3,
    } as OrchestratorEvent);

    // State should NOT change (global handler has no target)
    expect(stateOf(actor)).toBe('triage');
    expect(contextOf(actor).error).toContain('network timeout');
    expect(contextOf(actor).error).toContain('RUN_TRIAGE');
  });

  it('works in a compound state too', () => {
    const actor = actorFromSnapshot(
      { develop: 'await_worker' },
      { risk: 'standard', path: standardPath, decompose: false },
    );

    actor.send({
      type: 'DISPATCH_ERROR',
      failed_command: 'DISPATCH_WORKER',
      error_message: 'spawn failed',
      attempts: 1,
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ develop: 'await_worker' });
    expect(contextOf(actor).error).toContain('spawn failed');
  });
});

// ---------------------------------------------------------------------------
// 9. Decomposition recommended routing
// ---------------------------------------------------------------------------
describe('Decomposition recommended routing', () => {
  it('PREPARE_COMPLETE with decomposition_recommended: true -> develop', () => {
    const actor = actorFromSnapshot('prepare', {
      risk: 'standard',
      path: standardPath,
    });

    actor.send({
      type: 'PREPARE_COMPLETE',
      spec_path: '/tmp/spec.md',
      decomposition_recommended: true,
      decomposition_rationale: 'Complex multi-component feature',
    } as OrchestratorEvent);

    // Goes to develop (decompose is still false from default, so shouldNotDecompose fires -> next_task)
    expect(stateOf(actor)).toEqual({ develop: 'next_task' });
  });

  it('PREPARE_COMPLETE with decomposition_recommended: false -> brainstorm', () => {
    const actor = actorFromSnapshot('prepare', {
      risk: 'standard',
      path: standardPath,
    });

    actor.send({
      type: 'PREPARE_COMPLETE',
      spec_path: '/tmp/spec.md',
      decomposition_recommended: false,
      decomposition_rationale: null,
    } as OrchestratorEvent);

    // Goes to brainstorm (brainstorm is in path, so not skipped)
    expect(stateOf(actor)).toBe('brainstorm');
  });
});

// ---------------------------------------------------------------------------
// 10. Worker blocked escalation
// ---------------------------------------------------------------------------
describe('Worker blocked escalation', () => {
  it('WORKER_COMPLETE with BLOCKED -> escalate_worker', () => {
    const actor = actorFromSnapshot(
      { develop: 'await_worker' },
      {
        risk: 'standard',
        path: standardPath,
        decompose: false,
        current_task_id: 1,
        tasks: { 1: { id: 1, title: 'Task 1', status: 'in_progress', review_round: 0, worker_result_path: null, expert_prompt_path: null, cost_usd: 0, duration_ms: 0 } },
      },
    );

    actor.send({
      type: 'WORKER_COMPLETE',
      task_id: 1,
      status: 'BLOCKED',
      result_path: '/tmp/result.md',
      cost_usd: 0.01,
      duration_ms: 1000,
      files_changed: [],
      concerns: 'Missing API key',
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ develop: 'escalate_worker' });
  });

  it('WORKER_COMPLETE with NEEDS_CONTEXT -> escalate_worker', () => {
    const actor = actorFromSnapshot(
      { develop: 'await_worker' },
      {
        risk: 'standard',
        path: standardPath,
        decompose: false,
        current_task_id: 1,
        tasks: { 1: { id: 1, title: 'Task 1', status: 'in_progress', review_round: 0, worker_result_path: null, expert_prompt_path: null, cost_usd: 0, duration_ms: 0 } },
      },
    );

    actor.send({
      type: 'WORKER_COMPLETE',
      task_id: 1,
      status: 'NEEDS_CONTEXT',
      result_path: '/tmp/result.md',
      cost_usd: 0.01,
      duration_ms: 1000,
      files_changed: [],
      concerns: 'Need more info about the schema',
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ develop: 'escalate_worker' });
  });
});

// ---------------------------------------------------------------------------
// 11. Drift failure escalation
// ---------------------------------------------------------------------------
describe('Drift failure escalation', () => {
  it('EXPERT_READY with drift_check fail -> escalate_drift', () => {
    const actor = actorFromSnapshot(
      { develop: 'generate_expert' },
      {
        risk: 'standard',
        path: standardPath,
        decompose: false,
        current_task_id: 1,
        tasks: { 1: { id: 1, title: 'Task 1', status: 'expert_ready', review_round: 0, worker_result_path: null, expert_prompt_path: null, cost_usd: 0, duration_ms: 0 } },
      },
    );

    actor.send({
      type: 'EXPERT_READY',
      task_id: 1,
      expert_prompt_path: '/tmp/expert.md',
      drift_check: 'fail',
      drift_details: 'Spec has diverged from implementation',
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ develop: 'escalate_drift' });
  });

  it('escalate_drift: retry -> generate_expert', () => {
    const actor = actorFromSnapshot(
      { develop: 'escalate_drift' },
      {
        risk: 'standard',
        path: standardPath,
        decompose: false,
        current_task_id: 1,
      },
    );

    actor.send({
      type: 'USER_ESCALATION_RESPONSE',
      task_id: 1,
      action: 'retry',
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ develop: 'generate_expert' });
  });

  it('escalate_drift: skip -> next_task', () => {
    const actor = actorFromSnapshot(
      { develop: 'escalate_drift' },
      {
        risk: 'standard',
        path: standardPath,
        decompose: false,
        current_task_id: 1,
      },
    );

    actor.send({
      type: 'USER_ESCALATION_RESPONSE',
      task_id: 1,
      action: 'skip',
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ develop: 'next_task' });
  });

  it('escalate_drift: abort -> done', () => {
    const actor = actorFromSnapshot(
      { develop: 'escalate_drift' },
      {
        risk: 'standard',
        path: standardPath,
        decompose: false,
        current_task_id: 1,
      },
    );

    actor.send({
      type: 'USER_ESCALATION_RESPONSE',
      task_id: 1,
      action: 'abort',
    } as OrchestratorEvent);

    // abort (final) -> develop.onDone: hasAbortReason -> done
    expect(stateOf(actor)).toBe('done');
    expect(contextOf(actor).abort_reason).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 12. COMPACTION_DETECTED
// ---------------------------------------------------------------------------
describe('COMPACTION_DETECTED', () => {
  it('in await_worker -> escalate_worker', () => {
    const actor = actorFromSnapshot(
      { develop: 'await_worker' },
      {
        risk: 'standard',
        path: standardPath,
        decompose: false,
        current_task_id: 1,
        tasks: { 1: { id: 1, title: 'Task 1', status: 'in_progress', review_round: 0, worker_result_path: null, expert_prompt_path: null, cost_usd: 0, duration_ms: 0 } },
      },
    );

    actor.send({
      type: 'COMPACTION_DETECTED',
      task_id: 1,
      session_id: 'sess-123',
      utilization_at_compaction: 0.85,
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ develop: 'escalate_worker' });
    // Task status should be reset to pending
    expect(contextOf(actor).tasks[1].status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// 13. Abort from triage (via spec_review approval gate -- triage itself
//     doesn't have USER_APPROVE, so we test abort from earliest approval point)
// ---------------------------------------------------------------------------
describe('Abort from spec_review approval gate', () => {
  it('USER_APPROVE abort -> done', () => {
    const actor = actorFromSnapshot(
      { spec_review: 'awaiting_approval' },
      {
        risk: 'critical',
        path: standardPath,
        last_review_verdict: 'SHIP',
      },
    );

    actor.send({
      type: 'USER_APPROVE',
      stage: 'spec_review',
      decision: 'abort',
    } as OrchestratorEvent);

    expect(stateOf(actor)).toBe('done');
    expect(contextOf(actor).abort_reason).toContain('abort');
  });
});

// ---------------------------------------------------------------------------
// 14. Per-task review: REVISE routes back to dispatch_worker
// ---------------------------------------------------------------------------
describe('Per-task review: REVISE routes back to dispatch_worker', () => {
  it('REVISE below max rounds -> dispatch_worker -> await_worker', () => {
    const actor = actorFromSnapshot(
      { develop: { review_task: 'awaiting_review' } },
      {
        risk: 'standard',
        path: standardPath,
        decompose: false,
        current_task_id: 1,
        review_round: 0,
        max_review_rounds: 2,
        last_review_verdict: null,
        tasks: { 1: { id: 1, title: 'Task 1', status: 'review', review_round: 0, worker_result_path: '/tmp/r.md', expert_prompt_path: '/tmp/e.md', cost_usd: 0.01, duration_ms: 1000 } },
      },
    );

    actor.send({
      type: 'REVIEW_COMPLETE',
      task_id: 1,
      verdict: 'REVISE',
      round: 1,
      report_path: '/tmp/report.md',
      findings: [{ severity: 'warning', description: 'Missing test', file: 'src/test.ts', line: 10 }],
      gate: 'code_quality',
    } as OrchestratorEvent);

    // storeReviewResult: review_round -> 1, last_review_verdict -> 'REVISE'
    // route_verdict: isReviseAndBelowMax (1 < 2) -> exit_revise (final)
    // review_task.onDone: lastVerdictIsRevise -> dispatch_worker -> always -> await_worker
    expect(stateOf(actor)).toEqual({ develop: 'await_worker' });
    expect(contextOf(actor).review_round).toBe(0); // resetReviewRound fires in dispatch_worker entry
    expect(dispatched.some((c: any) => c.type === 'DISPATCH_WORKER')).toBe(true);
  });

  it('SHIP marks task done and goes to next_task', () => {
    const actor = actorFromSnapshot(
      { develop: { review_task: 'awaiting_review' } },
      {
        risk: 'standard',
        path: standardPath,
        decompose: false,
        current_task_id: 1,
        review_round: 0,
        max_review_rounds: 2,
        last_review_verdict: null,
        tasks: { 1: { id: 1, title: 'Task 1', status: 'review', review_round: 0, worker_result_path: '/tmp/r.md', expert_prompt_path: '/tmp/e.md', cost_usd: 0.01, duration_ms: 1000 } },
      },
    );

    actor.send({
      type: 'REVIEW_COMPLETE',
      task_id: 1,
      verdict: 'SHIP',
      round: 1,
      report_path: '/tmp/report.md',
      findings: [],
      gate: 'code_quality',
    } as OrchestratorEvent);

    // route_verdict: isShip -> exit_ship (final) with markTaskDone + dispatchQueryNextTask
    // review_task.onDone: not abort, not revise -> next_task
    expect(stateOf(actor)).toEqual({ develop: 'next_task' });
    expect(contextOf(actor).tasks[1].status).toBe('done');
  });

  it('REVISE at max rounds -> escalate then skip exits review_task', () => {
    const actor = actorFromSnapshot(
      { develop: { review_task: 'awaiting_review' } },
      {
        risk: 'trivial',
        path: trivialPath,
        decompose: false,
        current_task_id: 1,
        review_round: 0,
        max_review_rounds: 1,  // trivial: 1 round max
        last_review_verdict: null,
        tasks: { 1: { id: 1, title: 'Task 1', status: 'review', review_round: 0, worker_result_path: '/tmp/r.md', expert_prompt_path: '/tmp/e.md', cost_usd: 0.01, duration_ms: 1000 } },
      },
    );

    // Round 1 REVISE: review_round -> 1, NOT belowMax (1 >= 1) -> escalate
    actor.send({
      type: 'REVIEW_COMPLETE',
      task_id: 1,
      verdict: 'REVISE',
      round: 1,
      report_path: '/tmp/report.md',
      findings: [],
      gate: 'code_quality',
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ develop: { review_task: 'escalate' } });

    // Skip from escalation
    actor.send({
      type: 'USER_ESCALATION_RESPONSE',
      task_id: 1,
      action: 'skip',
    } as OrchestratorEvent);

    // exit_skip (final) -> review_task.onDone: not abort, not revise (verdict still REVISE but it's
    // overridden... actually storeReviewResult not called on skip. lastVerdictIsRevise is true.
    // Wait: the escalation skip goes to exit_skip with markTaskSkipped + dispatchQueryNextTask.
    // markTaskSkipped clears last_review_verdict to null, so onDone's
    // lastVerdictIsRevise guard is false. Falls through to next_task.
    const finalState = stateOf(actor);
    expect(finalState).toEqual({ develop: 'next_task' });
  });
});

// ---------------------------------------------------------------------------
// 15. Stage skipping for elevated risk
// ---------------------------------------------------------------------------
describe('Stage skipping for elevated risk', () => {
  it('skips brainstorm when not in path', () => {
    // Start fresh and use a path without brainstorm
    const actor = createTestActor();
    actor.start();

    actor.send({ type: 'START', input: { type: 'raw-idea', content: 'test', user_risk_override: null } });
    expect(stateOf(actor)).toBe('triage');

    actor.send({
      type: 'TRIAGE_COMPLETE',
      input_type: 'raw-idea',
      risk: 'elevated',
      path: elevatedPath,  // no brainstorm
      existing_artifact: null,
      external_ref: null,
      decompose: false,
      domain_clusters: [],
    } as OrchestratorEvent);

    // After triage -> prepare (prepare is in path, not skipped)
    expect(stateOf(actor)).toBe('prepare');

    // Complete prepare without decomposition recommendation
    actor.send({
      type: 'PREPARE_COMPLETE',
      spec_path: '/tmp/spec.md',
      decomposition_recommended: false,
      decomposition_rationale: null,
    } as OrchestratorEvent);

    // prepare -> brainstorm. brainstorm: shouldSkipBrainstorm (not in path) -> size_check_pre_spec.
    // size_check_pre_spec: shouldSkipSpecReview? spec_review IS in path, so not skipped.
    // size_check_pre_spec: entry runMechanicalSizing, initial evaluating.
    // No spec_path file on disk => sizing result = under => sizingClearlyUnder -> proceed (final)
    // onDone: sizingIsOver? no (under) -> spec_review
    expect(stateOf(actor)).toEqual({ spec_review: 'awaiting_review' });
    // Brainstorm was skipped! Confirm no brainstorm dispatch
    expect(dispatched.some((c: any) => c.type === 'BRAINSTORM')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 16. Escalate_worker: user responses
// ---------------------------------------------------------------------------
describe('Escalate_worker: user responses', () => {
  function makeEscalateWorkerActor() {
    return actorFromSnapshot(
      { develop: 'escalate_worker' },
      {
        risk: 'standard',
        path: standardPath,
        decompose: false,
        current_task_id: 1,
        tasks: { 1: { id: 1, title: 'Task 1', status: 'in_progress', review_round: 0, worker_result_path: null, expert_prompt_path: '/tmp/e.md', cost_usd: 0, duration_ms: 0 } },
      },
    );
  }

  it('retry -> dispatch_worker -> await_worker', () => {
    const actor = makeEscalateWorkerActor();
    actor.send({
      type: 'USER_ESCALATION_RESPONSE',
      task_id: 1,
      action: 'retry',
    } as OrchestratorEvent);
    expect(stateOf(actor)).toEqual({ develop: 'await_worker' });
  });

  it('skip -> next_task', () => {
    const actor = makeEscalateWorkerActor();
    actor.send({
      type: 'USER_ESCALATION_RESPONSE',
      task_id: 1,
      action: 'skip',
    } as OrchestratorEvent);
    expect(stateOf(actor)).toEqual({ develop: 'next_task' });
  });

  it('abort -> done', () => {
    const actor = makeEscalateWorkerActor();
    actor.send({
      type: 'USER_ESCALATION_RESPONSE',
      task_id: 1,
      action: 'abort',
    } as OrchestratorEvent);
    expect(stateOf(actor)).toBe('done');
    expect(contextOf(actor).abort_reason).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 17. Plan review: same compound structure as spec_review
// ---------------------------------------------------------------------------
describe('Plan review compound state', () => {
  it('SHIP at standard risk exits to develop', () => {
    const actor = actorFromSnapshot(
      { plan_review: 'awaiting_review' },
      {
        risk: 'standard',
        path: standardPath,
        max_review_rounds: 2,
        review_round: 0,
        decompose: false,
      },
    );

    actor.send({
      type: 'REVIEW_COMPLETE',
      task_id: -1,
      verdict: 'SHIP',
      round: 1,
      report_path: '/tmp/report.md',
      findings: [],
      gate: 'code_quality',
    } as OrchestratorEvent);

    // route_verdict -> isShipNoApproval -> exit -> onDone -> develop
    // develop: decompose -> shouldNotDecompose -> next_task
    expect(stateOf(actor)).toEqual({ develop: 'next_task' });
  });

  it('SHIP at critical risk -> awaiting_approval -> proceed -> develop', () => {
    const actor = actorFromSnapshot(
      { plan_review: 'awaiting_review' },
      {
        risk: 'critical',
        path: standardPath,
        max_review_rounds: 3,
        review_round: 0,
        decompose: false,
      },
    );

    actor.send({
      type: 'REVIEW_COMPLETE',
      task_id: -1,
      verdict: 'SHIP',
      round: 1,
      report_path: '/tmp/report.md',
      findings: [],
      gate: 'code_quality',
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ plan_review: 'awaiting_approval' });

    actor.send({
      type: 'USER_APPROVE',
      stage: 'plan_review',
      decision: 'proceed',
    } as OrchestratorEvent);

    // exit -> onDone -> develop -> decompose -> shouldNotDecompose -> next_task
    expect(stateOf(actor)).toEqual({ develop: 'next_task' });
  });
});

// ---------------------------------------------------------------------------
// 18. Develop: decompose path (decompose: true)
// ---------------------------------------------------------------------------
describe('Develop: decompose path', () => {
  it('decompose: true dispatches decompose and waits for DECOMPOSITION_COMPLETE', () => {
    const actor = actorFromSnapshot(
      { develop: 'decompose' },
      {
        risk: 'standard',
        path: standardPath,
        decompose: true,
        spec_path: '/tmp/spec.md',
      },
    );

    // decompose: shouldNotDecompose is false (decompose=true), so stays in decompose
    // entry: dispatchDecompose
    expect(stateOf(actor)).toEqual({ develop: 'decompose' });

    actor.send({
      type: 'DECOMPOSITION_COMPLETE',
      task_count: 3,
      task_ids: [1, 2, 3],
      domains: ['backend', 'frontend'],
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ develop: 'next_task' });
    expect(contextOf(actor).task_count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 19. STATUS_ROLLUP global handler
// ---------------------------------------------------------------------------
describe('STATUS_ROLLUP global handler', () => {
  it('updates tasks_complete without changing state', () => {
    const actor = actorFromSnapshot(
      { develop: 'await_worker' },
      {
        risk: 'standard',
        path: standardPath,
        decompose: false,
        tasks_complete: 2,
      },
    );

    actor.send({
      type: 'STATUS_ROLLUP',
      parent_id: 0,
      children_complete: 5,
      children_total: 10,
      all_complete: false,
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ develop: 'await_worker' });
    expect(contextOf(actor).tasks_complete).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 20. Idle state: only responds to START
// ---------------------------------------------------------------------------
describe('Idle state', () => {
  it('ignores non-START events', () => {
    const actor = createTestActor();
    actor.start();
    expect(stateOf(actor)).toBe('idle');

    // Sending TRIAGE_COMPLETE to idle should not crash or change state
    actor.send({
      type: 'TRIAGE_COMPLETE',
      input_type: 'raw-idea',
      risk: 'trivial',
      path: trivialPath,
      existing_artifact: null,
      external_ref: null,
      decompose: false,
      domain_clusters: [],
    } as OrchestratorEvent);

    expect(stateOf(actor)).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// 21. Write_plan stage
// ---------------------------------------------------------------------------
describe('Write_plan stage', () => {
  it('PLAN_COMPLETE without decomposition -> size_check_pre_plan', () => {
    const actor = actorFromSnapshot('write_plan', {
      risk: 'standard',
      path: standardPath,
    });

    actor.send({
      type: 'PLAN_COMPLETE',
      plan_path: '/tmp/plan.md',
      decomposition_recommended: false,
      decomposition_rationale: null,
    } as OrchestratorEvent);

    // size_check_pre_plan: shouldSkipPlanReview? plan_review IS in path.
    // runMechanicalSizing: no file on disk -> under. sizingClearlyUnder -> proceed -> onDone -> plan_review
    expect(stateOf(actor)).toEqual({ plan_review: 'awaiting_review' });
  });

  it('PLAN_COMPLETE with decomposition_recommended -> develop', () => {
    const actor = actorFromSnapshot('write_plan', {
      risk: 'standard',
      path: standardPath,
      decompose: false,
    });

    actor.send({
      type: 'PLAN_COMPLETE',
      plan_path: '/tmp/plan.md',
      decomposition_recommended: true,
      decomposition_rationale: 'Large plan scope',
    } as OrchestratorEvent);

    // Goes to develop with decompose still false -> next_task
    expect(stateOf(actor)).toEqual({ develop: 'next_task' });
  });
});

// ---------------------------------------------------------------------------
// 22. Context updates from configureFromRisk
// ---------------------------------------------------------------------------
describe('configureFromRisk', () => {
  it('sets trivial config on trivial risk triage', () => {
    const actor = createTestActor();
    actor.start();
    actor.send({ type: 'START', input: { type: 'raw-idea', content: 'test', user_risk_override: null } });

    actor.send({
      type: 'TRIAGE_COMPLETE',
      input_type: 'raw-idea',
      risk: 'trivial',
      path: trivialPath,
      existing_artifact: null,
      external_ref: null,
      decompose: false,
      domain_clusters: [],
    } as OrchestratorEvent);

    const ctx = contextOf(actor);
    expect(ctx.risk).toBe('trivial');
    expect(ctx.max_review_rounds).toBe(1);
    expect(ctx.worker_model).toBe('sonnet');
    expect(ctx.worker_max_turns).toBe(10);
    expect(ctx.review_panel_size).toBe(0);
  });

  it('sets critical config on critical risk triage', () => {
    const actor = createTestActor();
    actor.start();
    actor.send({ type: 'START', input: { type: 'raw-idea', content: 'test', user_risk_override: null } });

    actor.send({
      type: 'TRIAGE_COMPLETE',
      input_type: 'raw-idea',
      risk: 'critical',
      path: standardPath,
      existing_artifact: null,
      external_ref: null,
      decompose: true,
      domain_clusters: ['security', 'auth'],
    } as OrchestratorEvent);

    // Machine lands in prepare since it's in path
    const ctx = contextOf(actor);
    expect(ctx.risk).toBe('critical');
    expect(ctx.max_review_rounds).toBe(3);
    expect(ctx.worker_model).toBe('opus');
    expect(ctx.review_model).toBe('opus');
    expect(ctx.review_panel_size).toBe(5);
    expect(ctx.decompose).toBe(true);
    expect(ctx.domain_clusters).toEqual(['security', 'auth']);
  });
});

// ---------------------------------------------------------------------------
// 23. Gate-conditional round increment
// ---------------------------------------------------------------------------
describe('Gate-conditional round increment', () => {
  // Use spec_review compound state for these tests because it loops within
  // the same compound state without resetting review_round (unlike
  // develop.review_task which resets via dispatch_worker entry).

  it('code_quality gate increments review_round', () => {
    const actor = actorFromSnapshot(
      { spec_review: 'awaiting_review' },
      {
        risk: 'standard',
        path: standardPath,
        max_review_rounds: 2,
        review_round: 0,
      },
    );

    actor.send({
      type: 'REVIEW_COMPLETE',
      task_id: -1,
      verdict: 'REVISE',
      round: 1,
      report_path: '/tmp/report.md',
      findings: [{ severity: 'major', description: 'Quality issue', file: 'src/test.ts', line: 10 }],
      gate: 'code_quality',
    } as OrchestratorEvent);

    // code_quality increments: 0 → 1. isReviseAndBelowMax (1 < 2) → loops.
    expect(contextOf(actor).review_round).toBe(1);
    expect(stateOf(actor)).toEqual({ spec_review: 'awaiting_review' });
  });

  it('spec_compliance gate does NOT increment review_round', () => {
    const actor = actorFromSnapshot(
      { spec_review: 'awaiting_review' },
      {
        risk: 'standard',
        path: standardPath,
        max_review_rounds: 2,
        review_round: 0,
      },
    );

    actor.send({
      type: 'REVIEW_COMPLETE',
      task_id: -1,
      verdict: 'REVISE',
      round: 1,
      report_path: '/tmp/report.md',
      findings: [{ severity: 'major', description: 'Missing requirement', file: 'src/api.ts', line: 5 }],
      gate: 'spec_compliance',
    } as OrchestratorEvent);

    // spec_compliance does NOT increment: stays at 0. isReviseAndBelowMax (0 < 2) → loops.
    expect(contextOf(actor).review_round).toBe(0);
    expect(contextOf(actor).last_review_verdict).toBe('REVISE');
    expect(stateOf(actor)).toEqual({ spec_review: 'awaiting_review' });
  });

  it('code_quality REVISE at max rounds escalates, spec_compliance does not', () => {
    // Start at round 1 (one code_quality round already used)
    const actor = actorFromSnapshot(
      { spec_review: 'awaiting_review' },
      {
        risk: 'standard',
        path: standardPath,
        max_review_rounds: 2,
        review_round: 1,
      },
    );

    // spec_compliance REVISE: round stays at 1, belowMax (1 < 2) → loops
    actor.send({
      type: 'REVIEW_COMPLETE',
      task_id: -1,
      verdict: 'REVISE',
      round: 1,
      report_path: '/tmp/report.md',
      findings: [{ severity: 'major', description: 'Missing req', file: 'src/api.ts', line: 5 }],
      gate: 'spec_compliance',
    } as OrchestratorEvent);

    expect(contextOf(actor).review_round).toBe(1);
    expect(stateOf(actor)).toEqual({ spec_review: 'awaiting_review' });

    // code_quality REVISE: round goes to 2, NOT belowMax (2 >= 2) → escalate
    actor.send({
      type: 'REVIEW_COMPLETE',
      task_id: -1,
      verdict: 'REVISE',
      round: 2,
      report_path: '/tmp/report2.md',
      findings: [{ severity: 'major', description: 'Quality issue', file: 'src/api.ts', line: 10 }],
      gate: 'code_quality',
    } as OrchestratorEvent);

    expect(contextOf(actor).review_round).toBe(2);
    expect(stateOf(actor)).toEqual({ spec_review: 'escalate' });
  });
});

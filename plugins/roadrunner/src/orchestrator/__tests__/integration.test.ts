import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createActor, type AnyActor } from 'xstate';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { orchestratorMachine } from '../machine.js';
import { createPersistence } from '../persistence.js';
import { setDispatcher } from '../actions.js';
import type { OrchestratorCommand } from '../commands.js';
import type { OrchestratorContext } from '../context.js';
import type { OrchestratorEvent } from '../events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dispatched: OrchestratorCommand[];
let tmpDir: string;

function stateOf(actor: AnyActor): any {
  return actor.getSnapshot().value;
}

function contextOf(actor: AnyActor): OrchestratorContext {
  return actor.getSnapshot().context;
}

function commandTypes(): string[] {
  return dispatched.map((c) => c.type);
}

function lastCommand(): OrchestratorCommand {
  return dispatched[dispatched.length - 1];
}

function clearDispatched(): void {
  dispatched.length = 0;
}

// ---------------------------------------------------------------------------
// Scenario 1: Standard risk, two tasks, one REVISE cycle
// ---------------------------------------------------------------------------
describe('Integration: standard risk, two tasks, one REVISE cycle', () => {
  let actor: AnyActor;

  beforeEach(() => {
    dispatched = [];
    setDispatcher((cmd) => dispatched.push(cmd));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadrunner-integration-'));
    actor = createActor(orchestratorMachine);
    actor.start();
  });

  afterEach(() => {
    actor.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('drives full pipeline from idle to done', () => {
    // --- IDLE ---
    expect(stateOf(actor)).toBe('idle');

    // --- START ---
    actor.send({
      type: 'START',
      input: { type: 'raw-idea', content: 'add search feature', user_risk_override: null },
    } as OrchestratorEvent);

    expect(stateOf(actor)).toBe('triage');
    expect(commandTypes()).toContain('RUN_TRIAGE');
    clearDispatched();

    // --- TRIAGE_COMPLETE ---
    // Standard risk, path skips brainstorm/spec_review/write_plan/plan_review
    actor.send({
      type: 'TRIAGE_COMPLETE',
      risk: 'standard',
      input_type: 'raw-idea',
      path: ['triage', 'prepare', 'develop', 'finish'],
      decompose: true,
      existing_artifact: null,
      external_ref: null,
      domain_clusters: ['search', 'database'],
    } as OrchestratorEvent);

    // After triage -> prepare (prepare IS in path so no skip).
    // prepare entry fires dispatchPrepare (which is a console.log stub, not via dispatch()).
    expect(stateOf(actor)).toBe('prepare');

    // Context updated from triage
    const ctx1 = contextOf(actor);
    expect(ctx1.risk).toBe('standard');
    expect(ctx1.decompose).toBe(true);
    expect(ctx1.domain_clusters).toEqual(['search', 'database']);
    expect(ctx1.max_review_rounds).toBe(2);
    clearDispatched();

    // --- PREPARE_COMPLETE ---
    // decomposition_recommended: false, so prepare -> brainstorm.
    // brainstorm skipped (not in path) -> size_check_pre_spec skipped (spec_review not in path)
    // -> write_plan skipped (not in path) -> size_check_pre_plan skipped (plan_review not in path)
    // -> develop. develop initial: decompose. decompose: true => dispatchDecompose fires.
    actor.send({
      type: 'PREPARE_COMPLETE',
      spec_path: 'docs/specs/SPEC-001.md',
      decomposition_recommended: false,
      decomposition_rationale: null,
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ develop: 'decompose' });
    expect(ctx1.spec_path === null).toBe(true); // context before event
    expect(contextOf(actor).spec_path).toBe('docs/specs/SPEC-001.md');
    // dispatchDecompose dispatches a DECOMPOSE command
    expect(commandTypes()).toContain('DECOMPOSE');
    clearDispatched();

    // --- DECOMPOSITION_COMPLETE ---
    actor.send({
      type: 'DECOMPOSITION_COMPLETE',
      task_count: 2,
      task_ids: [1, 2],
      domains: ['search'],
    } as OrchestratorEvent);

    // storeDecomposition + dispatchQueryNextTask -> next_task
    expect(stateOf(actor)).toEqual({ develop: 'next_task' });
    expect(contextOf(actor).task_count).toBe(2);
    expect(contextOf(actor).tasks[1]).toBeDefined();
    expect(contextOf(actor).tasks[2]).toBeDefined();
    expect(commandTypes()).toContain('QUERY_NEXT_TASK');
    clearDispatched();

    // --- QUERY_RESULT: task 1 ready ---
    actor.send({
      type: 'QUERY_RESULT',
      outcome: 'task_ready',
      task: {
        id: 1,
        title: 'Add FTS5 virtual table',
        dependencies: [],
        status: 'pending',
        details: '...',
        acceptanceCriteria: ['search works'],
        relevantFiles: ['src/db/search.ts'],
      },
    } as OrchestratorEvent);

    // storeCurrentTask + dispatchGenerateExpert -> generate_expert
    expect(stateOf(actor)).toEqual({ develop: 'generate_expert' });
    expect(contextOf(actor).current_task_id).toBe(1);
    expect(commandTypes()).toContain('GENERATE_EXPERT');
    clearDispatched();

    // --- EXPERT_READY: task 1, drift pass ---
    actor.send({
      type: 'EXPERT_READY',
      task_id: 1,
      expert_prompt_path: '.roadrunner/experts/TASK-001.md',
      drift_check: 'pass',
      drift_details: null,
    } as OrchestratorEvent);

    // storeExpertResult + dispatchWorker -> dispatch_worker (entry: resetReviewRound)
    // -> always -> await_worker
    expect(stateOf(actor)).toEqual({ develop: 'await_worker' });
    expect(commandTypes()).toContain('DISPATCH_WORKER');
    expect(contextOf(actor).review_round).toBe(0); // resetReviewRound fired
    clearDispatched();

    // --- WORKER_COMPLETE: task 1 DONE ---
    actor.send({
      type: 'WORKER_COMPLETE',
      task_id: 1,
      status: 'DONE',
      result_path: '.roadrunner/results/TASK-001.json',
      cost_usd: 0.12,
      duration_ms: 45000,
      files_changed: ['src/db/search.ts'],
      concerns: null,
    } as OrchestratorEvent);

    // storeWorkerResult + dispatchReview -> review_task.dispatching_review
    // -> (entry: dispatchReview) -> always -> awaiting_review
    expect(stateOf(actor)).toEqual({ develop: { review_task: 'awaiting_review' } });
    // dispatchReview fires on transition action AND on dispatching_review entry = 2 RUN_REVIEW commands
    expect(commandTypes().filter((t) => t === 'RUN_REVIEW').length).toBeGreaterThanOrEqual(1);
    clearDispatched();

    // --- REVIEW_COMPLETE: task 1 SHIP ---
    actor.send({
      type: 'REVIEW_COMPLETE',
      task_id: 1,
      verdict: 'SHIP',
      round: 1,
      report_path: 'docs/reports/R-001.md',
      findings: [],
      gate: 'code_quality',
    } as OrchestratorEvent);

    // storeReviewResult -> route_verdict -> isShip -> exit_ship
    // markTaskDone + dispatchQueryNextTask -> onDone -> next_task
    expect(stateOf(actor)).toEqual({ develop: 'next_task' });
    expect(contextOf(actor).tasks[1].status).toBe('done');
    expect(contextOf(actor).tasks_complete).toBe(1);
    expect(commandTypes()).toContain('QUERY_NEXT_TASK');
    clearDispatched();

    // --- QUERY_RESULT: task 2 ready ---
    actor.send({
      type: 'QUERY_RESULT',
      outcome: 'task_ready',
      task: {
        id: 2,
        title: 'Add search API endpoint',
        dependencies: [1],
        status: 'pending',
        details: '...',
        acceptanceCriteria: ['API returns results'],
        relevantFiles: ['src/api/search.ts'],
      },
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ develop: 'generate_expert' });
    expect(contextOf(actor).current_task_id).toBe(2);
    expect(commandTypes()).toContain('GENERATE_EXPERT');
    clearDispatched();

    // --- EXPERT_READY: task 2, drift pass ---
    actor.send({
      type: 'EXPERT_READY',
      task_id: 2,
      expert_prompt_path: '.roadrunner/experts/TASK-002.md',
      drift_check: 'pass',
      drift_details: null,
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ develop: 'await_worker' });
    expect(commandTypes()).toContain('DISPATCH_WORKER');
    clearDispatched();

    // --- WORKER_COMPLETE: task 2 DONE ---
    actor.send({
      type: 'WORKER_COMPLETE',
      task_id: 2,
      status: 'DONE',
      result_path: '.roadrunner/results/TASK-002.json',
      cost_usd: 0.15,
      duration_ms: 60000,
      files_changed: ['src/api/search.ts'],
      concerns: null,
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ develop: { review_task: 'awaiting_review' } });
    clearDispatched();

    // --- REVIEW_COMPLETE: task 2 REVISE (round 1) ---
    actor.send({
      type: 'REVIEW_COMPLETE',
      task_id: 2,
      verdict: 'REVISE',
      round: 1,
      report_path: 'docs/reports/R-002.md',
      findings: [{
        severity: 'blocking',
        description: 'Missing error handling',
        file: 'src/api/search.ts',
        line: 42,
      }],
      gate: 'code_quality',
    } as OrchestratorEvent);

    // storeReviewResult sets review_round = 0 + 1 = 1, last_review_verdict = 'REVISE'
    // route_verdict: not isShip, isReviseAndBelowMax (1 < 2) -> exit_revise (final)
    // onDone: not abort, lastVerdictIsRevise -> dispatch_worker (entry: resetReviewRound)
    // -> always -> await_worker
    expect(stateOf(actor)).toEqual({ develop: 'await_worker' });
    expect(contextOf(actor).review_round).toBe(0); // resetReviewRound in dispatch_worker entry
    // dispatchWorker fires on onDone transition action
    expect(commandTypes()).toContain('DISPATCH_WORKER');
    clearDispatched();

    // --- WORKER_COMPLETE: task 2 revision ---
    actor.send({
      type: 'WORKER_COMPLETE',
      task_id: 2,
      status: 'DONE',
      result_path: '.roadrunner/results/TASK-002-r2.json',
      cost_usd: 0.08,
      duration_ms: 30000,
      files_changed: ['src/api/search.ts'],
      concerns: null,
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ develop: { review_task: 'awaiting_review' } });
    clearDispatched();

    // --- REVIEW_COMPLETE: task 2 SHIP (round 2) ---
    actor.send({
      type: 'REVIEW_COMPLETE',
      task_id: 2,
      verdict: 'SHIP',
      round: 2,
      report_path: 'docs/reports/R-002-r2.md',
      findings: [],
      gate: 'code_quality',
    } as OrchestratorEvent);

    // markTaskDone + dispatchQueryNextTask -> next_task
    expect(stateOf(actor)).toEqual({ develop: 'next_task' });
    expect(contextOf(actor).tasks[2].status).toBe('done');
    expect(contextOf(actor).tasks_complete).toBe(2);
    expect(commandTypes()).toContain('QUERY_NEXT_TASK');
    clearDispatched();

    // --- QUERY_RESULT: all_complete ---
    actor.send({
      type: 'QUERY_RESULT',
      outcome: 'all_complete',
    } as OrchestratorEvent);

    // -> finish_develop (final) -> develop.onDone: not abort -> finish
    expect(stateOf(actor)).toBe('finish');
    clearDispatched();

    // --- FINISH_COMPLETE ---
    actor.send({
      type: 'FINISH_COMPLETE',
      summary: 'Pipeline complete: 2 tasks, $0.35 total',
    } as OrchestratorEvent);

    expect(stateOf(actor)).toBe('done');
    expect(actor.getSnapshot().status).toBe('done');

    // Final context assertions
    const finalCtx = contextOf(actor);
    expect(finalCtx.tasks_complete).toBe(2);
    expect(finalCtx.tasks[1].status).toBe('done');
    expect(finalCtx.tasks[2].status).toBe('done');
    expect(finalCtx.task_count).toBe(2);
    expect(finalCtx.risk).toBe('standard');
    expect(finalCtx.abort_reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Crash recovery mid-pipeline
// ---------------------------------------------------------------------------
describe('Integration: crash recovery mid-pipeline', () => {
  beforeEach(() => {
    dispatched = [];
    setDispatcher((cmd) => dispatched.push(cmd));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadrunner-integration-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists state, restores, and completes pipeline', () => {
    const persistence = createPersistence(tmpDir);

    // --- Phase 1: Drive to develop.await_worker ---
    const actor1 = createActor(orchestratorMachine);
    actor1.start();

    actor1.send({
      type: 'START',
      input: { type: 'raw-idea', content: 'add search feature', user_risk_override: null },
    } as OrchestratorEvent);

    actor1.send({
      type: 'TRIAGE_COMPLETE',
      risk: 'standard',
      input_type: 'raw-idea',
      path: ['triage', 'prepare', 'develop', 'finish'],
      decompose: true,
      existing_artifact: null,
      external_ref: null,
      domain_clusters: ['search'],
    } as OrchestratorEvent);

    actor1.send({
      type: 'PREPARE_COMPLETE',
      spec_path: 'docs/specs/SPEC-001.md',
      decomposition_recommended: false,
      decomposition_rationale: null,
    } as OrchestratorEvent);

    actor1.send({
      type: 'DECOMPOSITION_COMPLETE',
      task_count: 1,
      task_ids: [1],
      domains: ['search'],
    } as OrchestratorEvent);

    actor1.send({
      type: 'QUERY_RESULT',
      outcome: 'task_ready',
      task: {
        id: 1,
        title: 'Add search',
        dependencies: [],
        status: 'pending',
        details: '...',
        acceptanceCriteria: ['works'],
        relevantFiles: ['src/search.ts'],
      },
    } as OrchestratorEvent);

    actor1.send({
      type: 'EXPERT_READY',
      task_id: 1,
      expert_prompt_path: '.roadrunner/experts/TASK-001.md',
      drift_check: 'pass',
      drift_details: null,
    } as OrchestratorEvent);

    // Should now be in develop.await_worker
    expect(stateOf(actor1)).toEqual({ develop: 'await_worker' });

    // --- Phase 2: Persist ---
    persistence.persist(actor1);
    actor1.stop();

    // Verify file exists
    expect(fs.existsSync(path.join(tmpDir, 'state.json'))).toBe(true);

    // --- Phase 3: Restore into new actor ---
    const restored = persistence.restore();
    expect(restored).not.toBeNull();

    clearDispatched();
    const actor2 = createActor(orchestratorMachine, { snapshot: restored as any });
    actor2.start();

    // Verify restored state
    expect(stateOf(actor2)).toEqual({ develop: 'await_worker' });
    expect(contextOf(actor2).current_task_id).toBe(1);
    expect(contextOf(actor2).task_count).toBe(1);
    expect(contextOf(actor2).risk).toBe('standard');

    // --- Phase 4: Continue from restored state ---
    actor2.send({
      type: 'WORKER_COMPLETE',
      task_id: 1,
      status: 'DONE',
      result_path: '.roadrunner/results/TASK-001.json',
      cost_usd: 0.10,
      duration_ms: 30000,
      files_changed: ['src/search.ts'],
      concerns: null,
    } as OrchestratorEvent);

    expect(stateOf(actor2)).toEqual({ develop: { review_task: 'awaiting_review' } });
    clearDispatched();

    actor2.send({
      type: 'REVIEW_COMPLETE',
      task_id: 1,
      verdict: 'SHIP',
      round: 1,
      report_path: 'docs/reports/R-001.md',
      findings: [],
      gate: 'code_quality',
    } as OrchestratorEvent);

    expect(stateOf(actor2)).toEqual({ develop: 'next_task' });
    expect(contextOf(actor2).tasks[1].status).toBe('done');
    expect(contextOf(actor2).tasks_complete).toBe(1);
    clearDispatched();

    actor2.send({
      type: 'QUERY_RESULT',
      outcome: 'all_complete',
    } as OrchestratorEvent);

    expect(stateOf(actor2)).toBe('finish');

    actor2.send({
      type: 'FINISH_COMPLETE',
      summary: 'Recovered pipeline complete',
    } as OrchestratorEvent);

    expect(stateOf(actor2)).toBe('done');
    expect(actor2.getSnapshot().status).toBe('done');
    expect(contextOf(actor2).tasks_complete).toBe(1);
    expect(contextOf(actor2).abort_reason).toBeNull();

    actor2.stop();
    persistence.cleanTmp();
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Blocked tasks escalation
// ---------------------------------------------------------------------------
describe('Integration: blocked tasks escalation', () => {
  let actor: AnyActor;

  beforeEach(() => {
    dispatched = [];
    setDispatcher((cmd) => dispatched.push(cmd));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadrunner-integration-'));
    actor = createActor(orchestratorMachine);
    actor.start();
  });

  afterEach(() => {
    actor.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('escalates on all_blocked, skip leads to finish', () => {
    // Drive to develop.next_task
    actor.send({
      type: 'START',
      input: { type: 'raw-idea', content: 'blocked test', user_risk_override: null },
    } as OrchestratorEvent);

    actor.send({
      type: 'TRIAGE_COMPLETE',
      risk: 'standard',
      input_type: 'raw-idea',
      path: ['triage', 'prepare', 'develop', 'finish'],
      decompose: true,
      existing_artifact: null,
      external_ref: null,
      domain_clusters: [],
    } as OrchestratorEvent);

    actor.send({
      type: 'PREPARE_COMPLETE',
      spec_path: 'docs/specs/SPEC-002.md',
      decomposition_recommended: false,
      decomposition_rationale: null,
    } as OrchestratorEvent);

    actor.send({
      type: 'DECOMPOSITION_COMPLETE',
      task_count: 2,
      task_ids: [3, 4],
      domains: ['infra'],
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ develop: 'next_task' });
    clearDispatched();

    // --- QUERY_RESULT: all_blocked ---
    actor.send({
      type: 'QUERY_RESULT',
      outcome: 'all_blocked',
      blocked_task_ids: [3, 4],
      blocked_reasons: ['TASK-002 failed'],
    } as OrchestratorEvent);

    expect(stateOf(actor)).toEqual({ develop: 'escalate_blocked' });
    // escalateBlocked entry action should dispatch an ESCALATE command
    expect(commandTypes()).toContain('ESCALATE');
    clearDispatched();

    // --- USER_ESCALATION_RESPONSE: skip ---
    actor.send({
      type: 'USER_ESCALATION_RESPONSE',
      task_id: 0,
      action: 'skip',
    } as OrchestratorEvent);

    // markBlockedTasksSkipped -> finish_develop (final) -> develop.onDone: not abort -> finish
    expect(stateOf(actor)).toBe('finish');

    // Both tasks should be skipped
    const ctx = contextOf(actor);
    expect(ctx.tasks[3].status).toBe('skipped');
    expect(ctx.tasks[4].status).toBe('skipped');
    clearDispatched();

    // --- FINISH_COMPLETE ---
    actor.send({
      type: 'FINISH_COMPLETE',
      summary: 'Pipeline complete with skipped tasks',
    } as OrchestratorEvent);

    expect(stateOf(actor)).toBe('done');
    expect(actor.getSnapshot().status).toBe('done');
  });
});

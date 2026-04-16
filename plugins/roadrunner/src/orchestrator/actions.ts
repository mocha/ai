import * as fs from 'node:fs';
import { assign } from 'xstate';
import type { OrchestratorCommand } from './commands.js';
import type { OrchestratorContext } from './context.js';
import type { OrchestratorEvent } from './events.js';
import type { ResolutionRecord, TaskSummary } from './types.js';
import { evaluateSizing } from './sizing.js';

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

type DispatchFn = (command: OrchestratorCommand) => void;

let _dispatch: DispatchFn = (cmd) => {
  console.log(`[orchestrator] command: ${cmd.type}`, JSON.stringify(cmd, null, 2));
};

export function setDispatcher(fn: DispatchFn): void {
  _dispatch = fn;
}

function dispatch(command: OrchestratorCommand): void {
  _dispatch(command);
}

// ---------------------------------------------------------------------------
// Context mutation actions (assign)
// ---------------------------------------------------------------------------

export const storeTriageResult = assign(
  ({ context, event }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    if (event.type !== 'TRIAGE_COMPLETE') return {};
    return {
      input_type: event.input_type,
      risk: event.risk,
      path: event.path,
      existing_artifact: event.existing_artifact,
      external_ref: event.external_ref,
      decompose: event.decompose,
      domain_clusters: event.domain_clusters,
    };
  },
);

export const configureFromRisk = assign(
  ({ context }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    switch (context.risk) {
      case 'trivial':
        return {
          max_review_rounds: 1,
          worker_model: 'sonnet' as const,
          worker_max_turns: 10,
          review_model: 'sonnet' as const,
          review_panel_size: 0,
          worker_timeout_ms: 600_000,
          review_timeout_ms: 300_000,
        };
      case 'standard':
        return {
          max_review_rounds: 2,
          worker_model: 'sonnet' as const,
          worker_max_turns: 20,
          review_model: 'sonnet' as const,
          review_panel_size: 3,
          worker_timeout_ms: 1_200_000,
          review_timeout_ms: 600_000,
        };
      case 'elevated':
        return {
          max_review_rounds: 2,
          worker_model: 'sonnet' as const,
          worker_max_turns: 30,
          review_model: 'sonnet' as const,
          review_panel_size: 4,
          worker_timeout_ms: 1_800_000,
          review_timeout_ms: 600_000,
        };
      case 'critical':
        return {
          max_review_rounds: 3,
          worker_model: 'opus' as const,
          worker_max_turns: 40,
          review_model: 'opus' as const,
          review_panel_size: 5,
          worker_timeout_ms: 1_800_000,
          review_timeout_ms: 600_000,
        };
    }
  },
);

export const storeCurrentTask = assign(
  ({ context, event }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    if (event.type !== 'QUERY_RESULT') return {};
    if (event.outcome !== 'task_ready' || !event.task) return {};

    const task = event.task;
    const updatedTask: TaskSummary = {
      id: task.id,
      title: task.title,
      status: 'expert_ready',
      review_round: 0,
      worker_result_path: null,
      expert_prompt_path: null,
      cost_usd: 0,
      duration_ms: 0,
    };

    return {
      current_task_id: task.id,
      tasks: {
        ...context.tasks,
        [task.id]: updatedTask,
      },
    };
  },
);

export const storeExpertResult = assign(
  ({ context, event }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    if (event.type !== 'EXPERT_READY') return {};

    const existing = context.tasks[event.task_id];
    if (!existing) return {};

    return {
      tasks: {
        ...context.tasks,
        [event.task_id]: {
          ...existing,
          expert_prompt_path: event.expert_prompt_path,
        },
      },
    };
  },
);

export const storeWorkerResult = assign(
  ({ context, event }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    if (event.type !== 'WORKER_COMPLETE') return {};

    const existing = context.tasks[event.task_id];
    if (!existing) return {};

    return {
      tasks: {
        ...context.tasks,
        [event.task_id]: {
          ...existing,
          worker_result_path: event.result_path,
          cost_usd: event.cost_usd,
          duration_ms: event.duration_ms,
          status: 'review' as const,
        },
      },
    };
  },
);

export const storeReviewResult = assign(
  ({ context, event }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    if (event.type !== 'REVIEW_COMPLETE') return {};
    return {
      last_review_verdict: event.verdict,
      last_review_findings: event.findings,
      review_round: context.review_round + 1,
    };
  },
);

export const storeDecomposition = assign(
  ({ context, event }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    if (event.type !== 'DECOMPOSITION_COMPLETE') return {};

    const newTasks: Record<number, TaskSummary> = { ...context.tasks };
    for (const id of event.task_ids) {
      newTasks[id] = {
        id,
        title: `Task ${id}`,
        status: 'pending',
        review_round: 0,
        worker_result_path: null,
        expert_prompt_path: null,
        cost_usd: 0,
        duration_ms: 0,
      };
    }

    return {
      task_count: event.task_count,
      tasks: newTasks,
    };
  },
);

export const storePrepareResult = assign(
  ({ context: _context, event }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    if (event.type !== 'PREPARE_COMPLETE') return {};
    return {
      spec_path: event.spec_path,
    };
  },
);

export const storeBrainstormResult = assign(
  ({ context: _context, event }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    if (event.type !== 'BRAINSTORM_COMPLETE') return {};
    return {
      spec_path: event.spec_path,
    };
  },
);

export const storePlanResult = assign(
  ({ context: _context, event }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    if (event.type !== 'PLAN_COMPLETE') return {};
    return {
      plan_path: event.plan_path,
    };
  },
);

export const resetReviewRound = assign(
  (_args: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    return {
      review_round: 0,
      last_review_verdict: null as null,
      last_review_findings: [] as OrchestratorContext['last_review_findings'],
    };
  },
);

export const markTaskDone = assign(
  ({ context }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    if (context.current_task_id === null) return {};

    const taskId = context.current_task_id;
    const existing = context.tasks[taskId];
    if (!existing) return {};

    return {
      tasks: {
        ...context.tasks,
        [taskId]: {
          ...existing,
          status: 'done' as const,
        },
      },
      tasks_complete: context.tasks_complete + 1,
    };
  },
);

export const markTaskSkipped = assign(
  ({ context }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    if (context.current_task_id === null) return {};

    const taskId = context.current_task_id;
    const existing = context.tasks[taskId];
    if (!existing) return {};

    return {
      tasks: {
        ...context.tasks,
        [taskId]: {
          ...existing,
          status: 'skipped' as const,
        },
      },
      tasks_complete: context.tasks_complete + 1,
    };
  },
);

export const markBlockedTasksSkipped = assign(
  ({ context }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    const updatedTasks: Record<number, TaskSummary> = { ...context.tasks };
    let skippedCount = 0;

    for (const [idStr, task] of Object.entries(updatedTasks)) {
      if (task.status === 'pending' || task.status === 'blocked') {
        updatedTasks[Number(idStr)] = { ...task, status: 'skipped' };
        skippedCount++;
      }
    }

    return {
      tasks: updatedTasks,
      tasks_complete: context.tasks_complete + skippedCount,
    };
  },
);

export const recordAbort = assign(
  ({ context: _context, event }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    if (event.type === 'USER_APPROVE' && event.decision === 'abort') {
      return { abort_reason: `User aborted at stage: ${event.stage}` };
    }
    if (event.type === 'USER_ESCALATION_RESPONSE' && event.action === 'abort') {
      return { abort_reason: `User aborted escalation for task ${event.task_id}` };
    }
    return { abort_reason: 'Pipeline aborted' };
  },
);

export const handleCompactionDetected = assign(
  ({ context }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    if (context.current_task_id === null) return {};

    const taskId = context.current_task_id;
    const existing = context.tasks[taskId];
    if (!existing) return {};

    return {
      tasks: {
        ...context.tasks,
        [taskId]: {
          ...existing,
          status: 'pending' as const,
        },
      },
    };
  },
);

export const recordDispatchError = assign(
  ({ context: _context, event }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    if (event.type !== 'DISPATCH_ERROR') return {};
    return {
      error: `Dispatch error for ${event.failed_command}: ${event.error_message} (attempts: ${event.attempts})`,
    };
  },
);

export const runMechanicalSizing = assign(
  ({ context }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    const artifactPath = context.spec_path ?? context.plan_path;

    if (!artifactPath) {
      return {
        last_sizing_result: {
          token_count: 0,
          prose_line_count: 0,
          file_blast_radius: 0,
          verdict: 'under' as const,
        },
      };
    }

    let content: string;
    try {
      content = fs.readFileSync(artifactPath, 'utf8');
    } catch {
      return {
        last_sizing_result: {
          token_count: 0,
          prose_line_count: 0,
          file_blast_radius: 0,
          verdict: 'under' as const,
        },
      };
    }

    const result = evaluateSizing(content, context.sizing_config);
    return { last_sizing_result: result };
  },
);

export const addResolution = assign(
  ({ context, event }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    // This action expects the event to carry a resolution record.
    // Since no event type specifically carries a ResolutionRecord, we treat
    // this as a helper that callers will invoke after building the record.
    // For now, if there's no resolution payload on the event, return unchanged.
    const eventWithResolution = event as OrchestratorEvent & { resolution?: ResolutionRecord };
    if (!eventWithResolution.resolution) return {};

    const updated = [...context.resolutions, eventWithResolution.resolution];
    // Keep last 20
    const bounded = updated.length > 20 ? updated.slice(updated.length - 20) : updated;
    return { resolutions: bounded };
  },
);

// ---------------------------------------------------------------------------
// Command dispatcher actions (regular functions)
// ---------------------------------------------------------------------------

export function dispatchTriage({ context }: { context: OrchestratorContext }): void {
  dispatch({
    type: 'RUN_TRIAGE',
    input: { type: context.input_type, content: '', user_risk_override: null },
  });
}

export function dispatchPrepare({ context }: { context: OrchestratorContext }): void {
  console.log(`[orchestrator] STUB: dispatchPrepare — risk=${context.risk}`);
}

export function dispatchBrainstorm({ context }: { context: OrchestratorContext }): void {
  console.log(`[orchestrator] STUB: dispatchBrainstorm — risk=${context.risk}`);
}

export function dispatchSpecReview({ context }: { context: OrchestratorContext }): void {
  const specPath = context.spec_path ?? '';
  dispatch({
    type: 'RUN_REVIEW',
    task_id: -1, // spec-level review, no task ID
    worktree_path: specPath,
    task_spec: {
      id: -1,
      title: 'Spec Review',
      dependencies: [],
      status: 'pending',
      details: '',
      acceptanceCriteria: [],
      relevantFiles: specPath ? [specPath] : [],
    },
    worker_result: {
      status: 'DONE',
      result_path: specPath,
      cost_usd: 0,
      duration_ms: 0,
      files_changed: specPath ? [specPath] : [],
      concerns: null,
    },
    risk: context.risk,
    round: context.review_round,
  });
}

export function dispatchWritePlan({ context }: { context: OrchestratorContext }): void {
  console.log(`[orchestrator] STUB: dispatchWritePlan — spec_path=${context.spec_path}`);
}

export function dispatchPlanReview({ context }: { context: OrchestratorContext }): void {
  const planPath = context.plan_path ?? '';
  dispatch({
    type: 'RUN_REVIEW',
    task_id: -1, // plan-level review, no task ID
    worktree_path: planPath,
    task_spec: {
      id: -1,
      title: 'Plan Review',
      dependencies: [],
      status: 'pending',
      details: '',
      acceptanceCriteria: [],
      relevantFiles: planPath ? [planPath] : [],
    },
    worker_result: {
      status: 'DONE',
      result_path: planPath,
      cost_usd: 0,
      duration_ms: 0,
      files_changed: planPath ? [planPath] : [],
      concerns: null,
    },
    risk: context.risk,
    round: context.review_round,
  });
}

export function dispatchDecompose({ context }: { context: OrchestratorContext }): void {
  const specPath = context.spec_path ?? context.plan_path;
  if (!specPath) {
    console.warn('[orchestrator] dispatchDecompose: no spec_path or plan_path available');
    return;
  }
  dispatch({
    type: 'DECOMPOSE',
    spec_path: specPath,
    risk: context.risk,
  });
}

export function dispatchQueryNextTask(_args: { context: OrchestratorContext }): void {
  dispatch({
    type: 'QUERY_NEXT_TASK',
    filter: { status: 'pending', dependencies_met: true },
  });
}

export function dispatchGenerateExpert({ context }: { context: OrchestratorContext }): void {
  if (context.current_task_id === null) {
    console.warn('[orchestrator] dispatchGenerateExpert: no current_task_id');
    return;
  }

  const taskId = context.current_task_id;
  const task = context.tasks[taskId];
  if (!task) {
    console.warn(`[orchestrator] dispatchGenerateExpert: task ${taskId} not found`);
    return;
  }

  dispatch({
    type: 'GENERATE_EXPERT',
    task_id: taskId,
    task: {
      id: taskId,
      title: task.title,
      dependencies: [],
      status: task.status,
      details: '',
      acceptanceCriteria: [],
      relevantFiles: [],
    },
    risk: context.risk,
    codebase_context: {
      entry_points: [],
      recent_changes: [],
      related_tests: [],
    },
  });
}

export function dispatchWorker({ context }: { context: OrchestratorContext }): void {
  if (context.current_task_id === null) {
    console.warn('[orchestrator] dispatchWorker: no current_task_id');
    return;
  }

  const taskId = context.current_task_id;
  const task = context.tasks[taskId];
  if (!task) {
    console.warn(`[orchestrator] dispatchWorker: task ${taskId} not found`);
    return;
  }

  const expertPromptPath = task.expert_prompt_path ?? '';

  dispatch({
    type: 'DISPATCH_WORKER',
    task_id: taskId,
    expert_prompt_path: expertPromptPath,
    task_spec: {
      id: taskId,
      title: task.title,
      dependencies: [],
      status: task.status,
      details: '',
      acceptanceCriteria: [],
      relevantFiles: [],
    },
    worktree_branch: `task-${taskId}`,
    max_turns: context.worker_max_turns,
    model: context.worker_model,
  });
}

export function dispatchReview({ context }: { context: OrchestratorContext }): void {
  if (context.current_task_id === null) {
    console.warn('[orchestrator] dispatchReview: no current_task_id');
    return;
  }

  const taskId = context.current_task_id;
  const task = context.tasks[taskId];
  if (!task) {
    console.warn(`[orchestrator] dispatchReview: task ${taskId} not found`);
    return;
  }

  dispatch({
    type: 'RUN_REVIEW',
    task_id: taskId,
    worktree_path: `task-${taskId}`,
    task_spec: {
      id: taskId,
      title: task.title,
      dependencies: [],
      status: task.status,
      details: '',
      acceptanceCriteria: [],
      relevantFiles: [],
    },
    worker_result: {
      status: 'DONE',
      result_path: task.worker_result_path ?? '',
      cost_usd: task.cost_usd,
      duration_ms: task.duration_ms,
      files_changed: [],
      concerns: null,
    },
    risk: context.risk,
    round: context.review_round,
  });
}

export function requestApproval({ context }: { context: OrchestratorContext }): void {
  dispatch({
    type: 'REQUEST_APPROVAL',
    stage: context.path[0] ?? 'unknown',
    summary: `Pipeline at risk=${context.risk}, path=${context.path.join('->')}`,
    risk: context.risk,
  });
}

export function escalateDrift({ context }: { context: OrchestratorContext }): void {
  dispatch({
    type: 'ESCALATE',
    task_id: context.current_task_id ?? -1,
    reason: 'drift check failed',
    options: ['retry', 'skip', 'abort'],
  });
}

export function escalateWorker({
  context,
  event,
}: {
  context: OrchestratorContext;
  event: OrchestratorEvent;
}): void {
  let reason = 'worker returned non-DONE status';
  if (event.type === 'WORKER_COMPLETE') {
    reason = `worker status: ${event.status}${event.concerns ? ` — ${event.concerns}` : ''}`;
  }
  dispatch({
    type: 'ESCALATE',
    task_id: context.current_task_id ?? -1,
    reason,
    options: ['retry', 'skip', 'abort'],
  });
}

export function escalateReview({
  context,
  event,
}: {
  context: OrchestratorContext;
  event: OrchestratorEvent;
}): void {
  let reason = 'review exceeded max rounds';
  if (event.type === 'REVIEW_COMPLETE') {
    reason = `review verdict: ${event.verdict} after round ${event.round}`;
  }
  dispatch({
    type: 'ESCALATE',
    task_id: context.current_task_id ?? -1,
    reason,
    options: ['retry', 'skip', 'abort'],
  });
}

export function escalateTimeout({ context }: { context: OrchestratorContext }): void {
  dispatch({
    type: 'ESCALATE',
    task_id: context.current_task_id ?? -1,
    reason: `timeout exceeded for task ${context.current_task_id ?? 'unknown'}`,
    options: ['retry', 'skip', 'abort'],
  });
}

export function escalateBlocked({
  context,
  event,
}: {
  context: OrchestratorContext;
  event: OrchestratorEvent;
}): void {
  let reason = 'all tasks blocked';
  if (event.type === 'QUERY_RESULT' && event.outcome === 'all_blocked') {
    const ids = event.blocked_task_ids ?? [];
    const reasons = event.blocked_reasons ?? [];
    reason = `all tasks blocked — ids: [${ids.join(', ')}]${reasons.length > 0 ? `, reasons: ${reasons.join('; ')}` : ''}`;
  }
  dispatch({
    type: 'ESCALATE',
    task_id: context.current_task_id ?? -1,
    reason,
    options: ['skip', 'abort'],
  });
}

export function escalateDispatchError({
  context,
  event,
}: {
  context: OrchestratorContext;
  event: OrchestratorEvent;
}): void {
  let reason = 'dispatch error';
  if (event.type === 'DISPATCH_ERROR') {
    reason = `dispatch error for command "${event.failed_command}": ${event.error_message} (after ${event.attempts} attempts)`;
  }
  dispatch({
    type: 'ESCALATE',
    task_id: context.current_task_id ?? -1,
    reason,
    options: ['retry', 'abort'],
  });
}

export function dispatchRedecompose({ context }: { context: OrchestratorContext }): void {
  if (context.current_task_id === null) {
    console.warn('[orchestrator] dispatchRedecompose: no current_task_id');
    return;
  }
  dispatch({
    type: 'REDECOMPOSE_TASK',
    task_id: context.current_task_id,
    reason: 'compaction_detected',
  });
}

export function dispatchDecomposeArtifact({ context }: { context: OrchestratorContext }): void {
  const artifactPath = context.spec_path ?? context.plan_path;
  if (!artifactPath) {
    console.warn('[orchestrator] dispatchDecomposeArtifact: no spec_path or plan_path');
    return;
  }
  const artifactType: 'spec' | 'plan' = context.spec_path ? 'spec' : 'plan';
  dispatch({
    type: 'DECOMPOSE_ARTIFACT',
    artifact_path: artifactPath,
    artifact_type: artifactType,
    reason: 'size_gate_mechanical',
    sizing_result: context.last_sizing_result ?? undefined,
  });
}

export function dispatchHaikuSizing({ context }: { context: OrchestratorContext }): void {
  const artifactPath = context.spec_path ?? context.plan_path;
  if (!artifactPath) {
    console.warn('[orchestrator] dispatchHaikuSizing: no spec_path or plan_path');
    return;
  }
  const artifactType: 'spec' | 'plan' = context.spec_path ? 'spec' : 'plan';

  if (!context.last_sizing_result) {
    console.warn('[orchestrator] dispatchHaikuSizing: no last_sizing_result');
    return;
  }

  dispatch({
    type: 'DISPATCH_HAIKU_SIZING',
    artifact_path: artifactPath,
    artifact_type: artifactType,
    sizing_result: context.last_sizing_result,
  });
}

export function dispatchFinish({ context }: { context: OrchestratorContext }): void {
  console.log(`[orchestrator] STUB: dispatchFinish — tasks_complete=${context.tasks_complete}`);
}

export function emitPipelineSummary({ context }: { context: OrchestratorContext }): void {
  const totalCost = Object.values(context.tasks).reduce(
    (sum, task) => sum + task.cost_usd,
    0,
  );

  console.log(
    `[orchestrator] Pipeline complete — tasks_complete=${context.tasks_complete}/${context.task_count} total_cost_usd=${totalCost.toFixed(4)} risk=${context.risk}`,
  );
}

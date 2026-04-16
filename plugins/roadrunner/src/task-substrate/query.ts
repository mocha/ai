/**
 * QUERY_NEXT_TASK command handler.
 *
 * Returns a three-way QUERY_RESULT event:
 * - task_ready: a dispatchable task exists
 * - all_complete: no non-terminal tasks remain
 * - all_blocked: tasks exist but none have all dependencies satisfied
 */

import type { TaskmasterClient } from './mcp-client.js';
import type { TaskPayload, TaskmasterStatus } from './types.js';
import type { QueryResult, StatusRollup } from '../orchestrator/events.js';
import type { TaskSpec } from '../orchestrator/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES: TaskmasterStatus[] = ['done', 'cancelled'];

function isTerminal(status: TaskmasterStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Convert a Taskmaster TaskPayload to the orchestrator's leaner TaskSpec. */
function toTaskSpec(task: TaskPayload): TaskSpec {
  return {
    id: task.id,
    title: task.title,
    dependencies: task.dependencies,
    status: task.status,
    details: task.details,
    acceptanceCriteria: task.acceptanceCriteria
      ? [task.acceptanceCriteria]
      : [],
    relevantFiles: task.relevantFiles.map((f) => f.path),
  };
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

/**
 * Primary dispatch query. Returns a QUERY_RESULT with one of three outcomes.
 */
export async function queryNextTask(
  client: TaskmasterClient,
): Promise<QueryResult> {
  // Try to get a ready task from Taskmaster
  const readyTask = await client.nextTask();

  if (readyTask) {
    return {
      type: 'QUERY_RESULT',
      outcome: 'task_ready',
      task: toTaskSpec(readyTask),
    };
  }

  // No ready task — determine if all complete or all blocked
  const allTasks = await client.getTasks();
  const nonTerminal = allTasks.filter((t) => !isTerminal(t.status));

  if (nonTerminal.length === 0) {
    return {
      type: 'QUERY_RESULT',
      outcome: 'all_complete',
    };
  }

  // Non-terminal tasks exist but none are ready — find out why
  const blockedIds: number[] = [];
  const blockedReasons: string[] = [];

  for (const task of nonTerminal) {
    if (task.status === 'pending' || task.status === 'blocked') {
      blockedIds.push(task.id);

      // Check which dependencies are unsatisfied
      const unsatisfied: string[] = [];
      for (const depId of task.dependencies) {
        const dep = allTasks.find((t) => t.id === depId);
        if (dep && !isTerminal(dep.status)) {
          unsatisfied.push(`TASK-${depId} (status: ${dep.status})`);
        }
      }

      if (unsatisfied.length > 0) {
        blockedReasons.push(
          `TASK-${task.id} blocked by ${unsatisfied.join(', ')}`,
        );
      } else if (task.status === 'blocked') {
        blockedReasons.push(
          `TASK-${task.id} has status 'blocked' (external dependency)`,
        );
      } else {
        blockedReasons.push(
          `TASK-${task.id} is pending but Taskmaster did not return it as next`,
        );
      }
    }
  }

  return {
    type: 'QUERY_RESULT',
    outcome: 'all_blocked',
    blocked_task_ids: blockedIds,
    blocked_reasons: blockedReasons,
  };
}

/**
 * Returns what is blocking a specific task (unmet dependencies).
 */
export interface BlockerReport {
  task_id: number;
  blockers: Array<{ id: number; status: TaskmasterStatus }>;
}

export async function queryBlockers(
  client: TaskmasterClient,
  taskId: number,
): Promise<BlockerReport> {
  const task = await client.getTask(taskId);
  const blockers: BlockerReport['blockers'] = [];

  for (const depId of task.dependencies) {
    try {
      const dep = await client.getTask(depId);
      if (!isTerminal(dep.status)) {
        blockers.push({ id: depId, status: dep.status });
      }
    } catch {
      // Dependency task not found — treat as a blocker
      blockers.push({ id: depId, status: 'blocked' });
    }
  }

  return { task_id: taskId, blockers };
}

/**
 * Returns completion status for a parent task (rollup).
 * Used by the status bridge after subtask status changes.
 */
export async function queryStatusRollup(
  client: TaskmasterClient,
  parentId: number,
): Promise<StatusRollup> {
  const parent = await client.getTask(parentId);
  const total = parent.subtasks.length;
  const complete = parent.subtasks.filter((s) => s.status === 'done').length;

  return {
    type: 'STATUS_ROLLUP',
    parent_id: parentId,
    children_complete: complete,
    children_total: total,
    all_complete: complete === total && total > 0,
  };
}

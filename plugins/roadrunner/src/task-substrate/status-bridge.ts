/**
 * UPDATE_TASK_STATUS command handler.
 *
 * Receives a task ID and new status, calls Taskmaster's set_task_status,
 * then checks for parent rollup. Returns the updated task and an optional
 * STATUS_ROLLUP event if the parent's effective status changed.
 */

import type { TaskmasterClient } from './mcp-client.js';
import type { TaskPayload, TaskmasterStatus } from './types.js';
import type { StatusRollup } from '../orchestrator/events.js';
import { queryStatusRollup } from './query.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatusUpdateResult {
  updated_task: TaskPayload;
  rollup: StatusRollup | null;
}

// ---------------------------------------------------------------------------
// Status bridge
// ---------------------------------------------------------------------------

/**
 * Handler for UPDATE_TASK_STATUS from the orchestrator.
 *
 * 1. Read parent state before the update (for rollup detection)
 * 2. Call set_task_status on Taskmaster
 * 3. Read parent state after the update
 * 4. If parent status changed, emit STATUS_ROLLUP
 */
export async function updateTaskStatus(
  client: TaskmasterClient,
  taskId: number | string,
  status: TaskmasterStatus,
  resultSummary?: string,
): Promise<StatusUpdateResult> {
  // Read the task to find its parent (if any)
  const taskBefore = await client.getTask(
    typeof taskId === 'string' ? parseTaskId(taskId) : taskId,
  );
  const parentId = taskBefore.parentId;

  // Capture parent state before the change (for rollup detection)
  let parentBefore: TaskPayload | null = null;
  if (parentId !== null) {
    try {
      parentBefore = await client.getTask(parentId);
    } catch {
      // Parent not found — no rollup possible
    }
  }

  // Execute the status change
  const updatedTask = await client.setTaskStatus(taskId, status);

  // Persist result summary if provided
  if (resultSummary) {
    try {
      const existingDetails = updatedTask.details || '';
      const updatedDetails = existingDetails
        ? `${existingDetails}\n\n---\n**Result summary:** ${resultSummary}`
        : `**Result summary:** ${resultSummary}`;
      await client.updateTask(
        typeof taskId === 'string' ? parseTaskId(taskId) : taskId as number,
        { details: updatedDetails },
      );
    } catch {
      // Non-critical — log and continue
      console.warn(
        `[task-substrate] Failed to persist result summary for task ${taskId}`,
      );
    }
  }

  // Check for rollup
  let rollup: StatusRollup | null = null;

  if (parentId !== null && parentBefore !== null) {
    try {
      const parentAfter = await client.getTask(parentId);

      // Detect if parent status changed (Taskmaster handles rollup
      // automatically, we just detect the change)
      if (parentBefore.status !== parentAfter.status) {
        rollup = await queryStatusRollup(client, parentId);
      }
    } catch {
      // Parent read failed — no rollup
    }
  }

  return { updated_task: updatedTask, rollup };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a dot-notation subtask ID (e.g., "3.2") to the parent task ID. */
function parseTaskId(id: string | number): number {
  if (typeof id === 'number') return id;
  // Dot notation: "3.2" → parent is 3
  const parts = id.split('.');
  return parseInt(parts[0], 10);
}

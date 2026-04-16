/**
 * Command handler for the task substrate.
 *
 * Receives OrchestratorCommands dispatched to Layer 3, translates them
 * into Taskmaster MCP calls, and sends response events back to the
 * orchestrator via the event bus.
 *
 * Usage:
 *   const bus = createEventBus(actor);
 *   const client = createTaskmasterClient(conn);
 *   bus.onCommand(createTaskSubstrateHandler(client, bus.sendEvent));
 */

import type { OrchestratorCommand } from '../orchestrator/commands.js';
import type { OrchestratorEvent } from '../orchestrator/events.js';
import type { TaskmasterClient } from './mcp-client.js';
import type { TaskmasterStatus } from './types.js';
import { decompose } from './decompose.js';
import { queryNextTask } from './query.js';
import { updateTaskStatus } from './status-bridge.js';
import { handleCompaction } from './sizing.js';
import { syncArtifactStatus } from './artifact-bridge.js';

type SendEvent = (event: OrchestratorEvent) => void;

/**
 * Create a command handler that handles Layer 3 commands.
 *
 * The returned function should be registered on the event bus via
 * bus.onCommand(). It only handles commands targeted at Layer 3 —
 * other commands are ignored (the bus may have multiple handlers).
 */
export function createTaskSubstrateHandler(
  client: TaskmasterClient,
  sendEvent: SendEvent,
): (command: OrchestratorCommand) => void {
  return (command: OrchestratorCommand) => {
    // Handle commands asynchronously — the bus calls us synchronously
    // but we return void and send events when done
    switch (command.type) {
      case 'DECOMPOSE':
        handleDecompose(client, sendEvent, command);
        break;

      case 'QUERY_NEXT_TASK':
        handleQueryNextTask(client, sendEvent);
        break;

      case 'UPDATE_TASK_STATUS':
        handleUpdateTaskStatus(client, sendEvent, command);
        break;

      case 'REDECOMPOSE_TASK':
        handleRedecomposeTask(client, sendEvent, command);
        break;

      // Commands not targeted at Layer 3 — ignore
      default:
        break;
    }
  };
}

// ---------------------------------------------------------------------------
// Individual command handlers
// ---------------------------------------------------------------------------

async function handleDecompose(
  client: TaskmasterClient,
  sendEvent: SendEvent,
  command: Extract<OrchestratorCommand, { type: 'DECOMPOSE' }>,
): Promise<void> {
  try {
    const result = await decompose(client, {
      specPath: command.spec_path,
      risk: command.risk,
    });
    sendEvent(result);
  } catch (err) {
    console.error('[task-substrate] DECOMPOSE failed:', err);
    sendEvent({
      type: 'DISPATCH_ERROR',
      failed_command: 'DECOMPOSE',
      error_message: err instanceof Error ? err.message : String(err),
      attempts: 1,
    });
  }
}

async function handleQueryNextTask(
  client: TaskmasterClient,
  sendEvent: SendEvent,
): Promise<void> {
  try {
    const result = await queryNextTask(client);
    sendEvent(result);
  } catch (err) {
    console.error('[task-substrate] QUERY_NEXT_TASK failed:', err);
    sendEvent({
      type: 'DISPATCH_ERROR',
      failed_command: 'QUERY_NEXT_TASK',
      error_message: err instanceof Error ? err.message : String(err),
      attempts: 1,
    });
  }
}

async function handleUpdateTaskStatus(
  client: TaskmasterClient,
  sendEvent: SendEvent,
  command: Extract<OrchestratorCommand, { type: 'UPDATE_TASK_STATUS' }>,
): Promise<void> {
  try {
    // Map orchestrator's TaskStatus to Taskmaster's TaskmasterStatus
    const tmStatus = mapToTaskmasterStatus(command.status);

    const result = await updateTaskStatus(
      client,
      command.task_id,
      tmStatus,
    );

    // Sync Skylark artifact status
    try {
      await syncArtifactStatus(client, command.task_id, tmStatus);
    } catch {
      // Non-critical — artifact sync failure doesn't block the pipeline
    }

    // Send rollup event if parent status changed
    if (result.rollup) {
      sendEvent(result.rollup);
    }
  } catch (err) {
    console.error('[task-substrate] UPDATE_TASK_STATUS failed:', err);
    sendEvent({
      type: 'DISPATCH_ERROR',
      failed_command: 'UPDATE_TASK_STATUS',
      error_message: err instanceof Error ? err.message : String(err),
      attempts: 1,
    });
  }
}

async function handleRedecomposeTask(
  client: TaskmasterClient,
  sendEvent: SendEvent,
  command: Extract<OrchestratorCommand, { type: 'REDECOMPOSE_TASK' }>,
): Promise<void> {
  try {
    const result = await handleCompaction(client, command.task_id);
    sendEvent(result);
  } catch (err) {
    console.error('[task-substrate] REDECOMPOSE_TASK failed:', err);
    sendEvent({
      type: 'DISPATCH_ERROR',
      failed_command: 'REDECOMPOSE_TASK',
      error_message: err instanceof Error ? err.message : String(err),
      attempts: 1,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map orchestrator's TaskStatus to Taskmaster's TaskmasterStatus.
 *
 * The orchestrator uses a richer status set that includes pipeline-specific
 * statuses (expert_ready, review, skipped). Taskmaster only knows its own
 * status enum.
 */
function mapToTaskmasterStatus(
  orchestratorStatus: string,
): TaskmasterStatus {
  const map: Record<string, TaskmasterStatus> = {
    pending: 'pending',
    expert_ready: 'pending', // Pipeline-specific, maps to pending
    in_progress: 'in-progress',
    review: 'in-progress', // Under review = still in progress
    done: 'done',
    blocked: 'blocked',
    skipped: 'cancelled', // Skipped tasks are effectively cancelled
    deferred: 'deferred',
    cancelled: 'cancelled',
  };

  return map[orchestratorStatus] ?? 'pending';
}

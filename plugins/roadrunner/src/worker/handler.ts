/**
 * Command handler for the worker layer (Layer 5).
 *
 * Handles DISPATCH_WORKER (CLI execution) and UPDATE_TASK_STATUS
 * (incremental merge/cleanup). Layer 4 commands (GENERATE_EXPERT,
 * RUN_REVIEW) are handled by the review handler in src/review/handler.ts.
 *
 * Usage:
 *   const handler = createWorkerHandler({ config, repoRoot }, bus.sendEvent);
 *   bus.onCommand(handler);
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { OrchestratorCommand } from '../orchestrator/commands.js';
import type { OrchestratorEvent } from '../orchestrator/events.js';
import type { RiskLevel } from '../orchestrator/types.js';
import type { WorkerConfig, WorktreeInfo, SessionTracker } from './types.js';
import { createWorktree } from './worktree.js';
import { buildTaskPrompt } from './prompt.js';
import { installWorkerSettings } from './settings.js';
import { invokeClaude } from './execute.js';
import { parseCliOutput } from './result.js';
import { assemblePredecessorContext, writeSessionContext } from './context.js';
import { mergeTaskBranch, discardTaskBranch } from './merge.js';

type SendEvent = (event: OrchestratorEvent) => void;

export interface WorkerDeps {
  config: WorkerConfig;
  repoRoot: string;
}

// Narrow command types for internal use
type DispatchWorker = Extract<OrchestratorCommand, { type: 'DISPATCH_WORKER' }>;
type UpdateTaskStatus = Extract<OrchestratorCommand, { type: 'UPDATE_TASK_STATUS' }>;

/**
 * Create a command handler for the worker layer (Layer 5).
 * Handles: DISPATCH_WORKER (full CLI execution lifecycle),
 *          UPDATE_TASK_STATUS (incremental merge/cleanup trigger)
 */
export function createWorkerHandler(
  deps: WorkerDeps,
  sendEvent: SendEvent,
): (command: OrchestratorCommand) => void {
  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------

  // Pending merge promise — DISPATCH_WORKER waits for this before creating new worktree
  let pendingMerge: Promise<void> | null = null;

  // Session trackers per task — tracks dispatch count, cost
  const sessions: Map<number, SessionTracker> = new Map();

  // Active worktrees — maps task_id to WorktreeInfo
  const worktrees: Map<number, WorktreeInfo> = new Map();

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Infer risk level from max_turns. The orchestrator sets max_turns
   * deterministically from risk in configureFromRisk (actions.ts):
   * trivial=10, standard=20, elevated=30, critical=40.
   */
  function inferRiskFromMaxTurns(maxTurns: number): RiskLevel {
    if (maxTurns <= 10) return 'trivial';
    if (maxTurns <= 20) return 'standard';
    if (maxTurns <= 30) return 'elevated';
    return 'critical';
  }

  function getOrCreateSession(taskId: number): SessionTracker {
    let session = sessions.get(taskId);
    if (!session) {
      session = {
        task_id: taskId,
        dispatch_count: 0,
        handoff_count: 0,
        total_cost_usd: 0,
        total_duration_ms: 0,
      };
      sessions.set(taskId, session);
    }
    return session;
  }

  // ---------------------------------------------------------------------------
  // DISPATCH_WORKER
  // ---------------------------------------------------------------------------

  async function handleDispatchWorker(command: DispatchWorker): Promise<void> {
    try {
      // 1. Wait for any pending merge from previous task
      if (pendingMerge) await pendingMerge;

      // 2. Create worktree (or check if exists for re-dispatch)
      let worktreeInfo = worktrees.get(command.task_id);
      if (!worktreeInfo) {
        worktreeInfo = createWorktree(command.task_id, deps.config, deps.repoRoot);
        worktrees.set(command.task_id, worktreeInfo);
      }

      // 3. Install expert prompt as .claude/CLAUDE.md
      const claudeDir = path.join(worktreeInfo.path, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      if (command.expert_prompt_path && fs.existsSync(command.expert_prompt_path)) {
        fs.copyFileSync(command.expert_prompt_path, path.join(claudeDir, 'CLAUDE.md'));
      }

      // 4. Install worker settings (tool scoping + hooks)
      const risk = inferRiskFromMaxTurns(command.max_turns);
      installWorkerSettings(worktreeInfo.path, risk, deps.config, command.task_id);

      // 5. Assemble & write predecessor context
      // Pass empty completed tasks record — predecessor context handles missing tasks gracefully.
      const predCtx = assemblePredecessorContext(
        command.task_spec,
        {},
        deps.repoRoot,
        deps.config,
      );
      writeSessionContext(worktreeInfo.path, predCtx);

      // 6. Build prompt
      const session = getOrCreateSession(command.task_id);
      const prompt = buildTaskPrompt(command.task_spec);

      // 7. Invoke claude CLI
      const timeoutMs =
        deps.config.timeout_overrides?.[risk] ?? 600_000;

      const { exec, hookEvents } = await invokeClaude({
        worktreePath: worktreeInfo.path,
        prompt,
        maxTurns: command.max_turns,
        model: command.model,
        timeoutMs,
        taskId: command.task_id,
        config: deps.config,
      });

      // 8. Parse result
      const event = parseCliOutput(
        exec,
        hookEvents,
        command.task_id,
        worktreeInfo.path,
        session.dispatch_count + 1,
        deps.config,
      );

      // 9. Update session tracker
      session.dispatch_count++;
      session.total_cost_usd += event.cost_usd;
      session.total_duration_ms += event.duration_ms;

      // 10. Send event to orchestrator
      sendEvent(event);
    } catch (err) {
      sendEvent({
        type: 'DISPATCH_ERROR',
        failed_command: 'DISPATCH_WORKER',
        error_message: err instanceof Error ? err.message : String(err),
        attempts: 1,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // UPDATE_TASK_STATUS
  // ---------------------------------------------------------------------------

  function handleTaskStatusChange(command: UpdateTaskStatus): void {
    if (command.status === 'done') {
      pendingMerge = (async () => {
        try {
          mergeTaskBranch(command.task_id, deps.config, deps.repoRoot);
        } catch (err) {
          console.error(`[worker] merge failed for task ${command.task_id}:`, err);
        } finally {
          worktrees.delete(command.task_id);
          sessions.delete(command.task_id);
          pendingMerge = null;
        }
      })();
    } else if (command.status === 'skipped') {
      try {
        discardTaskBranch(command.task_id, deps.config, deps.repoRoot);
      } catch (err) {
        console.error(`[worker] discard failed for task ${command.task_id}:`, err);
      }
      worktrees.delete(command.task_id);
      sessions.delete(command.task_id);
    }
  }

  // ---------------------------------------------------------------------------
  // Dispatch router
  // ---------------------------------------------------------------------------

  return (command: OrchestratorCommand): void => {
    switch (command.type) {
      case 'DISPATCH_WORKER':
        handleDispatchWorker(command);
        break;

      case 'UPDATE_TASK_STATUS':
        handleTaskStatusChange(command);
        break;

      // Layer 4 commands (GENERATE_EXPERT, RUN_REVIEW) handled by
      // the review handler in src/review/handler.ts. All other
      // commands silently ignored.
      default:
        break;
    }
  };
}

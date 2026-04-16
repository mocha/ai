/**
 * Task sizing enforcement module.
 *
 * Applies at every entry point where work items enter or re-enter the
 * system. Provides:
 *
 * - checkTaskSize: primary sizing heuristic for individual tasks
 * - checkArtifactSize: sizing for spec/plan markdown files (consumed
 *   by orchestrator's size_check gates)
 * - handleCompaction: re-decomposes tasks that triggered compaction
 * - promoteSubtask: promotes a subtask to standalone task when at depth limit
 */

import * as fs from 'node:fs';
import type { TaskmasterClient } from './mcp-client.js';
import type {
  TaskPayload,
  TaskSizingResult,
  ArtifactSizingResult,
  ArtifactSizingThresholds,
} from './types.js';
import { SIZING_CONSTANTS, VERTICAL_SLICE_PROMPT } from './types.js';
import type { DecompositionComplete } from '../orchestrator/events.js';

// Re-export the orchestrator's sizing functions for artifact-level checks
import {
  countProseTokens,
  countProseLines,
  countFileBlastRadius,
} from '../orchestrator/sizing.js';

// ---------------------------------------------------------------------------
// Default thresholds (match orchestrator amendments spec)
// ---------------------------------------------------------------------------

const DEFAULT_ARTIFACT_THRESHOLDS: ArtifactSizingThresholds = {
  max_prose_tokens: 2500,
  max_prose_lines: 200,
  max_file_blast_radius: 4,
};

// ---------------------------------------------------------------------------
// Task-level sizing
// ---------------------------------------------------------------------------

/**
 * Check whether a task fits in a single worker session.
 *
 * Decision tree:
 * 1. Complexity <= FLOOR → dispatch (already atomic)
 * 2. Complexity > 9 → scope_down
 * 3. Complexity > THRESHOLD → decompose
 * 4. File blast radius >= THRESHOLD → decompose
 * 5. Estimated LOC > MAX → decompose
 * 6. Otherwise → dispatch
 */
export function checkTaskSize(task: TaskPayload): TaskSizingResult {
  const {
    COMPLEXITY_FLOOR,
    COMPLEXITY_DECOMPOSE_THRESHOLD,
    FILE_BLAST_RADIUS_THRESHOLD,
    MAX_LOC_PER_TASK,
    TOKENS_PER_LOC,
    MAX_CODE_TOKENS,
    SESSION_CONTEXT_WINDOW,
  } = SIZING_CONSTANTS;

  const complexity = task.complexity ?? 0;

  // Step 1: Floor — already atomic
  if (complexity > 0 && complexity <= COMPLEXITY_FLOOR) {
    return {
      fits_single_session: true,
      complexity,
      estimated_loc: 0,
      estimated_code_tokens: 0,
      file_blast_radius: 0,
      recommendation: 'dispatch',
      reason: `complexity ${complexity} <= floor ${COMPLEXITY_FLOOR} — already atomic`,
    };
  }

  // Count files that will be created or modified (not just referenced)
  const activeFiles = task.relevantFiles.filter(
    (f) => f.action === 'create' || f.action === 'modify',
  );
  const fileBlastRadius = activeFiles.length;

  // Estimate LOC: new files ~100 LOC, modifications ~50 LOC
  const estimatedLoc = activeFiles.reduce((sum, f) => {
    return sum + (f.action === 'create' ? 100 : 50);
  }, 0);

  const estimatedCodeTokens = estimatedLoc * TOKENS_PER_LOC;

  // Enough room in context window? Need ~150K+ for context and tool calls
  const fitsSession = estimatedCodeTokens < (SESSION_CONTEXT_WINDOW * 0.3);

  // Step 2: Complexity > 9 → scope_down
  if (complexity > 9) {
    return {
      fits_single_session: false,
      complexity,
      estimated_loc: estimatedLoc,
      estimated_code_tokens: estimatedCodeTokens,
      file_blast_radius: fileBlastRadius,
      recommendation: 'scope_down',
      reason: `complexity ${complexity} > 9 — needs manual re-scoping before decomposition`,
    };
  }

  // Step 3: Complexity > threshold → decompose
  if (complexity > COMPLEXITY_DECOMPOSE_THRESHOLD) {
    return {
      fits_single_session: false,
      complexity,
      estimated_loc: estimatedLoc,
      estimated_code_tokens: estimatedCodeTokens,
      file_blast_radius: fileBlastRadius,
      recommendation: 'decompose',
      reason: `complexity ${complexity} > threshold ${COMPLEXITY_DECOMPOSE_THRESHOLD}`,
    };
  }

  // Step 4: File blast radius → decompose (independent of complexity)
  if (fileBlastRadius >= FILE_BLAST_RADIUS_THRESHOLD) {
    return {
      fits_single_session: false,
      complexity,
      estimated_loc: estimatedLoc,
      estimated_code_tokens: estimatedCodeTokens,
      file_blast_radius: fileBlastRadius,
      recommendation: 'decompose',
      reason: `file blast radius ${fileBlastRadius} >= threshold ${FILE_BLAST_RADIUS_THRESHOLD} (multi-file cliff)`,
    };
  }

  // Step 5: LOC/token check
  if (estimatedLoc > MAX_LOC_PER_TASK || estimatedCodeTokens > MAX_CODE_TOKENS) {
    return {
      fits_single_session: false,
      complexity,
      estimated_loc: estimatedLoc,
      estimated_code_tokens: estimatedCodeTokens,
      file_blast_radius: fileBlastRadius,
      recommendation: 'decompose',
      reason: `estimated ${estimatedLoc} LOC > ${MAX_LOC_PER_TASK} cap (${estimatedCodeTokens} code tokens)`,
    };
  }

  // Step 6: Fits
  return {
    fits_single_session: fitsSession,
    complexity,
    estimated_loc: estimatedLoc,
    estimated_code_tokens: estimatedCodeTokens,
    file_blast_radius: fileBlastRadius,
    recommendation: 'dispatch',
    reason: 'within all thresholds',
  };
}

// ---------------------------------------------------------------------------
// Artifact-level sizing (consumed by orchestrator's size_check gates)
// ---------------------------------------------------------------------------

/**
 * Check whether an artifact (spec or plan) exceeds mechanical sizing
 * thresholds. Used by the orchestrator's size_check_pre_spec and
 * size_check_pre_plan states.
 */
export function checkArtifactSize(
  artifactPath: string,
  thresholds?: Partial<ArtifactSizingThresholds>,
): ArtifactSizingResult {
  const config = { ...DEFAULT_ARTIFACT_THRESHOLDS, ...thresholds };

  let content: string;
  try {
    content = fs.readFileSync(artifactPath, 'utf8');
  } catch {
    // File not found or unreadable — treat as under (don't block pipeline)
    return {
      token_count: 0,
      prose_line_count: 0,
      file_blast_radius: 0,
      verdict: 'under',
    };
  }

  // Strip YAML frontmatter before counting
  const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, '');

  const token_count = countProseTokens(withoutFrontmatter);
  const prose_line_count = countProseLines(withoutFrontmatter);
  const file_blast_radius = countFileBlastRadius(withoutFrontmatter);

  // Verdict logic (matches orchestrator's evaluateSizing)
  const over =
    token_count > config.max_prose_tokens ||
    prose_line_count > config.max_prose_lines ||
    file_blast_radius > config.max_file_blast_radius;

  if (over) {
    return { token_count, prose_line_count, file_blast_radius, verdict: 'over' };
  }

  const AMBIGUITY_THRESHOLD = 0.7;
  const ambiguous =
    token_count > config.max_prose_tokens * AMBIGUITY_THRESHOLD ||
    prose_line_count > config.max_prose_lines * AMBIGUITY_THRESHOLD ||
    file_blast_radius > config.max_file_blast_radius * AMBIGUITY_THRESHOLD;

  return {
    token_count,
    prose_line_count,
    file_blast_radius,
    verdict: ambiguous ? 'ambiguous' : 'under',
  };
}

// ---------------------------------------------------------------------------
// Compaction handler
// ---------------------------------------------------------------------------

/**
 * Handle a task that exceeded its context window (compaction detected).
 *
 * If the task is a subtask at the depth limit, promote it to a standalone
 * task first, then expand. Otherwise, expand in place.
 */
export async function handleCompaction(
  client: TaskmasterClient,
  taskId: number | string,
): Promise<DecompositionComplete> {
  const numericId = typeof taskId === 'string' ? parseInt(taskId.split('.')[0], 10) : taskId;
  const isSubtask = typeof taskId === 'string' && taskId.includes('.');

  let targetTaskId: number;

  if (isSubtask) {
    // Subtask at depth limit — promote to standalone task
    const promoted = await promoteSubtask(client, taskId as string);
    targetTaskId = promoted.id;
  } else {
    targetTaskId = numericId;
    // Reset status to pending for re-decomposition
    await client.setTaskStatus(targetTaskId, 'pending');
  }

  // Expand the task with a note about compaction
  await client.expandTask(targetTaskId, {
    prompt: `This task exceeded the worker's context window during execution. ${VERTICAL_SLICE_PROMPT}`,
    force: true,
  });

  // Return decomposition event for the new subtasks
  const task = await client.getTask(targetTaskId);
  const subtaskIds = task.subtasks.map((s) => s.id);

  return {
    type: 'DECOMPOSITION_COMPLETE',
    task_count: subtaskIds.length,
    task_ids: subtaskIds,
    domains: [],
  };
}

// ---------------------------------------------------------------------------
// Subtask promotion
// ---------------------------------------------------------------------------

/**
 * Promote a subtask to a standalone top-level task.
 *
 * Used when a subtask is too complex but is at Taskmaster's 2-level
 * depth limit (subtasks cannot have sub-subtasks).
 */
export async function promoteSubtask(
  client: TaskmasterClient,
  subtaskId: string,
): Promise<TaskPayload> {
  const parts = subtaskId.split('.');
  const parentId = parseInt(parts[0], 10);
  const subtaskIndex = parseInt(parts[1], 10);

  // Read the parent to find the subtask
  const parent = await client.getTask(parentId);
  const subtask = parent.subtasks.find((s) => s.id === subtaskIndex);

  if (!subtask) {
    throw new Error(
      `Subtask ${subtaskId} not found in parent task ${parentId}`,
    );
  }

  // Create a new top-level task with the subtask's content
  const newTask = await client.createTask({
    title: subtask.title,
    description: subtask.description,
    details: subtask.details,
    dependencies: [parentId],
    testStrategy: subtask.testStrategy,
    acceptanceCriteria: subtask.acceptanceCriteria,
    tags: [`promoted-from:${subtaskId}`],
  });

  // Cancel the original subtask with a reference
  await client.setTaskStatus(subtaskId, 'cancelled');

  console.log(
    `[task-substrate] Promoted subtask ${subtaskId} to task ${newTask.id}`,
  );

  return newTask;
}

// ---------------------------------------------------------------------------
// Calibration logging
// ---------------------------------------------------------------------------

/**
 * Log a calibration warning when a task took more turns than expected.
 * Writes to .skylark/telemetry/sizing-calibration.jsonl.
 */
export function logCalibrationWarning(
  taskId: number,
  turnsUsed: number,
  maxTurns: number,
  complexity: number,
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    taskId,
    turnsUsed,
    maxTurns,
    complexity,
    signal: turnsUsed > maxTurns * 0.8 ? 'high' : 'moderate',
  };

  const logPath = '.skylark/telemetry/sizing-calibration.jsonl';

  try {
    const dir = logPath.substring(0, logPath.lastIndexOf('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch {
    // Telemetry is best-effort
    console.warn(
      `[task-substrate] Failed to write calibration log: taskId=${taskId} turns=${turnsUsed}/${maxTurns}`,
    );
  }
}

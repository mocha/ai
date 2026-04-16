import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorkerComplete } from '../orchestrator/events.js';
import type { ExecResult, HookEvent, WorkerConfig } from './types.js';
import { getFilesChanged } from './worktree.js';

// ---------------------------------------------------------------------------
// Internal: Claude Code JSON output shape
// ---------------------------------------------------------------------------

interface ClaudeCliOutput {
  type?: string;
  result?: string;
  cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  session_id?: string;
  is_error?: boolean;
}

// ---------------------------------------------------------------------------
// extractStatus
// ---------------------------------------------------------------------------

/**
 * Extract status keyword from worker's result text.
 * Check order: DONE_WITH_CONCERNS → DONE → NEEDS_CONTEXT → BLOCKED
 * (DONE_WITH_CONCERNS before DONE to avoid false prefix match).
 */
export function extractStatus(
  resultText: string,
  isError: boolean,
  filesChanged: string[],
  timedOut: boolean,
  maxTurnsExceeded: boolean,
): { status: WorkerComplete['status']; concerns: string | null } {
  // Search for keywords in priority order
  if (resultText.includes('DONE_WITH_CONCERNS')) {
    const idx = resultText.indexOf('DONE_WITH_CONCERNS');
    const after = resultText.slice(idx + 'DONE_WITH_CONCERNS'.length).trim();
    return {
      status: 'DONE_WITH_CONCERNS',
      concerns: after.length > 0 ? after : null,
    };
  }

  if (resultText.includes('DONE')) {
    return { status: 'DONE', concerns: null };
  }

  if (resultText.includes('NEEDS_CONTEXT')) {
    return { status: 'NEEDS_CONTEXT', concerns: null };
  }

  if (resultText.includes('BLOCKED')) {
    return { status: 'BLOCKED', concerns: null };
  }

  // No keyword found — apply fallback rules
  if (timedOut) {
    return { status: 'BLOCKED', concerns: 'timed out' };
  }

  if (maxTurnsExceeded) {
    return {
      status: 'BLOCKED',
      concerns: 'max turns exceeded without completion',
    };
  }

  if (isError) {
    const excerpt = resultText.slice(0, 500) || '(no output)';
    return { status: 'BLOCKED', concerns: excerpt };
  }

  if (filesChanged.length > 0) {
    return {
      status: 'DONE_WITH_CONCERNS',
      concerns: 'completed work but did not report explicit status',
    };
  }

  return {
    status: 'BLOCKED',
    concerns: 'no changes made and no status reported',
  };
}

// ---------------------------------------------------------------------------
// writeResultArtifact
// ---------------------------------------------------------------------------

export interface ResultArtifact {
  task_id: number;
  status: WorkerComplete['status'];
  round: number;
  model: string;
  timestamp: string;
  cost_usd: number;
  duration_ms: number;
  files_changed: string[];
  concerns: string | null;
  hook_events: HookEvent[];
}

/**
 * Write result artifact to .roadrunner/results/TASK-{id}.json
 * or TASK-{id}-r{round}.json for round > 1.
 * Returns the artifact path.
 */
export function writeResultArtifact(
  event: WorkerComplete,
  round: number,
  model: string,
  config: WorkerConfig,
): string {
  const resultsDir = path.join(config.artifact_root, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });

  const filename =
    round > 1
      ? `TASK-${event.task_id}-r${round}.json`
      : `TASK-${event.task_id}.json`;

  const artifactPath = path.join(resultsDir, filename);

  const artifact: ResultArtifact = {
    task_id: event.task_id,
    status: event.status,
    round,
    model,
    timestamp: new Date().toISOString(),
    cost_usd: event.cost_usd,
    duration_ms: event.duration_ms,
    files_changed: event.files_changed,
    concerns: event.concerns,
    hook_events: [],
  };

  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), 'utf8');

  return artifactPath;
}

// ---------------------------------------------------------------------------
// parseCliOutput
// ---------------------------------------------------------------------------

/**
 * Parse CLI output into a WorkerComplete event.
 */
export function parseCliOutput(
  exec: ExecResult,
  hookEvents: HookEvent[],
  taskId: number,
  worktreePath: string,
  round: number,
  config: WorkerConfig,
): WorkerComplete {
  // Attempt to parse Claude Code JSON output
  let parsed: ClaudeCliOutput | null = null;
  try {
    const trimmed = exec.stdout.trim();
    if (trimmed.length > 0) {
      parsed = JSON.parse(trimmed) as ClaudeCliOutput;
    }
  } catch {
    // JSON parse failed — fall through to crash handling
  }

  if (parsed === null) {
    // CLI crashed with no parseable output
    const concerns = exec.stderr.trim().slice(0, 500) || 'CLI produced no parseable output';

    const event: WorkerComplete = {
      type: 'WORKER_COMPLETE',
      task_id: taskId,
      status: 'BLOCKED',
      result_path: '',
      cost_usd: 0,
      duration_ms: exec.duration_ms,
      files_changed: [],
      concerns,
    };

    const resultPath = writeResultArtifact(event, round, 'unknown', config);
    return { ...event, result_path: resultPath };
  }

  // Successfully parsed JSON output
  const resultText = parsed.result ?? '';
  const costUsd = typeof parsed.cost_usd === 'number' ? parsed.cost_usd : 0;
  const durationMs =
    typeof parsed.duration_ms === 'number' ? parsed.duration_ms : exec.duration_ms;
  const numTurns = typeof parsed.num_turns === 'number' ? parsed.num_turns : 0;
  const isError = parsed.is_error === true;

  // Compute files changed from git diff in the worktree
  const filesChanged = getFilesChanged(worktreePath, config.base_branch);

  // Determine if max turns was exceeded (num_turns from JSON; we don't have
  // max_turns stored in ExecResult so we rely on the no-status-keyword path)
  // The CLI args include --max-turns; we don't have that value here so we use
  // the heuristic: if num_turns > 0 and no status keyword, let extractStatus
  // handle it. We set maxTurnsExceeded = false and rely on the natural flow.
  // (A caller that knows max_turns can derive this upstream and inject via
  // a pre-computed resultText containing BLOCKED or similar.)
  const maxTurnsExceeded = false;

  const { status, concerns } = extractStatus(
    resultText,
    isError,
    filesChanged,
    exec.timed_out,
    maxTurnsExceeded,
  );

  const event: WorkerComplete = {
    type: 'WORKER_COMPLETE',
    task_id: taskId,
    status,
    result_path: '',
    cost_usd: costUsd,
    duration_ms: durationMs,
    files_changed: filesChanged,
    concerns,
  };

  const resultPath = writeResultArtifact(event, round, 'unknown', config);
  return { ...event, result_path: resultPath };
}

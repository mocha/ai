import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskSpec } from '../orchestrator/types.js';
import type { WorkerConfig } from './types.js';
import type { ResultArtifact } from './result.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface PredecessorContext {
  task_id: number;
  predecessor_tasks: PredecessorSummary[];
  pipeline_run_id: string;
}

export interface PredecessorSummary {
  task_id: number;
  title: string;
  status: string;
  files_changed: string[];
  result_path: string | null;
  commit_sha: string | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read files_changed from a result artifact JSON file.
 * Returns an empty array if the file is unreadable or malformed.
 */
function readFilesChanged(resultPath: string): string[] {
  try {
    const raw = fs.readFileSync(resultPath, 'utf8');
    const artifact = JSON.parse(raw) as ResultArtifact;
    if (Array.isArray(artifact.files_changed)) {
      return artifact.files_changed;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Try to get the tip commit SHA of a task branch.
 * Uses `git rev-parse task-{id}` in the repoRoot.
 * Returns null when the branch no longer exists or the git command fails.
 */
function getBranchSha(taskId: number, repoRoot: string): string | null {
  try {
    const sha = execSync(`git rev-parse task-${taskId}`, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return sha.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Generate a pipeline run ID from the current timestamp and a random suffix.
 */
function generateRunId(): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `run-${Date.now()}-${suffix}`;
}

// ---------------------------------------------------------------------------
// assemblePredecessorContext
// ---------------------------------------------------------------------------

/**
 * Assemble predecessor context from completed tasks.
 * Reads result artifacts from .roadrunner/results/ for each dependency.
 * Pure logic — only reads files, does not write.
 */
export function assemblePredecessorContext(
  task: TaskSpec,
  completedTasks: Record<number, { result_path: string | null; title: string; status: string }>,
  repoRoot: string,
  _config: WorkerConfig,
): PredecessorContext {
  const predecessors: PredecessorSummary[] = task.dependencies.map((depId) => {
    const completed = completedTasks[depId];

    if (!completed) {
      // Dependency not found in completed tasks — include with null fields
      return {
        task_id: depId,
        title: '',
        status: 'unknown',
        files_changed: [],
        result_path: null,
        commit_sha: null,
      };
    }

    const filesChanged =
      completed.result_path != null
        ? readFilesChanged(completed.result_path)
        : [];

    const commitSha = getBranchSha(depId, repoRoot);

    return {
      task_id: depId,
      title: completed.title,
      status: completed.status,
      files_changed: filesChanged,
      result_path: completed.result_path,
      commit_sha: commitSha,
    };
  });

  return {
    task_id: task.id,
    predecessor_tasks: predecessors,
    pipeline_run_id: generateRunId(),
  };
}

// ---------------------------------------------------------------------------
// writeSessionContext
// ---------------------------------------------------------------------------

/**
 * Write session_context.json to the worktree for the SessionStart hook.
 * Creates {worktreePath}/.roadrunner/ if it does not exist.
 */
export function writeSessionContext(
  worktreePath: string,
  context: PredecessorContext,
): void {
  const roadrunnerDir = path.join(worktreePath, '.roadrunner');
  fs.mkdirSync(roadrunnerDir, { recursive: true });

  const outputPath = path.join(roadrunnerDir, 'session_context.json');
  fs.writeFileSync(outputPath, JSON.stringify(context, null, 2), 'utf8');
}

import { execSync } from 'node:child_process';
import * as path from 'node:path';
import type { MergeResult, WorkerConfig } from './types.js';
import { hasUncommittedChanges, commitWip, removeWorktree } from './worktree.js';

/**
 * Get the list of conflicting files after a failed merge.
 * Parses `git diff --name-only --diff-filter=U` to find unmerged paths.
 */
function getConflictFiles(repoRoot: string): string[] {
  try {
    const output = execSync('git diff --name-only --diff-filter=U', {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    return output.trim().split('\n').filter(f => f.length > 0);
  } catch {
    return [];
  }
}

/**
 * Merge a task's branch into the base branch and clean up.
 *
 * Flow:
 * 1. Ensure all changes in the worktree are committed (commitWip if needed)
 * 2. cd to repoRoot (main worktree)
 * 3. git merge --no-ff task-{taskId} -m "merge: task-{taskId}"
 * 4. On conflict: abort merge, rebase task branch in worktree, retry merge
 * 5. On success: removeWorktree (removes worktree + deletes branch)
 * 6. On second failure: report conflicts, leave worktree intact
 */
export function mergeTaskBranch(
  taskId: number,
  config: WorkerConfig,
  repoRoot: string,
): MergeResult {
  const branch = `task-${taskId}`;
  const worktreePath = path.join(repoRoot, config.worktree_root, `task-${taskId}`);

  // Step 1: commit any uncommitted changes
  if (hasUncommittedChanges(worktreePath)) {
    commitWip(worktreePath, `WIP: task-${taskId} pre-merge`);
  }

  // Step 2+3: attempt merge in main repo
  try {
    execSync(`git merge --no-ff ${branch} -m "merge: ${branch}"`, {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    // Step 5: success — clean up worktree
    removeWorktree(taskId, config, repoRoot);
    return {
      success: true,
      merged_branch: branch,
      base_branch: config.base_branch,
    };
  } catch {
    // Step 4: merge failed — get conflict files, abort, rebase, retry
    const conflictFiles = getConflictFiles(repoRoot);

    // Abort the failed merge
    try {
      execSync('git merge --abort', { cwd: repoRoot, encoding: 'utf8' });
    } catch {
      // ignore — may already be aborted
    }

    // Rebase the task branch in the worktree
    try {
      execSync(`git rebase ${config.base_branch}`, {
        cwd: worktreePath,
        encoding: 'utf8',
      });
    } catch {
      // Rebase failed — abort it and give up
      try {
        execSync('git rebase --abort', { cwd: worktreePath, encoding: 'utf8' });
      } catch {
        // ignore
      }
      return {
        success: false,
        merged_branch: branch,
        base_branch: config.base_branch,
        conflict_files: conflictFiles,
        error: `Merge and rebase both failed for ${branch}`,
      };
    }

    // Retry merge after rebase
    try {
      execSync(`git merge --no-ff ${branch} -m "merge: ${branch}"`, {
        cwd: repoRoot,
        encoding: 'utf8',
      });

      // Step 5: second merge succeeded — clean up
      removeWorktree(taskId, config, repoRoot);
      return {
        success: true,
        merged_branch: branch,
        base_branch: config.base_branch,
      };
    } catch {
      // Step 6: second merge failed — get updated conflict files, abort, leave worktree intact
      const finalConflictFiles = getConflictFiles(repoRoot);
      try {
        execSync('git merge --abort', { cwd: repoRoot, encoding: 'utf8' });
      } catch {
        // ignore
      }
      return {
        success: false,
        merged_branch: branch,
        base_branch: config.base_branch,
        conflict_files: finalConflictFiles,
        error: `Merge conflict after rebase for ${branch}: ${finalConflictFiles.join(', ')}`,
      };
    }
  }
}

/**
 * Remove a task's worktree and branch without merging.
 * Used for skipped tasks.
 */
export function discardTaskBranch(
  taskId: number,
  config: WorkerConfig,
  repoRoot: string,
): void {
  removeWorktree(taskId, config, repoRoot);
}

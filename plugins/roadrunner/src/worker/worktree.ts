import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorktreeInfo, WorkerConfig } from './types.js';

/**
 * Ensure {worktree_root}/ is in .gitignore. Called once on first worktree creation.
 */
function ensureGitignore(worktreeRoot: string, repoRoot: string): void {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  const entry = `${worktreeRoot}/`;

  let contents = '';
  if (fs.existsSync(gitignorePath)) {
    contents = fs.readFileSync(gitignorePath, 'utf8');
  }

  const lines = contents.split('\n');
  if (!lines.some(line => line.trim() === entry || line.trim() === worktreeRoot)) {
    const newContents = contents.endsWith('\n') || contents === ''
      ? contents + entry + '\n'
      : contents + '\n' + entry + '\n';
    fs.writeFileSync(gitignorePath, newContents, 'utf8');
  }
}

/**
 * Create a worktree for a task. Cleans up stale branch/worktree if it exists.
 */
export function createWorktree(taskId: number, config: WorkerConfig, repoRoot: string): WorktreeInfo {
  const branch = `task-${taskId}`;
  const worktreePath = path.join(repoRoot, config.worktree_root, `task-${taskId}`);

  // Ensure the worktree root directory exists
  const worktreeRootPath = path.join(repoRoot, config.worktree_root);
  fs.mkdirSync(worktreeRootPath, { recursive: true });

  // Ensure .gitignore has the worktree root
  ensureGitignore(config.worktree_root, repoRoot);

  // Clean up any stale worktree/branch from a prior run
  try {
    // Check if worktree is locked and unlock if needed
    const lockedFile = path.join(repoRoot, '.git', 'worktrees', branch, 'locked');
    if (fs.existsSync(lockedFile)) {
      try {
        execSync(`git worktree unlock "${worktreePath}"`, { cwd: repoRoot, encoding: 'utf8' });
      } catch {
        // Unlocking may fail if not a registered worktree — remove locked file directly
        try { fs.unlinkSync(lockedFile); } catch { /* ignore */ }
      }
    }

    // Remove stale worktree if it exists
    const worktreeList = execSync('git worktree list --porcelain', { cwd: repoRoot, encoding: 'utf8' });
    if (worktreeList.includes(worktreePath)) {
      try {
        execSync(`git worktree remove --force "${worktreePath}"`, { cwd: repoRoot, encoding: 'utf8' });
      } catch (err) {
        process.stderr.write(`[worktree] Warning: failed to remove stale worktree at ${worktreePath}: ${err}\n`);
      }
    }

    // Remove stale branch if it exists
    const branches = execSync('git branch', { cwd: repoRoot, encoding: 'utf8' });
    if (branches.split('\n').some(b => b.replace(/^\*?\s+/, '').trim() === branch)) {
      try {
        execSync(`git branch -D "${branch}"`, { cwd: repoRoot, encoding: 'utf8' });
      } catch (err) {
        process.stderr.write(`[worktree] Warning: failed to delete stale branch ${branch}: ${err}\n`);
      }
    }

    // Also prune any stale worktree metadata
    try {
      execSync('git worktree prune', { cwd: repoRoot, encoding: 'utf8' });
    } catch { /* ignore */ }
  } catch (err) {
    process.stderr.write(`[worktree] Warning during stale cleanup for task ${taskId}: ${err}\n`);
  }

  // Create the new worktree on a fresh branch from base
  try {
    execSync(
      `git worktree add -b "${branch}" "${worktreePath}" "${config.base_branch}"`,
      { cwd: repoRoot, encoding: 'utf8' }
    );
  } catch (err) {
    throw new Error(`[worktree] Failed to create worktree for task ${taskId}: ${err}`);
  }

  return {
    task_id: taskId,
    branch,
    path: worktreePath,
    base_branch: config.base_branch,
    created_at: new Date().toISOString(),
  };
}

/**
 * Remove a worktree and its branch. Idempotent — no-op if already removed.
 */
export function removeWorktree(taskId: number, config: WorkerConfig, repoRoot: string): void {
  const branch = `task-${taskId}`;
  const worktreePath = path.join(repoRoot, config.worktree_root, `task-${taskId}`);

  // Try to remove worktree (ignore errors if already gone)
  try {
    execSync(`git worktree remove --force "${worktreePath}"`, { cwd: repoRoot, encoding: 'utf8' });
  } catch {
    // Already gone or not a worktree — not an error
  }

  // Prune stale metadata
  try {
    execSync('git worktree prune', { cwd: repoRoot, encoding: 'utf8' });
  } catch { /* ignore */ }

  // Try to delete the branch (ignore errors if already gone)
  try {
    execSync(`git branch -D "${branch}"`, { cwd: repoRoot, encoding: 'utf8' });
  } catch {
    // Already gone — not an error
  }
}

/**
 * List all active worktrees managed by this module (those under worktree_root).
 */
export function listWorktrees(config: WorkerConfig, repoRoot: string): WorktreeInfo[] {
  const worktreeRootRaw = path.join(repoRoot, config.worktree_root);
  // Resolve symlinks so paths match what git worktree list reports (e.g. /private/tmp on macOS)
  let worktreeRootPath: string;
  try {
    worktreeRootPath = fs.realpathSync(worktreeRootRaw);
  } catch {
    // Directory may not exist yet — fall back to the unresolved path
    worktreeRootPath = worktreeRootRaw;
  }

  let output: string;
  try {
    output = execSync('git worktree list --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  } catch (err) {
    process.stderr.write(`[worktree] Failed to list worktrees: ${err}\n`);
    return [];
  }

  const worktrees: WorktreeInfo[] = [];

  // Parse the porcelain format: blocks separated by blank lines
  const blocks = output.trim().split(/\n\n+/);
  for (const block of blocks) {
    if (!block.trim()) continue;

    const lines = block.trim().split('\n');
    let worktreePath = '';
    let branch = '';

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        worktreePath = line.slice('worktree '.length);
      } else if (line.startsWith('branch ')) {
        // branch refs/heads/task-1
        const ref = line.slice('branch '.length);
        branch = ref.replace('refs/heads/', '');
      }
    }

    if (!worktreePath || !branch) continue;

    // Filter to only worktrees under our managed root
    if (!worktreePath.startsWith(worktreeRootPath)) continue;

    // Parse taskId from branch name task-{N}
    const match = branch.match(/^task-(\d+)$/);
    if (!match) continue;

    const taskId = parseInt(match[1], 10);

    worktrees.push({
      task_id: taskId,
      branch,
      path: worktreePath,
      base_branch: config.base_branch,
      created_at: '', // Not stored in git worktree list output
    });
  }

  return worktrees;
}

/**
 * Check if worktree has uncommitted changes.
 */
export function hasUncommittedChanges(worktreePath: string): boolean {
  try {
    const output = execSync('git status --porcelain', { cwd: worktreePath, encoding: 'utf8' });
    return output.trim().length > 0;
  } catch (err) {
    process.stderr.write(`[worktree] Failed to check uncommitted changes at ${worktreePath}: ${err}\n`);
    return false;
  }
}

/**
 * Commit any uncommitted changes as WIP. Returns commit SHA or null if nothing to commit.
 */
export function commitWip(worktreePath: string, message: string): string | null {
  // Check if there's anything to commit
  try {
    const status = execSync('git status --porcelain', { cwd: worktreePath, encoding: 'utf8' });
    if (status.trim().length === 0) {
      return null;
    }
  } catch (err) {
    process.stderr.write(`[worktree] Failed to check status at ${worktreePath}: ${err}\n`);
    return null;
  }

  // Stage all changes
  try {
    execSync('git add -A', { cwd: worktreePath, encoding: 'utf8' });
  } catch (err) {
    process.stderr.write(`[worktree] Failed to stage changes at ${worktreePath}: ${err}\n`);
    return null;
  }

  // Commit
  try {
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: worktreePath, encoding: 'utf8' });
  } catch (err) {
    process.stderr.write(`[worktree] Failed to commit WIP at ${worktreePath}: ${err}\n`);
    return null;
  }

  // Return the commit SHA
  try {
    const sha = execSync('git rev-parse HEAD', { cwd: worktreePath, encoding: 'utf8' });
    return sha.trim();
  } catch (err) {
    process.stderr.write(`[worktree] Failed to get HEAD SHA at ${worktreePath}: ${err}\n`);
    return null;
  }
}

/**
 * Get files changed since branching from base.
 */
export function getFilesChanged(worktreePath: string, baseBranch: string): string[] {
  try {
    const output = execSync(
      `git diff --name-only "${baseBranch}"...HEAD`,
      { cwd: worktreePath, encoding: 'utf8' }
    );
    return output.trim().split('\n').filter(f => f.length > 0);
  } catch (err) {
    process.stderr.write(`[worktree] Failed to get changed files at ${worktreePath}: ${err}\n`);
    return [];
  }
}

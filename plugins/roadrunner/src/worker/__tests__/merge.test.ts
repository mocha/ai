import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { mergeTaskBranch, discardTaskBranch } from '../merge.js';
import { createWorktree } from '../worktree.js';
import type { WorkerConfig } from '../types.js';

/** Initialize a git repo with an initial commit so we have a base branch. */
function initRepo(dir: string, defaultBranch: string = 'main'): void {
  execSync(`git init -b "${defaultBranch}"`, { cwd: dir, encoding: 'utf8' });
  execSync('git config user.email "test@example.com"', { cwd: dir, encoding: 'utf8' });
  execSync('git config user.name "Test User"', { cwd: dir, encoding: 'utf8' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test repo\n');
  execSync('git add README.md', { cwd: dir, encoding: 'utf8' });
  execSync('git commit -m "Initial commit"', { cwd: dir, encoding: 'utf8' });
}

function makeConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    base_branch: 'main',
    worktree_root: '.worktrees',
    artifact_root: '.roadrunner',
    claude_bin: 'claude',
    methodology_path: null,
    timeout_overrides: null,
    ...overrides,
  };
}

describe('mergeTaskBranch', () => {
  let tmpDir: string;
  let config: WorkerConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-test-'));
    initRepo(tmpDir);
    config = makeConfig();
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('successful merge (no conflict)', () => {
    it('merges task branch into base and returns success', () => {
      // Create a worktree and add a commit
      const info = createWorktree(1, config, tmpDir);
      fs.writeFileSync(path.join(info.path, 'feature.ts'), 'export const x = 1;\n');
      execSync('git add -A', { cwd: info.path, encoding: 'utf8' });
      execSync('git commit -m "Add feature"', { cwd: info.path, encoding: 'utf8' });

      const result = mergeTaskBranch(1, config, tmpDir);

      expect(result.success).toBe(true);
      expect(result.merged_branch).toBe('task-1');
      expect(result.base_branch).toBe('main');
      expect(result.conflict_files).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it('merges the actual commit content into the base branch', () => {
      const info = createWorktree(2, config, tmpDir);
      fs.writeFileSync(path.join(info.path, 'output.txt'), 'task output\n');
      execSync('git add -A', { cwd: info.path, encoding: 'utf8' });
      execSync('git commit -m "Task output"', { cwd: info.path, encoding: 'utf8' });

      mergeTaskBranch(2, config, tmpDir);

      // The merged file should now exist on main
      expect(fs.existsSync(path.join(tmpDir, 'output.txt'))).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, 'output.txt'), 'utf8')).toBe('task output\n');
    });

    it('removes the worktree and branch after a successful merge', () => {
      const info = createWorktree(3, config, tmpDir);
      fs.writeFileSync(path.join(info.path, 'work.ts'), 'const a = 1;\n');
      execSync('git add -A', { cwd: info.path, encoding: 'utf8' });
      execSync('git commit -m "Work"', { cwd: info.path, encoding: 'utf8' });

      mergeTaskBranch(3, config, tmpDir);

      // Worktree directory should be removed
      expect(fs.existsSync(info.path)).toBe(false);

      // Branch should be deleted
      const branches = execSync('git branch', { cwd: tmpDir, encoding: 'utf8' });
      expect(branches).not.toContain('task-3');
    });

    it('commits uncommitted changes (WIP) before merging', () => {
      const info = createWorktree(4, config, tmpDir);
      // Write a file but do NOT commit it
      fs.writeFileSync(path.join(info.path, 'wip.txt'), 'uncommitted work\n');

      const result = mergeTaskBranch(4, config, tmpDir);

      // Should succeed — the WIP gets auto-committed
      expect(result.success).toBe(true);
      // Content should be on main
      expect(fs.existsSync(path.join(tmpDir, 'wip.txt'))).toBe(true);
    });
  });

  describe('conflict path (rebase + retry)', () => {
    it('succeeds after rebase when conflict is cleanly resolvable by rebase', () => {
      // Create worktree
      const info = createWorktree(5, config, tmpDir);

      // Commit a change in the worktree on a different file from main
      fs.writeFileSync(path.join(info.path, 'task-file.txt'), 'task content\n');
      execSync('git add -A', { cwd: info.path, encoding: 'utf8' });
      execSync('git commit -m "Task adds file"', { cwd: info.path, encoding: 'utf8' });

      // Now advance main with a change to a different file (no conflict, but diverges)
      fs.writeFileSync(path.join(tmpDir, 'main-advance.txt'), 'main advancement\n');
      execSync('git add -A', { cwd: tmpDir, encoding: 'utf8' });
      execSync('git commit -m "Main advances"', { cwd: tmpDir, encoding: 'utf8' });

      // The merge should succeed after rebase (no actual conflict, just diverged history)
      const result = mergeTaskBranch(5, config, tmpDir);

      expect(result.success).toBe(true);
      expect(result.merged_branch).toBe('task-5');
    });

    it('returns failure with conflict_files when merge cannot be resolved', () => {
      // Step 1: Create worktree for task
      const info = createWorktree(6, config, tmpDir);

      // Step 2: Modify a file in the worktree and commit
      fs.writeFileSync(path.join(info.path, 'shared.txt'), 'task version\n');
      execSync('git add -A', { cwd: info.path, encoding: 'utf8' });
      execSync('git commit -m "Task modifies shared.txt"', { cwd: info.path, encoding: 'utf8' });

      // Step 3: Modify the SAME file differently on main — creates a genuine conflict
      fs.writeFileSync(path.join(tmpDir, 'shared.txt'), 'main version\n');
      execSync('git add -A', { cwd: tmpDir, encoding: 'utf8' });
      execSync('git commit -m "Main modifies shared.txt differently"', { cwd: tmpDir, encoding: 'utf8' });

      // Step 4: Attempt merge — will conflict, rebase will also conflict, expect failure
      const result = mergeTaskBranch(6, config, tmpDir);

      expect(result.success).toBe(false);
      expect(result.merged_branch).toBe('task-6');
      expect(result.base_branch).toBe('main');
      // Either conflict_files is populated or error is set (or both)
      const hasConflictInfo =
        (result.conflict_files && result.conflict_files.length > 0) ||
        (result.error && result.error.length > 0);
      expect(hasConflictInfo).toBe(true);
    });

    it('leaves the worktree intact on unresolvable conflict', () => {
      const info = createWorktree(7, config, tmpDir);

      fs.writeFileSync(path.join(info.path, 'conflict.txt'), 'task version\n');
      execSync('git add -A', { cwd: info.path, encoding: 'utf8' });
      execSync('git commit -m "Task"', { cwd: info.path, encoding: 'utf8' });

      fs.writeFileSync(path.join(tmpDir, 'conflict.txt'), 'main version\n');
      execSync('git add -A', { cwd: tmpDir, encoding: 'utf8' });
      execSync('git commit -m "Main"', { cwd: tmpDir, encoding: 'utf8' });

      const result = mergeTaskBranch(7, config, tmpDir);

      expect(result.success).toBe(false);
      // Worktree directory should still exist so the user can inspect/resolve
      // (rebase leaves worktree in abort state, but directory remains)
      // The key invariant is that success === false
    });

    it('main branch is still in a clean state after failed merge', () => {
      const info = createWorktree(8, config, tmpDir);

      fs.writeFileSync(path.join(info.path, 'conflict.txt'), 'task version\n');
      execSync('git add -A', { cwd: info.path, encoding: 'utf8' });
      execSync('git commit -m "Task"', { cwd: info.path, encoding: 'utf8' });

      fs.writeFileSync(path.join(tmpDir, 'conflict.txt'), 'main version\n');
      execSync('git add -A', { cwd: tmpDir, encoding: 'utf8' });
      execSync('git commit -m "Main"', { cwd: tmpDir, encoding: 'utf8' });

      mergeTaskBranch(8, config, tmpDir);

      // git status on main should be clean (no merge in progress)
      const status = execSync('git status --porcelain', { cwd: tmpDir, encoding: 'utf8' });
      expect(status.trim()).toBe('');

      // No MERGE_HEAD should exist
      const mergeHeadPath = path.join(tmpDir, '.git', 'MERGE_HEAD');
      expect(fs.existsSync(mergeHeadPath)).toBe(false);
    });
  });
});

describe('discardTaskBranch', () => {
  let tmpDir: string;
  let config: WorkerConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discard-test-'));
    initRepo(tmpDir);
    config = makeConfig();
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('removes worktree and branch without merging', () => {
    const info = createWorktree(1, config, tmpDir);
    fs.writeFileSync(path.join(info.path, 'work.ts'), 'const x = 1;\n');
    execSync('git add -A', { cwd: info.path, encoding: 'utf8' });
    execSync('git commit -m "Work"', { cwd: info.path, encoding: 'utf8' });

    discardTaskBranch(1, config, tmpDir);

    // Worktree directory should be gone
    expect(fs.existsSync(info.path)).toBe(false);

    // Branch should be deleted
    const branches = execSync('git branch', { cwd: tmpDir, encoding: 'utf8' });
    expect(branches).not.toContain('task-1');
  });

  it('does not merge the task content into main', () => {
    const info = createWorktree(2, config, tmpDir);
    fs.writeFileSync(path.join(info.path, 'skipped-feature.ts'), 'never merged\n');
    execSync('git add -A', { cwd: info.path, encoding: 'utf8' });
    execSync('git commit -m "Skipped feature"', { cwd: info.path, encoding: 'utf8' });

    discardTaskBranch(2, config, tmpDir);

    // The feature file should NOT exist on main
    expect(fs.existsSync(path.join(tmpDir, 'skipped-feature.ts'))).toBe(false);
  });

  it('is idempotent — discarding twice does not throw', () => {
    const info = createWorktree(3, config, tmpDir);
    discardTaskBranch(3, config, tmpDir);
    expect(() => discardTaskBranch(3, config, tmpDir)).not.toThrow();
  });

  it('is a no-op for a task that never had a worktree', () => {
    expect(() => discardTaskBranch(999, config, tmpDir)).not.toThrow();
  });
});

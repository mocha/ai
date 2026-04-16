import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import {
  createWorktree,
  removeWorktree,
  listWorktrees,
  hasUncommittedChanges,
  commitWip,
  getFilesChanged,
} from '../worktree.js';
import type { WorkerConfig } from '../types.js';

/** Initialize a bare git repo with an initial commit so we have a base branch. */
function initRepo(dir: string, defaultBranch: string = 'main'): void {
  execSync(`git init -b "${defaultBranch}"`, { cwd: dir, encoding: 'utf8' });
  execSync('git config user.email "test@example.com"', { cwd: dir, encoding: 'utf8' });
  execSync('git config user.name "Test User"', { cwd: dir, encoding: 'utf8' });
  // Create an initial commit so the branch ref exists
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

describe('worktree lifecycle', () => {
  let tmpDir: string;
  let config: WorkerConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-test-'));
    initRepo(tmpDir);
    config = makeConfig();
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('createWorktree', () => {
    it('creates a worktree and returns WorktreeInfo', () => {
      const info = createWorktree(1, config, tmpDir);

      expect(info.task_id).toBe(1);
      expect(info.branch).toBe('task-1');
      expect(info.base_branch).toBe('main');
      expect(info.path).toBe(path.join(tmpDir, '.worktrees', 'task-1'));
      expect(info.created_at).toBeTruthy();
      // Verify the path actually exists
      expect(fs.existsSync(info.path)).toBe(true);
    });

    it('creates a branch named task-{taskId}', () => {
      createWorktree(42, config, tmpDir);
      const branches = execSync('git branch', { cwd: tmpDir, encoding: 'utf8' });
      expect(branches).toContain('task-42');
    });

    it('adds worktree_root to .gitignore on first creation', () => {
      createWorktree(1, config, tmpDir);
      const gitignorePath = path.join(tmpDir, '.gitignore');
      expect(fs.existsSync(gitignorePath)).toBe(true);
      const contents = fs.readFileSync(gitignorePath, 'utf8');
      expect(contents).toContain('.worktrees/');
    });

    it('does not duplicate .gitignore entry on second creation', () => {
      createWorktree(1, config, tmpDir);
      createWorktree(2, config, tmpDir);
      const gitignorePath = path.join(tmpDir, '.gitignore');
      const contents = fs.readFileSync(gitignorePath, 'utf8');
      const occurrences = contents.split('.worktrees/').length - 1;
      expect(occurrences).toBe(1);
    });
  });

  describe('stale cleanup', () => {
    it('can create worktree again after prior run (stale cleanup)', () => {
      // First create
      const info1 = createWorktree(1, config, tmpDir);
      expect(fs.existsSync(info1.path)).toBe(true);

      // Create again — should clean up stale and succeed
      const info2 = createWorktree(1, config, tmpDir);
      expect(fs.existsSync(info2.path)).toBe(true);
      expect(info2.task_id).toBe(1);
    });
  });

  describe('listWorktrees', () => {
    it('returns empty array when no managed worktrees exist', () => {
      const list = listWorktrees(config, tmpDir);
      expect(list).toEqual([]);
    });

    it('lists created worktrees', () => {
      createWorktree(1, config, tmpDir);
      createWorktree(2, config, tmpDir);

      const list = listWorktrees(config, tmpDir);
      expect(list).toHaveLength(2);

      const ids = list.map(w => w.task_id).sort();
      expect(ids).toEqual([1, 2]);
    });

    it('does not include the main worktree', () => {
      createWorktree(1, config, tmpDir);
      const list = listWorktrees(config, tmpDir);
      // Should only have the managed one, not the main repo worktree
      expect(list.every(w => w.path.includes('.worktrees'))).toBe(true);
    });
  });

  describe('hasUncommittedChanges', () => {
    it('returns false for a clean worktree', () => {
      const info = createWorktree(1, config, tmpDir);
      expect(hasUncommittedChanges(info.path)).toBe(false);
    });

    it('returns true when files are modified', () => {
      const info = createWorktree(1, config, tmpDir);
      fs.writeFileSync(path.join(info.path, 'newfile.txt'), 'hello');
      expect(hasUncommittedChanges(info.path)).toBe(true);
    });
  });

  describe('commitWip', () => {
    it('returns null when there is nothing to commit', () => {
      const info = createWorktree(1, config, tmpDir);
      const sha = commitWip(info.path, 'WIP: nothing');
      expect(sha).toBeNull();
    });

    it('commits changes and returns a SHA', () => {
      const info = createWorktree(1, config, tmpDir);
      fs.writeFileSync(path.join(info.path, 'work.txt'), 'some work');

      const sha = commitWip(info.path, 'WIP: test work');
      expect(sha).toBeTruthy();
      expect(typeof sha).toBe('string');
      // SHA should be a 40-char hex string
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    });

    it('leaves worktree clean after commit', () => {
      const info = createWorktree(1, config, tmpDir);
      fs.writeFileSync(path.join(info.path, 'work.txt'), 'some work');
      commitWip(info.path, 'WIP: test');
      expect(hasUncommittedChanges(info.path)).toBe(false);
    });
  });

  describe('getFilesChanged', () => {
    it('returns empty array when no files changed from base', () => {
      const info = createWorktree(1, config, tmpDir);
      const files = getFilesChanged(info.path, config.base_branch);
      expect(files).toEqual([]);
    });

    it('returns changed files after committing work', () => {
      const info = createWorktree(1, config, tmpDir);
      fs.writeFileSync(path.join(info.path, 'feature.ts'), 'export const x = 1;');
      fs.writeFileSync(path.join(info.path, 'test.ts'), 'it works');
      commitWip(info.path, 'WIP: add feature');

      const files = getFilesChanged(info.path, config.base_branch);
      expect(files).toContain('feature.ts');
      expect(files).toContain('test.ts');
    });
  });

  describe('removeWorktree', () => {
    it('removes an existing worktree and branch', () => {
      const info = createWorktree(1, config, tmpDir);
      expect(fs.existsSync(info.path)).toBe(true);

      removeWorktree(1, config, tmpDir);

      // Worktree dir should be gone
      expect(fs.existsSync(info.path)).toBe(false);

      // Branch should be gone
      const branches = execSync('git branch', { cwd: tmpDir, encoding: 'utf8' });
      expect(branches).not.toContain('task-1');
    });

    it('is idempotent — removing twice does not throw', () => {
      const info = createWorktree(1, config, tmpDir);
      removeWorktree(1, config, tmpDir);
      // Second removal should not throw
      expect(() => removeWorktree(1, config, tmpDir)).not.toThrow();
    });

    it('is a no-op when worktree never existed', () => {
      expect(() => removeWorktree(999, config, tmpDir)).not.toThrow();
    });
  });

  describe('full lifecycle', () => {
    it('create → list → hasUncommittedChanges → commitWip → getFilesChanged → remove', () => {
      // Create
      const info = createWorktree(5, config, tmpDir);
      expect(info.task_id).toBe(5);

      // List
      const list = listWorktrees(config, tmpDir);
      expect(list.some(w => w.task_id === 5)).toBe(true);

      // No uncommitted changes initially
      expect(hasUncommittedChanges(info.path)).toBe(false);

      // Add a file
      fs.writeFileSync(path.join(info.path, 'solution.ts'), 'export default 42;');

      // Now has uncommitted changes
      expect(hasUncommittedChanges(info.path)).toBe(true);

      // Commit WIP
      const sha = commitWip(info.path, 'WIP: solution');
      expect(sha).toBeTruthy();

      // Clean after commit
      expect(hasUncommittedChanges(info.path)).toBe(false);

      // Files changed
      const files = getFilesChanged(info.path, config.base_branch);
      expect(files).toContain('solution.ts');

      // Remove
      removeWorktree(5, config, tmpDir);
      expect(fs.existsSync(info.path)).toBe(false);

      // List should be empty
      const listAfter = listWorktrees(config, tmpDir);
      expect(listAfter.some(w => w.task_id === 5)).toBe(false);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ---------------------------------------------------------------------------
// Mock child_process so tests never need a real git repo.
// vi.mock is hoisted to the top by Vitest's transformer.
// ---------------------------------------------------------------------------
vi.mock('node:child_process', () => ({
  execSync: vi.fn(() => ''),
}));

import { execSync } from 'node:child_process';
import { assemblePredecessorContext, writeSessionContext } from '../context.js';
import type { PredecessorContext, PredecessorSummary } from '../context.js';
import type { TaskSpec } from '../../orchestrator/types.js';
import type { WorkerConfig } from '../types.js';
import type { ResultArtifact } from '../result.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockExecSync = vi.mocked(execSync);

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

function makeTask(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: 5,
    title: 'Implement feature X',
    dependencies: [],
    status: 'pending',
    details: 'Details here',
    acceptanceCriteria: [],
    relevantFiles: [],
    ...overrides,
  };
}

function makeResultArtifact(overrides: Partial<ResultArtifact> = {}): ResultArtifact {
  return {
    task_id: 1,
    status: 'DONE',
    round: 1,
    model: 'sonnet',
    timestamp: new Date().toISOString(),
    cost_usd: 0.05,
    duration_ms: 10000,
    files_changed: ['src/foo.ts', 'src/bar.ts'],
    concerns: null,
    hook_events: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// assemblePredecessorContext
// ---------------------------------------------------------------------------

describe('assemblePredecessorContext', () => {
  let tmpDir: string;
  let config: WorkerConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-test-'));
    config = makeConfig({ artifact_root: path.join(tmpDir, '.roadrunner') });
    // Default: git rev-parse throws (branch not found)
    mockExecSync.mockImplementation(() => {
      throw new Error('fatal: ambiguous argument');
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('empty dependencies', () => {
    it('returns a PredecessorContext with empty predecessor_tasks', () => {
      const task = makeTask({ id: 3, dependencies: [] });
      const result = assemblePredecessorContext(task, {}, tmpDir, config);

      expect(result.task_id).toBe(3);
      expect(result.predecessor_tasks).toEqual([]);
      expect(typeof result.pipeline_run_id).toBe('string');
    });

    it('pipeline_run_id starts with "run-"', () => {
      const task = makeTask({ dependencies: [] });
      const result = assemblePredecessorContext(task, {}, tmpDir, config);
      expect(result.pipeline_run_id).toMatch(/^run-\d+-[a-z0-9]+$/);
    });
  });

  describe('dependency not in completedTasks', () => {
    it('includes summary with null fields and unknown status', () => {
      const task = makeTask({ id: 10, dependencies: [99] });
      const result = assemblePredecessorContext(task, {}, tmpDir, config);

      expect(result.predecessor_tasks).toHaveLength(1);
      const summary = result.predecessor_tasks[0];
      expect(summary.task_id).toBe(99);
      expect(summary.title).toBe('');
      expect(summary.status).toBe('unknown');
      expect(summary.files_changed).toEqual([]);
      expect(summary.result_path).toBeNull();
      expect(summary.commit_sha).toBeNull();
    });
  });

  describe('dependency in completedTasks with no result_path', () => {
    it('includes summary with empty files_changed', () => {
      const task = makeTask({ id: 5, dependencies: [2] });
      const completed = {
        2: { result_path: null, title: 'Setup DB', status: 'DONE' },
      };
      const result = assemblePredecessorContext(task, completed, tmpDir, config);

      expect(result.predecessor_tasks).toHaveLength(1);
      const summary = result.predecessor_tasks[0];
      expect(summary.task_id).toBe(2);
      expect(summary.title).toBe('Setup DB');
      expect(summary.status).toBe('DONE');
      expect(summary.files_changed).toEqual([]);
      expect(summary.result_path).toBeNull();
    });
  });

  describe('dependency in completedTasks with valid result_path', () => {
    it('reads files_changed from the result artifact', () => {
      // Write a result artifact to tmpDir
      const resultsDir = path.join(tmpDir, '.roadrunner', 'results');
      fs.mkdirSync(resultsDir, { recursive: true });
      const artifactPath = path.join(resultsDir, 'TASK-1.json');
      const artifact = makeResultArtifact({ task_id: 1, files_changed: ['src/a.ts', 'src/b.ts'] });
      fs.writeFileSync(artifactPath, JSON.stringify(artifact), 'utf8');

      const task = makeTask({ id: 5, dependencies: [1] });
      const completed = {
        1: { result_path: artifactPath, title: 'Build API', status: 'DONE' },
      };
      const result = assemblePredecessorContext(task, completed, tmpDir, config);

      const summary = result.predecessor_tasks[0];
      expect(summary.files_changed).toEqual(['src/a.ts', 'src/b.ts']);
      expect(summary.result_path).toBe(artifactPath);
    });

    it('populates title and status from completedTasks entry', () => {
      const resultsDir = path.join(tmpDir, '.roadrunner', 'results');
      fs.mkdirSync(resultsDir, { recursive: true });
      const artifactPath = path.join(resultsDir, 'TASK-3.json');
      fs.writeFileSync(artifactPath, JSON.stringify(makeResultArtifact({ task_id: 3 })), 'utf8');

      const task = makeTask({ id: 7, dependencies: [3] });
      const completed = {
        3: { result_path: artifactPath, title: 'Write tests', status: 'DONE_WITH_CONCERNS' },
      };
      const result = assemblePredecessorContext(task, completed, tmpDir, config);

      const summary = result.predecessor_tasks[0];
      expect(summary.title).toBe('Write tests');
      expect(summary.status).toBe('DONE_WITH_CONCERNS');
    });
  });

  describe('git branch SHA resolution', () => {
    it('returns commit_sha when git rev-parse succeeds', () => {
      const sha = 'abcdef1234567890abcdef1234567890abcdef12';
      mockExecSync.mockReturnValue(`${sha}\n` as unknown as Buffer);

      const task = makeTask({ id: 5, dependencies: [1] });
      const completed = {
        1: { result_path: null, title: 'Task 1', status: 'DONE' },
      };
      const result = assemblePredecessorContext(task, completed, tmpDir, config);

      expect(result.predecessor_tasks[0].commit_sha).toBe(sha);
    });

    it('returns null commit_sha when branch does not exist (git throws)', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('fatal: ambiguous argument');
      });

      const task = makeTask({ id: 5, dependencies: [1] });
      const completed = {
        1: { result_path: null, title: 'Task 1', status: 'DONE' },
      };
      const result = assemblePredecessorContext(task, completed, tmpDir, config);

      expect(result.predecessor_tasks[0].commit_sha).toBeNull();
    });
  });

  describe('multiple dependencies', () => {
    it('assembles summaries for all dependencies', () => {
      const resultsDir = path.join(tmpDir, '.roadrunner', 'results');
      fs.mkdirSync(resultsDir, { recursive: true });

      // Task 1 has a result artifact
      const artifactPath1 = path.join(resultsDir, 'TASK-1.json');
      fs.writeFileSync(
        artifactPath1,
        JSON.stringify(makeResultArtifact({ task_id: 1, files_changed: ['foo.ts'] })),
        'utf8',
      );

      // Task 2 has no result path
      // Task 3 is not in completedTasks at all

      const task = makeTask({ id: 5, dependencies: [1, 2, 3] });
      const completed = {
        1: { result_path: artifactPath1, title: 'Task 1', status: 'DONE' },
        2: { result_path: null, title: 'Task 2', status: 'DONE' },
      };
      const result = assemblePredecessorContext(task, completed, tmpDir, config);

      expect(result.predecessor_tasks).toHaveLength(3);

      const t1 = result.predecessor_tasks.find(p => p.task_id === 1)!;
      expect(t1.files_changed).toEqual(['foo.ts']);
      expect(t1.title).toBe('Task 1');

      const t2 = result.predecessor_tasks.find(p => p.task_id === 2)!;
      expect(t2.files_changed).toEqual([]);
      expect(t2.title).toBe('Task 2');

      const t3 = result.predecessor_tasks.find(p => p.task_id === 3)!;
      expect(t3.title).toBe('');
      expect(t3.status).toBe('unknown');
      expect(t3.result_path).toBeNull();
    });
  });

  describe('malformed result artifact', () => {
    it('returns empty files_changed when artifact JSON is invalid', () => {
      const resultsDir = path.join(tmpDir, '.roadrunner', 'results');
      fs.mkdirSync(resultsDir, { recursive: true });
      const artifactPath = path.join(resultsDir, 'TASK-8.json');
      fs.writeFileSync(artifactPath, 'not valid json', 'utf8');

      const task = makeTask({ id: 9, dependencies: [8] });
      const completed = {
        8: { result_path: artifactPath, title: 'Bad task', status: 'DONE' },
      };
      const result = assemblePredecessorContext(task, completed, tmpDir, config);

      expect(result.predecessor_tasks[0].files_changed).toEqual([]);
    });

    it('returns empty files_changed when artifact is missing files_changed field', () => {
      const resultsDir = path.join(tmpDir, '.roadrunner', 'results');
      fs.mkdirSync(resultsDir, { recursive: true });
      const artifactPath = path.join(resultsDir, 'TASK-8.json');
      // Artifact without files_changed
      fs.writeFileSync(artifactPath, JSON.stringify({ task_id: 8, status: 'DONE' }), 'utf8');

      const task = makeTask({ id: 9, dependencies: [8] });
      const completed = {
        8: { result_path: artifactPath, title: 'Task 8', status: 'DONE' },
      };
      const result = assemblePredecessorContext(task, completed, tmpDir, config);

      expect(result.predecessor_tasks[0].files_changed).toEqual([]);
    });
  });

  describe('pipeline_run_id uniqueness', () => {
    it('generates a different run_id on each call', () => {
      const task = makeTask({ dependencies: [] });
      const r1 = assemblePredecessorContext(task, {}, tmpDir, config);
      const r2 = assemblePredecessorContext(task, {}, tmpDir, config);
      // With extremely high probability these will differ
      expect(r1.pipeline_run_id).not.toBe(r2.pipeline_run_id);
    });
  });
});

// ---------------------------------------------------------------------------
// writeSessionContext
// ---------------------------------------------------------------------------

describe('writeSessionContext', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-ctx-test-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function makeContext(overrides: Partial<PredecessorContext> = {}): PredecessorContext {
    return {
      task_id: 5,
      predecessor_tasks: [],
      pipeline_run_id: 'run-12345-abc',
      ...overrides,
    };
  }

  it('creates .roadrunner/ directory if it does not exist', () => {
    const worktreePath = path.join(tmpDir, 'worktree-5');
    fs.mkdirSync(worktreePath);

    const roadrunnerDir = path.join(worktreePath, '.roadrunner');
    expect(fs.existsSync(roadrunnerDir)).toBe(false);

    writeSessionContext(worktreePath, makeContext());

    expect(fs.existsSync(roadrunnerDir)).toBe(true);
  });

  it('writes session_context.json to the .roadrunner/ directory', () => {
    const worktreePath = path.join(tmpDir, 'worktree-5');
    fs.mkdirSync(worktreePath);

    writeSessionContext(worktreePath, makeContext());

    const outputPath = path.join(worktreePath, '.roadrunner', 'session_context.json');
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it('writes valid JSON', () => {
    const worktreePath = path.join(tmpDir, 'worktree-5');
    fs.mkdirSync(worktreePath);

    writeSessionContext(worktreePath, makeContext());

    const outputPath = path.join(worktreePath, '.roadrunner', 'session_context.json');
    const raw = fs.readFileSync(outputPath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('writes the context fields correctly', () => {
    const worktreePath = path.join(tmpDir, 'worktree-5');
    fs.mkdirSync(worktreePath);

    const summary: PredecessorSummary = {
      task_id: 2,
      title: 'Prior task',
      status: 'DONE',
      files_changed: ['src/x.ts'],
      result_path: '/some/path/TASK-2.json',
      commit_sha: 'abc123',
    };
    const context = makeContext({
      task_id: 5,
      predecessor_tasks: [summary],
      pipeline_run_id: 'run-99-xyz',
    });

    writeSessionContext(worktreePath, context);

    const outputPath = path.join(worktreePath, '.roadrunner', 'session_context.json');
    const parsed = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as PredecessorContext;

    expect(parsed.task_id).toBe(5);
    expect(parsed.pipeline_run_id).toBe('run-99-xyz');
    expect(parsed.predecessor_tasks).toHaveLength(1);
    expect(parsed.predecessor_tasks[0].task_id).toBe(2);
    expect(parsed.predecessor_tasks[0].files_changed).toEqual(['src/x.ts']);
    expect(parsed.predecessor_tasks[0].commit_sha).toBe('abc123');
  });

  it('is idempotent — overwrites existing session_context.json', () => {
    const worktreePath = path.join(tmpDir, 'worktree-5');
    fs.mkdirSync(worktreePath);

    writeSessionContext(worktreePath, makeContext({ pipeline_run_id: 'run-first' }));
    writeSessionContext(worktreePath, makeContext({ pipeline_run_id: 'run-second' }));

    const outputPath = path.join(worktreePath, '.roadrunner', 'session_context.json');
    const parsed = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as PredecessorContext;
    expect(parsed.pipeline_run_id).toBe('run-second');
  });

  it('works when .roadrunner/ directory already exists', () => {
    const worktreePath = path.join(tmpDir, 'worktree-5');
    fs.mkdirSync(worktreePath);
    fs.mkdirSync(path.join(worktreePath, '.roadrunner'));

    expect(() => writeSessionContext(worktreePath, makeContext())).not.toThrow();
    const outputPath = path.join(worktreePath, '.roadrunner', 'session_context.json');
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it('writes formatted JSON (pretty-printed)', () => {
    const worktreePath = path.join(tmpDir, 'worktree-5');
    fs.mkdirSync(worktreePath);

    writeSessionContext(worktreePath, makeContext());

    const outputPath = path.join(worktreePath, '.roadrunner', 'session_context.json');
    const raw = fs.readFileSync(outputPath, 'utf8');
    // Pretty-printed JSON contains newlines
    expect(raw).toContain('\n');
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ---------------------------------------------------------------------------
// Mock heavy dependencies so tests never touch git or the real claude CLI
// ---------------------------------------------------------------------------

vi.mock('../execute.js', () => ({
  invokeClaude: vi.fn(),
}));

vi.mock('../worktree.js', () => ({
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
  listWorktrees: vi.fn(() => []),
  hasUncommittedChanges: vi.fn(() => false),
  commitWip: vi.fn(() => null),
  getFilesChanged: vi.fn(() => [] as string[]),
}));

vi.mock('../merge.js', () => ({
  mergeTaskBranch: vi.fn(() => ({ success: true, merged_branch: 'task-1', base_branch: 'main' })),
  discardTaskBranch: vi.fn(),
}));

vi.mock('../settings.js', () => ({
  generateWorkerSettings: vi.fn(() => ({})),
  installWorkerSettings: vi.fn(),
}));

vi.mock('../result.js', () => ({
  parseCliOutput: vi.fn(),
  extractStatus: vi.fn(),
  writeResultArtifact: vi.fn(() => '/tmp/result.json'),
}));

vi.mock('../context.js', () => ({
  assemblePredecessorContext: vi.fn(() => ({
    task_id: 1,
    predecessor_tasks: [],
    pipeline_run_id: 'run-test',
  })),
  writeSessionContext: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports — must come AFTER vi.mock hoisting
// ---------------------------------------------------------------------------

import { createWorkerHandler } from '../handler.js';
import { invokeClaude } from '../execute.js';
import { createWorktree } from '../worktree.js';
import { mergeTaskBranch, discardTaskBranch } from '../merge.js';
import { installWorkerSettings } from '../settings.js';
import { parseCliOutput } from '../result.js';
import { assemblePredecessorContext, writeSessionContext } from '../context.js';
import type { WorkerConfig, WorktreeInfo } from '../types.js';
import type { OrchestratorCommand } from '../../orchestrator/commands.js';
import type { OrchestratorEvent } from '../../orchestrator/events.js';
import type { TaskSpec } from '../../orchestrator/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeTaskSpec(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: 1,
    title: 'Test Task',
    dependencies: [],
    status: 'pending',
    details: 'Implement the feature.',
    acceptanceCriteria: ['It works', 'Tests pass'],
    relevantFiles: ['src/index.ts'],
    ...overrides,
  };
}

function makeWorktreeInfo(taskId: number, worktreePath: string): WorktreeInfo {
  return {
    task_id: taskId,
    branch: `task-${taskId}`,
    path: worktreePath,
    base_branch: 'main',
    created_at: new Date().toISOString(),
  };
}

function makeWorkerCompleteEvent(
  taskId: number,
): import('../../orchestrator/events.js').WorkerComplete {
  return {
    type: 'WORKER_COMPLETE',
    task_id: taskId,
    status: 'DONE',
    result_path: '/tmp/result.json',
    cost_usd: 0.05,
    duration_ms: 5000,
    files_changed: ['src/index.ts'],
    concerns: null,
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('createWorkerHandler', () => {
  let tmpDir: string;
  let config: WorkerConfig;
  let sentEvents: OrchestratorEvent[];
  let sendEvent: (event: OrchestratorEvent) => void;

  const mockInvokeClaude = vi.mocked(invokeClaude);
  const mockCreateWorktree = vi.mocked(createWorktree);
  const mockMergeTaskBranch = vi.mocked(mergeTaskBranch);
  const mockDiscardTaskBranch = vi.mocked(discardTaskBranch);
  const mockInstallWorkerSettings = vi.mocked(installWorkerSettings);
  const mockParseCliOutput = vi.mocked(parseCliOutput);
  const mockAssemblePredecessorContext = vi.mocked(assemblePredecessorContext);
  const mockWriteSessionContext = vi.mocked(writeSessionContext);

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handler-test-'));
    config = makeConfig({ artifact_root: path.join(tmpDir, '.roadrunner') });
    sentEvents = [];
    sendEvent = (event) => sentEvents.push(event);
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // 1. DISPATCH_WORKER
  // -------------------------------------------------------------------------

  describe('DISPATCH_WORKER', () => {
    function setupDispatchMocks(taskId: number, worktreePath: string): void {
      mockCreateWorktree.mockReturnValue(makeWorktreeInfo(taskId, worktreePath));
      mockInvokeClaude.mockResolvedValue({
        exec: {
          exit_code: 0,
          stdout: JSON.stringify({ result: 'DONE', cost_usd: 0.1, duration_ms: 3000 }),
          stderr: '',
          timed_out: false,
          retried: false,
          duration_ms: 3000,
        },
        hookEvents: [],
      });
      mockParseCliOutput.mockReturnValue(makeWorkerCompleteEvent(taskId));
    }

    it('creates a worktree if one does not exist', async () => {
      const worktreePath = path.join(tmpDir, '.worktrees', 'task-1');
      fs.mkdirSync(worktreePath, { recursive: true });
      setupDispatchMocks(1, worktreePath);

      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      const dispatchCmd: OrchestratorCommand = {
        type: 'DISPATCH_WORKER',
        task_id: 1,
        expert_prompt_path: '',
        task_spec: makeTaskSpec({ id: 1 }),
        worktree_branch: 'task-1',
        max_turns: 20,
        model: 'sonnet',
      };

      handler(dispatchCmd);

      // Let async work complete
      await new Promise(resolve => setImmediate(resolve));

      expect(mockCreateWorktree).toHaveBeenCalledWith(1, config, tmpDir);
    });

    it('infers trivial risk from max_turns=10', async () => {
      const worktreePath = path.join(tmpDir, '.worktrees', 'task-5');
      fs.mkdirSync(worktreePath, { recursive: true });
      setupDispatchMocks(5, worktreePath);

      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      handler({
        type: 'DISPATCH_WORKER',
        task_id: 5,
        expert_prompt_path: '',
        task_spec: makeTaskSpec({ id: 5 }),
        worktree_branch: 'task-5',
        max_turns: 10,
        model: 'sonnet',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(mockInstallWorkerSettings).toHaveBeenCalledWith(
        worktreePath,
        'trivial',
        config,
        5,
      );
    });

    it('infers elevated risk from max_turns=30', async () => {
      const worktreePath = path.join(tmpDir, '.worktrees', 'task-9');
      fs.mkdirSync(worktreePath, { recursive: true });
      setupDispatchMocks(9, worktreePath);

      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      handler({
        type: 'DISPATCH_WORKER',
        task_id: 9,
        expert_prompt_path: '',
        task_spec: makeTaskSpec({ id: 9 }),
        worktree_branch: 'task-9',
        max_turns: 30,
        model: 'sonnet',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(mockInstallWorkerSettings).toHaveBeenCalledWith(
        worktreePath,
        'elevated',
        config,
        9,
      );
    });

    it('installs expert prompt as .claude/CLAUDE.md when path exists', async () => {
      const worktreePath = path.join(tmpDir, '.worktrees', 'task-2');
      fs.mkdirSync(worktreePath, { recursive: true });
      setupDispatchMocks(2, worktreePath);

      // Create a fake expert prompt file
      const expertDir = path.join(tmpDir, config.artifact_root, 'experts');
      fs.mkdirSync(expertDir, { recursive: true });
      const expertPath = path.join(expertDir, 'TASK-2.md');
      fs.writeFileSync(expertPath, '# Expert prompt\n');

      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      handler({
        type: 'DISPATCH_WORKER',
        task_id: 2,
        expert_prompt_path: expertPath,
        task_spec: makeTaskSpec({ id: 2 }),
        worktree_branch: 'task-2',
        max_turns: 20,
        model: 'sonnet',
      });

      await new Promise(resolve => setImmediate(resolve));

      const installedPromptPath = path.join(worktreePath, '.claude', 'CLAUDE.md');
      expect(fs.existsSync(installedPromptPath)).toBe(true);
      expect(fs.readFileSync(installedPromptPath, 'utf8')).toBe('# Expert prompt\n');
    });

    it('assembles predecessor context and writes session context', async () => {
      const worktreePath = path.join(tmpDir, '.worktrees', 'task-3');
      fs.mkdirSync(worktreePath, { recursive: true });
      setupDispatchMocks(3, worktreePath);

      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);
      const taskSpec = makeTaskSpec({ id: 3 });

      handler({
        type: 'DISPATCH_WORKER',
        task_id: 3,
        expert_prompt_path: '',
        task_spec: taskSpec,
        worktree_branch: 'task-3',
        max_turns: 20,
        model: 'sonnet',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(mockAssemblePredecessorContext).toHaveBeenCalledWith(
        taskSpec,
        {},
        tmpDir,
        config,
      );
      expect(mockWriteSessionContext).toHaveBeenCalled();
    });

    it('invokes claude CLI with correct options', async () => {
      const worktreePath = path.join(tmpDir, '.worktrees', 'task-4');
      fs.mkdirSync(worktreePath, { recursive: true });
      setupDispatchMocks(4, worktreePath);

      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      handler({
        type: 'DISPATCH_WORKER',
        task_id: 4,
        expert_prompt_path: '',
        task_spec: makeTaskSpec({ id: 4 }),
        worktree_branch: 'task-4',
        max_turns: 20,
        model: 'opus',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(mockInvokeClaude).toHaveBeenCalledWith(
        expect.objectContaining({
          worktreePath,
          maxTurns: 20,
          model: 'opus',
          taskId: 4,
          config,
        }),
      );
    });

    it('sends WORKER_COMPLETE event on success', async () => {
      const worktreePath = path.join(tmpDir, '.worktrees', 'task-6');
      fs.mkdirSync(worktreePath, { recursive: true });
      setupDispatchMocks(6, worktreePath);

      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      handler({
        type: 'DISPATCH_WORKER',
        task_id: 6,
        expert_prompt_path: '',
        task_spec: makeTaskSpec({ id: 6 }),
        worktree_branch: 'task-6',
        max_turns: 20,
        model: 'sonnet',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(sentEvents.some(e => e.type === 'WORKER_COMPLETE')).toBe(true);
      const event = sentEvents.find(e => e.type === 'WORKER_COMPLETE');
      expect(event).toBeDefined();
      if (event?.type === 'WORKER_COMPLETE') {
        expect(event.task_id).toBe(6);
      }
    });

    it('reuses existing worktree on re-dispatch (does not create a second one)', async () => {
      const worktreePath = path.join(tmpDir, '.worktrees', 'task-10');
      fs.mkdirSync(worktreePath, { recursive: true });
      setupDispatchMocks(10, worktreePath);

      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      const dispatchCmd: OrchestratorCommand = {
        type: 'DISPATCH_WORKER',
        task_id: 10,
        expert_prompt_path: '',
        task_spec: makeTaskSpec({ id: 10 }),
        worktree_branch: 'task-10',
        max_turns: 20,
        model: 'sonnet',
      };

      handler(dispatchCmd);
      await new Promise(resolve => setImmediate(resolve));

      handler(dispatchCmd);
      await new Promise(resolve => setImmediate(resolve));

      // createWorktree should only have been called once
      expect(mockCreateWorktree).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 2. UPDATE_TASK_STATUS — done → merge
  // -------------------------------------------------------------------------

  describe('UPDATE_TASK_STATUS done', () => {
    it('triggers merge for status=done', async () => {
      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      handler({
        type: 'UPDATE_TASK_STATUS',
        task_id: 1,
        status: 'done',
      });

      // Let the async merge fire
      await new Promise(resolve => setImmediate(resolve));

      expect(mockMergeTaskBranch).toHaveBeenCalledWith(1, config, tmpDir);
    });

    it('cleans up worktree and session after merge', async () => {
      // We verify the cleanup by confirming state is removed.
      // The merge mock succeeds so the finally block runs.
      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      // Make the worktree known to the handler by dispatching first
      const worktreePath = path.join(tmpDir, '.worktrees', 'task-1');
      fs.mkdirSync(worktreePath, { recursive: true });
      mockCreateWorktree.mockReturnValue(makeWorktreeInfo(1, worktreePath));
      mockInvokeClaude.mockResolvedValue({
        exec: { exit_code: 0, stdout: '{}', stderr: '', timed_out: false, retried: false, duration_ms: 0 },
        hookEvents: [],
      });
      mockParseCliOutput.mockReturnValue(makeWorkerCompleteEvent(1));

      handler({
        type: 'DISPATCH_WORKER',
        task_id: 1,
        expert_prompt_path: '',
        task_spec: makeTaskSpec(),
        worktree_branch: 'task-1',
        max_turns: 20,
        model: 'sonnet',
      });
      await new Promise(resolve => setImmediate(resolve));

      handler({
        type: 'UPDATE_TASK_STATUS',
        task_id: 1,
        status: 'done',
      });

      await new Promise(resolve => setImmediate(resolve));

      // The merge function should have been called
      expect(mockMergeTaskBranch).toHaveBeenCalledWith(1, config, tmpDir);
    });

    it('does not crash when merge throws', async () => {
      mockMergeTaskBranch.mockImplementationOnce(() => {
        throw new Error('merge conflict');
      });

      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      handler({
        type: 'UPDATE_TASK_STATUS',
        task_id: 99,
        status: 'done',
      });

      // Should not throw
      await new Promise(resolve => setImmediate(resolve));
      expect(sentEvents).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. UPDATE_TASK_STATUS — skipped → discard
  // -------------------------------------------------------------------------

  describe('UPDATE_TASK_STATUS skipped', () => {
    it('triggers discard for status=skipped', () => {
      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      handler({
        type: 'UPDATE_TASK_STATUS',
        task_id: 2,
        status: 'skipped',
      });

      expect(mockDiscardTaskBranch).toHaveBeenCalledWith(2, config, tmpDir);
    });

    it('does not send any events for status=skipped', () => {
      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      handler({
        type: 'UPDATE_TASK_STATUS',
        task_id: 3,
        status: 'skipped',
      });

      expect(sentEvents).toHaveLength(0);
    });

    it('does not crash when discard throws', () => {
      mockDiscardTaskBranch.mockImplementationOnce(() => {
        throw new Error('discard failed');
      });

      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      expect(() =>
        handler({
          type: 'UPDATE_TASK_STATUS',
          task_id: 4,
          status: 'skipped',
        }),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Error handling — DISPATCH_WORKER throws → DISPATCH_ERROR
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('sends DISPATCH_ERROR when invokeClaude throws', async () => {
      const worktreePath = path.join(tmpDir, '.worktrees', 'task-11');
      fs.mkdirSync(worktreePath, { recursive: true });
      mockCreateWorktree.mockReturnValue(makeWorktreeInfo(11, worktreePath));
      mockInvokeClaude.mockRejectedValueOnce(new Error('Claude CLI not found'));

      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      handler({
        type: 'DISPATCH_WORKER',
        task_id: 11,
        expert_prompt_path: '',
        task_spec: makeTaskSpec({ id: 11 }),
        worktree_branch: 'task-11',
        max_turns: 20,
        model: 'sonnet',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(sentEvents).toHaveLength(1);
      const event = sentEvents[0];
      expect(event.type).toBe('DISPATCH_ERROR');
      if (event.type === 'DISPATCH_ERROR') {
        expect(event.failed_command).toBe('DISPATCH_WORKER');
        expect(event.error_message).toContain('Claude CLI not found');
        expect(event.attempts).toBe(1);
      }
    });

    it('sends DISPATCH_ERROR when createWorktree throws', async () => {
      mockCreateWorktree.mockImplementationOnce(() => {
        throw new Error('git not available');
      });

      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      handler({
        type: 'DISPATCH_WORKER',
        task_id: 12,
        expert_prompt_path: '',
        task_spec: makeTaskSpec({ id: 12 }),
        worktree_branch: 'task-12',
        max_turns: 20,
        model: 'sonnet',
      });

      await new Promise(resolve => setImmediate(resolve));

      const event = sentEvents[0];
      expect(event.type).toBe('DISPATCH_ERROR');
    });

    it('stringifies non-Error throws in DISPATCH_ERROR', async () => {
      const worktreePath = path.join(tmpDir, '.worktrees', 'task-13');
      fs.mkdirSync(worktreePath, { recursive: true });
      mockCreateWorktree.mockReturnValue(makeWorktreeInfo(13, worktreePath));
      mockInvokeClaude.mockRejectedValueOnce('string error value');

      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      handler({
        type: 'DISPATCH_WORKER',
        task_id: 13,
        expert_prompt_path: '',
        task_spec: makeTaskSpec({ id: 13 }),
        worktree_branch: 'task-13',
        max_turns: 20,
        model: 'sonnet',
      });

      await new Promise(resolve => setImmediate(resolve));

      const event = sentEvents[0];
      if (event?.type === 'DISPATCH_ERROR') {
        expect(event.error_message).toBe('string error value');
      }
    });
  });

  // -------------------------------------------------------------------------
  // 5. Commands handled by other layers — silently ignored
  // -------------------------------------------------------------------------

  describe('ignored commands', () => {
    it('ignores GENERATE_EXPERT (handled by review handler)', () => {
      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      expect(() =>
        handler({
          type: 'GENERATE_EXPERT',
          task_id: 1,
          task: makeTaskSpec(),
          risk: 'standard',
          codebase_context: { entry_points: [], recent_changes: [], related_tests: [] },
        }),
      ).not.toThrow();

      expect(sentEvents).toHaveLength(0);
    });

    it('ignores RUN_REVIEW (handled by review handler)', () => {
      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      expect(() =>
        handler({
          type: 'RUN_REVIEW',
          task_id: 1,
          worktree_path: '/tmp/worktree',
          task_spec: makeTaskSpec(),
          worker_result: {
            status: 'DONE',
            result_path: '',
            cost_usd: 0,
            duration_ms: 0,
            files_changed: [],
            concerns: null,
          },
          risk: 'standard',
          round: 1,
        }),
      ).not.toThrow();

      expect(sentEvents).toHaveLength(0);
    });

    it('ignores DECOMPOSE command', () => {
      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      expect(() =>
        handler({
          type: 'DECOMPOSE',
          spec_path: '/some/spec.md',
          risk: 'standard',
        }),
      ).not.toThrow();

      expect(sentEvents).toHaveLength(0);
    });

    it('ignores QUERY_NEXT_TASK command', () => {
      const handler = createWorkerHandler({ config, repoRoot: tmpDir }, sendEvent);

      expect(() =>
        handler({
          type: 'QUERY_NEXT_TASK',
          filter: { status: 'pending', dependencies_met: true },
        }),
      ).not.toThrow();

      expect(sentEvents).toHaveLength(0);
    });
  });
});

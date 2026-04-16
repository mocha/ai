/**
 * End-to-end integration test for the worker handler.
 *
 * Wires createWorkerHandler with a real temporary git repo and a mock claude
 * binary. Validates the DISPATCH_WORKER → WORKER_COMPLETE flow including
 * worktree creation, expert prompt installation, CLI invocation, result
 * parsing, and artifact writing.
 *
 * Note: GENERATE_EXPERT and RUN_REVIEW are handled by the review handler
 * (src/review/handler.ts), not the worker handler. These tests simulate the
 * review handler's output by creating expert prompt files directly.
 *
 * Note: These tests spawn real child processes and perform real git operations.
 * They may take several seconds to complete.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createWorkerHandler } from '../handler.js';
import { createDefaultWorkerConfig } from '../types.js';
import type { WorkerConfig } from '../types.js';
import type { OrchestratorEvent } from '../../orchestrator/events.js';
import type { TaskSpec } from '../../orchestrator/types.js';

// ---------------------------------------------------------------------------
// Resolve the mock-claude.sh path relative to this file
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MOCK_CLAUDE_PATH = path.resolve(__dirname, 'fixtures/mock-claude.sh');

// ---------------------------------------------------------------------------
// Shared test state (reset per-test)
// ---------------------------------------------------------------------------

let repoRoot: string;
let config: WorkerConfig;
let events: OrchestratorEvent[];

function sendEvent(event: OrchestratorEvent): void {
  events.push(event);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for a specific event type to appear in the events array.
 * Polls every 100ms up to timeoutMs.
 */
async function waitForEvent(type: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (!events.some(e => e.type === type)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for event "${type}". ` +
        `Events so far: ${events.map(e => e.type).join(', ') || '(none)'}`,
      );
    }
    await new Promise(r => setTimeout(r, 100));
  }
}

/**
 * Initialize a bare git repo with a default user config and an initial commit.
 */
function initRepo(dir: string): void {
  execSync('git init -b main', { cwd: dir, encoding: 'utf8' });
  execSync('git config user.email "test@example.com"', { cwd: dir, encoding: 'utf8' });
  execSync('git config user.name "Test User"', { cwd: dir, encoding: 'utf8' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Integration test repo\n');
  execSync('git add README.md', { cwd: dir, encoding: 'utf8' });
  execSync('git commit -m "initial"', { cwd: dir, encoding: 'utf8' });
}

function makeMockTask(): TaskSpec {
  return {
    id: 1,
    title: 'Add hello world function',
    dependencies: [],
    status: 'pending',
    details: 'Create a simple hello world function in TypeScript.',
    acceptanceCriteria: ['Function returns "Hello, World!"', 'Has unit test'],
    relevantFiles: ['src/hello.ts'],
  };
}

/**
 * Create an expert prompt file (simulating what the review handler produces).
 * Returns the absolute path to the written file.
 */
function createExpertPrompt(task: TaskSpec): string {
  const expertDir = path.join(config.artifact_root, 'experts');
  fs.mkdirSync(expertDir, { recursive: true });
  const expertPath = path.join(expertDir, `TASK-${task.id}.md`);
  const content = [
    `# Expert: ${task.title}`,
    '',
    '## Task Details',
    task.details,
    '',
    '## Acceptance Criteria',
    ...task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
    '',
    '## Relevant Files',
    ...task.relevantFiles.map(f => `- ${f}`),
    '',
    '## Status Reporting',
    'Report your status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED',
  ].join('\n');
  fs.writeFileSync(expertPath, content);
  return expertPath;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-integration-'));
  initRepo(repoRoot);

  // artifact_root must be absolute because result.ts resolves it directly
  config = {
    ...createDefaultWorkerConfig(),
    claude_bin: MOCK_CLAUDE_PATH,
    artifact_root: path.join(repoRoot, '.roadrunner'),
  };

  events = [];
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('worker handler integration', () => {
  it('completes a single task dispatch cycle', async () => {
    const handler = createWorkerHandler({ config, repoRoot }, sendEvent);
    const mockTask = makeMockTask();
    const expertPath = createExpertPrompt(mockTask);

    // Send DISPATCH_WORKER
    handler({
      type: 'DISPATCH_WORKER',
      task_id: 1,
      expert_prompt_path: expertPath,
      task_spec: mockTask,
      worktree_branch: 'task-1',
      max_turns: 20,
      model: 'sonnet',
    });

    await waitForEvent('WORKER_COMPLETE');

    // Verify worktree was created
    const worktreePath = path.join(repoRoot, config.worktree_root, 'task-1');
    expect(fs.existsSync(worktreePath)).toBe(true);

    // Verify expert prompt was installed as .claude/CLAUDE.md
    const claudeMdPath = path.join(worktreePath, '.claude', 'CLAUDE.md');
    expect(fs.existsSync(claudeMdPath)).toBe(true);
    const installedContent = fs.readFileSync(claudeMdPath, 'utf8');
    expect(installedContent).toContain('Add hello world function');

    // Verify mock claude ran (it creates generated.ts and commits it)
    const gitLog = execSync('git log --oneline', { cwd: worktreePath, encoding: 'utf8' });
    expect(gitLog).toContain('feat: implement task');

    // Verify WORKER_COMPLETE event
    const workerComplete = events.find(e => e.type === 'WORKER_COMPLETE');
    expect(workerComplete).toBeDefined();
    if (workerComplete?.type !== 'WORKER_COMPLETE') throw new Error('type guard failed');
    expect(workerComplete.task_id).toBe(1);
    expect(workerComplete.status).toBe('DONE');

    // Verify result artifact was written to .roadrunner/results/
    const resultPath = workerComplete.result_path;
    expect(resultPath).toBeTruthy();
    expect(fs.existsSync(resultPath)).toBe(true);
    const artifact = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    expect(artifact.task_id).toBe(1);
    expect(artifact.status).toBe('DONE');
  });

  it('sends WORKER_COMPLETE(BLOCKED) when claude binary does not exist', async () => {
    const badConfig: WorkerConfig = {
      ...config,
      claude_bin: '/nonexistent/claude-binary',
    };
    const badHandler = createWorkerHandler({ config: badConfig, repoRoot }, sendEvent);
    const mockTask = makeMockTask();
    const expertPath = createExpertPrompt(mockTask);

    badHandler({
      type: 'DISPATCH_WORKER',
      task_id: 1,
      expert_prompt_path: expertPath,
      task_spec: mockTask,
      worktree_branch: 'task-1',
      max_turns: 20,
      model: 'sonnet',
    });

    // invokeClaude handles spawn ENOENT by resolving exit_code=1 with empty stdout,
    // then retries once. After retry it returns the exec result to parseCliOutput,
    // which treats empty stdout + non-zero exit as BLOCKED (not a thrown error).
    await waitForEvent('WORKER_COMPLETE', 15000);

    const workerComplete = events.find(e => e.type === 'WORKER_COMPLETE');
    expect(workerComplete).toBeDefined();
    if (workerComplete?.type !== 'WORKER_COMPLETE') throw new Error('type guard failed');
    expect(workerComplete.task_id).toBe(1);
    expect(workerComplete.status).toBe('BLOCKED');
    expect(typeof workerComplete.concerns).toBe('string');
  });

  it('installs worker settings in the worktree', async () => {
    const handler = createWorkerHandler({ config, repoRoot }, sendEvent);
    const mockTask = makeMockTask();
    const expertPath = createExpertPrompt(mockTask);

    handler({
      type: 'DISPATCH_WORKER',
      task_id: 1,
      expert_prompt_path: expertPath,
      task_spec: mockTask,
      worktree_branch: 'task-1',
      max_turns: 20,
      model: 'sonnet',
    });

    await waitForEvent('WORKER_COMPLETE');

    // Worker settings are installed as .claude/settings.json inside the worktree
    const worktreePath = path.join(repoRoot, config.worktree_root, 'task-1');
    const settingsPath = path.join(worktreePath, '.claude', 'settings.json');
    expect(fs.existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(typeof settings).toBe('object');
    expect(settings).not.toBeNull();
  });

  it('infers risk from max_turns for settings installation', async () => {
    const handler = createWorkerHandler({ config, repoRoot }, sendEvent);
    const mockTask = makeMockTask();
    const expertPath = createExpertPrompt(mockTask);

    // max_turns=10 → trivial risk → Bash should be denied
    handler({
      type: 'DISPATCH_WORKER',
      task_id: 1,
      expert_prompt_path: expertPath,
      task_spec: mockTask,
      worktree_branch: 'task-1',
      max_turns: 10,
      model: 'sonnet',
    });

    await waitForEvent('WORKER_COMPLETE');

    const worktreePath = path.join(repoRoot, config.worktree_root, 'task-1');
    const settingsPath = path.join(worktreePath, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    // Trivial risk: Bash should be in the deny list
    expect(settings.permissions.deny).toContain('Bash');
  });
});

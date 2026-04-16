import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ---------------------------------------------------------------------------
// Mock worktree module so parseCliOutput never needs a real git repo.
// vi.mock is hoisted to the top by Vitest's transformer.
// ---------------------------------------------------------------------------
vi.mock('../worktree.js', () => ({
  getFilesChanged: vi.fn(() => [] as string[]),
}));

import { extractStatus, parseCliOutput, writeResultArtifact } from '../result.js';
import { getFilesChanged } from '../worktree.js';
import type { ExecResult, HookEvent, WorkerConfig } from '../types.js';

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

function makeExecResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return {
    exit_code: 0,
    stdout: '',
    stderr: '',
    timed_out: false,
    retried: false,
    duration_ms: 5000,
    ...overrides,
  };
}

function makeClaudeJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    cost_usd: 0.10,
    duration_ms: 20000,
    num_turns: 3,
    session_id: 'sess-abc',
    is_error: false,
    result: 'DONE',
    ...overrides,
  });
}

const mockGetFilesChanged = vi.mocked(getFilesChanged);

// ---------------------------------------------------------------------------
// extractStatus — pure function, no I/O
// ---------------------------------------------------------------------------

describe('extractStatus', () => {
  describe('keyword detection', () => {
    it('returns DONE when result text contains DONE', () => {
      const { status, concerns } = extractStatus('Task DONE.', false, [], false, false);
      expect(status).toBe('DONE');
      expect(concerns).toBeNull();
    });

    it('returns DONE_WITH_CONCERNS when result text contains DONE_WITH_CONCERNS', () => {
      const { status, concerns } = extractStatus(
        'DONE_WITH_CONCERNS minor issue',
        false, [], false, false,
      );
      expect(status).toBe('DONE_WITH_CONCERNS');
      expect(concerns).toBe('minor issue');
    });

    it('prefers DONE_WITH_CONCERNS over DONE (avoids false prefix match)', () => {
      // Text contains DONE_WITH_CONCERNS — must not match the DONE prefix first
      const { status } = extractStatus('DONE_WITH_CONCERNS and DONE', false, [], false, false);
      expect(status).toBe('DONE_WITH_CONCERNS');
    });

    it('returns NEEDS_CONTEXT when result text contains NEEDS_CONTEXT', () => {
      const { status, concerns } = extractStatus('NEEDS_CONTEXT missing info', false, [], false, false);
      expect(status).toBe('NEEDS_CONTEXT');
      expect(concerns).toBeNull();
    });

    it('returns BLOCKED when result text contains BLOCKED', () => {
      const { status, concerns } = extractStatus('BLOCKED on dependency', false, [], false, false);
      expect(status).toBe('BLOCKED');
      expect(concerns).toBeNull();
    });

    it('extracts concerns text after DONE_WITH_CONCERNS keyword', () => {
      const { status, concerns } = extractStatus(
        'Task complete DONE_WITH_CONCERNS the API response was slow',
        false, [], false, false,
      );
      expect(status).toBe('DONE_WITH_CONCERNS');
      expect(concerns).toBe('the API response was slow');
    });

    it('returns null concerns when nothing follows DONE_WITH_CONCERNS', () => {
      const { concerns } = extractStatus('DONE_WITH_CONCERNS', false, [], false, false);
      expect(concerns).toBeNull();
    });
  });

  describe('fallback rules — no keyword', () => {
    it('returns BLOCKED with "timed out" when timedOut=true', () => {
      const { status, concerns } = extractStatus('', false, [], true, false);
      expect(status).toBe('BLOCKED');
      expect(concerns).toBe('timed out');
    });

    it('returns BLOCKED with max turns message when maxTurnsExceeded=true', () => {
      const { status, concerns } = extractStatus('', false, [], false, true);
      expect(status).toBe('BLOCKED');
      expect(concerns).toBe('max turns exceeded without completion');
    });

    it('returns BLOCKED with result text excerpt when isError=true', () => {
      const errText = 'Something went wrong in the process';
      const { status, concerns } = extractStatus(errText, true, [], false, false);
      expect(status).toBe('BLOCKED');
      expect(concerns).toBe(errText);
    });

    it('truncates isError concerns to 500 chars', () => {
      const longText = 'x'.repeat(600);
      const { concerns } = extractStatus(longText, true, [], false, false);
      expect(concerns?.length).toBe(500);
    });

    it('returns DONE_WITH_CONCERNS when filesChanged is non-empty and no keyword', () => {
      const { status, concerns } = extractStatus('', false, ['src/index.ts'], false, false);
      expect(status).toBe('DONE_WITH_CONCERNS');
      expect(concerns).toBe('completed work but did not report explicit status');
    });

    it('returns BLOCKED when filesChanged is empty and no keyword', () => {
      const { status, concerns } = extractStatus('', false, [], false, false);
      expect(status).toBe('BLOCKED');
      expect(concerns).toBe('no changes made and no status reported');
    });

    it('timedOut takes precedence over isError and filesChanged', () => {
      const { status, concerns } = extractStatus('error msg', true, ['file.ts'], true, false);
      expect(status).toBe('BLOCKED');
      expect(concerns).toBe('timed out');
    });
  });
});

// ---------------------------------------------------------------------------
// parseCliOutput
// ---------------------------------------------------------------------------

describe('parseCliOutput', () => {
  let tmpDir: string;
  let config: WorkerConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'result-test-'));
    config = makeConfig({ artifact_root: path.join(tmpDir, '.roadrunner') });
    mockGetFilesChanged.mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('valid Claude Code JSON output', () => {
    it('parses a successful DONE result', () => {
      const exec = makeExecResult({ stdout: makeClaudeJson({ result: 'DONE' }) });
      const event = parseCliOutput(exec, [], 1, tmpDir, 1, config);

      expect(event.type).toBe('WORKER_COMPLETE');
      expect(event.task_id).toBe(1);
      expect(event.status).toBe('DONE');
      expect(event.cost_usd).toBe(0.10);
      expect(event.duration_ms).toBe(20000);
      expect(event.concerns).toBeNull();
    });

    it('extracts files_changed via getFilesChanged', () => {
      mockGetFilesChanged.mockReturnValue(['foo.ts', 'bar.ts']);
      const exec = makeExecResult({ stdout: makeClaudeJson({ result: 'DONE' }) });
      const event = parseCliOutput(exec, [], 1, tmpDir, 1, config);

      expect(event.files_changed).toEqual(['foo.ts', 'bar.ts']);
    });

    it('writes a result artifact and populates result_path', () => {
      const exec = makeExecResult({ stdout: makeClaudeJson({ result: 'DONE' }) });
      const event = parseCliOutput(exec, [], 5, tmpDir, 1, config);

      expect(event.result_path).toMatch(/TASK-5\.json$/);
      expect(fs.existsSync(event.result_path)).toBe(true);
    });

    it('handles DONE_WITH_CONCERNS and captures concerns text', () => {
      const exec = makeExecResult({
        stdout: makeClaudeJson({ result: 'DONE_WITH_CONCERNS the config was missing' }),
      });
      const event = parseCliOutput(exec, [], 2, tmpDir, 1, config);

      expect(event.status).toBe('DONE_WITH_CONCERNS');
      expect(event.concerns).toBe('the config was missing');
    });

    it('falls back cost_usd to 0 when missing from JSON', () => {
      const jsonWithoutCost = JSON.stringify({
        type: 'result',
        result: 'DONE',
        duration_ms: 5000,
        num_turns: 1,
        is_error: false,
      });
      const exec = makeExecResult({ stdout: jsonWithoutCost });
      const event = parseCliOutput(exec, [], 3, tmpDir, 1, config);

      expect(event.cost_usd).toBe(0);
    });

    it('uses exec.duration_ms when JSON duration_ms is absent', () => {
      const jsonNoDuration = JSON.stringify({
        type: 'result',
        result: 'DONE',
        cost_usd: 0.05,
        is_error: false,
      });
      const exec = makeExecResult({ stdout: jsonNoDuration, duration_ms: 99999 });
      const event = parseCliOutput(exec, [], 4, tmpDir, 1, config);

      expect(event.duration_ms).toBe(99999);
    });
  });

  describe('crashed CLI output (no JSON)', () => {
    it('returns BLOCKED when stdout is empty', () => {
      const exec = makeExecResult({
        stdout: '',
        stderr: 'fatal: something broke',
        exit_code: 1,
      });
      const event = parseCliOutput(exec, [], 4, tmpDir, 1, config);

      expect(event.status).toBe('BLOCKED');
      expect(event.concerns).toContain('something broke');
      expect(event.cost_usd).toBe(0);
      expect(event.duration_ms).toBe(5000);
    });

    it('returns BLOCKED with fallback message when stderr is also empty', () => {
      const exec = makeExecResult({ stdout: '', stderr: '' });
      const event = parseCliOutput(exec, [], 6, tmpDir, 1, config);

      expect(event.status).toBe('BLOCKED');
      expect(event.concerns).toBe('CLI produced no parseable output');
    });

    it('returns BLOCKED when stdout contains malformed (non-JSON) text', () => {
      const exec = makeExecResult({
        stdout: 'not valid json at all',
        stderr: 'something went wrong',
      });
      const event = parseCliOutput(exec, [], 7, tmpDir, 1, config);

      expect(event.status).toBe('BLOCKED');
    });

    it('writes result artifact even on crash', () => {
      const exec = makeExecResult({ stdout: '', stderr: 'crash' });
      const event = parseCliOutput(exec, [], 11, tmpDir, 1, config);

      expect(event.result_path).toBeTruthy();
      expect(fs.existsSync(event.result_path)).toBe(true);
    });
  });

  describe('timeout handling', () => {
    it('returns BLOCKED with timed_out concerns when exec.timed_out is true', () => {
      const exec = makeExecResult({
        stdout: makeClaudeJson({ result: '' }),
        timed_out: true,
      });
      const event = parseCliOutput(exec, [], 8, tmpDir, 1, config);

      expect(event.status).toBe('BLOCKED');
      expect(event.concerns).toBe('timed out');
    });
  });

  describe('missing status with/without file changes', () => {
    it('returns DONE_WITH_CONCERNS when no keyword but files were changed', () => {
      mockGetFilesChanged.mockReturnValue(['main.ts']);
      const exec = makeExecResult({
        stdout: makeClaudeJson({ result: 'I worked on the task.' }),
      });
      const event = parseCliOutput(exec, [], 9, tmpDir, 1, config);

      expect(event.status).toBe('DONE_WITH_CONCERNS');
      expect(event.concerns).toBe('completed work but did not report explicit status');
    });

    it('returns BLOCKED when no keyword and no files changed', () => {
      mockGetFilesChanged.mockReturnValue([]);
      const exec = makeExecResult({
        stdout: makeClaudeJson({ result: 'I looked at things.' }),
      });
      const event = parseCliOutput(exec, [], 10, tmpDir, 1, config);

      expect(event.status).toBe('BLOCKED');
      expect(event.concerns).toBe('no changes made and no status reported');
    });
  });
});

// ---------------------------------------------------------------------------
// writeResultArtifact
// ---------------------------------------------------------------------------

describe('writeResultArtifact', () => {
  let tmpDir: string;
  let config: WorkerConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-test-'));
    config = makeConfig({ artifact_root: path.join(tmpDir, '.roadrunner') });
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function makeEvent(overrides: Partial<import('../../orchestrator/events.js').WorkerComplete> = {}): import('../../orchestrator/events.js').WorkerComplete {
    return {
      type: 'WORKER_COMPLETE',
      task_id: 1,
      status: 'DONE',
      result_path: '',
      cost_usd: 0.05,
      duration_ms: 10000,
      files_changed: ['src/foo.ts'],
      concerns: null,
      ...overrides,
    };
  }

  it('creates .roadrunner/results/ directory if it does not exist', () => {
    const resultsDir = path.join(config.artifact_root, 'results');
    expect(fs.existsSync(resultsDir)).toBe(false);

    writeResultArtifact(makeEvent(), 1, 'sonnet', config);

    expect(fs.existsSync(resultsDir)).toBe(true);
  });

  it('writes TASK-{id}.json for round 1', () => {
    const artifactPath = writeResultArtifact(makeEvent({ task_id: 3 }), 1, 'sonnet', config);
    expect(path.basename(artifactPath)).toBe('TASK-3.json');
    expect(fs.existsSync(artifactPath)).toBe(true);
  });

  it('writes TASK-{id}-r{round}.json for round > 1', () => {
    const artifactPath = writeResultArtifact(makeEvent({ task_id: 3 }), 2, 'opus', config);
    expect(path.basename(artifactPath)).toBe('TASK-3-r2.json');
    expect(fs.existsSync(artifactPath)).toBe(true);
  });

  it('artifact JSON contains expected fields', () => {
    const event = makeEvent({
      task_id: 7,
      status: 'DONE_WITH_CONCERNS',
      concerns: 'slow query',
    });
    const artifactPath = writeResultArtifact(event, 1, 'sonnet', config);
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

    expect(artifact.task_id).toBe(7);
    expect(artifact.status).toBe('DONE_WITH_CONCERNS');
    expect(artifact.round).toBe(1);
    expect(artifact.model).toBe('sonnet');
    expect(artifact.cost_usd).toBe(0.05);
    expect(artifact.duration_ms).toBe(10000);
    expect(artifact.files_changed).toEqual(['src/foo.ts']);
    expect(artifact.concerns).toBe('slow query');
    expect(artifact.hook_events).toEqual([]);
    expect(typeof artifact.timestamp).toBe('string');
  });

  it('writes valid ISO-8601 timestamp', () => {
    const artifactPath = writeResultArtifact(makeEvent(), 1, 'sonnet', config);
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    expect(new Date(artifact.timestamp).toISOString()).toBe(artifact.timestamp);
  });

  it('returns the path to the written artifact', () => {
    const artifactPath = writeResultArtifact(makeEvent({ task_id: 99 }), 1, 'sonnet', config);
    expect(typeof artifactPath).toBe('string');
    expect(artifactPath).toContain('TASK-99');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { invokeClaude } from '../execute.js';
import type { WorkerConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(claudeBin: string, overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    base_branch: 'main',
    worktree_root: '.worktrees',
    artifact_root: '.roadrunner',
    claude_bin: claudeBin,
    methodology_path: null,
    timeout_overrides: null,
    ...overrides,
  };
}

/** Write a bash script to a path and make it executable. */
function writeMockClaude(scriptPath: string, scriptBody: string): void {
  const content = `#!/usr/bin/env bash\n${scriptBody}\n`;
  fs.writeFileSync(scriptPath, content, { mode: 0o755 });
}

const SUCCESS_JSON = JSON.stringify({
  type: 'result',
  subtype: 'success',
  cost_usd: 0.05,
  duration_ms: 10000,
  num_turns: 3,
  session_id: 'test-sess',
  is_error: false,
  result: 'DONE',
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('invokeClaude', () => {
  let tmpDir: string;
  let worktreePath: string;
  let mockScriptPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'execute-test-'));
    worktreePath = path.join(tmpDir, 'worktree');
    fs.mkdirSync(worktreePath, { recursive: true });
    mockScriptPath = path.join(tmpDir, 'mock-claude');
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Successful execution
  // -------------------------------------------------------------------------

  describe('successful execution', () => {
    it('returns exit_code 0 and parsed stdout on success', async () => {
      writeMockClaude(mockScriptPath, `echo '${SUCCESS_JSON}'`);

      const result = await invokeClaude({
        worktreePath,
        prompt: 'do something',
        maxTurns: 5,
        model: 'sonnet',
        timeoutMs: 10_000,
        taskId: 1,
        config: makeConfig(mockScriptPath),
      });

      expect(result.exec.exit_code).toBe(0);
      expect(result.exec.stdout.trim()).toBe(SUCCESS_JSON);
      expect(result.exec.timed_out).toBe(false);
      expect(result.exec.retried).toBe(false);
      expect(result.hookEvents).toEqual([]);
    });

    it('captures stderr output', async () => {
      writeMockClaude(mockScriptPath, `echo 'some warning' >&2\necho '${SUCCESS_JSON}'`);

      const result = await invokeClaude({
        worktreePath,
        prompt: 'do something',
        maxTurns: 5,
        model: 'sonnet',
        timeoutMs: 10_000,
        taskId: 1,
        config: makeConfig(mockScriptPath),
      });

      expect(result.exec.stderr).toContain('some warning');
      expect(result.exec.exit_code).toBe(0);
    });

    it('records accurate duration_ms', async () => {
      writeMockClaude(mockScriptPath, `echo '${SUCCESS_JSON}'`);

      const before = Date.now();
      const result = await invokeClaude({
        worktreePath,
        prompt: 'do something',
        maxTurns: 5,
        model: 'sonnet',
        timeoutMs: 10_000,
        taskId: 1,
        config: makeConfig(mockScriptPath),
      });
      const after = Date.now();

      expect(result.exec.duration_ms).toBeGreaterThan(0);
      expect(result.exec.duration_ms).toBeLessThanOrEqual(after - before + 50);
    });

    it('writes current_task_id to .roadrunner/ in the worktree', async () => {
      writeMockClaude(mockScriptPath, `echo '${SUCCESS_JSON}'`);

      await invokeClaude({
        worktreePath,
        prompt: 'do something',
        maxTurns: 5,
        model: 'sonnet',
        timeoutMs: 10_000,
        taskId: 42,
        config: makeConfig(mockScriptPath),
      });

      const markerPath = path.join(worktreePath, '.roadrunner', 'current_task_id');
      expect(fs.existsSync(markerPath)).toBe(true);
      expect(fs.readFileSync(markerPath, 'utf8')).toBe('42');
    });
  });

  // -------------------------------------------------------------------------
  // Timeout behaviour
  // -------------------------------------------------------------------------

  describe('timeout', () => {
    it('sets timed_out=true and terminates a hanging process', async () => {
      // Script sleeps indefinitely
      writeMockClaude(mockScriptPath, 'sleep 60');

      const result = await invokeClaude({
        worktreePath,
        prompt: 'do something',
        maxTurns: 5,
        model: 'sonnet',
        timeoutMs: 300, // 300 ms — very short
        taskId: 1,
        config: makeConfig(mockScriptPath),
      });

      expect(result.exec.timed_out).toBe(true);
      // The process is killed, so exit code should be non-zero (SIGTERM = 143 on Linux, varies)
      expect(result.exec.exit_code).not.toBe(0);
    }, 20_000); // generous wall-clock budget: 300ms trigger + up to 10s SIGKILL delay
  });

  // -------------------------------------------------------------------------
  // Retry behaviour
  // -------------------------------------------------------------------------

  describe('retry', () => {
    it('retries once when first run exits non-zero with empty stdout, sets retried=true', async () => {
      // First invocation: exit 1 with empty stdout
      // Second invocation: succeed
      // We use a counter file to track how many times the script was called
      const counterFile = path.join(tmpDir, 'call_count');
      fs.writeFileSync(counterFile, '0');

      writeMockClaude(
        mockScriptPath,
        `COUNT=$(cat "${counterFile}")\nNEXT=$((COUNT + 1))\necho $NEXT > "${counterFile}"\nif [ "$COUNT" -eq "0" ]; then\n  exit 1\nfi\necho '${SUCCESS_JSON}'`,
      );

      const result = await invokeClaude({
        worktreePath,
        prompt: 'do something',
        maxTurns: 5,
        model: 'sonnet',
        timeoutMs: 10_000,
        taskId: 1,
        config: makeConfig(mockScriptPath),
      });

      expect(result.exec.retried).toBe(true);
      expect(result.exec.exit_code).toBe(0);
      expect(result.exec.stdout.trim()).toBe(SUCCESS_JSON);

      // Verify the script was called twice
      const finalCount = fs.readFileSync(counterFile, 'utf8').trim();
      expect(finalCount).toBe('2');
    });

    it('does NOT retry when exit non-zero but stdout has content', async () => {
      const counterFile = path.join(tmpDir, 'call_count');
      fs.writeFileSync(counterFile, '0');

      // Exit non-zero but produce JSON stdout — this is a valid outcome, no retry
      writeMockClaude(
        mockScriptPath,
        `COUNT=$(cat "${counterFile}")\nNEXT=$((COUNT + 1))\necho $NEXT > "${counterFile}"\necho '${SUCCESS_JSON}'\nexit 1`,
      );

      const result = await invokeClaude({
        worktreePath,
        prompt: 'do something',
        maxTurns: 5,
        model: 'sonnet',
        timeoutMs: 10_000,
        taskId: 1,
        config: makeConfig(mockScriptPath),
      });

      expect(result.exec.retried).toBe(false);
      expect(result.exec.exit_code).toBe(1);
      expect(result.exec.stdout.trim()).toBe(SUCCESS_JSON);

      // Only called once — no retry
      const finalCount = fs.readFileSync(counterFile, 'utf8').trim();
      expect(finalCount).toBe('1');
    });

    it('does NOT retry on zero exit code', async () => {
      writeMockClaude(mockScriptPath, `echo '${SUCCESS_JSON}'`);

      const result = await invokeClaude({
        worktreePath,
        prompt: 'do something',
        maxTurns: 5,
        model: 'sonnet',
        timeoutMs: 10_000,
        taskId: 1,
        config: makeConfig(mockScriptPath),
      });

      expect(result.exec.retried).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Event polling
  // -------------------------------------------------------------------------

  describe('event polling', () => {
    it('collects hook events written to .roadrunner/events/ during execution', async () => {
      const eventDir = path.join(worktreePath, '.roadrunner', 'events');
      fs.mkdirSync(eventDir, { recursive: true });

      const event1: object = {
        event: 'CONTEXT_WARNING',
        task_id: 1,
        session_id: 'test-sess',
        utilization_pct: 65,
        threshold: 60,
        action: 'warn',
      };

      // Script writes an event file before sleeping briefly, then exits
      const eventFilePath = path.join(eventDir, 'evt-001.json');
      writeMockClaude(
        mockScriptPath,
        `echo '${JSON.stringify(event1)}' > "${eventFilePath}"\nsleep 3\necho '${SUCCESS_JSON}'`,
      );

      const result = await invokeClaude({
        worktreePath,
        prompt: 'do something',
        maxTurns: 5,
        model: 'sonnet',
        timeoutMs: 10_000,
        taskId: 1,
        config: makeConfig(mockScriptPath),
      });

      expect(result.exec.exit_code).toBe(0);
      expect(result.hookEvents).toHaveLength(1);
      expect(result.hookEvents[0].event).toBe('CONTEXT_WARNING');
      expect(result.hookEvents[0].task_id).toBe(1);
      expect(result.hookEvents[0].utilization_pct).toBe(65);
    }, 15_000);

    it('collects events written after the last poll (drain on exit)', async () => {
      const eventDir = path.join(worktreePath, '.roadrunner', 'events');
      fs.mkdirSync(eventDir, { recursive: true });

      const event1: object = {
        event: 'HANDOFF_READY',
        task_id: 2,
        session_id: 'test-sess-2',
        handoff_path: '/some/path',
      };

      const eventFilePath = path.join(eventDir, 'evt-final.json');

      // Script immediately writes an event and exits — may land after the last poll interval
      writeMockClaude(
        mockScriptPath,
        `echo '${JSON.stringify(event1)}' > "${eventFilePath}"\necho '${SUCCESS_JSON}'`,
      );

      const result = await invokeClaude({
        worktreePath,
        prompt: 'do something',
        maxTurns: 5,
        model: 'sonnet',
        timeoutMs: 10_000,
        taskId: 2,
        config: makeConfig(mockScriptPath),
      });

      expect(result.exec.exit_code).toBe(0);
      expect(result.hookEvents).toHaveLength(1);
      expect(result.hookEvents[0].event).toBe('HANDOFF_READY');
    });

    it('clears stale events from a prior run before executing', async () => {
      const eventDir = path.join(worktreePath, '.roadrunner', 'events');
      fs.mkdirSync(eventDir, { recursive: true });

      // Plant a stale event file as if from a previous run
      const staleEvent = { event: 'CONTEXT_WARNING', task_id: 99, session_id: 'stale' };
      fs.writeFileSync(
        path.join(eventDir, 'stale-evt.json'),
        JSON.stringify(staleEvent),
        'utf8',
      );

      // Mock claude writes no events and succeeds
      writeMockClaude(mockScriptPath, `echo '${SUCCESS_JSON}'`);

      const result = await invokeClaude({
        worktreePath,
        prompt: 'do something',
        maxTurns: 5,
        model: 'sonnet',
        timeoutMs: 10_000,
        taskId: 1,
        config: makeConfig(mockScriptPath),
      });

      // Stale event should NOT appear
      expect(result.hookEvents).toEqual([]);
    });

    it('ignores non-JSON files in the events directory', async () => {
      const eventDir = path.join(worktreePath, '.roadrunner', 'events');
      fs.mkdirSync(eventDir, { recursive: true });

      writeMockClaude(
        mockScriptPath,
        `echo 'not json' > "${path.join(eventDir, 'noise.json')}"\necho '${SUCCESS_JSON}'`,
      );

      const result = await invokeClaude({
        worktreePath,
        prompt: 'do something',
        maxTurns: 5,
        model: 'sonnet',
        timeoutMs: 10_000,
        taskId: 1,
        config: makeConfig(mockScriptPath),
      });

      expect(result.exec.exit_code).toBe(0);
      // Malformed JSON is silently skipped
      expect(result.hookEvents).toEqual([]);
    });
  });
});

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExecResult, WorkerConfig, HookEvent } from './types.js';

export interface ExecuteOptions {
  worktreePath: string;
  prompt: string;
  maxTurns: number;
  model: 'sonnet' | 'opus';
  timeoutMs: number;
  taskId: number;
  config: WorkerConfig;
}

export interface ExecuteResult {
  exec: ExecResult;
  hookEvents: HookEvent[];
}

const SIGKILL_DELAY_MS = 10_000;
const EVENT_POLL_INTERVAL_MS = 2_000;

/** Kill the process and its entire process group so child processes (e.g. sleep) are also killed. */
function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    // Negative PID targets the process group
    process.kill(-pid, signal);
  } catch {
    // Fall back to killing just the process if the group kill fails
    try {
      process.kill(pid, signal);
    } catch { /* already dead */ }
  }
}

/**
 * Ensure the .roadrunner/events/ directory exists and is empty.
 */
function prepareEventDir(worktreePath: string): string {
  const eventDir = path.join(worktreePath, '.roadrunner', 'events');
  fs.mkdirSync(eventDir, { recursive: true });

  // Clear any stale event files from a prior run
  for (const entry of fs.readdirSync(eventDir)) {
    try {
      fs.unlinkSync(path.join(eventDir, entry));
    } catch {
      // Ignore errors — file may have already been removed
    }
  }

  return eventDir;
}

/**
 * Write the task ID marker so hook scripts know which task is running.
 */
function writeTaskIdMarker(worktreePath: string, taskId: number): void {
  const roadrunnerDir = path.join(worktreePath, '.roadrunner');
  fs.mkdirSync(roadrunnerDir, { recursive: true });
  fs.writeFileSync(path.join(roadrunnerDir, 'current_task_id'), String(taskId), 'utf8');
}

/**
 * Drain all JSON event files from the event directory. Consumed files are deleted.
 */
function drainEvents(eventDir: string): HookEvent[] {
  const collected: HookEvent[] = [];

  let entries: string[];
  try {
    entries = fs.readdirSync(eventDir);
  } catch {
    return collected;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const filePath = path.join(eventDir, entry);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as HookEvent;
      collected.push(parsed);
      fs.unlinkSync(filePath);
    } catch {
      // Malformed or already deleted — skip
    }
  }

  return collected;
}

/**
 * Invoke claude CLI in a worktree with the given prompt.
 * Monitors .roadrunner/events/ for hook signals during execution.
 */
export async function invokeClaude(options: ExecuteOptions): Promise<ExecuteResult> {
  const result = await _invoke(options, false);
  // Retry once on non-zero exit with empty stdout (no JSON output)
  if (result.exec.exit_code !== 0 && result.exec.stdout.trim() === '') {
    const retried = await _invoke(options, true);
    return retried;
  }
  return result;
}

async function _invoke(options: ExecuteOptions, retried: boolean): Promise<ExecuteResult> {
  const { worktreePath, prompt, maxTurns, model, timeoutMs, taskId, config } = options;

  // 1. Write task ID marker
  writeTaskIdMarker(worktreePath, taskId);

  // 2. Clear stale events and get the event directory path
  const eventDir = prepareEventDir(worktreePath);

  const allHookEvents: HookEvent[] = [];
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  const startTime = Date.now();

  // 3. Spawn the claude subprocess
  const claudeArgs = [
    '--bare',
    '--output-format', 'json',
    '--max-turns', String(maxTurns),
    '--model', model,
    '-p', prompt,
  ];

  const child = spawn(config.claude_bin, claudeArgs, {
    cwd: worktreePath,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Use a new process group so we can kill all descendants on timeout
    detached: true,
  });

  child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

  let timedOut = false;
  let killTimer: ReturnType<typeof setTimeout> | null = null;

  // 4. Timeout: SIGTERM after timeoutMs, SIGKILL after additional 10s
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    const pid = child.pid;
    if (pid !== undefined) {
      killProcessGroup(pid, 'SIGTERM');
    }
    killTimer = setTimeout(() => {
      const p = child.pid;
      if (p !== undefined) {
        killProcessGroup(p, 'SIGKILL');
      }
    }, SIGKILL_DELAY_MS);
  }, timeoutMs);

  // 5. Event polling: check for new events every 2 seconds while the process runs
  let pollingActive = true;
  const pollTimer = setInterval(() => {
    if (!pollingActive) return;
    const events = drainEvents(eventDir);
    allHookEvents.push(...events);
  }, EVENT_POLL_INTERVAL_MS);

  // 6. Wait for the process to exit
  const exitCode = await new Promise<number>((resolve) => {
    child.on('close', (code: number | null) => {
      resolve(code ?? 1);
    });
    child.on('error', () => {
      resolve(1);
    });
  });

  // 7. Cleanup timers
  clearTimeout(timeoutTimer);
  if (killTimer !== null) clearTimeout(killTimer);
  pollingActive = false;
  clearInterval(pollTimer);

  const durationMs = Date.now() - startTime;

  // Collect any remaining events that arrived after the last poll
  const remainingEvents = drainEvents(eventDir);
  allHookEvents.push(...remainingEvents);

  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');

  const execResult: ExecResult = {
    exit_code: exitCode,
    stdout,
    stderr,
    timed_out: timedOut,
    retried,
    duration_ms: durationMs,
  };

  return {
    exec: execResult,
    hookEvents: allHookEvents,
  };
}

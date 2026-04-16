# Worker Dispatch Layer — Roadrunner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the worker dispatch layer (Layers 5 + 7) for Roadrunner — CLI execution in isolated worktrees, structured result parsing, budget monitoring, handoff protocol, predecessor context assembly, and incremental post-SHIP merge. Includes a unified handler that also stubs Layer 4 commands (GENERATE_EXPERT, RUN_REVIEW) until plan 04 fills them in.

**Architecture:** TypeScript event bus handler following the `createTaskSubstrateHandler()` pattern from `src/task-substrate/handler.ts`. Registers on the bus via `bus.onCommand()`, handles Layer 5 commands (`DISPATCH_WORKER`), observes Layer 3 commands (`UPDATE_TASK_STATUS`) for merge triggers, and stubs Layer 4 commands (`GENERATE_EXPERT`, `RUN_REVIEW`). Shell scripts only for hooks running inside worker Claude Code sessions.

**Tech Stack:** TypeScript, Node.js `child_process`, git worktrees, Claude Code CLI (`--bare` mode), Vitest, shell hooks (bash)

**Depends on:**
- Orchestrator (Layer 2) — implemented in `src/orchestrator/`
- Task substrate (Layer 3) — implemented in `src/task-substrate/`
- Plan 04 (Layer 4) — expert gen + review. This plan stubs Layer 4; plan 04 replaces stubs.

---

## Build Order Summary

```
Task 1: Worker types + configuration (foundation)
Task 2: Worktree lifecycle manager
  depends on: Task 1
Task 3: Prompt builders
  depends on: Task 1
Task 4: Worker settings generator
  depends on: Task 1
Task 5: Hook scripts (shell — budget monitor, compaction detector, budget report)
  depends on: Task 4
Task 6: CLI invocation wrapper
  depends on: Task 1, Task 2, Task 4
Task 7: Result parser
  depends on: Task 1
Task 8: Predecessor context assembly
  depends on: Task 1
Task 9: Worktree merge (incremental, post-SHIP)
  depends on: Task 2
Task 10: Orchestrator amendment — task status dispatch
  depends on: none (modifies existing orchestrator code)
Task 11: Worker handler + Layer 4 stubs
  depends on: all above
Task 12: End-to-end integration test
  depends on: Task 11
```

Critical path: 1 → 2 → 6 → 7 → 11 → 12 (types → worktree → CLI → parse → handler → integration)

Parallel tracks:
- 1 → 3 (types → prompts)
- 1 → 4 → 5 (types → settings → hooks)
- 1 → 8 (types → predecessor context)
- 2 → 9 (worktree → merge)
- 10 (orchestrator amendment, independent)

---

## Task 1: Worker Types + Configuration

**Description**

Define all types specific to the worker dispatch layer and a configuration interface. These types are the internal vocabulary — the orchestrator's types (`DispatchWorker`, `WorkerComplete`, etc. in `src/orchestrator/commands.ts` and `events.ts`) remain the external contract.

**Files to create**

- `src/worker/types.ts`

**Key interfaces**

```typescript
import type { RiskLevel } from '../orchestrator/types.js';

/** Raw output from claude CLI subprocess */
export interface ExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  retried: boolean;
  duration_ms: number;
}

/** Tracked worktree metadata */
export interface WorktreeInfo {
  task_id: number;
  branch: string;
  path: string;
  base_branch: string;
  created_at: string;       // ISO-8601
}

/** Per-task session tracking for compaction counting */
export interface SessionTracker {
  task_id: number;
  dispatch_count: number;    // incremented on each dispatch/re-dispatch
  handoff_count: number;     // incremented on each budget handoff
  total_cost_usd: number;
  total_duration_ms: number;
}

/** Worker layer configuration */
export interface WorkerConfig {
  /** Base branch for worktree creation and merge (default: 'main') */
  base_branch: string;
  /** Root directory for worktrees (default: '.worktrees') */
  worktree_root: string;
  /** Directory for worker artifacts (default: '.roadrunner') */
  artifact_root: string;
  /** Path to claude CLI binary (default: 'claude') */
  claude_bin: string;
  /** Path to Skylark _shared/ methodology (for expert gen stub) */
  methodology_path: string | null;
  /** Override timeouts per risk level (ms). Null = use orchestrator values. */
  timeout_overrides: Partial<Record<RiskLevel, number>> | null;
}

export function createDefaultWorkerConfig(): WorkerConfig;

/** Hook event written to .roadrunner/events/ by shell hooks */
export interface HookEvent {
  event: 'CONTEXT_WARNING' | 'COMPACTION_DETECTED' | 'HANDOFF_READY';
  task_id: number;
  session_id: string;
  utilization_pct?: number;
  threshold?: 40 | 60 | 70;
  action?: 'warn' | 'save_state' | 'handoff';
  handoff_path?: string;
  error?: string;
}

/** Handoff artifact schema (written at 70% utilization) */
export interface HandoffArtifact {
  task_id: number;
  session_number: number;
  completed_work: string[];
  pending_work: string[];
  decisions: Array<{ decision: string; rationale: string }>;
  modified_files: string[];
  blockers: string[];
  next_steps: string[];
  git_state: {
    branch: string;
    head_sha: string;
    uncommitted_changes: boolean;
  };
}

/** Merge result */
export interface MergeResult {
  success: boolean;
  merged_branch: string;
  base_branch: string;
  conflict_files?: string[];
  error?: string;
}
```

**Acceptance criteria**

- All types compile with strict TypeScript
- `createDefaultWorkerConfig()` returns sensible defaults (base_branch: 'main', worktree_root: '.worktrees', artifact_root: '.roadrunner', claude_bin: 'claude')
- Types do not duplicate orchestrator types — import `RiskLevel`, `TaskSpec`, `ReviewFinding` from `../orchestrator/types.js`
- No runtime dependencies — pure type definitions + one factory function

**Dependencies**

None. This is the foundation.

**Estimated scope**

~100 lines. Pure data definitions.

---

## Task 2: Worktree Lifecycle Manager

**Description**

TypeScript module wrapping git worktree operations. Creates, removes, and lists worktrees for task isolation. Each task gets a worktree at `{worktree_root}/task-{taskId}/` on branch `task-{taskId}`, branching from the configured base branch. All git operations use `child_process.execSync` for simplicity (worktree ops are fast and sequential).

Handles edge cases from the original plan: stale worktrees, locked worktrees (`.git/worktrees/<name>/locked`), branch conflicts from prior runs.

**Files to create**

- `src/worker/worktree.ts`
- `src/worker/__tests__/worktree.test.ts`

**Key functions**

```typescript
import type { WorktreeInfo, WorkerConfig } from './types.js';

/** Create a worktree for a task. Cleans up stale branch/worktree if it exists. */
export function createWorktree(
  taskId: number,
  config: WorkerConfig,
  repoRoot: string,
): WorktreeInfo;

/** Remove a worktree and its branch. Idempotent — no-op if already removed. */
export function removeWorktree(
  taskId: number,
  config: WorkerConfig,
  repoRoot: string,
): void;

/** List all active worktrees managed by this module. */
export function listWorktrees(
  config: WorkerConfig,
  repoRoot: string,
): WorktreeInfo[];

/** Check if worktree has uncommitted changes. */
export function hasUncommittedChanges(worktreePath: string): boolean;

/** Commit any uncommitted changes as WIP (used before re-dispatch and handoff). */
export function commitWip(worktreePath: string, message: string): string | null;

/** Get files changed since branching from base. */
export function getFilesChanged(worktreePath: string): string[];

/** Ensure .worktrees/ is in .gitignore. Called once on first worktree creation. */
function ensureGitignore(worktreeRoot: string, repoRoot: string): void;
```

**Acceptance criteria**

- `createWorktree(1, config, root)` creates `{root}/.worktrees/task-1/` on branch `task-1` from `main`
- If branch `task-1` already exists (stale from prior run): removes the old worktree and branch before creating fresh
- If worktree is locked: unlocks before removal (removes `.git/worktrees/task-1/locked` file)
- `removeWorktree(1, config, root)` removes worktree and deletes branch. Running twice is a no-op (exit 0).
- `listWorktrees` returns array of `WorktreeInfo` for all worktrees under `worktree_root`
- `hasUncommittedChanges` returns true if `git status --porcelain` is non-empty in the worktree
- `commitWip` commits with the given message. Returns the commit SHA, or null if nothing to commit.
- `getFilesChanged` returns file list from `git diff --name-only {base_branch}...HEAD` in the worktree
- `.worktrees/` is added to `.gitignore` on first worktree creation
- All functions throw descriptive errors on git failures (with stderr output)
- Unit tests create a real temporary git repo (using `mkdtemp`), exercise the full create/list/remove lifecycle

**Dependencies**

Task 1 (types)

**Estimated scope**

~200 lines + ~150 lines test.

---

## Task 3: Prompt Builders

**Description**

Pure functions that assemble prompt strings for worker dispatch, re-dispatch (fix round), and review. These are templates that interpolate task spec data — the actual expert prompt content (vocabulary routing, anti-patterns) comes from the expert generation step (plan 04). These builders produce the `-p` argument to the `claude` CLI.

**Files to create**

- `src/worker/prompt.ts`
- `src/worker/__tests__/prompt.test.ts`

**Key functions**

```typescript
import type { TaskSpec, ReviewFinding } from '../orchestrator/types.js';

/**
 * Build the initial task dispatch prompt.
 * This is the -p argument to claude CLI, NOT the expert prompt (.claude/CLAUDE.md).
 * The expert prompt is installed separately; this prompt says "do the task."
 */
export function buildTaskPrompt(task: TaskSpec): string;

/**
 * Build the fix/re-dispatch prompt after REVISE verdict.
 * Includes findings as a numbered list with severity/description/file/line.
 */
export function buildFixPrompt(
  task: TaskSpec,
  findings: ReviewFinding[],
  round: number,
): string;

/**
 * Build the review dispatch prompt (used by review stub and later by plan 04).
 * Instructs the reviewer agent to evaluate the implementation against
 * acceptance criteria and produce a structured verdict.
 */
export function buildReviewPrompt(
  task: TaskSpec,
  filesChanged: string[],
  round: number,
): string;
```

**Template structure (buildTaskPrompt)**

```
# Task: {title}

## Details
{details}

## Acceptance Criteria
{acceptanceCriteria as numbered list}

## Relevant Files
{relevantFiles as bullet list}

## Instructions
- Implement the task as described above
- Run tests to verify your work
- Commit your changes with a descriptive message
- Report your status: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, or BLOCKED
- If DONE_WITH_CONCERNS, describe your concerns
- If NEEDS_CONTEXT or BLOCKED, explain what you need
```

**Template structure (buildFixPrompt)**

```
# Fix Round {round}: {title}

The following issues were found during review. Fix each one.

## Findings
1. [{severity}] {description}
   File: {file}:{line}
...

## Instructions
- Address each finding above
- Run tests to verify your fixes
- Commit your changes
- Report your status: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, or BLOCKED
```

**Acceptance criteria**

- `buildTaskPrompt` includes title, details, acceptance criteria, relevant files, and status reporting instructions
- `buildFixPrompt` includes all findings as a numbered list with severity, description, file, and line
- `buildFixPrompt` includes round number for context
- `buildReviewPrompt` includes acceptance criteria and files changed, asks for SHIP/REVISE/RETHINK verdict with findings in structured format
- All builders are pure functions (no I/O, no side effects)
- Empty fields are handled gracefully (e.g., empty acceptance criteria → "No explicit criteria provided")
- Unit tests verify output format for each builder

**Dependencies**

Task 1 (types)

**Estimated scope**

~150 lines + ~100 lines test.

---

## Task 4: Worker Settings Generator

**Description**

Generates the `.claude/settings.json` file installed in each worker's worktree. Controls tool scoping, hook registration, and MCP server configuration. Risk level determines which tools are allowed/disallowed.

The settings file is the integration point for hooks (Task 5) — it tells Claude Code to invoke the budget monitor, compaction detector, and budget report scripts at the appropriate lifecycle events.

**Files to create**

- `src/worker/settings.ts`
- `src/worker/__tests__/settings.test.ts`

**Key functions**

```typescript
import type { RiskLevel } from '../orchestrator/types.js';
import type { WorkerConfig } from './types.js';

export interface WorkerSettings {
  permissions: {
    allow: string[];
    deny: string[];
  };
  hooks: {
    SessionStart: HookEntry[];
    PreToolUse: HookEntry[];
    PostToolUse: HookEntry[];
    PreCompact: HookEntry[];
    Stop: HookEntry[];
  };
  mcpServers: Record<string, McpServerEntry>;
}

interface HookEntry {
  matcher: string;
  command: string;
}

interface McpServerEntry {
  command: string;
  args: string[];
}

/**
 * Generate settings.json content for a worker session.
 * Tool scoping is risk-proportional per spec Section 9.
 */
export function generateWorkerSettings(
  risk: RiskLevel,
  config: WorkerConfig,
  taskId: number,
): WorkerSettings;

/**
 * Write settings.json and install hook scripts into a worktree.
 */
export function installWorkerSettings(
  worktreePath: string,
  risk: RiskLevel,
  config: WorkerConfig,
  taskId: number,
): void;
```

**Tool scoping by risk level**

| Risk | Allowed | Denied |
|------|---------|--------|
| trivial | Read, Write, Edit, Glob, Grep | Bash, WebSearch, WebFetch, Skill, NotebookEdit |
| standard | Read, Write, Edit, Glob, Grep, Bash | WebSearch, WebFetch, Skill, NotebookEdit |
| elevated | Read, Write, Edit, Glob, Grep, Bash | WebSearch, WebFetch, Skill, NotebookEdit |
| critical | Read, Write, Edit, Glob, Grep, Bash | WebSearch, WebFetch, Skill, NotebookEdit |

**Hook registration**

- `PostToolUse` with empty matcher → `bash hooks/budget-monitor.sh`
- `PreCompact` with empty matcher → `bash hooks/compaction-detector.sh`
- `Stop` with empty matcher → `bash hooks/budget-report.sh`
- `mcpServers.context-mode` → `{ command: "npx", args: ["-y", "@anthropic/context-mode"] }`

**Acceptance criteria**

- Trivial risk: `Bash` is in deny list
- All other risk levels: `Bash` is in allow list
- `WebSearch`, `WebFetch`, `Skill`, `NotebookEdit` always denied
- Hook entries reference scripts by relative path from worktree root (`hooks/budget-monitor.sh`)
- `installWorkerSettings` creates `.claude/` directory, writes `settings.json`, copies hook scripts to `hooks/` directory in worktree
- Hook scripts are executable (chmod +x)
- Idempotent: running twice produces identical results
- Settings JSON is valid JSON (tested by parsing output)

**Dependencies**

Task 1 (types)

**Estimated scope**

~130 lines + ~80 lines test.

---

## Task 5: Hook Scripts

**Description**

Three shell scripts that run inside the worker's Claude Code session as lifecycle hooks. These are the ONLY shell scripts in the worker dispatch layer — everything else is TypeScript. They must be shell because Claude Code's hook system invokes them as executables.

Each hook reads JSON from stdin (Claude Code's hook invocation data), performs its function, and writes event files to `.roadrunner/events/` for the CLI wrapper (Task 6) to detect.

**Files to create**

- `src/worker/hooks/budget-monitor.sh`
- `src/worker/hooks/compaction-detector.sh`
- `src/worker/hooks/budget-report.sh`

**budget-monitor.sh (~80 lines)**

Reads `context_utilization_pct` from stdin JSON on every PostToolUse invocation. Fires at three thresholds (each fires exactly once per session):

- **40%**: Writes `CONTEXT_WARNING` event with `action: "warn"`
- **60%**: Writes `CONTEXT_WARNING` event with `action: "save_state"`
- **70%**: Writes `CONTEXT_WARNING` event with `action: "handoff"`. Also writes `HANDOFF_READY` event.

Threshold state tracked in `.roadrunner/budget_state/{session_id}.json`. Performance target: <50ms per invocation.

```bash
#!/usr/bin/env bash
set -euo pipefail

# Read hook input from stdin
INPUT=$(cat)
UTIL_PCT=$(echo "$INPUT" | jq -r '.context_utilization_pct // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

# Exit early if no utilization data
if [ -z "$UTIL_PCT" ]; then exit 0; fi

# Load/create threshold state
STATE_DIR=".roadrunner/budget_state"
STATE_FILE="$STATE_DIR/$SESSION_ID.json"
mkdir -p "$STATE_DIR"
if [ ! -f "$STATE_FILE" ]; then
  echo '{"fired_40":false,"fired_60":false,"fired_70":false}' > "$STATE_FILE"
fi

# ... threshold checks, event writes to .roadrunner/events/ ...
```

**compaction-detector.sh (~30 lines)**

Fires on PreCompact events. Compaction should never happen in a healthy pipeline — this hook writes a `COMPACTION_DETECTED` event when it does.

```bash
#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
TASK_ID=$(cat .roadrunner/current_task_id 2>/dev/null || echo "0")
EVENT_DIR=".roadrunner/events"
mkdir -p "$EVENT_DIR"
EVENT_FILE="$EVENT_DIR/$(date +%s%N)-compaction.json"
cat > "$EVENT_FILE" <<EOF
{"event":"COMPACTION_DETECTED","task_id":$TASK_ID,"session_id":"$SESSION_ID","utilization_at_compaction":$(echo "$INPUT" | jq '.context_utilization_pct // 0')}
EOF
```

**budget-report.sh (~40 lines)**

Fires on Stop event. Writes a summary of context utilization to `.roadrunner/events/` for the result parser to include in the WorkerComplete event.

**Acceptance criteria**

- All scripts are executable (`chmod +x`)
- All scripts read JSON from stdin, handle missing/malformed input gracefully (exit 0, never crash the worker)
- budget-monitor: writes event files to `.roadrunner/events/` at correct thresholds
- budget-monitor: each threshold fires exactly once per session (state file prevents duplicates)
- compaction-detector: writes `COMPACTION_DETECTED` event on PreCompact
- budget-report: writes utilization summary on Stop
- Event files use unique names (timestamp + type) to prevent collisions
- Scripts require `jq` on PATH (validated at install time in Task 4)
- Performance: budget-monitor completes in <50ms (no network calls, only local file I/O)

**Dependencies**

Task 4 (hook scripts are installed by `installWorkerSettings`)

**Estimated scope**

~150 lines of shell total across 3 scripts.

---

## Task 6: CLI Invocation Wrapper

**Description**

The core execution engine. Spawns `claude --bare -p "{prompt}" --output-format json --max-turns N --model M` as a subprocess in a worktree directory, manages the process lifecycle (timeout, signals), and monitors `.roadrunner/events/` for hook-emitted events (budget warnings, handoffs, compaction) during execution.

This is the only module that invokes the `claude` binary. It returns a raw `ExecResult` — semantic interpretation is handled by the result parser (Task 7).

**Files to create**

- `src/worker/execute.ts`
- `src/worker/__tests__/execute.test.ts`

**Key functions**

```typescript
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
  hookEvents: HookEvent[];  // Events detected during execution
}

/**
 * Invoke claude CLI in a worktree with the given prompt.
 * Monitors .roadrunner/events/ for hook signals during execution.
 * Returns raw output + any hook events detected.
 */
export async function invokeClaude(options: ExecuteOptions): Promise<ExecuteResult>;

/**
 * Write the current task ID to .roadrunner/current_task_id
 * (read by hook scripts to tag events with the task).
 */
function writeTaskIdMarker(worktreePath: string, taskId: number): void;

/**
 * Poll .roadrunner/events/ directory for new event files.
 * Returns parsed events and removes consumed files.
 */
function pollHookEvents(worktreePath: string): HookEvent[];
```

**Execution flow**

1. Write task ID marker to worktree (`.roadrunner/current_task_id`)
2. Clear any stale event files from `.roadrunner/events/`
3. Spawn `claude` subprocess with `child_process.spawn`:
   - `claude --bare -p "{prompt}" --output-format json --max-turns {maxTurns} --model {model}`
   - cwd: `worktreePath`
   - Capture stdout and stderr
4. Start polling `.roadrunner/events/` at 2-second intervals
5. If `HANDOFF_READY` detected during execution: let the process finish naturally (the budget monitor hook will guide the worker to wrap up)
6. On timeout: send SIGTERM, wait 10s, send SIGKILL if still alive
7. On process exit: stop polling, collect any remaining events
8. Return `ExecResult` + collected `HookEvent[]`

**Acceptance criteria**

- Invokes `claude` with correct flags: `--bare -p --output-format json --max-turns --model`
- cwd is set to the worktree path
- stdout and stderr are captured completely
- Wall-clock timeout: SIGTERM then SIGKILL after 10s grace period
- `timed_out: true` in result when timeout fires
- On non-zero exit with no stdout: retries once with same parameters, sets `retried: true`
- On non-zero exit with valid JSON stdout: returns the result (CLI may exit non-zero but produce valid output)
- Hook events polled from `.roadrunner/events/` during execution
- Event files are removed after reading (prevent duplicate processing)
- `duration_ms` accurately measures wall-clock time of the subprocess
- Tests use a mock `claude` binary (shell script that outputs valid JSON) — do NOT invoke real claude CLI
- Test timeout behavior with a mock binary that sleeps

**Dependencies**

Task 1 (types), Task 2 (worktree must exist), Task 4 (settings installed)

**Estimated scope**

~250 lines + ~150 lines test.

---

## Task 7: Result Parser

**Description**

Parses the raw CLI output from Task 6 into a structured `WorkerComplete` event for the orchestrator. Extracts status from the worker's output text, computes `files_changed` from git diff, and writes a result artifact to `.roadrunner/results/TASK-{id}.json`.

**Files to create**

- `src/worker/result.ts`
- `src/worker/__tests__/result.test.ts`

**Key functions**

```typescript
import type { WorkerComplete } from '../orchestrator/events.js';
import type { ExecResult, HookEvent, WorkerConfig, SessionTracker } from './types.js';

/**
 * Parse CLI output into a WorkerComplete event.
 */
export function parseCliOutput(
  exec: ExecResult,
  hookEvents: HookEvent[],
  taskId: number,
  worktreePath: string,
  round: number,
  config: WorkerConfig,
): WorkerComplete;

/**
 * Extract status keyword from worker's result text.
 * Checks in order: DONE_WITH_CONCERNS, DONE, NEEDS_CONTEXT, BLOCKED
 * (DONE_WITH_CONCERNS before DONE to avoid false match on prefix).
 */
export function extractStatus(
  resultText: string,
  isError: boolean,
  filesChanged: string[],
  timedOut: boolean,
  maxTurnsExceeded: boolean,
): { status: WorkerComplete['status']; concerns: string | null };

/**
 * Write result artifact to .roadrunner/results/TASK-{id}.json
 */
export function writeResultArtifact(
  event: WorkerComplete,
  round: number,
  model: string,
  config: WorkerConfig,
): string;  // returns artifact path
```

**Status extraction logic**

1. Search result text for status keywords in order: `DONE_WITH_CONCERNS` → `DONE` → `NEEDS_CONTEXT` → `BLOCKED`
2. If keyword found: use it. Extract concerns text after `DONE_WITH_CONCERNS` if present.
3. If no keyword found:
   - If `timedOut`: status = `BLOCKED`, concerns = "timed out"
   - If `maxTurnsExceeded` (num_turns == max_turns and no explicit status): status = `BLOCKED`, concerns = "max turns exceeded without completion"
   - If `isError`: status = `BLOCKED`, concerns = stderr excerpt
   - If `filesChanged` is non-empty: status = `DONE_WITH_CONCERNS`, concerns = "completed work but did not report explicit status"
   - If `filesChanged` is empty: status = `BLOCKED`, concerns = "no changes made and no status reported"

**Result artifact schema**

```json
{
  "task_id": 1,
  "status": "DONE",
  "round": 1,
  "model": "sonnet",
  "timestamp": "2026-04-15T10:30:00Z",
  "cost_usd": 0.12,
  "duration_ms": 45000,
  "files_changed": ["src/db/search.ts"],
  "concerns": null,
  "hook_events": []
}
```

**Acceptance criteria**

- Correctly parses valid Claude Code JSON output (extracts `result`, `cost_usd`, `duration_ms`, `num_turns`, `session_id`, `is_error`)
- Status extraction follows the priority order and fallback logic above
- `DONE_WITH_CONCERNS` matched before `DONE` (order matters)
- `files_changed` computed from `git diff --name-only {base}...HEAD` in worktree
- Result artifact written to `.roadrunner/results/TASK-{id}.json` (or `TASK-{id}-r{round}.json` for re-dispatch rounds)
- Creates `.roadrunner/results/` directory if it doesn't exist
- Handles malformed CLI output gracefully (no JSON → status BLOCKED with stderr as concern)
- Hook events from execution are included in the artifact for telemetry
- Cost is extracted from CLI JSON `cost_usd` field, falls back to 0 if missing
- Unit tests cover: valid JSON output, crashed output (no JSON), timeout output, missing-status with/without file changes, DONE_WITH_CONCERNS extraction

**Dependencies**

Task 1 (types)

**Estimated scope**

~180 lines + ~150 lines test.

---

## Task 8: Predecessor Context Assembly

**Description**

Assembles context from completed predecessor tasks for injection into a worker session. Queries the task substrate for completed tasks that the current task depends on, extracts their decisions, modified files, and commit hashes, and writes a `session_context.json` file that the SessionStart hook can read.

This enables the context-mode MCP server's predecessor query mechanism — the SessionStart hook indexes predecessor events into FTS5 for BM25 search during the worker session.

**Files to create**

- `src/worker/context.ts`
- `src/worker/__tests__/context.test.ts`

**Key functions**

```typescript
import type { TaskSpec } from '../orchestrator/types.js';
import type { WorkerConfig } from './types.js';

export interface PredecessorContext {
  task_id: number;
  predecessor_tasks: PredecessorSummary[];
  pipeline_run_id: string;
}

export interface PredecessorSummary {
  task_id: number;
  title: string;
  status: string;
  files_changed: string[];
  result_path: string | null;
  commit_sha: string | null;
}

/**
 * Assemble predecessor context from completed tasks.
 * Reads result artifacts from .roadrunner/results/ for each dependency.
 */
export function assemblePredecessorContext(
  task: TaskSpec,
  completedTasks: Record<number, { result_path: string | null; title: string; status: string }>,
  repoRoot: string,
  config: WorkerConfig,
): PredecessorContext;

/**
 * Write session_context.json to the worktree for the SessionStart hook.
 */
export function writeSessionContext(
  worktreePath: string,
  context: PredecessorContext,
): void;
```

**Acceptance criteria**

- Reads result artifacts for each task ID in the current task's `dependencies` array
- Extracts `files_changed`, `commit_sha` (from git log in the task's branch), and `result_path` from each predecessor
- Writes `session_context.json` to `{worktreePath}/.roadrunner/session_context.json`
- Creates `.roadrunner/` in the worktree if it doesn't exist
- Handles missing result artifacts gracefully (predecessor completed but artifact not found → include with null fields)
- Handles empty dependencies (writes minimal context with empty `predecessor_tasks`)
- Pure function (assemblePredecessorContext) + I/O function (writeSessionContext) separated for testability
- Unit tests verify context assembly with mock task data

**Dependencies**

Task 1 (types)

**Estimated scope**

~100 lines + ~80 lines test.

---

## Task 9: Worktree Merge

**Description**

Merges a task's branch back to the base branch after the task ships. This enables the ENG-180 lesson: "treat merges to main as integration checkpoint, not all tasks complete." Each shipped task is merged incrementally so subsequent tasks work against up-to-date code.

The merge uses `--no-ff` to preserve task branch history. On conflict: attempts rebase in the worktree first, then re-attempts merge. On second failure: reports the conflict (does not force-resolve).

After a successful merge, the worktree and branch are cleaned up.

**Files to create**

- `src/worker/merge.ts`
- `src/worker/__tests__/merge.test.ts`

**Key functions**

```typescript
import type { MergeResult, WorkerConfig } from './types.js';

/**
 * Merge a task's branch into the base branch and clean up.
 *
 * Flow:
 * 1. Ensure all changes in the worktree are committed
 * 2. Switch to base branch in the main repo
 * 3. git merge --no-ff task-{taskId}
 * 4. On conflict: abort merge, rebase task branch, retry merge
 * 5. On success: remove worktree and delete task branch
 * 6. On second failure: report conflicts, leave worktree intact
 */
export function mergeTaskBranch(
  taskId: number,
  config: WorkerConfig,
  repoRoot: string,
): MergeResult;

/**
 * Remove a task's worktree and branch without merging.
 * Used for skipped tasks.
 */
export function discardTaskBranch(
  taskId: number,
  config: WorkerConfig,
  repoRoot: string,
): void;
```

**Acceptance criteria**

- Successful merge: task branch merged to base with `--no-ff`, worktree removed, branch deleted
- Merge commit message: `"merge: task-{taskId} — {task title}"`
- On conflict first attempt: aborts merge, runs `git rebase {base}` in worktree, re-attempts merge
- On conflict second attempt: returns `{ success: false, conflict_files: [...] }`, worktree left intact for manual resolution
- `discardTaskBranch` removes worktree and branch without merging (calls `removeWorktree` from Task 2)
- Uncommitted changes are committed as WIP before merge attempt (calls `commitWip` from Task 2)
- Does not force-push or use destructive git operations
- Unit tests use a temporary git repo with divergent branches to test conflict path

**Dependencies**

Task 2 (worktree lifecycle functions)

**Estimated scope**

~150 lines + ~120 lines test.

---

## Task 10: Orchestrator Amendment — Task Status Dispatch

**Description**

Small, surgical change to the orchestrator. Currently, when the machine marks a task as done or skipped (`markTaskDone`, `markTaskSkipped`), it updates internal context but never dispatches `UPDATE_TASK_STATUS` to the bus. This means:
1. Taskmaster doesn't know tasks are done (the task substrate handler has the code but never receives the command)
2. The worker handler has no signal to trigger incremental merge

This task adds a `dispatchUpdateTaskStatus` action and fires it in the machine alongside `markTaskDone` and `markTaskSkipped`.

**Files to modify**

- `src/orchestrator/actions.ts` — add `dispatchUpdateTaskStatus` function
- `src/orchestrator/machine.ts` — add `'dispatchUpdateTaskStatus'` to transition actions where `markTaskDone` and `markTaskSkipped` fire
- `src/orchestrator/__tests__/machine.test.ts` — verify the command is dispatched

**Code changes**

In `actions.ts`, add:

```typescript
export function dispatchUpdateTaskStatus({
  context,
}: {
  context: OrchestratorContext;
  event: OrchestratorEvent;
}): void {
  if (context.current_task_id === null) return;

  const task = context.tasks[context.current_task_id];
  if (!task) return;

  dispatch({
    type: 'UPDATE_TASK_STATUS',
    task_id: context.current_task_id,
    status: task.status,
  });
}
```

In `machine.ts`, wherever `markTaskDone` or `markTaskSkipped` appears in an actions array, add `'dispatchUpdateTaskStatus'` after it. The `markTask*` assign action updates the context first, then `dispatchUpdateTaskStatus` reads the updated status and dispatches.

**Acceptance criteria**

- `UPDATE_TASK_STATUS` command dispatched to bus after every `markTaskDone` (with status 'done')
- `UPDATE_TASK_STATUS` command dispatched to bus after every `markTaskSkipped` (with status 'skipped')
- Existing tests continue to pass (no behavioral change to the state machine)
- New test: verify that transitioning through a SHIP verdict dispatches `UPDATE_TASK_STATUS` with the correct task_id and status
- The `dispatchUpdateTaskStatus` action is registered in `setup()` alongside other dispatcher actions

**Dependencies**

None (modifies existing orchestrator code).

**Estimated scope**

~40 lines changed across 3 files.

---

## Task 11: Worker Handler + Layer 4 Stubs

**Description**

The integration hub. Creates a command handler following the `createTaskSubstrateHandler()` pattern that handles all worker-layer commands. Registers on the event bus and routes commands to the appropriate modules.

Includes stub implementations for Layer 4 commands (`GENERATE_EXPERT`, `RUN_REVIEW`) that produce valid events with minimal logic. These stubs let the full pipeline flow work before plan 04 replaces them with real expert generation and review dispatch.

The handler also listens for `UPDATE_TASK_STATUS` commands (dispatched by the orchestrator after Task 10) to trigger incremental merge (done → merge) or cleanup (skipped → discard).

**Files to create**

- `src/worker/handler.ts`
- `src/worker/__tests__/handler.test.ts`
- `src/worker/index.ts` (barrel exports)

**Key structure**

```typescript
import type { OrchestratorCommand } from '../orchestrator/commands.js';
import type { OrchestratorEvent } from '../orchestrator/events.js';
import type { WorkerConfig, SessionTracker } from './types.js';

type SendEvent = (event: OrchestratorEvent) => void;

export interface WorkerDeps {
  config: WorkerConfig;
  repoRoot: string;
}

/**
 * Create a command handler for the worker layer.
 * Handles: GENERATE_EXPERT (stub), DISPATCH_WORKER, RUN_REVIEW (stub),
 *          UPDATE_TASK_STATUS (merge/cleanup trigger)
 */
export function createWorkerHandler(
  deps: WorkerDeps,
  sendEvent: SendEvent,
): (command: OrchestratorCommand) => void;
```

**Command routing**

| Command | Handler | Notes |
|---------|---------|-------|
| `GENERATE_EXPERT` | `handleGenerateExpert()` | **Stub:** writes minimal expert prompt, returns EXPERT_READY with drift_check: 'pass' |
| `DISPATCH_WORKER` | `handleDispatchWorker()` | **Full:** create worktree → install settings → install prompt → build task prompt → invoke CLI → parse result → write artifact → send WorkerComplete |
| `RUN_REVIEW` | `handleRunReview()` | **Stub:** auto-SHIP for trivial, auto-SHIP with round check for others. Returns ReviewComplete. |
| `UPDATE_TASK_STATUS` | `handleTaskStatusChange()` | **Full:** done → merge task branch; skipped → discard task branch |
| Other commands | Ignored | Commands for other layers pass through |

**Internal state**

```typescript
// Pending merge promise — DISPATCH_WORKER waits for this before creating new worktree
let pendingMerge: Promise<void> | null = null;

// Session trackers per task — tracks dispatch count, handoff count, cost
const sessions: Map<number, SessionTracker> = new Map();
```

**DISPATCH_WORKER flow**

```typescript
async function handleDispatchWorker(command: DispatchWorker): Promise<void> {
  // 1. Wait for any pending merge from previous task
  if (pendingMerge) await pendingMerge;

  // 2. Create or reuse worktree
  const worktree = createWorktree(command.task_id, config, repoRoot);

  // 3. Install expert prompt as .claude/CLAUDE.md
  installExpertPrompt(worktree.path, command.expert_prompt_path);

  // 4. Install worker settings (tool scoping + hooks)
  installWorkerSettings(worktree.path, risk, config, command.task_id);

  // 5. Assemble predecessor context
  const predContext = assemblePredecessorContext(command.task_spec, ...);
  writeSessionContext(worktree.path, predContext);

  // 6. Build task prompt (or fix prompt for re-dispatch)
  const prompt = isRedispatch
    ? buildFixPrompt(command.task_spec, lastFindings, round)
    : buildTaskPrompt(command.task_spec);

  // 7. Invoke claude CLI
  const { exec, hookEvents } = await invokeClaude({
    worktreePath: worktree.path,
    prompt,
    maxTurns: command.max_turns,
    model: command.model,
    timeoutMs: config.timeout_overrides?.[risk] ?? orchestratorTimeout,
    taskId: command.task_id,
    config,
  });

  // 8. Parse result into WorkerComplete event
  const event = parseCliOutput(exec, hookEvents, command.task_id, worktree.path, round, config);

  // 9. Update session tracker
  updateSession(command.task_id, event);

  // 10. Send event to orchestrator
  sendEvent(event);
}
```

**GENERATE_EXPERT stub**

```typescript
async function handleGenerateExpert(command: GenerateExpert): Promise<void> {
  // Stub: write a minimal expert prompt from task spec
  const promptContent = [
    `# Expert: ${command.task.title}`,
    '',
    `## Task Details`,
    command.task.details,
    '',
    `## Acceptance Criteria`,
    ...command.task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
    '',
    `## Relevant Files`,
    ...command.task.relevantFiles.map(f => `- ${f}`),
    '',
    '## Status Reporting',
    'Report: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED',
  ].join('\n');

  const expertDir = path.join(config.artifact_root, 'experts');
  fs.mkdirSync(expertDir, { recursive: true });
  const expertPath = path.join(expertDir, `TASK-${command.task_id}.md`);
  fs.writeFileSync(expertPath, promptContent);

  sendEvent({
    type: 'EXPERT_READY',
    task_id: command.task_id,
    expert_prompt_path: expertPath,
    drift_check: 'pass',
    drift_details: null,
  });
}
```

**RUN_REVIEW stub**

```typescript
async function handleRunReview(command: RunReview): Promise<void> {
  // Stub: auto-SHIP (real implementation from plan 04 replaces this)
  sendEvent({
    type: 'REVIEW_COMPLETE',
    task_id: command.task_id,
    verdict: 'SHIP',
    round: command.round,
    report_path: '',
    findings: [],
  });
}
```

**Acceptance criteria**

- Handler registers on bus and routes all four command types correctly
- DISPATCH_WORKER: full lifecycle from worktree creation to WorkerComplete event emission
- DISPATCH_WORKER for re-dispatch: reuses existing worktree, builds fix prompt, increments round in session tracker
- GENERATE_EXPERT stub: writes minimal expert prompt, returns EXPERT_READY with pass
- RUN_REVIEW stub: returns SHIP verdict with empty findings
- UPDATE_TASK_STATUS with done: triggers async merge, sets pendingMerge
- UPDATE_TASK_STATUS with skipped: triggers discard (remove worktree + branch)
- DISPATCH_WORKER waits for pendingMerge before creating new worktree
- Session tracker accurately counts dispatches and accumulates cost
- Error handling: any exception in the flow sends a DISPATCH_ERROR event (does not throw)
- Barrel export (`index.ts`) exports: createWorkerHandler, WorkerDeps, all types
- Handler tests mock invokeClaude to avoid real CLI calls
- Tests verify: successful dispatch flow, re-dispatch flow, merge trigger, error propagation

**Dependencies**

All previous tasks (1-10)

**Estimated scope**

~250 lines handler + ~50 lines barrel + ~200 lines test.

---

## Task 12: End-to-End Integration Test

**Description**

Integration test that wires the orchestrator, task substrate, and worker handler together and runs a multi-task pipeline using a mock `claude` binary. Validates the full event flow from START to FINISH_COMPLETE, including decomposition, expert generation (stub), worker dispatch, review (stub), incremental merge, and task iteration.

Uses the same mock claude approach as the orchestrator's integration test, but now the worker handler actually invokes the mock binary instead of the orchestrator just replaying events.

**Files to create**

- `src/worker/__tests__/integration.test.ts`
- `src/worker/__tests__/fixtures/mock-claude.sh` — mock claude binary that outputs valid JSON

**Mock claude binary**

```bash
#!/usr/bin/env bash
# Mock claude binary for integration tests.
# Reads -p flag for prompt, outputs valid Claude Code JSON.
echo '{"type":"result","subtype":"success","cost_usd":0.05,"duration_ms":10000,"num_turns":3,"session_id":"test-session","is_error":false,"result":"DONE\n\nImplemented the requested changes."}'
# Create a dummy file to simulate work
touch "$PWD/src/dummy-change.ts"
git add -A && git commit -m "feat: implement task" --allow-empty 2>/dev/null || true
```

**Test scenarios**

1. **Single task, happy path**: START → TRIAGE → develop(decompose → task_ready → expert_ready → dispatch_worker → worker_complete → review_complete(SHIP) → all_complete) → FINISH
   - Verify: worktree created, CLI invoked with correct flags, result parsed, worktree merged to main, final state is done

2. **Two tasks, sequential**: Same as above but with 2 tasks, verifying that task 1's branch is merged before task 2's worktree is created

3. **Worker returns BLOCKED**: Mock claude outputs BLOCKED status → verify escalation event

4. **Timeout**: Mock claude sleeps beyond timeout → verify SIGTERM, timed_out=true, BLOCKED status

**Acceptance criteria**

- Test 1: full pipeline completes with state `done`, mock claude invoked exactly once, worktree created and merged
- Test 2: task 1 merged before task 2 starts, both tasks complete, final state done
- Test 3: WorkerComplete with status BLOCKED triggers escalation
- Test 4: timed out worker produces correct ExecResult
- All tests use temporary git repos (no side effects on the real repo)
- Mock claude binary is used instead of real CLI
- Tests validate actual git state (branches created, merged, cleaned up)

**Dependencies**

Task 11 (handler must be complete)

**Estimated scope**

~300 lines test + ~20 lines mock script.

---

## File Inventory

### New files (22)

| File | Task | Purpose |
|------|------|---------|
| `src/worker/types.ts` | 1 | Worker-layer types + configuration |
| `src/worker/worktree.ts` | 2 | Git worktree lifecycle management |
| `src/worker/__tests__/worktree.test.ts` | 2 | Worktree unit tests |
| `src/worker/prompt.ts` | 3 | Task/fix/review prompt builders |
| `src/worker/__tests__/prompt.test.ts` | 3 | Prompt builder tests |
| `src/worker/settings.ts` | 4 | Worker settings.json generator |
| `src/worker/__tests__/settings.test.ts` | 4 | Settings generator tests |
| `src/worker/hooks/budget-monitor.sh` | 5 | Three-tier budget threshold hook |
| `src/worker/hooks/compaction-detector.sh` | 5 | Compaction failure signal hook |
| `src/worker/hooks/budget-report.sh` | 5 | Stop-event utilization report hook |
| `src/worker/execute.ts` | 6 | Claude CLI invocation wrapper |
| `src/worker/__tests__/execute.test.ts` | 6 | CLI invocation tests |
| `src/worker/result.ts` | 7 | CLI output → WorkerComplete parser |
| `src/worker/__tests__/result.test.ts` | 7 | Result parser tests |
| `src/worker/context.ts` | 8 | Predecessor context assembly |
| `src/worker/__tests__/context.test.ts` | 8 | Context assembly tests |
| `src/worker/merge.ts` | 9 | Post-SHIP incremental merge |
| `src/worker/__tests__/merge.test.ts` | 9 | Merge tests |
| `src/worker/handler.ts` | 11 | Unified command handler + Layer 4 stubs |
| `src/worker/__tests__/handler.test.ts` | 11 | Handler unit tests |
| `src/worker/index.ts` | 11 | Barrel exports |
| `src/worker/__tests__/integration.test.ts` | 12 | End-to-end pipeline test |
| `src/worker/__tests__/fixtures/mock-claude.sh` | 12 | Mock claude binary |

### Modified files (3)

| File | Task | Change |
|------|------|--------|
| `src/orchestrator/actions.ts` | 10 | Add `dispatchUpdateTaskStatus` |
| `src/orchestrator/machine.ts` | 10 | Fire `dispatchUpdateTaskStatus` after markTaskDone/markTaskSkipped |
| `src/orchestrator/__tests__/machine.test.ts` | 10 | Test UPDATE_TASK_STATUS dispatch |

---

## Total Estimated Scope

| Task | TypeScript LOC | Shell LOC | Test LOC | Total |
|------|---------------|-----------|----------|-------|
| 1. Types + config | 100 | — | — | 100 |
| 2. Worktree manager | 200 | — | 150 | 350 |
| 3. Prompt builders | 150 | — | 100 | 250 |
| 4. Settings generator | 130 | — | 80 | 210 |
| 5. Hook scripts | — | 150 | — | 150 |
| 6. CLI invocation | 250 | — | 150 | 400 |
| 7. Result parser | 180 | — | 150 | 330 |
| 8. Predecessor context | 100 | — | 80 | 180 |
| 9. Worktree merge | 150 | — | 120 | 270 |
| 10. Orchestrator amend | 40 | — | 30 | 70 |
| 11. Handler + stubs | 300 | — | 200 | 500 |
| 12. Integration test | — | 20 | 300 | 320 |
| **Total** | **~1,600** | **~170** | **~1,360** | **~3,130** |

With parallelism on independent tasks (3, 4, 7, 8, 9, 10 can run concurrently after Task 1-2), wall-clock implementation time is ~4-5 focused sessions.

---

## Integration Points

### Upstream: Orchestrator (Layer 2)

The orchestrator dispatches commands and receives events via the event bus. The worker handler registers via `bus.onCommand()` alongside the task substrate handler. Commands consumed:

| Command | Source action | Response event |
|---------|-------------|---------------|
| `GENERATE_EXPERT` | `dispatchGenerateExpert()` | `EXPERT_READY` |
| `DISPATCH_WORKER` | `dispatchWorker()` | `WORKER_COMPLETE` |
| `RUN_REVIEW` | `dispatchReview()` | `REVIEW_COMPLETE` |
| `UPDATE_TASK_STATUS` | `dispatchUpdateTaskStatus()` (Task 10) | None (side effect: merge/cleanup) |

### Upstream: Task Substrate (Layer 3)

The handler reads task data from orchestrator context (passed via commands). For predecessor context assembly, it reads result artifacts from `.roadrunner/results/` — no direct dependency on the task substrate module.

### Downstream: Plan 04 (Layer 4 — Expert Gen + Review)

The Layer 4 stubs in `handler.ts` will be replaced when plan 04 is executed. The interface is:

```typescript
// Plan 04 will implement these, replacing the stubs:
type ExpertGenerator = (command: GenerateExpert) => Promise<ExpertReady>;
type ReviewRunner = (command: RunReview) => Promise<ReviewComplete>;
```

The handler accepts these as injectable dependencies in `WorkerDeps`, defaulting to the stubs.

### Downstream: Plan 06 (Layer 6 — Sandbox/Isolation)

Plan 06 configures user-scope settings, pre-bash firewalls, and audit hooks. These are system-level configurations that complement the per-worktree settings generated by Task 4. No code dependency — they operate at different scopes.

### File Layout

```
plugins/roadrunner/
  src/
    orchestrator/          # Layer 2 (existing)
    task-substrate/        # Layer 3 (existing)
    worker/                # Layers 4-stub + 5 + 7 (this plan)
      types.ts
      worktree.ts
      prompt.ts
      settings.ts
      execute.ts
      result.ts
      context.ts
      merge.ts
      handler.ts
      index.ts
      hooks/
        budget-monitor.sh
        compaction-detector.sh
        budget-report.sh
      __tests__/
        worktree.test.ts
        prompt.test.ts
        settings.test.ts
        execute.test.ts
        result.test.ts
        context.test.ts
        merge.test.ts
        handler.test.ts
        integration.test.ts
        fixtures/
          mock-claude.sh
```

### Event Flow (with merge)

```
Orchestrator                Worker Handler               Claude Code CLI
    |                            |                            |
    |-- GENERATE_EXPERT -------->|                            |
    |                            |-- write expert prompt      |
    |<-- EXPERT_READY -----------|                            |
    |                            |                            |
    |-- DISPATCH_WORKER -------->|                            |
    |                            |-- await pending merge      |
    |                            |-- createWorktree           |
    |                            |-- installExpertPrompt      |
    |                            |-- installWorkerSettings    |
    |                            |-- writeSessionContext      |
    |                            |-- buildTaskPrompt          |
    |                            |-- invokeClaude ----------->|
    |                            |                            |
    |                            |   [hooks fire on each tool]|
    |                            |   budget-monitor checks %  |
    |                            |                            |
    |                            |<-- JSON result ------------|
    |                            |-- parseCliOutput           |
    |                            |-- writeResultArtifact      |
    |<-- WORKER_COMPLETE --------|                            |
    |                            |                            |
    |-- RUN_REVIEW ------------->|                            |
    |                            |-- [stub: auto-SHIP]        |
    |<-- REVIEW_COMPLETE --------|                            |
    |                            |                            |
    |-- UPDATE_TASK_STATUS ----->|  (done)                    |
    |   (also to task-substrate) |-- mergeTaskBranch (async)  |
    |                            |   pendingMerge = merge()   |
    |                            |                            |
    |-- QUERY_NEXT_TASK -------->|  (to task-substrate)       |
    |<-- QUERY_RESULT -----------|  (task_ready)              |
    |                            |                            |
    |-- GENERATE_EXPERT -------->|  (next task)               |
    |   ...                      |                            |
    |                            |                            |
    |-- UPDATE_TASK_STATUS ----->|  (skipped)                 |
    |                            |-- discardTaskBranch        |
```

---

## Deferred

- **Real expert generation** (plan 04): vocabulary-routed prompt generation via sub-agent dispatch. This plan stubs it with a minimal template.
- **Real review dispatch** (plan 04): spec compliance solo review + code quality panel review with verdict synthesis. This plan stubs with auto-SHIP.
- **Parallel fan-out** (future): Multiple workers executing concurrently on independent tasks. This plan handles single-worker sequential dispatch.
- **Peer-awareness log**: Log of what each worker did, consumable by subsequent workers. Deferred until parallel fan-out.
- **Sandbox/isolation config** (plan 06): System-level settings, pre-bash firewalls, audit hooks. Separate concern from per-worktree worker settings.
- **Telemetry bridge** (plan 05): Forwarding cost/duration/events to Langfuse. Result artifacts contain the data; the bridge reads them.

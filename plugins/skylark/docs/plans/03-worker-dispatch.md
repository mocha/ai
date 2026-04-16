# Domain 3: Worker Dispatch Harness -- Implementation Plan

## Build Order Summary

```
Task 1: Worktree lifecycle manager (shell)
Task 2: Expert prompt installer (shell)
Task 3: CLI invocation wrapper (shell/Python)
  depends on: Task 1, Task 2
Task 4: Result parser (Python)
  depends on: Task 3
Task 5: Re-dispatch handler (Python)
  depends on: Task 3, Task 4
Task 6: Context engineering hooks setup (shell)
  depends on: Task 2
Task 7: Budget monitor hook (shell)
  depends on: Task 6
Task 8: Handoff protocol (shell/Python)
  depends on: Task 4, Task 7
Task 9: End-to-end integration + harness entry point
  depends on: all above
```

Critical path: 1 -> 3 -> 4 -> 5 -> 9 (the dispatch-execute-parse-redispatch spine).
Parallel track: 2 -> 6 -> 7 -> 8 (prompt install and context engineering).

---

## Task 1: Worktree Lifecycle Manager

**Description**

Shell script that manages the full git worktree lifecycle: create, list, merge, and cleanup. This is the isolation primitive that every worker session depends on. The script must handle stale worktrees, branch conflicts, locked worktrees, and merge conflicts gracefully. All operations are idempotent.

Branch naming convention: `task/TASK-NNN-slug`. Worktree path: `<repo-root>/.worktrees/TASK-NNN-slug/`. The `.worktrees/` directory is created on first use and added to `.gitignore`.

**Files to create/modify**

- `lib/worktree.sh` -- core functions: `worktree_create`, `worktree_remove`, `worktree_merge`, `worktree_list`, `worktree_cleanup_stale`
- `lib/worktree_config.sh` -- constants: default worktree root (`.worktrees/`), stale timeout (24h), branch prefix (`task/`)

**Acceptance criteria**

- `worktree_create <task-id> <slug> [base-branch]` creates a worktree at `.worktrees/TASK-<id>-<slug>/` on branch `task/TASK-<id>-<slug>`, branching from the base branch (default: `main`).
- If the branch or worktree already exists (stale from a prior run), the function removes the stale worktree and branch before creating fresh. No manual intervention required.
- If the worktree is locked (`.git/worktrees/<name>/locked`), the function unlocks it before removal.
- `worktree_merge <task-id> <slug> <base-branch>` attempts `git merge --no-ff`. On conflict: aborts, attempts rebase in the worktree, re-attempts merge. On second failure: exits with conflict file list on stderr and non-zero exit code.
- `worktree_remove <task-id> <slug>` removes the worktree and deletes the branch. Idempotent -- running on an already-removed worktree is a no-op (exit 0).
- `worktree_cleanup_stale <hours>` finds worktrees with no commits newer than `<hours>` and removes them.
- `worktree_list` outputs JSON: `[{"task_id": N, "slug": "...", "branch": "...", "path": "...", "last_commit_age_hours": N}]`.
- All functions log to stderr with `[worktree]` prefix. No stdout output except for `worktree_list`.
- Unit test: create, list, remove cycle in a temporary git repo.

**Dependencies**

None. This is the foundation.

**Estimated scope**

~200 lines of shell. 1 day.

---

## Task 2: Expert Prompt Installer

**Description**

Given a path to an expert prompt file (`.skylark/experts/TASK-NNN.md` in the main tree), copy it into the worktree as `.claude/CLAUDE.md`. Also generate a `.claude/settings.json` in the worktree that configures tool scoping and hook registration for the worker session. The settings file is the integration point for context engineering hooks (Task 6) and budget monitoring (Task 7) -- this task creates the skeleton, later tasks fill in the hook commands.

**Files to create/modify**

- `lib/prompt_installer.sh` -- functions: `install_expert_prompt`, `install_worker_settings`
- `lib/settings_template.json` -- template for `.claude/settings.json` with placeholder hook commands

**Acceptance criteria**

- `install_expert_prompt <worktree-path> <expert-prompt-path>` copies the expert prompt to `<worktree-path>/.claude/CLAUDE.md`. Creates the `.claude/` directory if it does not exist.
- Fails with clear error if the expert prompt file does not exist.
- `install_worker_settings <worktree-path> <risk-level>` writes `.claude/settings.json` into the worktree with:
  - `allowedTools` / `disallowedTools` arrays per spec Section 9 (risk-based tool scoping).
  - `hooks` block with empty arrays for each lifecycle event (SessionStart, PreToolUse, PostToolUse, PreCompact, Stop). Task 6 populates these.
  - `mcpServers` block with `context-mode` entry (can be a placeholder if context-mode is not yet installed).
- For trivial risk with no `testStrategy`: `Bash` is in `disallowedTools`. For all other cases: `Bash` is allowed.
- `WebSearch`, `WebFetch`, `Skill`, `NotebookEdit` are always in `disallowedTools`.
- Idempotent: running twice overwrites cleanly, no duplicates.

**Dependencies**

- Task 1 (worktree must exist before installing into it)

**Estimated scope**

~120 lines of shell + 1 JSON template. 0.5 days.

---

## Task 3: CLI Invocation Wrapper

**Description**

The core execution function. Constructs the `claude` CLI command from dispatch parameters, executes it as a subprocess in the worktree directory, captures stdout/stderr, enforces a wall-clock timeout, and handles retries on transient failures. This is the only component that invokes the `claude` binary.

The wrapper does NOT parse the result -- it captures raw output and passes it to the result parser (Task 4). Separation of concerns: this task handles process lifecycle, Task 4 handles semantic interpretation.

**Files to create/modify**

- `lib/cli_invoke.sh` -- main function: `invoke_claude`
- `lib/cli_invoke.py` -- Python alternative for richer subprocess management (timeout, signal handling, JSON capture). Decision: use Python for the invoke wrapper since shell `timeout` + JSON capture is fragile. Shell shim calls Python.
- `lib/prompt_builder.py` -- functions: `build_task_prompt(task_spec)`, `build_fix_prompt(findings, round)`. Assembles the `-p` prompt string per spec Section 4 Step 3.

**Acceptance criteria**

- `invoke_claude <worktree-path> <prompt> <max-turns> <model> <risk>` runs `claude --bare -p "<prompt>" --output-format json --max-turns <max-turns> --model <model>` with cwd set to `<worktree-path>`.
- Wall-clock timeout per risk level: trivial=3m, standard=10m, elevated=15m, critical=25m. Configurable override.
- On timeout: sends SIGTERM, waits 10s, sends SIGKILL. Captures any partial output.
- On non-zero exit with no JSON output: retries once with same parameters. If retry also fails: returns error struct with exit code and stderr.
- On non-zero exit with valid JSON output: returns the JSON (the CLI may exit non-zero but still produce structured output).
- Returns a raw result dict: `{"exit_code": N, "stdout": "...", "stderr": "...", "timed_out": bool, "retried": bool, "duration_ms": N}`.
- `build_task_prompt` assembles the initial dispatch prompt per spec Section 4 Step 3 template (title, details, acceptance criteria, relevant files, test strategy, instructions).
- `build_fix_prompt` assembles the re-dispatch prompt per spec Section 4 Step 3 re-dispatch template (findings as numbered list with severity/description/file/line).
- Prompt builder is pure function, no side effects.

**Dependencies**

- Task 1 (worktree exists)
- Task 2 (expert prompt + settings installed)

**Estimated scope**

~250 lines of Python + ~30 line shell shim. 1.5 days.

---

## Task 4: Result Parser

**Description**

Parses the raw CLI output from Task 3 into a structured `WORKER_COMPLETE` event. Extracts status, cost, duration, turns, session ID from the Claude Code JSON output. Infers status from the worker's final text when it is not explicitly stated. Computes `files_changed` from `git diff` in the worktree. Writes the result artifact to `.skylark/results/TASK-NNN.json`.

**Files to create/modify**

- `lib/result_parser.py` -- functions: `parse_cli_output(raw_result, task_id, worktree_path, round, model, risk)`, `extract_status(result_text)`, `get_files_changed(worktree_path)`, `write_result_artifact(result, repo_root)`
- `lib/result_schema.py` -- dataclass / TypedDict for the result artifact and the WORKER_COMPLETE event payload.

**Acceptance criteria**

- `parse_cli_output` accepts the raw result dict from Task 3 and returns a structured `WorkerResult` object.
- `extract_status` scans the worker's `result` text for status keywords: `DONE_WITH_CONCERNS`, `DONE`, `NEEDS_CONTEXT`, `BLOCKED` (checked in that order to avoid false match on `DONE` prefix of `DONE_WITH_CONCERNS`).
- When no status keyword is found: if `is_error` is true, status is `BLOCKED`. If `files_changed` is non-empty, status is `DONE_WITH_CONCERNS` with synthetic concern. If `files_changed` is empty, status is `BLOCKED`.
- When the CLI timed out or crashed (from raw result): status is `BLOCKED` with appropriate `blocked_reason`.
- When max turns exceeded (`num_turns == max_turns` and no explicit status): status is `BLOCKED` with `blocked_reason: "max turns exceeded without completion"`.
- `get_files_changed` runs `git diff --name-only HEAD` in the worktree and returns the file list.
- `write_result_artifact` writes the full result (including metadata: round, model, risk, timestamp) to `.skylark/results/TASK-<id>.json`. Creates the `.skylark/results/` directory if needed.
- Result artifact JSON matches the schema in spec Section 4 Step 6 exactly.
- Unit tests: parse valid JSON output, parse crashed output (no JSON), parse timeout output, parse missing-status output with/without file changes.

**Dependencies**

- Task 3 (consumes raw result from CLI invocation)

**Estimated scope**

~200 lines of Python. 1 day.

---

## Task 5: Re-dispatch Handler

**Description**

Handles the REVISE flow: when the orchestrator sends a re-dispatch after a REVISE verdict, the handler constructs a fix prompt from the review findings and dispatches into the EXISTING worktree. No new worktree is created. The expert prompt (`.claude/CLAUDE.md`) is already installed from the initial dispatch and is preserved.

**Files to create/modify**

- `lib/redispatch.py` -- function: `redispatch_worker(task_id, worktree_path, findings, round, model, risk)`
- Modifies `lib/prompt_builder.py` if not already complete from Task 3 (the `build_fix_prompt` function).

**Acceptance criteria**

- `redispatch_worker` validates that the worktree still exists at the given path. Fails with clear error if not.
- Does NOT create a new worktree or modify `.claude/CLAUDE.md`.
- Constructs a fix prompt via `build_fix_prompt(findings, round)` -- formatted as a numbered list with severity, description, file, and line for each finding.
- Invokes `invoke_claude` in the existing worktree with the fix prompt.
- Passes the result through `parse_cli_output` with the incremented round number.
- Returns the same `WorkerResult` structure as initial dispatch.
- If the model should escalate on re-dispatch (elevated risk: sonnet -> opus), the caller passes the correct model. This function does not make model selection decisions.
- Unit test: mock `invoke_claude`, verify fix prompt format, verify round number is passed through.

**Dependencies**

- Task 3 (CLI invocation)
- Task 4 (result parsing)

**Estimated scope**

~80 lines of Python. 0.5 days.

---

## Task 6: Context Engineering Hooks Setup

**Description**

Populate the `.claude/settings.json` skeleton (from Task 2) with actual hook commands for context-mode integration. This means writing the hook command entries that wire up context-mode's SessionStart, PreToolUse, PostToolUse, and PreCompact hooks into each worker session. Also configure the context-mode MCP server entry.

The hooks themselves (context-mode's `.mjs` files) are provided by the `context-mode` npm package. This task writes the configuration that tells Claude Code to invoke them, and copies or symlinks the budget monitor hook (Task 7) into the worktree.

**Files to create/modify**

- Modifies `lib/prompt_installer.sh` -- `install_worker_settings` now generates the full hooks block instead of empty arrays.
- `lib/hooks/` directory -- contains the pipeline-specific hook scripts:
  - `lib/hooks/budget-monitor.sh` (placeholder, implemented in Task 7)
  - `lib/hooks/compaction-detector.sh` (emits `COMPACTION_DETECTED` event)
  - `lib/hooks/budget-report.sh` (final utilization report on Stop)
- `lib/context_setup.sh` -- function: `setup_context_engineering <worktree-path> <task-id> <predecessor-tasks-json>`. Writes `session_context.json` into the worktree for the SessionStart hook to read.

**Acceptance criteria**

- After `install_worker_settings` runs, the `.claude/settings.json` in the worktree contains:
  - `SessionStart` hook entries for context-mode (`node hooks/sessionstart.mjs`).
  - `PreToolUse` hook entries for context-mode with correct matcher pattern.
  - `PostToolUse` hook entries for context-mode + budget monitor with correct matcher patterns. Budget monitor runs AFTER context-mode (array order matters).
  - `PreCompact` hook entries for context-mode + compaction detector.
  - `Stop` hook entry for budget report.
- `mcpServers.context-mode` entry points to `npx -y @anthropic/context-mode`.
- Hook script paths in settings.json are relative to the worktree root.
- `setup_context_engineering` writes `<worktree-path>/.skylark/session_context.json` containing `{task_id, predecessor_tasks, pipeline_run_id, stage}`.
- If context-mode is not installed (`npx @anthropic/context-mode` would fail), the settings still work -- hooks will fail gracefully and the worker continues without context conservation. The CLI invocation should not abort.
- Compaction detector script (`compaction-detector.sh`) writes `{"event": "COMPACTION_DETECTED", "task_id": N, "session_id": "..."}` to `.skylark/events/` when invoked.

**Dependencies**

- Task 2 (extends the settings template and installer)

**Estimated scope**

~150 lines of shell across multiple files + JSON generation. 1 day.

---

## Task 7: Budget Monitor Hook

**Description**

Implement `budget-monitor.sh` -- the ~80-line shell hook that reads context utilization from Claude Code's hook invocation data and acts at the 40/60/70% thresholds. This is the pipeline-specific hook that prevents compaction. It runs on every `PostToolUse` event (after context-mode's hook) and checks the utilization percentage.

At each threshold, it writes a structured event to `.skylark/events/` for the harness to read. At 70%, it also triggers the handoff writer (Task 8).

**Files to create/modify**

- `lib/hooks/budget-monitor.sh` -- replaces the placeholder from Task 6
- `lib/hooks/threshold_state.sh` -- helper: tracks which thresholds have already fired per session (each threshold fires exactly once)

**Acceptance criteria**

- The hook reads `context_utilization_pct` from the hook invocation's input JSON (piped via stdin by Claude Code's hook system).
- At 40%: writes `{"event": "CONTEXT_WARNING", "task_id": N, "session_id": "...", "utilization_pct": N, "threshold": 40, "action": "warn"}` to `.skylark/events/`.
- At 60%: writes the same event with `threshold: 60, action: "save_state"`.
- At 70%: writes the same event with `threshold: 70, action: "handoff"`. Then invokes the handoff writer (Task 8's `trigger_handoff` function/script).
- Each threshold fires exactly once per session. Uses a state file (`.skylark/budget_state/<session-id>.json`) to track fired thresholds.
- Total execution time target: <50ms per invocation (the hook runs on every tool call).
- If utilization data is unavailable or unparseable, the hook logs a warning and exits 0 (never blocks the worker).

**Dependencies**

- Task 6 (hook is registered in settings.json)

**Estimated scope**

~100 lines of shell. 0.5 days.

---

## Task 8: Handoff Protocol

**Description**

When the budget monitor fires at 70%, the handoff writer persists enough state for a successor session to continue the task. It reads session events, git state, and uncommitted changes, then assembles a structured handoff artifact at `.skylark/handoffs/TASK-NNN-session-M.md`. After writing the artifact, it emits `HANDOFF_READY` to the orchestrator and terminates the worker session.

This is part shell (for git operations) and part Python (for artifact assembly from session events).

**Files to create/modify**

- `lib/handoff.py` -- functions: `build_handoff_artifact(task_id, session_id, session_number, worktree_path)`, `write_handoff(artifact, repo_root)`
- `lib/handoff_trigger.sh` -- shell entry point invoked by the budget monitor at 70%. Calls the Python handoff writer, then writes the `HANDOFF_READY` event to `.skylark/events/`.

**Acceptance criteria**

- `build_handoff_artifact` reads:
  - Git state: `git status`, `git log --oneline`, `git diff --name-only HEAD`, current branch, HEAD commit hash, uncommitted changes flag.
  - Session events from `.skylark/events/` for the current session (decisions, errors, file changes).
  - Does NOT read from context-mode's SessionDB directly (that is context-mode's concern). Reads only from `.skylark/events/` which the hooks have been writing to.
- Artifact schema matches spec Section 7: `completed_work`, `pending_work`, `decisions`, `modified_files`, `blockers`, `next_steps`, `git_state`.
- Written to `.skylark/handoffs/TASK-<id>-session-<M>.md` where M is the session number (starts at 1, increments on each handoff for the same task).
- Session number is determined by counting existing handoff files for the same task ID.
- `HANDOFF_READY` event written to `.skylark/events/`: `{"event": "HANDOFF_READY", "task_id": N, "session_id": "...", "handoff_path": "..."}`.
- The handoff trigger script commits any uncommitted work in the worktree (`git add -A && git commit -m "WIP: handoff at <utilization>% context"`) before building the artifact. If nothing to commit, proceeds without error.
- If the handoff writer fails (any exception), it still writes a minimal `HANDOFF_READY` event with `error` field so the orchestrator knows the session ended.
- Unit test: build artifact from mock git state and events, verify schema.

**Dependencies**

- Task 4 (result schema definitions)
- Task 7 (budget monitor triggers the handoff)

**Estimated scope**

~200 lines of Python + ~40 lines of shell. 1 day.

---

## Task 9: End-to-End Integration and Harness Entry Point

**Description**

Wire all components together into a single entry point that the orchestrator (Domain 1) calls. The harness entry point accepts a `DISPATCH_WORKER` command (as JSON on stdin or as a file path argument), orchestrates the full lifecycle (worktree create -> prompt install -> context setup -> CLI invoke -> result parse -> event emit), and returns a `WORKER_COMPLETE` event (as JSON on stdout). Also handles re-dispatch commands.

This task also adds the event file polling mechanism: the harness monitors `.skylark/events/` during CLI execution for budget warnings and handoff signals, enabling the orchestrator to receive mid-session events.

**Files to create/modify**

- `bin/skylark-worker` -- executable entry point (Python). Accepts `dispatch` or `redispatch` subcommands.
- `lib/dispatch.py` -- top-level orchestration: `dispatch_worker(command)` and `redispatch_worker_from_command(command)`.
- `lib/event_bus.py` -- reads/writes `.skylark/events/` directory. Functions: `emit_event(event)`, `poll_events(task_id)`, `cleanup_events(task_id)`.
- `lib/config.py` -- centralized configuration: turn limits, timeout thresholds, model defaults (from spec Section 11), worktree paths, event directory paths.

**Acceptance criteria**

- `bin/skylark-worker dispatch <command.json>` runs the full initial dispatch lifecycle:
  1. Reads DISPATCH_WORKER command from file or stdin.
  2. Creates worktree (`worktree_create`).
  3. Installs expert prompt (`install_expert_prompt`).
  4. Installs worker settings (`install_worker_settings`).
  5. Sets up context engineering (`setup_context_engineering`).
  6. Builds task prompt (`build_task_prompt`).
  7. Invokes CLI (`invoke_claude`).
  8. Parses result (`parse_cli_output`).
  9. Writes result artifact.
  10. Emits `WORKER_COMPLETE` event to stdout.
- `bin/skylark-worker redispatch <command.json>` runs the re-dispatch lifecycle (skips steps 2-5, uses existing worktree).
- If a `HANDOFF_READY` event appears in `.skylark/events/` during execution, the harness captures it and emits it instead of `WORKER_COMPLETE`.
- If a `COMPACTION_DETECTED` event appears, the harness includes it as metadata in the `WORKER_COMPLETE` event.
- Exit codes: 0 = success (WORKER_COMPLETE emitted), 1 = harness error (not a worker error -- worker errors are reported in the WORKER_COMPLETE status field), 2 = invalid input.
- `lib/config.py` contains all magic numbers from spec Section 11 as named constants with docstrings.
- Integration test: dispatch a trivial task (echo hello) into a real worktree with a mock `claude` binary (shell script that outputs valid JSON), verify the full lifecycle produces a correct result artifact and WORKER_COMPLETE event.

**Dependencies**

- All previous tasks.

**Estimated scope**

~300 lines of Python + integration test. 1.5 days.

---

## Total Estimated Effort

| Task | Scope | Days |
|------|-------|------|
| 1. Worktree lifecycle manager | ~200 LOC shell | 1.0 |
| 2. Expert prompt installer | ~120 LOC shell + JSON | 0.5 |
| 3. CLI invocation wrapper | ~280 LOC Python + shell | 1.5 |
| 4. Result parser | ~200 LOC Python | 1.0 |
| 5. Re-dispatch handler | ~80 LOC Python | 0.5 |
| 6. Context engineering hooks setup | ~150 LOC shell + JSON | 1.0 |
| 7. Budget monitor hook | ~100 LOC shell | 0.5 |
| 8. Handoff protocol | ~240 LOC Python + shell | 1.0 |
| 9. Integration + entry point | ~300 LOC Python | 1.5 |
| **Total** | **~1,670 LOC** | **8.5 days** |

With parallelism on the two tracks (Tasks 1-5 and Tasks 2,6-8), wall-clock time is closer to 6 days.

---

## Integration Points

### Upstream: Domain 1 (Orchestrator)

The orchestrator sends `DISPATCH_WORKER` and re-dispatch commands as JSON. The harness consumes these via `bin/skylark-worker dispatch|redispatch`. The orchestrator reads `WORKER_COMPLETE`, `HANDOFF_READY`, and `CONTEXT_WARNING` events from the harness's stdout and from `.skylark/events/`.

**Contract dependency:** Domain 1 must define the `DISPATCH_WORKER` event type (spec Section 3) and the `WORKER_COMPLETE` event type (spec Section 5) before this domain's integration test can use real event schemas. During development, use the YAML schemas from the spec as the contract.

### Upstream: Domain 4 (Expert Generation)

Domain 4 writes expert prompts to `.skylark/experts/TASK-NNN.md`. This domain reads them. No code dependency -- file path convention is the contract.

### Downstream: Domain 4 (Review)

This domain writes result artifacts to `.skylark/results/TASK-NNN.json`. Domain 4's reviewers read these to understand what the worker attempted. No code dependency -- file path convention is the contract.

### Downstream: Domain 5 (Telemetry)

The result artifact (`.skylark/results/TASK-NNN.json`) contains `session_id`, `total_cost_usd`, `duration_ms`, and `num_turns`. The telemetry bridge reads these. Additionally, `CONTEXT_WARNING` and `HANDOFF_READY` events in `.skylark/events/` are forwarded to the telemetry layer.

### Cross-cutting: context-mode MCP server

The context-mode MCP server is configured in `.claude/settings.json` but runs inside the Claude Code CLI process. This domain does not start or manage it -- the CLI does. If context-mode is not installed, the worker operates without context conservation (hooks fail gracefully, CLI continues).

### File layout produced by this domain

```
<repo-root>/
  .worktrees/
    TASK-NNN-slug/              # git worktrees (one per active task)
      .claude/
        CLAUDE.md               # expert prompt (copied from .skylark/experts/)
        settings.json           # tool scoping + hooks + MCP config
      .skylark/
        session_context.json    # predecessor task context for SessionStart hook
      hooks/                    # symlinks or copies of pipeline hook scripts
        budget-monitor.sh
        compaction-detector.sh
        budget-report.sh

  .skylark/
    results/
      TASK-NNN.json             # worker result artifacts
    events/
      <event-uuid>.json         # transient event files (polled + cleaned up)
    handoffs/
      TASK-NNN-session-M.md     # handoff artifacts
    budget_state/
      <session-id>.json         # threshold firing state (per session)
    experts/
      TASK-NNN.md               # expert prompts (written by Domain 4, read here)

  lib/
    worktree.sh
    worktree_config.sh
    prompt_installer.sh
    settings_template.json
    cli_invoke.sh
    cli_invoke.py
    prompt_builder.py
    result_parser.py
    result_schema.py
    redispatch.py
    context_setup.sh
    handoff.py
    handoff_trigger.sh
    dispatch.py
    event_bus.py
    config.py
    hooks/
      budget-monitor.sh
      compaction-detector.sh
      budget-report.sh
      threshold_state.sh

  bin/
    skylark-worker              # entry point
```

### Event flow diagram

```
Orchestrator                    Harness                         Claude Code CLI
    |                              |                                  |
    |-- DISPATCH_WORKER ---------->|                                  |
    |                              |-- worktree_create                |
    |                              |-- install_expert_prompt          |
    |                              |-- install_worker_settings        |
    |                              |-- setup_context_engineering      |
    |                              |-- build_task_prompt              |
    |                              |-- invoke_claude --------------->|
    |                              |                                  |
    |                              |   [hooks fire on every tool call]|
    |                              |   budget-monitor.sh checks util  |
    |                              |                                  |
    |  <-- CONTEXT_WARNING(40%) ---|   [if util >= 40%]              |
    |  <-- CONTEXT_WARNING(60%) ---|   [if util >= 60%]              |
    |  <-- CONTEXT_WARNING(70%) ---|   [if util >= 70%]              |
    |                              |-- handoff_trigger.sh             |
    |                              |-- build_handoff_artifact         |
    |  <-- HANDOFF_READY ----------|                                  |
    |                              |                                  |
    |                              |   [normal completion path:]     |
    |                              |<-- JSON result ------------------|
    |                              |-- parse_cli_output               |
    |                              |-- write_result_artifact          |
    |  <-- WORKER_COMPLETE --------|                                  |
    |                              |                                  |
    |-- RE_DISPATCH -------------->|   [on REVISE verdict]           |
    |                              |-- build_fix_prompt               |
    |                              |-- invoke_claude --------------->|
    |                              |<-- JSON result ------------------|
    |  <-- WORKER_COMPLETE --------|                                  |
```

### Deferred to future iterations

- **context-mode SessionDB querying for predecessor context.** Task 6 writes `session_context.json` for the SessionStart hook to read, but the actual FTS5 querying depends on context-mode being installed and having indexed prior sessions. The harness provides the data; context-mode does the querying. If context-mode is absent, predecessor context injection is skipped.
- **Parallel worker dispatch.** This domain handles single-worker dispatch. The Mux-based parallel dispatch (`dispatch-with-mux` skill) is a separate domain that calls into this harness per-worker.
- **Taskmaster MCP integration.** The spec says the worker updates Taskmaster status to `in-progress` on dispatch start. This requires MCP access, which `--bare` mode disables. The orchestrator handles Taskmaster updates, not the worker. The harness emits events; the orchestrator translates them to Taskmaster calls.

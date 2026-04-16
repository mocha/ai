# Layer 7 -- Context Engineering

Cross-cutting concern that attaches to every worker session. Two
sub-layers: context conservation (reduce what enters the context
window; preserve what comes out) and budget enforcement (prevent
compaction from ever firing). This layer is the defense against the
compaction death spiral that killed ENG-180.

---

## 1. Purpose

ENG-180 compacted at least four times. Each reset required
reconstructing state from lossy markdown resumption notes. Details
were paraphrased, invariants were dropped, and subsequent sessions
acted on a degraded representation of earlier decisions. The
retrospective concluded: "If a project needs more than 2 compactions,
stop and decompose."

Layer 7 enforces a stronger position: **compaction should never
happen.** The pipeline is designed so that every worker session
completes well within a single context window. If compaction fires, it
means the task was too large and should have been decomposed further.

Two sub-layers make this possible:

**Context conservation (context-mode).** Reduces context pressure by
keeping large tool outputs out of the window and persisting all
meaningful events to disk. When conservation is working, a session
that would have consumed 80% of the window instead consumes 30-40%.

**Budget enforcement (budget monitor hooks).** Monitors context
utilization in real time and triggers a graceful handoff before
compaction can fire. The orchestrator receives a structured handoff
artifact and can re-dispatch a new worker to continue the task.
Together these sub-layers guarantee that no session loses context to
compaction. Conservation makes it unlikely; budget enforcement makes
it impossible.

---

## 2. Components

### context-mode (MCP server + hooks)

| Component | Description |
|-----------|-------------|
| MCP server | `context-mode` v1.0.89+, Elastic-2.0 license. Provides 6 sandbox tools for containing tool output. |
| SessionStart hook | On startup: injects routing block. On compact/resume: builds `session_knowledge` directive from FTS5. |
| PreToolUse hook | Routes analysis work to sandbox tools. Blocks raw `curl`/`wget`/`WebFetch`. Injects guidance once per tool type. |
| PostToolUse hook | Extracts events from every tool call (13 categories). Writes to SessionDB. Target latency: <20ms. |
| PreCompact hook | Reads all session events from SessionDB. Builds priority-tiered XML snapshot (<=2KB). Stores in `session_resume` table. |
| SessionDB | Per-project SQLite at `~/.claude/context-mode/sessions/<hash>.db`. Tables: `session_events`, `session_meta`, `session_resume`. WAL mode for crash safety. |
| ContentStore | FTS5 SQLite at `~/.claude/context-mode/content/<hash>.db`. Tables: `sources`, `chunks` (porter/unicode61 tokenizer), `chunks_trigram` (trigram tokenizer), `vocabulary`. |

### Budget monitor hooks (~80 lines, pipeline-specific)

| Component | Description |
|-----------|-------------|
| `budget-monitor.sh` | Shell hook attached to Claude Code's hook system. Reads context utilization from Claude Code's internal state. Emits structured JSON events at 40/60/70% thresholds. |
| Handoff writer | At 70%: generates a handoff artifact at `.skylark/handoffs/TASK-NNN-session-M.md`, signals orchestrator, terminates session. |
| Compaction detector | If PreCompact fires despite budget enforcement, emits `COMPACTION_DETECTED` to the orchestrator as evidence the task should be decomposed. |

### Interaction between sub-layers

context-mode and the budget monitor are independent. context-mode
reduces context pressure passively (sandboxing tool output, routing
analysis to MCP tools). The budget monitor watches the utilization
number that results after context-mode has done its work. In practice,
context-mode's 98% reduction on analysis workloads means the budget
monitor rarely fires above 40%. When it does, the task is genuinely
large.

---

## 3. Inputs

### From Claude Code hook system (automatic)

```yaml
session_lifecycle:
  event: SessionStart | PreToolUse | PostToolUse | PreCompact | Stop
  session_id: string
  context_utilization_pct: number   # 0-100, from budget monitor
```

Every hook event carries the session ID. The budget monitor reads
`context_utilization_pct` from Claude Code's internal state on each
hook invocation. context-mode hooks do not use utilization directly;
they fire on every qualifying tool call regardless of fill level.

### From Layer 2 (Orchestrator) -- predecessor context injection

```yaml
session_context:
  task_id: number
  predecessor_tasks: [number]       # completed tasks whose decisions may be relevant
  pipeline_run_id: string
  stage: string
```

The orchestrator provides this context when dispatching a worker via
Layer 5. It is written to the worktree as part of the worker's
environment and read by the SessionStart hook to prime predecessor
queries.

---

## 4. Context conservation workflow

Context conservation operates across the four hook lifecycle events.
Each hook has a specific role in keeping the context window lean.

### SessionStart: prime the session

On `startup` source:

1. Inject the `ROUTING_BLOCK` as `additionalContext`. This is a static
   XML template (`<context_window_protection>`) containing tool
   selection hierarchy, forbidden actions, and output constraints. It
   is identical on every invocation, making it cache-friendly.
2. Capture CLAUDE.md content into SessionDB for later snapshot
   generation.
3. Clean up sessions older than 7 days.
4. If `session_context` is available (predecessor tasks exist), trigger
   the predecessor query mechanism (see section 6).

On `compact` source (should not fire in normal operation, but handled
defensively):

1. Write session events as markdown to `<hash>-events.md`.
2. Auto-index the events file into FTS5 ContentStore.
3. Build `<session_knowledge>` directive with BM25 search references.
4. Inject as `additionalContext` for the post-compaction session.

### PreToolUse: redirect large operations to sandbox

Before each tool call:

1. Normalize tool name across platforms (cross-platform aliases).
2. Security check: deny `curl`, `wget`, `WebFetch` (force
   `ctx_fetch_and_index` instead).
3. For Bash/Read/Grep calls that are likely to produce large output,
   inject a one-time guidance message recommending `ctx_execute`,
   `ctx_execute_file`, or `ctx_search` instead.
4. The guidance fires once per session per tool type via
   `guidanceOnce()` to avoid adding noise on repeated calls.

### PostToolUse: persist everything to disk

After each tool call:

1. Extract events from the tool result across 13 categories: `file`,
   `decision`, `task`, `error`, `git`, `env`, `role`, `intent`,
   `data`, `plan`, `subagent`, `skill`, `config`.
2. Write events to SessionDB with type, timestamp, session ID, task
   ID, content, and priority level.
3. Deduplication: last 5 events are checked for duplicate type+hash.
   Duplicates are silently dropped.
4. Target latency: <20ms. This must not slow down the worker.

### PreCompact: generate the survival snapshot

If compaction fires (a failure case in our pipeline):

1. Read all events from SessionDB for the current session.
2. Build a priority-tiered XML snapshot with these sections:
   - `<files>`: Modified file paths with operation counts
   - `<errors>`: Error messages from tool failures
   - `<decisions>`: User and agent decisions with context
   - `<rules>`: CLAUDE.md content
   - `<git>`: Git operations (commit, push, branch)
   - `<task_state>`: Pending tasks from TaskCreate/TaskUpdate
   - `<environment>`: Working directory, env setup
   - `<subagents>`: Subagent launch/completion status
   - `<skills>`: Skills invoked during session
   - `<intent>`: Session mode (investigate/implement/discuss/review)
3. Each section includes pre-built BM25 search queries for retrieving
   full details from the FTS5 knowledge base.
4. Target size: <=2KB. The snapshot is a pointer structure, not a data
   dump.
5. Store in `session_resume` table via upsert.
6. Increment `compact_count` in `session_meta`.

### Sandbox tools (6 tools from context-mode MCP server)

| Tool | Purpose | Context impact |
|------|---------|----------------|
| `ctx_execute` | Run code in sandbox subprocess. Only `console.log()` enters context. | 98% reduction on analysis |
| `ctx_execute_file` | Run a file in sandbox. Same containment as `ctx_execute`. | Same |
| `ctx_index` | Index content into FTS5. Returns pointer, not content. | Near-zero context cost |
| `ctx_search` | BM25 search over FTS5 index. Returns ranked snippets. | Controlled output size |
| `ctx_fetch_and_index` | Fetch URL, convert to markdown, chunk, index into FTS5. | Zero raw HTML in context |
| `ctx_batch_execute` | Batch multiple execute calls. Single round-trip. | Amortized overhead |

The key insight: these tools let the worker perform analysis (read
large files, parse data, search codebases) without that data entering
the context window. The data lives in SQLite. The worker queries it on
demand via `ctx_search`.

---

## 5. Budget enforcement workflow

The budget monitor is a shell hook (~80 lines) that reads context
utilization on every hook invocation and acts at three thresholds.

### Threshold system

| Threshold | Action | Event emitted | Worker impact |
|-----------|--------|---------------|---------------|
| 40% | Log warning | `CONTEXT_WARNING` (action: `warn`) | None. Worker continues normally. |
| 60% | Notify orchestrator | `CONTEXT_WARNING` (action: `save_state`) | Worker continues but should wrap up current subtask. |
| 70% | Trigger handoff | `CONTEXT_WARNING` (action: `handoff`) | Worker persists state and exits. |

### What happens at each level

**40% -- advisory.** The budget monitor logs a structured warning.
The orchestrator receives `CONTEXT_WARNING` with `threshold: 40` and
`action: warn`. No operational change. This threshold exists for
telemetry -- if workers routinely hit 40%, it indicates tasks are
trending toward the upper bound and decomposition thresholds should
be tightened.

**60% -- wrap up.** The orchestrator receives `CONTEXT_WARNING` with
`threshold: 60` and `action: save_state`. The worker is not
interrupted but the orchestrator notes that this session is
approaching limits. If the worker is mid-subtask, it should finish
the current unit of work and commit. The orchestrator will not
dispatch additional subtasks to this session.

**70% -- handoff.** The budget monitor:

1. Emits `CONTEXT_WARNING` with `threshold: 70` and `action: handoff`.
2. Triggers the handoff writer (see section 7).
3. The worker persists all uncommitted state to disk.
4. The worker commits any in-progress work to git.
5. The session terminates gracefully.
6. The orchestrator receives `HANDOFF_READY` with the artifact path.

Auto-compaction in Claude Code fires at 75-95% utilization. The 70%
threshold gives a 5-25% buffer to complete the handoff protocol
before compaction could fire.

### Why not let compaction happen?

From the ENG-180 retrospective: each compaction required
reconstructing state from lossy resumption notes. The PreCompact
snapshot is a best-effort survival mechanism, not a lossless handoff.
Specific failure modes observed:

- Details paraphrased away (exact function signatures lost)
- Invariants dropped (a constraint from Task 1 forgotten by Task 5)
- Compaction summaries occasionally hallucinated instructions that
  never existed
- The post-compaction session operated on a degraded representation,
  making subtly wrong decisions

A structured handoff artifact written before the 70% mark preserves
full fidelity. The successor session starts with curated context, not
a lossy summary.

---

## 6. Predecessor query mechanism

When a new worker session starts, it may need to know what previous
sessions decided. Task 3 might need to know what Task 1 decided about
a shared interface. Task 7 might need to know what Task 4 discovered
about a dependency.

### How it works

1. **SessionStart hook fires.** The hook reads `session_context` from
   the worker environment, which includes `predecessor_tasks` (an
   array of completed task IDs whose decisions may be relevant).

2. **Query SessionDB.** For each predecessor task ID, look up the
   corresponding session in SessionDB. Retrieve events categorized as
   `decision`, `file`, `git`, and `error`.

3. **Index into FTS5.** Session events from predecessors are written
   as markdown and auto-indexed into the ContentStore FTS5 database.

4. **BM25 ranking.** The current task's domain terms (from the task
   spec's title, description, and relevant files) are used as queries
   against the FTS5 index. BM25 ranks results by relevance.

5. **Inject top results.** The highest-ranked predecessor decisions
   are injected into the session as initial context via
   `additionalContext`. This gives the worker awareness of relevant
   prior decisions without loading full session histories.

### FTS5 search tiers

The ContentStore uses a multi-tier search fallback:

1. **Porter stemming** (primary): Matches morphological variants
   (`authenticate` matches `authentication`).
2. **Trigram matching** (fallback): Handles partial matches and
   typos (`auth` matches `authentication`).
3. **Fuzzy correction** (last resort): Levenshtein distance against
   the vocabulary table for imprecise queries.

### What gets indexed

Every PostToolUse event that context-mode captures is eligible for
indexing. The categories most relevant to predecessor queries:

| Category | What it captures | Predecessor value |
|----------|-----------------|-------------------|
| `decision` | User corrections, approach selections, architectural choices | High -- these are the choices that constrain downstream work |
| `file` | Modified file paths with operation counts | Medium -- shows what was touched |
| `git` | Commit, push, branch operations | Medium -- shows what was committed |
| `error` | Tool failures, build errors | Medium -- shows what failed and how it was resolved |
| `task` | TaskCreate/TaskUpdate events | Low -- the orchestrator already tracks this |

### Relevance to multi-task pipelines

The predecessor query is critical when tasks share interfaces. If
Task 1 defined a `buildServer({ auth: { verifyToken } })` API and
Task 5 needs to call it, the predecessor query surfaces Task 1's
decision about the signature. Without this, Task 5 might assume
`buildServer({ verifyToken })` (the shape described in the plan) and
produce code that does not compile. This exact scenario occurred in
ENG-180 (plan-to-reality drift on `buildServer` API).

---

## 7. Handoff protocol

When the budget monitor triggers at 70%, the worker must persist
enough state for a successor session to continue the task without
re-reading the entire codebase.

### Handoff artifact schema

```yaml
# Written to .skylark/handoffs/TASK-NNN-session-M.md
handoff_artifact:
  task_id: number
  session_id: string
  session_number: number            # M in TASK-NNN-session-M
  triggered_at_utilization: number  # the utilization % when handoff fired
  timestamp: ISO8601

  completed_work:
    - description: string           # what was accomplished
      commit_hash: string           # git SHA, if committed
      files: [string]               # files touched

  pending_work:
    - description: string           # what remains to be done
      estimated_complexity: string  # small | medium | large
      relevant_files: [string]

  decisions:
    - decision: string              # the choice that was made
      rationale: string             # why this choice, not an alternative
      affects: [string]             # files or interfaces affected

  modified_files: [string]          # all files modified in this session
  blockers: [string]                # anything preventing progress
  next_steps: [string]              # ordered list of what to do next

  git_state:
    branch: string
    head_commit: string
    uncommitted_changes: boolean
```

### Handoff artifact location

```
.skylark/handoffs/
├── TASK-001-session-1.md
├── TASK-001-session-2.md           # second attempt after first handoff
├── TASK-003-session-1.md
└── ...
```

### When handoff triggers

The handoff writer executes this sequence:

1. Read all events from SessionDB for the current session.
2. Read `git status` and `git log` for uncommitted and committed work.
3. Assemble the handoff artifact from session events and git state.
4. Write to `.skylark/handoffs/TASK-NNN-session-M.md`.
5. Emit `HANDOFF_READY` to the orchestrator with the artifact path.
6. The worker session exits.

### How the orchestrator re-dispatches

When the orchestrator receives `HANDOFF_READY`:

1. Read the handoff artifact from the provided path.
2. Create a new `DISPATCH_WORKER` command for the same task.
3. Include the handoff artifact path in the dispatch payload.
4. The new worker session's SessionStart hook reads the handoff
   artifact and injects it as initial context.
5. The new worker resumes from where the previous session left off.

The session number increments (`session-1` -> `session-2`). If a task
requires 3+ handoffs, the orchestrator should treat this as a signal
that the task is too large and escalate for decomposition.

---

## 8. Outputs

All events emitted by Layer 7 to the orchestrator (Layer 2).

### CONTEXT_WARNING

```yaml
CONTEXT_WARNING:
  task_id: number
  session_id: string
  utilization_pct: number
  threshold: 40 | 60 | 70
  action: warn | save_state | handoff
```

Emitted at each threshold crossing. A single session may emit
multiple warnings (40%, then 60%, then 70%) as utilization climbs.
Each warning is emitted exactly once per threshold per session.

### COMPACTION_DETECTED

```yaml
COMPACTION_DETECTED:
  task_id: number
  session_id: string
  utilization_at_compaction: number
```

Emitted if the PreCompact hook fires despite budget enforcement.
This should not happen in normal operation -- it means either the
budget monitor failed to trigger handoff at 70%, or compaction fired
between the 70% warning and the handoff completion. Either way, the
orchestrator should treat this as evidence that the task is too large.

### HANDOFF_READY

```yaml
HANDOFF_READY:
  task_id: number
  session_id: string
  handoff_artifact:
    completed_work: [string]
    commit_hashes: [string]
    pending_work: [string]
    decisions: [{ decision, rationale }]
    modified_files: [string]
    blockers: [string]
    next_steps: [string]
  handoff_path: string              # .skylark/handoffs/TASK-NNN-session-M.md
```

Emitted after the handoff writer completes. The orchestrator reads
the full artifact from `handoff_path`.

### Persisted events (to SQLite, automatic via hooks)

```yaml
persisted_events:
  - type: edit | decision | error | git_op | tool_result
    timestamp: ISO8601
    session_id: string
    task_id: number
    content: string                 # searchable via FTS5
```

These are not emitted to the orchestrator. They are written to
SessionDB by the PostToolUse hook and become available to future
sessions via the predecessor query mechanism.

---

## 9. Downstream

How the orchestrator (Layer 2) consumes Layer 7 events.

### CONTEXT_WARNING consumption

| Threshold | Orchestrator action |
|-----------|---------------------|
| 40% | Logged to telemetry (Layer 6). No pipeline action. |
| 60% | Orchestrator notes the session is approaching limits. Does not dispatch additional subtasks to this worker. Worker finishes its current unit and commits. |
| 70% | Orchestrator waits for `HANDOFF_READY`, then re-dispatches a new worker for the same task with the handoff artifact as input. |

### COMPACTION_DETECTED consumption

The orchestrator logs `COMPACTION_DETECTED` as a decomposition
signal. Two responses depending on the task's current state:

1. **Task has no subtasks.** The orchestrator sends the task back to
   Layer 3 (Task Substrate) for further decomposition before
   re-dispatching.

2. **Task already has subtasks.** The orchestrator logs a warning.
   The task may need manual review of its scope. The orchestrator
   escalates to the user: "Task NNN triggered compaction. Consider
   breaking it down further."

### HANDOFF_READY consumption

The orchestrator re-dispatches following the protocol in section 7.
The new worker receives the handoff artifact path as part of its
`DISPATCH_WORKER` payload. The `session_context` for the new worker
includes the predecessor session (the one that handed off) so the
predecessor query mechanism can surface its decisions.

### Telemetry integration (Layer 6)

All Layer 7 events are also forwarded to Layer 6 for dashboard
visibility:

- Context utilization over time (per session, per task)
- Handoff frequency (indicator of decomposition quality)
- Compaction events (should be zero; any occurrence is a bug)
- Predecessor query hit rates (indicator of cross-task coupling)

---

## 10. The compaction philosophy

**Compaction is a failure signal, not a normal operating mode.**

The pipeline is designed so that compaction should never be needed.
Every task is decomposed small enough to complete in a single context
window. Context conservation keeps tool output out of the window.
Budget enforcement triggers handoff before compaction can fire.

If compaction happens anyway, it means one of:

1. **The task was too large.** Decomposition thresholds need
   tightening. The orchestrator should send the task back for further
   breakdown.

2. **The worker was inefficient.** Too many large tool results entered
   the context window despite conservation. The routing block or
   PreToolUse guidance may need strengthening.

3. **The budget monitor failed.** The 70% threshold did not trigger,
   or the handoff did not complete before compaction fired. This is a
   bug in the budget monitor.

In all three cases, the correct response is to investigate and fix
the root cause, not to improve compaction survival. Investing in
better compaction summaries is treating the symptom. Investing in
smaller tasks and better conservation treats the disease.

### The ENG-180 lesson

ENG-180 compacted 4+ times across 53 commits. Each compaction
degraded context fidelity:

- Function signatures were paraphrased (lost exact parameter shapes)
- Cross-task invariants were dropped (constraints from early tasks
  forgotten by later tasks)
- The plan-to-reality gap widened (compaction summaries referenced
  the plan's description of APIs, not the actual implementation)
- At least one compaction summary hallucinated an instruction that
  never existed

The composed pipeline exists specifically to prevent this. Layer 3
(Task Substrate) ensures tasks are small. Layer 7 ensures the context
window stays within bounds. Together they make compaction unnecessary.

### Compaction count as a metric

Every `COMPACTION_DETECTED` event should be treated with the same
urgency as a test failure. The target compaction rate across the
pipeline is zero. Any non-zero rate is actionable:

- 1 compaction per pipeline run: investigate task sizing
- 2+ compactions per pipeline run: halt and decompose further
- Compaction on a trivial/standard risk task: likely a bug in
  context conservation (tool output not being sandboxed)

---

## 11. Configuration

### Utilization thresholds

```yaml
budget_monitor:
  warn_threshold: 40                # percent, advisory only
  save_state_threshold: 60          # percent, orchestrator notified
  handoff_threshold: 70             # percent, session terminated
```

These thresholds are conservative. Auto-compaction in Claude Code
fires at 75-95% utilization. The 70% handoff threshold provides a
5-25% buffer for the handoff protocol to complete.

Quality degradation has been observed as early as 20-30% for
mixed-mode work (prose + code) and around 60% for code-only work.
The 40% advisory threshold captures the onset of degradation for
mixed workloads. If telemetry shows quality issues at lower
utilization, tighten the thresholds.

### SQLite paths

```yaml
context_mode:
  session_db: ~/.claude/context-mode/sessions/<project-hash>.db
  content_store: ~/.claude/context-mode/content/<project-hash>.db
  session_ttl_days: 7               # cleanup threshold for old sessions
  max_events_per_session: 1000      # FIFO eviction beyond this
  dedup_window: 5                   # recent events checked for duplicates
```

The `<project-hash>` is derived from the project's working directory.
Each project gets its own pair of SQLite databases.

### FTS5 index configuration

```yaml
fts5:
  primary_tokenizer: porter unicode61
  fallback_tokenizer: trigram
  fuzzy_correction: true            # Levenshtein against vocabulary table
  search_tiers:
    - porter_stemming                # morphological: authenticate -> authentication
    - trigram_matching               # partial: auth -> authentication
    - fuzzy_levenshtein              # typo correction
```

### Handoff artifact location

```yaml
handoff:
  directory: .skylark/handoffs/
  naming: TASK-{task_id}-session-{session_number}.md
  max_sessions_per_task: 3          # escalate to user if exceeded
```

If a task exceeds `max_sessions_per_task` handoffs, the orchestrator
escalates to the user rather than continuing to re-dispatch. Three
handoffs for a single task is strong evidence the task cannot be
completed at its current granularity.

### Event persistence

```yaml
persistence:
  post_tool_use_latency_target: 20ms
  categories:
    - file
    - decision
    - task
    - error
    - git
    - env
    - role
    - intent
    - data
    - plan
    - subagent
    - skill
    - config
  priority_levels:                   # 1 = highest, evicted last
    decision: 1
    error: 2
    git: 2
    file: 3
    task: 3
    plan: 3
    env: 4
    intent: 4
    role: 4
    data: 5
    subagent: 5
    skill: 5
    config: 5
```

---

## 12. Integration with Claude Code

### Required hooks

Layer 7 requires all four Claude Code lifecycle hooks plus a custom
Stop hook:

| Hook | Provider | Purpose |
|------|----------|---------|
| `SessionStart` | context-mode | Inject routing block, prime predecessor queries |
| `PreToolUse` | context-mode | Redirect large operations to sandbox tools |
| `PostToolUse` | context-mode + budget monitor | Persist events, check utilization |
| `PreCompact` | context-mode + budget monitor | Build snapshot, emit `COMPACTION_DETECTED` |
| `Stop` | budget monitor | Final utilization report to orchestrator |

### settings.json configuration

Hooks are registered in the project's `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "command": "node hooks/sessionstart.mjs"
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash|Read|Write|Edit|NotebookEdit|Glob|Grep|WebFetch",
        "command": "node hooks/pretooluse.mjs"
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|Read|Write|Edit|NotebookEdit|Glob|Grep|TodoWrite|TaskCreate|TaskUpdate|EnterPlanMode|ExitPlanMode|Skill|Agent|AskUserQuestion|EnterWorktree|mcp__",
        "command": "node hooks/posttooluse.mjs"
      },
      {
        "matcher": "",
        "command": "bash hooks/budget-monitor.sh"
      }
    ],
    "PreCompact": [
      {
        "matcher": "",
        "command": "node hooks/precompact.mjs"
      },
      {
        "matcher": "",
        "command": "bash hooks/compaction-detector.sh"
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "command": "bash hooks/budget-report.sh"
      }
    ]
  },
  "mcpServers": {
    "context-mode": {
      "command": "npx",
      "args": ["-y", "@anthropic/context-mode"]
    }
  }
}
```

### Compatibility with --bare mode

Workers are dispatched via `claude --bare -p --output-format json
--max-turns N`. The `--bare` flag disables interactive features but
hooks still fire. Critical considerations:

- **Hooks fire normally in `--bare` mode.** SessionStart, PreToolUse,
  PostToolUse, and PreCompact all execute as configured.
- **MCP servers start normally.** The context-mode MCP server
  launches and provides its 6 sandbox tools.
- **No interactive prompts.** The budget monitor cannot prompt the
  user. At 70%, it writes the handoff artifact and exits. The
  orchestrator handles the re-dispatch decision.
- **JSON output.** Worker results include context utilization
  metadata when `--output-format json` is active. The budget monitor
  reads this for threshold checks.

### Hook execution order

When multiple hooks are registered for the same lifecycle event, they
execute in array order. For PostToolUse:

1. context-mode's `posttooluse.mjs` runs first (persists events).
2. `budget-monitor.sh` runs second (checks utilization after
   persistence is complete).

This ordering ensures that if handoff triggers, all events from the
current tool call are already persisted in SessionDB before the
session terminates.

### Prompt caching considerations

context-mode's routing block is static and injected via
`additionalContext` on SessionStart. This is compatible with Claude
Code's prompt cache structure (system prompt -> tool definitions ->
CLAUDE.md -> conversation history). The routing block lands in the
static prefix and benefits from cache hits on subsequent turns.

The `<session_knowledge>` block (injected on compact/resume) contains
session-specific data that would invalidate cache if placed in the
static prefix. In normal operation (no compaction), this block is
never injected, so cache stability is maintained throughout the
session.

The context-mode MCP server registers all 6 tools at startup. Adding
or removing MCP tools mid-session would invalidate the prompt cache.
The tool set must remain stable for the lifetime of each worker
session.

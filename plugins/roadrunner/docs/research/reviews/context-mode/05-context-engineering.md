# context-mode -- Context Engineering Conformance Evaluation

**Evaluator**: Automated source code analysis
**Date**: 2026-04-15
**Repo**: `mksglu/context-mode` v1.0.89 (Elastic-2.0 license)
**Scope**: MCP server + hooks system for Claude Code, Gemini CLI, VS Code Copilot, OpenCode, Codex CLI, Cursor, Kiro, OpenClaw, Pi Agent, Zed, Antigravity

---

## Summary

| Verdict | Count | Requirements |
|---------|-------|-------------|
| MEETS | 3 | #2, #4, #10 |
| PARTIAL | 6 | #3, #5, #6, #7, #8, #13 |
| DOES NOT MEET | 4 | #1, #9, #11, #12 |

**Headline**: context-mode is a strong context *conservation* tool (disk-canonical state, FTS5 predecessor query, auto-persisted snapshots) but it is not a context *budget management* tool. It has no concept of utilization ceilings, three-tier alerts, or compaction-as-failure-signal. It treats compaction as a normal lifecycle event and works to survive it gracefully rather than prevent it.

---

## Per-Requirement Findings

### 1. Hard 60% ceiling per worker

**Verdict**: DOES NOT MEET

**Evidence**: Searched the entire codebase for `budget`, `utilization`, `percent`, `ceiling`, `threshold`, `monitor`, `alert`, `warning`, `60%`, `40%`, `70%`. No context window utilization tracking exists. The `sessionStats` object in `server.ts` (line ~208) tracks bytes returned per tool and bytes indexed/sandboxed, but this measures *savings efficiency*, not *context window fill level*. The `ctx_stats` tool reports "X KB entered your conversation" as an after-the-fact metric, not a real-time budget monitor.

There is no mechanism to:
- Query the current context utilization percentage
- Trigger a handoff (or any action) at a threshold
- Emit a hard stop at 60%

The `AnalyticsEngine` (`src/session/analytics.ts`) computes `savedPercent`, `savings_ratio`, and `reductionPct` -- all measuring how much data was *kept out* of context, not how full the context window is.

**Notes**: context-mode's philosophy is to *minimize* what enters context (the "98% reduction" claim) rather than to *monitor* how full the window is. These are complementary but different. Our pipeline would need to layer `claude-code-session-kit`'s `context-monitor.sh` (40%/60%/70% alerts) on top of context-mode.

---

### 2. Disk-canonical state

**Verdict**: MEETS

**Evidence**: context-mode operates on a fundamental principle that canonical state lives on disk in SQLite, not in conversation history.

- **SessionDB** (`src/session/db.ts`): Per-project SQLite database at `~/.claude/context-mode/sessions/<hash>.db` stores all session events, metadata, and resume snapshots. Three tables: `session_events`, `session_meta`, `session_resume`.
- **ContentStore** (`src/store.ts`): Separate FTS5 SQLite database at `~/.claude/context-mode/content/<hash>.db` stores indexed content chunks. Tables: `sources`, `chunks` (FTS5 virtual table with porter/unicode61 tokenizer), `chunks_trigram` (FTS5 trigram tokenizer), `vocabulary`.
- **CLAUDE.md** (`configs/claude-code/CLAUDE.md` lines 18-19): Enforces "Write artifacts to FILES -- never return them as inline text. Return only: file path + 1-line description."
- **Snapshot builder** (`src/session/snapshot.ts` lines 8-13): Explicitly documented: "Instead of truncated inline data, each section contains a natural summary plus a runnable search tool call that retrieves full details from the indexed knowledge base on demand. Zero truncation. Zero information loss. Full data lives in SessionDB."

The conversation history is treated as ephemeral scaffolding. After compaction, the model receives a minimal `<session_knowledge>` directive pointing to the FTS5 knowledge base, not a dump of prior conversation.

**Notes**: This is the strongest alignment with our pipeline philosophy. The disk-canonical approach means workers can be killed without data loss -- SQLite is crash-safe with WAL mode.

---

### 3. Defined handoff protocol

**Verdict**: PARTIAL

**Evidence**: The PreCompact hook (`hooks/precompact.mjs`) builds a resume snapshot via `buildResumeSnapshot()` that contains structured sections:

- `<files>`: Modified file paths with operation counts (write/read/edit)
- `<errors>`: Error messages from tool failures
- `<decisions>`: User decisions (corrections, approach selections)
- `<rules>`: CLAUDE.md content (project rules)
- `<git>`: Git operations performed (commit, push, branch, etc.)
- `<task_state>`: Pending tasks from TaskCreate/TaskUpdate
- `<environment>`: Working directory, env setup commands
- `<subagents>`: Subagent launch/completion status
- `<skills>`: Skills invoked during session
- `<intent>`: Session mode (investigate/implement/discuss/review)

Each section includes BM25 search queries for retrieving full details from the FTS5 knowledge base.

**What's missing for our handoff protocol**:
- No explicit **commit hashes** -- git operations are tracked as category labels ("commit", "push") but the actual commit SHA is not extracted from `git commit` output. The PostToolUse hook (`src/session/extract.ts` line 249) stores only the operation name, not the response.
- No explicit **blockers** section -- errors are tracked but not categorized as blockers vs resolved issues.
- No structured **next steps** -- the snapshot captures pending tasks but doesn't generate a "what to do next" directive for a successor session.
- No explicit **rationale** for decisions -- the `decision` category captures Q&A pairs and correction patterns, but doesn't extract the "why" behind architectural choices.

**Notes**: The snapshot structure is 80% of what we need. The gap is mainly in the *richness* of what's captured per event, not in the architecture. A custom PostToolUse extractor that parses `git commit` output for SHAs and classifies errors into resolved/blocking would close most gaps.

---

### 4. Predecessor query

**Verdict**: MEETS

**Evidence**: The FTS5/BM25 knowledge base provides exactly this capability.

- **SessionStart hook** (`hooks/sessionstart.mjs` lines 53-59): On `compact` or `resume`, writes session events to a markdown file (`<hash>-events.md`) organized by H2 headings per category. This file is then auto-indexed by the MCP server into the ContentStore FTS5 database.
- **Auto-indexing** (`src/server.ts` lines 97-109): `maybeIndexSessionEvents()` is called on every `getStore()` invocation. It scans `~/.claude/context-mode/sessions/` for `*-events.md` files and indexes them with `source: "session-events"`.
- **Search tool** (`ctx_search`): Accepts `queries` array and optional `source` filter. When `source: "session-events"` is specified, queries are scoped to session event data.
- **Snapshot search references** (`src/session/snapshot.ts` lines 56-59): Each snapshot section includes pre-built search tool calls: `ctx_search(queries: [...], source: "session-events")`.

A new session can query "what did the previous session decide about X?" by:
1. SessionStart hook (on `resume` source) loads events from the most recent session via `getLatestSessionEvents()` and indexes them.
2. The `<session_knowledge>` directive tells the model to use `ctx_search(queries: [...], source: "session-events")`.
3. BM25 ranking returns the most relevant chunks from the previous session's events.

**Notes**: The FTS5 search uses a multi-tier fallback: porter stemming first, then trigram matching, then fuzzy correction via Levenshtein distance against the vocabulary table. This is genuinely useful for imprecise queries like "that authentication thing from yesterday." The critical question is whether BM25 ranking returns useful results in practice -- this is only answerable through trial.

---

### 5. Stable static prefix

**Verdict**: PARTIAL

**Evidence**: context-mode injects its routing block via the SessionStart hook's `additionalContext` field. The `ROUTING_BLOCK` (`hooks/routing-block.mjs`) is a static XML template (`<context_window_protection>`) that contains tool selection hierarchy, forbidden actions, and output constraints. It is regenerated identically on every SessionStart call.

However, context-mode does not explicitly reason about **prompt cache preservation**:
- The routing block is injected as `additionalContext` in the SessionStart response. Whether this lands in the cached static prefix vs the dynamic portion depends on Claude Code's internal prompt assembly, not context-mode.
- The `<session_knowledge>` block injected on compact/resume contains session-specific data that changes every time, which would invalidate cache if placed in the static prefix.
- There is no code that detects or logs cache-invalidating events.
- The `guidanceOnce()` function in `hooks/core/routing.mjs` (lines 40-67) throttles per-session advisory messages to show each type only once. This implicitly reduces churn in context additions, but the motivation is reducing noise, not cache preservation.

**Notes**: The design is *compatible* with prompt cache stability -- the routing block is stable, and session-specific data is kept in a separate `<session_knowledge>` block that would naturally go in the dynamic portion. But there's no explicit mechanism to *ensure* cache stability or detect when it's violated.

---

### 6. Append-only where possible

**Verdict**: PARTIAL

**Evidence**: The SessionDB uses an append-only event model with some notable exceptions:

- **Append-only events**: `insertEvent()` always appends new rows. No existing event data is modified. (`src/session/db.ts` lines 310-347)
- **Deduplication**: Recent events (last 5 by default, `DEDUP_WINDOW = 5`) are checked for duplicate type+hash combinations. Duplicates are silently dropped. This is append-only-compatible (skip rather than overwrite).
- **FIFO eviction**: When events exceed `MAX_EVENTS_PER_SESSION = 1000`, the lowest-priority oldest event is deleted. This is a mutation, not append-only.
- **Resume snapshot upsert**: `upsertResume()` uses `ON CONFLICT DO UPDATE`, overwriting the previous snapshot. This is explicitly not append-only.
- **ContentStore**: `index()` with a duplicate label deletes previous chunks before re-indexing (dedup path at `store.ts` statement declarations).
- **Cleanup**: `cleanupOldSessions(7)` deletes sessions older than 7 days. `deleteSession()` wipes all data for a session.

The FTS5 knowledge base is effectively append-only during a session (new sources are added, old ones are only cleaned up across sessions), which is favorable for prompt cache.

**Notes**: The eviction and upsert patterns are pragmatic concessions to bounded storage. For our pipeline, where sessions are short-lived workers, the 1000-event limit and upsert patterns are unlikely to be hit, making the system effectively append-only in practice.

---

### 7. Deferred tool loading

**Verdict**: PARTIAL

**Evidence**: context-mode registers all MCP tools at server startup in `server.ts`. The tools are: `ctx_execute`, `ctx_execute_file`, `ctx_index`, `ctx_search`, `ctx_fetch_and_index`, `ctx_batch_execute`, `ctx_stats`, `ctx_doctor`, `ctx_upgrade`, `ctx_purge`, `ctx_insight`. All 11 tools are registered via `server.registerTool()` calls with full schema definitions up front.

However, the **ContentStore** (FTS5 database) is lazy-loaded (`server.ts` line 87: `let _store: ContentStore | null = null;`). The SQLite database is only opened when the first index/search call arrives. This prevents the overhead of better-sqlite3 initialization and WAL file creation until needed.

The `PolyglotExecutor` is initialized eagerly at server startup (line 69), but this is lightweight (just runtime detection).

Claude Code's own deferred tool loading mechanism (the `ToolSearch` infrastructure in the system prompt) is unrelated to context-mode.

**Notes**: context-mode does not implement deferred *schema* loading -- all tool definitions are sent in the MCP `tools/list` response at connect time. This adds ~17KB to the initial tool listing (per `BENCHMARK.md` line 43: "MCP tools (40 tools) | MCP tools/list | 17.0 KB"). In a pipeline where multiple MCP servers may be active, this contributes to static prefix bloat. The tool descriptions are also quite verbose (the `ctx_execute` description alone is ~600 bytes with THINK IN CODE instructions baked in).

---

### 8. Mode isolation

**Verdict**: PARTIAL

**Evidence**: context-mode tracks session intent as one of four modes: `investigate`, `implement`, `discuss`, `review` (`src/session/extract.ts` lines 556-568). However, this is observational classification, not enforcement:

- Intent is extracted from user message patterns and stored as a low-priority event (priority 4).
- No mechanism switches tools, permissions, or context composition based on mode.
- All event categories (file, decision, task, error, git, env, etc.) are stored in the same SessionDB and the same FTS5 knowledge base.
- The snapshot builder includes intent as a simple `<intent mode="investigate"/>` tag but doesn't use it to filter which sections are included.

The `<session_knowledge>` block in `session-directive.mjs` does separate content by category (## Files Modified, ## Key Decisions, ## Pending Tasks, etc.), providing structural separation within a single context injection. But prose, decision, and code contexts can freely intermix in the conversation.

**Notes**: Mode isolation in our pipeline sense (separate sessions for research vs implementation) is not something context-mode addresses. It would need to come from the pipeline orchestrator. context-mode's event categorization system (13+ categories with priority levels) provides a foundation that could be used for filtering, but the filtering logic would need to be built by us.

---

### 9. Phase-boundary splits (RPI pattern)

**Verdict**: DOES NOT MEET

**Evidence**: context-mode has no concept of phases, phase boundaries, or the Research-Planning-Implementation pattern. It operates within a single session lifecycle: `SessionStart -> (PreToolUse -> PostToolUse)* -> PreCompact -> SessionStart(compact) -> ...`

There is no mechanism to:
- Declare a session as "research-only" or "implementation-only"
- Enforce that research findings are committed before implementation begins
- Split a task into sequential phase sessions
- Detect when a session has transitioned from research to implementation

The `plan` event category (`src/session/extract.ts` lines 286-349) tracks `EnterPlanMode`/`ExitPlanMode` tool calls and plan approval/rejection, which acknowledges a distinction between planning and execution. But this is event recording, not phase enforcement.

**Notes**: Phase-boundary splits are an orchestration concern. context-mode is a per-session tool, not an orchestrator. Our pipeline would implement RPI by dispatching separate workers with different context-mode configurations -- e.g., a research worker whose snapshot becomes the input for a planning worker.

---

### 10. Auto-persisted state

**Verdict**: MEETS

**Evidence**: Session state is persisted automatically at every lifecycle event without requiring the worker to remember:

- **PostToolUse hook** (`hooks/posttooluse.mjs`): Fires after *every* tool call matching the broad matcher pattern (`Bash|Read|Write|Edit|NotebookEdit|Glob|Grep|TodoWrite|TaskCreate|TaskUpdate|EnterPlanMode|ExitPlanMode|Skill|Agent|AskUserQuestion|EnterWorktree|mcp__`). Extracts events from the tool call and writes them to SessionDB. Target latency: <20ms.
- **UserPromptSubmit hook** (`hooks/userpromptsubmit.mjs`): Fires on every user message. Captures the raw prompt plus extracted decision/role/intent/data events. Target latency: <10ms.
- **PreCompact hook** (`hooks/precompact.mjs`): Fires before Claude Code compacts the conversation. Reads all session events, builds a `buildResumeSnapshot()` XML, and stores it as a resume row in SessionDB.
- **SessionStart hook** (`hooks/sessionstart.mjs`): On `compact` source, writes session events as markdown for FTS5 auto-indexing. On `startup`, captures CLAUDE.md files from disk.

The entire flow is:
1. Every tool call -> PostToolUse -> SQLite write
2. Every user message -> UserPromptSubmit -> SQLite write
3. Compaction imminent -> PreCompact -> Build snapshot -> SQLite write
4. After compaction -> SessionStart(compact) -> Write events to .md -> Auto-index into FTS5

No step requires the LLM to explicitly "save" its state. All persistence is automatic.

**Notes**: The `hooks.json` file (`hooks/hooks.json`) registers all four hook types. The `PostToolUse` matcher covers the union of all tools that produce meaningful session events. The `PreCompact` and `SessionStart` matchers are empty strings (match everything), meaning they always fire.

---

### 11. Compaction as a failure signal

**Verdict**: DOES NOT MEET

**Evidence**: context-mode treats compaction as a **normal lifecycle event** to be survived gracefully, not as a signal to decompose. Multiple code paths and documentation confirm this:

- `sessionstart.mjs` line 42: `if (source === "compact")` is a normal branch, not an error handler.
- `session_meta.compact_count`: Tracks how many times compaction occurred. Used for display in `ctx_stats` output, not for triggering decomposition.
- `README.md` line 39: "Session Continuity -- Every file edit... is tracked in SQLite. When the conversation compacts, context-mode doesn't dump this data back into context -- it indexes events into FTS5 and retrieves only what's relevant."
- `session/snapshot.ts` line 469: The snapshot includes `compact_count="${compactCount}"` as metadata, treating it as a counter, not an alarm.
- The `ctx_stats` output (`session/analytics.ts` line 485) shows compactions as a neutral metric: "Session continuity: N events preserved across M compactions."

There is no code that:
- Logs compaction as a warning or error
- Treats compaction as a signal to stop or decompose
- Increases urgency or changes behavior based on compact_count

**Notes**: This is a fundamental philosophical difference. context-mode's value proposition is "compaction is fine because we handle it." Our pipeline needs "compaction should never happen because sessions are short enough." These are complementary -- context-mode's conservation keeps sessions small enough that our pipeline's hard ceiling can be set to avoid compaction entirely.

---

### 12. Three-tier context alerts

**Verdict**: DOES NOT MEET

**Evidence**: No context utilization monitoring exists at any level. See Requirement #1 for the detailed search results. The `sessionStats` object tracks bytes returned/indexed/sandboxed but never compares these against the total context window size (200K tokens / ~800KB).

There is no:
- Percentage-based utilization calculation
- Warning system at any threshold
- Integration with Claude Code's `/cost` or context window APIs
- Hook or callback for context fill level changes

**Notes**: This is the most significant gap for our pipeline. Without utilization alerts, workers cannot proactively hand off before reaching dangerous fill levels. The `claude-code-session-kit` shell hooks (`context-monitor.sh`) would need to run alongside context-mode to provide this layer.

---

### 13. Tool-result containment

**Verdict**: PARTIAL

**Evidence**: context-mode's core value proposition is keeping tool results out of context, but the containment is opt-in, not automatic:

- **Sandbox execution** (`ctx_execute`, `ctx_execute_file`): Code runs in a subprocess. Only `console.log()` output enters context. Raw data stays in the sandbox. This is true containment.
- **Intent-driven indexing** (`server.ts` lines 829-883): When `intent` is provided and output exceeds 5KB (`INTENT_SEARCH_THRESHOLD`), output is indexed into FTS5 and only section titles + previews are returned.
- **Auto-indexing large output** (`server.ts` line 827): Outputs exceeding 100KB (`LARGE_OUTPUT_THRESHOLD`) are automatically indexed into FTS5 with only a pointer returned.
- **Fetch and index** (`ctx_fetch_and_index`): Fetches URLs, converts HTML to markdown, chunks, indexes into FTS5. Raw HTML never enters context.
- **Smart truncation** (`BENCHMARK.md` Part 3): When output exceeds limits, head (60%) + tail (40%) is preserved with a truncation notice.

**What's NOT contained**:
- Tool results under 5KB flow directly into context without indexing.
- The PreToolUse hook *nudges* the model to use context-mode tools instead of Bash/Read/Grep, but only blocks curl/wget/WebFetch outright. A Bash command producing 500 lines of output can still enter context if the model ignores the guidance.
- The `guidanceOnce()` throttle (`hooks/core/routing.mjs`) means the nudge is only shown once per session per tool type. After the first Bash use, subsequent Bash commands with large output flow through unimpeded.
- Native Read/Grep results are not intercepted -- only guidance is added via `additionalContext` on the first invocation.

**Notes**: The containment works well when the model follows the routing instructions (use `ctx_execute` instead of Bash for analysis). But it relies on model compliance, not enforcement. The PreToolUse hook can deny/modify tool calls, but it only does so for curl/wget/WebFetch/build-tools -- not for generic Bash commands with large output.

---

## Architecture Deep-Dive

### Hook Pipeline

The hook pipeline follows the Claude Code lifecycle:

```
SessionStart(startup)
  -> Inject ROUTING_BLOCK into additionalContext
  -> Capture CLAUDE.md files into SessionDB
  -> Clean up old sessions (>7 days)

For each tool call:
  PreToolUse
    -> Normalize tool name (cross-platform aliases)
    -> Security check (Bash deny patterns)
    -> Route: deny curl/wget/WebFetch, redirect to MCP tools
    -> Inject guidance (once per session per type)

  [Tool executes normally]

  PostToolUse
    -> Extract events from tool call (13 categories)
    -> Write events to SessionDB (SQLite, <20ms)

For each user message:
  UserPromptSubmit
    -> Save raw prompt to SessionDB
    -> Extract decision/role/intent/data events

When Claude Code compacts:
  PreCompact
    -> Read all events from SessionDB
    -> Build XML resume snapshot
    -> Store snapshot in session_resume table
    -> Increment compact_count

  SessionStart(compact)
    -> Write events as markdown to <hash>-events.md
    -> Build session_knowledge directive
    -> Inject as additionalContext
    -> MCP server auto-indexes events.md into FTS5
```

### SQLite Schema

**SessionDB** (`src/session/db.ts`):

```sql
session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,          -- e.g., "file_read", "git", "decision"
  category TEXT NOT NULL,      -- e.g., "file", "git", "decision"
  priority INTEGER NOT NULL,   -- 1=critical, 5=low
  data TEXT NOT NULL,          -- Full payload, no truncation
  source_hook TEXT NOT NULL,   -- "PostToolUse" or "UserPromptSubmit"
  created_at TEXT NOT NULL,
  data_hash TEXT NOT NULL      -- SHA256 prefix for deduplication
)

session_meta (
  session_id TEXT PRIMARY KEY,
  project_dir TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_event_at TEXT,
  event_count INTEGER NOT NULL DEFAULT 0,
  compact_count INTEGER NOT NULL DEFAULT 0
)

session_resume (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  snapshot TEXT NOT NULL,       -- XML resume snapshot
  event_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0
)
```

**ContentStore** (`src/store.ts`):

```sql
sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  code_chunk_count INTEGER NOT NULL DEFAULT 0,
  indexed_at TEXT NOT NULL
)

chunks USING fts5 (           -- Porter stemming + unicode61
  title, content,
  source_id UNINDEXED,
  content_type UNINDEXED
)

chunks_trigram USING fts5 (   -- Trigram tokenizer for substring matching
  title, content,
  source_id UNINDEXED,
  content_type UNINDEXED
)

vocabulary (word TEXT PRIMARY KEY)  -- For fuzzy correction via Levenshtein
```

### FTS5 Search Mechanism

Search uses a three-tier fallback chain:

1. **Porter stemming** (primary): FTS5 `MATCH` with porter tokenizer. Handles morphological variants (e.g., "configure" matches "configuration").
2. **Trigram** (fallback): FTS5 `MATCH` with trigram tokenizer. Catches substring matches that porter misses.
3. **Fuzzy correction** (last resort): If both FTS5 searches return empty, individual query terms are fuzzy-corrected against the vocabulary table using Levenshtein distance (max distance scales with word length: <=4 chars -> 1, <=12 -> 2, else 3). Corrected terms are re-searched via porter.

BM25 ranking is used for relevance scoring. Stopword filtering removes common terms that dilute ranking. Proximity scoring (`findMinSpan`) boosts results where query terms appear close together.

Results include `highlighted` text with STX/ETX markers from FTS5, used for smart snippet extraction -- returning windows around matching terms rather than arbitrary truncation.

### Context Sandboxing

The `PolyglotExecutor` (`src/executor.ts`) runs code in subprocess isolation:

- **Environment sanitization**: 50+ dangerous environment variables are stripped (LD_PRELOAD, NODE_OPTIONS, BASH_ENV, PYTHONSTARTUP, etc.), preventing code injection via env vars.
- **Temp directory isolation**: Scripts run in `mkdtempSync()` directories, not the project root.
- **Process group kill**: Processes are spawned with `detached: true` and killed via process group (`-pid`) to catch all children.
- **Byte cap**: Combined stdout+stderr is capped at 100MB (`hardCapBytes`), killing the process if exceeded.
- **Timeout**: Default 30s, configurable. Background mode detaches the process after timeout.
- **11 languages**: JS, TS, Python, Shell, Ruby, Go, Rust, PHP, Perl, R, Elixir.

The sandbox does NOT prevent filesystem access -- scripts can read/write anywhere the process user can. Security is enforced at the hook layer (deny patterns in `security.ts`) and the MCP tool layer (file path checks against Read deny patterns).

---

## Benchmark Analysis

### Claims from BENCHMARK.md

- **"96% overall context savings"**: Measured across 21 scenarios processing 376KB total.
- **"98% savings" (Part 1)**: `ctx_execute_file` summarization -- 315KB raw -> 5.5KB context. These are *summaries*, not exact content retrieval.
- **"82% savings" (Part 2)**: `ctx_index + ctx_search` knowledge retrieval -- 60.3KB raw -> 11KB context. These return exact code blocks, not summaries.
- **"100% code examples preserved"**: FTS5 returns exact code blocks, not descriptions.

### Is the "98% context reduction" real?

**Conditionally yes.** The 98% figure applies specifically to the `ctx_execute_file` path where a script reads a file and prints only a summary. For example, a 45KB nginx access log produces a 155-byte summary ("500 requests, 98% 200s, avg latency 45ms"). This is genuinely a 99.7% reduction.

**Conditions where it holds**:
- Log files, CSV data, access logs (summarization is natural)
- Build output (extract error count + key failures)
- GitHub issues/PRs (extract titles + counts)
- Playwright snapshots (extract page structure)

**Conditions where it weakens**:
- Documentation where you need exact code examples: 44-85% savings (Part 2 benchmarks)
- Small outputs (<5KB): pass through without indexing, 0% savings
- Network requests (0.4KB raw -> 349B context): 13% savings (already small)

**What's NOT measured**: The overhead of context-mode itself. The ROUTING_BLOCK injected at SessionStart is ~2KB. The `<session_knowledge>` directive after compaction adds 1-5KB. Tool descriptions for 11 MCP tools add ~17KB to the initial tools/list response. For a fresh session with minimal tool use, context-mode adds more context than it saves.

### For our pipeline

Worker sessions that do heavy analysis (reading logs, processing test output, exploring codebases) would benefit enormously. Worker sessions that primarily edit files and make small commits would see minimal benefit since Read/Edit operations aren't sandboxed (you need the file content in context to edit it).

---

## Integration Surface

### Claude Code CLI `--bare` mode

**Not explicitly tested or documented.** The codebase contains no references to `--bare`, `headless`, or `worker` in the source code. However:

- The MCP server (`server.bundle.mjs`) communicates via stdio JSON-RPC, which works in any Claude Code mode.
- Hooks are registered via `hooks.json` and fire based on lifecycle events, which should work in `--bare` mode.
- The SessionStart hook relies on `CLAUDE_SESSION_ID` env var for session identification. If `--bare` mode sets this (which it does), hooks work.
- The `start.mjs` entrypoint sets `CLAUDE_PROJECT_DIR` from `process.cwd()` if not already set, which handles headless invocation.
- The `getSessionId()` function in `hooks/session-helpers.mjs` has a fallback chain: `transcript_path UUID > sessionId > session_id > env var > pid-{ppid}`. The `pid-{ppid}` fallback ensures unique session IDs even without explicit session IDs.

**Likely works** but needs verification. The main risk is that `--bare` mode might not fire all hook types (particularly UserPromptSubmit and PreCompact).

### Subagent compatibility

**Explicitly supported.** The PreToolUse routing (`hooks/core/routing.mjs` lines 299-313) intercepts the `Agent` tool and:
1. Injects the ROUTING_BLOCK into the subagent's prompt
2. Excludes `<ctx_commands>` section (subagents can't run ctx stats/doctor/upgrade)
3. Upgrades `subagent_type: "Bash"` to `"general-purpose"` so subagents can use MCP tools

The PostToolUse extractor tracks subagent launches and completions (`extractSubagent` in `src/session/extract.ts` lines 417-432).

### Hooks needed

All four Claude Code hook types are used:
- **SessionStart**: Injects routing rules and restores session state
- **PreToolUse**: Routes tool calls, blocks dangerous commands, injects guidance
- **PostToolUse**: Captures session events from tool calls
- **PreCompact**: Builds resume snapshot before compaction

Plus: **UserPromptSubmit**: Captures user prompts and extracts decisions/intent

### How it would compose with our pipeline

```
Pipeline Orchestrator
  |
  +-> Dispatch Worker (claude code --bare with context-mode MCP)
  |     |
  |     +-- context-mode hooks fire automatically
  |     +-- context-mode MCP tools available for sandbox execution
  |     +-- SessionDB accumulates events in SQLite
  |     +-- Worker completes or times out
  |     |
  |     +-- SessionDB persists: events, snapshot, metadata
  |
  +-> Next Worker (same project dir)
        |
        +-- SessionStart(startup) fires
        +-- Previous session events auto-indexed into FTS5
        +-- Worker can ctx_search(queries, source: "session-events")
        +-- Predecessor context available without replay
```

**What the pipeline orchestrator would need to provide**:
1. **Context budget monitoring** -- context-mode does not do this
2. **Handoff trigger** -- based on budget alerts, not compaction
3. **Phase separation** -- dispatch research/plan/implement as separate workers
4. **Structured handoff artifacts** -- extract commit hashes, blockers, next steps from SessionDB events

---

## Surprises

### Unexpected capabilities

1. **Cross-platform support**: context-mode works with 12 different AI coding platforms via adapters. Each adapter normalizes tool names and hook formats. This is far more than "a Claude Code plugin."

2. **Worktree isolation**: Sessions in git worktrees get separate SQLite databases via a hash suffix (`getWorktreeSuffix()` in `src/session/db.ts`). This means parallel workers in different worktrees won't clobber each other's session data.

3. **Security layer**: A full security module (`src/security.ts`) implements deny/allow patterns for Bash commands, with both hook-side and server-side enforcement. This dual enforcement (hooks as primary, server as fallback) is defense in depth.

4. **OpenClaw/Pi Agent integration**: context-mode has a full TypeScript plugin for OpenClaw that registers lifecycle hooks, a context engine, and all MCP tools. This suggests the codebase is built for platform-agnostic composability.

5. **Elastic-2.0 license**: Not MIT/Apache. Restricts hosting as a managed service. Fine for internal pipeline use but blocks SaaS deployment.

### Unexpected limitations

1. **No session cross-referencing**: Sessions from different projects are isolated by hash. There is no mechanism to query across projects ("what did we learn about auth patterns in the API project?").

2. **Event extraction is regex-based**: Decision detection uses patterns like `don't|do not|never|always|instead|rather|prefer` (`src/session/extract.ts` lines 506-512). This is fragile -- "I always loved this approach" would register as a decision. Turkish patterns are included, suggesting the author is Turkish, but no other languages are supported.

3. **No event editing or correction**: If PostToolUse incorrectly classifies an event, there's no way to correct it. The SessionDB is append-only for events (no update API). Incorrect events persist and can pollute snapshots.

4. **500-word response limit**: The CLAUDE.md and ROUTING_BLOCK both enforce "Keep responses under 500 words." For pipeline workers that need to produce detailed analysis reports, this constraint would need to be overridden.

5. **The "Think in Code" paradigm is aggressive**: context-mode's CLAUDE.md instructs the model to never use Bash for commands producing >20 lines of output, never use Read for analysis, and never use WebFetch. These are hard rules baked into the routing block. For workers that legitimately need to read file contents into context (e.g., to do a multi-file edit), this routing can be counterproductive.

---

## Open Questions for Trial

1. **Does PreCompact fire in `--bare` mode?** This is the critical path for our pipeline. If `--bare` sessions don't fire PreCompact (or any) hooks, context-mode's session continuity is broken for headless workers.

2. **BM25 search quality for predecessor queries**: Does `ctx_search(queries: ["authentication decision"], source: "session-events")` return the right decision from a session that discussed auth? Benchmarks show it works for documentation; session events may have different characteristics (shorter, more cryptic).

3. **Latency under load**: PostToolUse targets <20ms. With 500+ events in SessionDB and frequent tool calls, does SQLite WAL mode maintain this? The `DEDUP_WINDOW = 5` check and `MAX_EVENTS_PER_SESSION = 1000` eviction add overhead.

4. **Interaction with our context-monitor.sh**: If our pipeline's shell hook saves state at 60% and stops at 70%, does that conflict with context-mode's PreCompact hook? Both would fire near the compaction boundary but with different goals (ours: stop; context-mode's: survive).

5. **Session isolation across parallel workers**: Two workers on the same project with different worktrees get separate SessionDBs (worktree suffix). But two workers on the same project in the same directory would share the same SessionDB. Is the session_id sufficient to prevent cross-contamination?

6. **FTS5 index size growth**: Over many sessions, does the ContentStore grow unbounded? `cleanupStaleContentDBs(14)` removes DBs older than 14 days, but within those 14 days, a busy project could accumulate substantial data.

7. **Event category completeness**: The 13 event categories cover files, tasks, git, errors, decisions, env, rules, skills, subagents, intent, data, cwd, and MCP. Is anything missing that our pipeline needs? E.g., no "architecture" or "dependency" category.

8. **better-sqlite3 dependency**: context-mode requires native SQLite bindings (`better-sqlite3` with optional `bun:sqlite` adapter). This needs Node.js ABI-compatible binaries. Does this work reliably in CI/Docker environments? The `ensure-deps.mjs` script handles ABI cache/rebuild, but this adds complexity.

---

## Source Index

### Files read in full

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Architectural instructions for the model |
| `BENCHMARK.md` | Performance claims and benchmark data |
| `package.json` | Dependencies, scripts, version (1.0.89) |
| `llms.txt` | Architecture overview for LLMs |
| `src/executor.ts` | PolyglotExecutor -- sandbox subprocess runner |
| `src/session/db.ts` | SessionDB -- per-project SQLite for session events |
| `src/session/snapshot.ts` | Resume snapshot builder (pure functions) |
| `src/session/extract.ts` | Event extraction from tool calls (13 categories) |
| `src/session/analytics.ts` | Analytics engine + report formatter |
| `src/truncate.ts` | String truncation and XML escaping utilities |
| `src/lifecycle.ts` | Process lifecycle guard (orphan prevention) |
| `src/db-base.ts` (partial) | SQLite infrastructure (WAL, prepared statements) |
| `hooks/precompact.mjs` | PreCompact hook -- build resume snapshot |
| `hooks/sessionstart.mjs` | SessionStart hook -- inject context, restore state |
| `hooks/pretooluse.mjs` | PreToolUse hook -- route tools, enforce sandbox |
| `hooks/posttooluse.mjs` | PostToolUse hook -- capture session events |
| `hooks/userpromptsubmit.mjs` | UserPromptSubmit hook -- capture user messages |
| `hooks/hooks.json` | Hook registration manifest |
| `hooks/routing-block.mjs` | Routing rules template (XML) |
| `hooks/core/routing.mjs` | PreToolUse routing logic (pure functions) |
| `hooks/session-directive.mjs` | Session knowledge directive builder |
| `hooks/session-helpers.mjs` | Shared session utilities (paths, IDs, stdin) |
| `configs/claude-code/CLAUDE.md` | Claude Code routing instructions |
| `start.mjs` | Server entrypoint with self-heal logic |

### Files read partially

| File | Lines | Purpose |
|------|-------|---------|
| `src/server.ts` | 1-200, 200-500, 500-800, 800-1100 | MCP server -- tool registration, session stats, security |
| `src/store.ts` | 1-200, 200-450 | ContentStore -- FTS5 schema, search, indexing |
| `README.md` | 1-100 | Installation, problem statement |

### Directories enumerated

| Path | Contents |
|------|----------|
| `/` (root) | 30+ files including bundles, configs, hooks, src |
| `src/` | Core source -- server, store, executor, session, adapters |
| `src/adapters/` | 11 platform adapters (claude-code, gemini-cli, cursor, etc.) |
| `hooks/` | Hook scripts for 6 platforms + core routing |
| `configs/` | Per-platform configuration (CLAUDE.md, hooks.json, mcp.json) |
| `skills/` | 7 skill definitions (context-mode, ops, doctor, stats, etc.) |
| `tests/` | Unit/integration tests for all subsystems |
| `docs/` | Adapter documentation |

### Grep searches performed

| Pattern | Purpose | Key findings |
|---------|---------|-------------|
| `bare\|headless\|CLI.*mode\|worker` | Bare mode support | No references |
| `budget\|utilization\|ceiling\|60%\|40%\|70%` | Context budget monitoring | No monitoring -- only savings metrics |
| `compaction.*fail\|signal\|death\|spiral` | Compaction as failure | Treated as normal lifecycle |
| `handoff\|predecessor\|cross.session` | Handoff protocol | No explicit handoff; predecessor via FTS5 search |
| `prompt.cache\|cache.invalidat\|static.*prefix` | Prompt cache awareness | No explicit cache management |

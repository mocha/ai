---
date: 2026-04-15
status: synthesis — second pass
inputs:
  - 27 per-framework / per-domain conformance reports in `reviews/{skylark,gastown,triad}/`
  - 9 composable-tool conformance reports in `reviews/{xstate,taskmaster,restate,openllmetry,langfuse,context-mode}/`
  - composable-toolchain-report.md (landscape scan)
  - ENG-180 retrospective, context/compaction research, sandbox ergonomics report
scope: architecture decision for the next-generation Skylark pipeline
supersedes: first-pass synthesis (three-framework comparison only)
---

# Evaluation Synthesis — Second Pass

## 1. Executive summary

The first-pass synthesis framed the decision as "adopt Gas Town, stay
standalone, or combine." The second pass introduces a third path —
**compose a stack from small, focused tools** — and evaluates six
candidate tools against the same criteria used for the three-framework
comparison. This pass narrows the decision to two concrete architectures,
both viable, with different trade-off profiles.

**Two paths survive:**

- **Path A — Gas Town as monolithic runtime** with Skylark as domain
  layer and Triad-mined discipline patterns. This was the first-pass
  recommendation. It remains contingent on the prompt-channel question
  (can `gt sling --var` carry a full vocabulary-routed expert prompt?).

- **Path B — Composed stack** assembled from XState (orchestration) +
  Taskmaster AI (task substrate/decomposition) + Claude Code CLI
  (workers) + Skylark review layer (review/gating) + OpenLLMetry +
  Langfuse (monitoring) + context-mode (context engineering). Each
  component owns one pipeline stage with file-based contracts between
  them. No monolithic dependency.

**The composable path is now concrete, not theoretical.** Six tools
evaluated against the same 9-domain criteria produce a combined score
that matches or exceeds Gas Town in five domains, while preserving the
"swap any single layer" property that Gas Town does not offer.

**What changed from first pass:**
- Gas Town's prompt-channel limitation is no longer the *only* blocker.
  The composable path sidesteps it entirely — Skylark generates expert
  prompts and passes them directly to Claude Code CLI workers.
- Five critical gaps identified: pre-dispatch context estimator, typed
  review verdict schema, supervision daemon, worker instrumentation
  bridge, and cross-session trace ID standard. All are small builds
  (~50-200 lines each), not framework-scale efforts.
- OpenLLMetry cannot instrument Claude Code CLI processes. This is an
  architectural constraint that affects both paths equally.

**Recommendation direction:** Path B (composed stack) as the primary
pursuit, with Gas Town's Beads substrate as the contingency if
Taskmaster proves insufficient at scale. Rationale: Path B preserves
composability and avoids the coupling risk the user identified as a
core concern, while covering 7 of 9 domains with production-quality
tools. Path A remains viable if Gas Town's prompt channel opens up
and the coupling trade-off is accepted.

---

## 2. Methodology

### First pass (three frameworks)
Nine framework-agnostic domain specs with 117 testable requirements.
Twenty-seven independent Opus agents evaluated Skylark, Gas Town, and
Triad — one per framework per domain. Reports in `reviews/{skylark,
gastown,triad}/`.

### Second pass (composable tools)
Six additional tools evaluated against the same criteria, scoped to
only their applicable domains. Nine reports from six Opus agents
reading cloned source code. Reports in `reviews/{xstate,taskmaster,
restate,openllmetry,langfuse,context-mode}/`. A landscape scan
(`composable-toolchain-report.md`) preceded the evaluations to
identify candidates.

---

## 3. Three-framework comparison (first-pass findings, preserved)

### Scorecard

| Domain | Skylark | Gas Town | Triad |
|---|---:|---:|---:|
| 01 Orchestration model | 0 | 7 | 0 |
| 02 Worker model | 4 | 7 | 3 |
| 03 Artifact & task substrate | 3 | 11 | 5 |
| 04 Review & gate model | 8 | 3 | 6 |
| 05 Context engineering | 2 | 4 | 0 |
| 06 Task decomposition & sizing | 4 | 1 | 6 |
| 07 Integration & merge model | 0 | 5 | 0 |
| 08 Monitoring & recovery | 0 | 10 | 0 |
| 09 Environment isolation | 1 | 4 | 2 |
| **MEETS total** | **22** | **52** | **22** |

Gas Town wins 7/9 domains (52 MEETS). Skylark owns review/gating (8).
Triad owns decomposition discipline (6). Full per-domain analysis in
first-pass synthesis and individual review files.

### Topline characterization (unchanged)

- **Gas Town** = runtime substrate. Mature Go codebase, Dolt-backed
  Beads, Bors merge queue, OTEL telemetry, four-tier supervisor. Does
  not teach you to size a task or generate a per-task expert.
- **Skylark** = process discipline. Vocabulary-routed experts, bounded
  panel review, risk-tiered gates. High-quality output when the pipeline
  survives; the pipeline does not survive reliably.
- **Triad** = retired decomposition cascade. The discipline it encoded
  (depth-capped decomposition, round-accounted gates, decision capture,
  Sonnet-as-sizing-sentinel) is salvageable. The orchestration layer is
  not.

---

## 4. Composable toolchain evaluation

### 4.1 Scorecard

| Tool | Domain | M | P | DNM | Role |
|---|---|---:|---:|---:|---|
| XState | 01 Orchestration | 4 | 4 | 2 | Deterministic pipeline state machine |
| XState | 05 Context eng. | 1 | 3 | 0 | State serialization / resume |
| XState | 08 Monitoring | 0 | 3 | 1 | Loop detection primitives |
| Restate | 01 Orchestration | 5 | 4 | 1 | Durable execution (alternative) |
| Taskmaster | 03 Artifact/task | 4 | 5 | 4 | Task tracking, querying, MCP |
| Taskmaster | 06 Decomposition | 3 | 7 | 4 | DAG decomposition, sizing |
| OpenLLMetry | 08 Monitoring | 2 | 3 | 8 | OTel instrumentation layer |
| Langfuse | 08 Monitoring | 2 | 5 | 6 | Observability backend |
| context-mode | 05 Context eng. | 3 | 6 | 4 | Context conservation / handoff |

### 4.2 Per-tool findings

**XState v5** — Excellent state machine primitives: declarative JSON
configs, typed transitions with guards, parallel states, actor model for
worker dispatch, `getPersistedSnapshot()`/`restoreSnapshot()` round-trip
for crash recovery. DOES NOT MEET on DAG dependency tracking (no built-in
scheduler — you implement dispatch logic via guards and events) and
crash-safe transitions (no transactional writes — you build persistence).
The `@statelyai/agent` LLM integration lives in a separate repo and was
not evaluated. The "Deterministic Core, Agentic Shell" pattern (blog.
davemo.com, Feb 2026) describes the exact architecture: LLM tool
availability constrained by current machine state.

**Restate** — Stronger than XState on durability (5 vs 4 MEETS on domain
01). Crash-safe transitions, disk-first state, and resume semantics are
infrastructure-level guarantees, not application code. DOES NOT MEET on
declarative pipeline definition (code-first, no YAML/TOML). The
fundamental trade-off: **Restate gives you durability for free but costs
you a running server (RocksDB, Bifrost, partition management). XState
gives you the pipeline abstraction but you build persistence.** For a
single-developer pipeline, XState + JSON-file persistence is lighter.
Restate becomes the right call if the pipeline scales to fleet operations.

**Taskmaster AI** — Solid task substrate: atomic writes with cross-process
locking, DAG decomposition with dependency validation and topological
ordering, status rollup from subtasks to parents, complexity analysis for
sizing heuristics. MCP server (36 tools, 7 core) is the integration
surface. DOES NOT MEET on: specs/plans/reviews as first-class types
(tasks only), decision capture (no rationale fields), pre-dispatch code
validation, context-window sizing, and import from external systems. The
internal `WorkflowOrchestrator` is nearly an XState-equivalent state
machine — useful architectural reference.

**OpenLLMetry** — Full OTEL-native instrumentation for Anthropic SDK:
`gen_ai.*` semantic conventions, prompt caching tokens
(`cache_read.input_tokens`, `cache_creation.input_tokens`), thinking
blocks, tool calls, streaming support. **Critical constraint: cannot
instrument Claude Code CLI processes (`claude --bare -p`).** Only works
by monkey-patching the Python `anthropic` SDK. No cost calculation —
only raw token counts. The supervision/recovery requirements (8 of 13)
are categorically out of scope for an instrumentation library.

**Langfuse** — Observability backend with OTLP ingestion, Anthropic cost
tracking (including prompt cache pricing tiers), trace/span/generation
hierarchy, web dashboard, evaluation/scoring features. Session model can
represent our pipeline (session=pipeline run, trace=stage,
observation=task). Self-hosting: 6 containers (Postgres, ClickHouse,
Redis, MinIO, web, worker) — moderate but feasible. The supervision/
recovery requirements are out of scope, but Langfuse provides the data
layer that would enable building them externally.

**context-mode** — Context *conservation* tool, not context *management*
tool. Excels at: disk-canonical state via SQLite, predecessor query via
FTS5/BM25 search (a new session can ask "what did the previous session
decide about X?"), auto-persistence at all lifecycle events (SessionStart,
PreToolUse, PostToolUse, PreCompact). The "98% context reduction" claim
is real for analysis workloads (sandboxing tool output). DOES NOT MEET on
context budget monitoring (zero awareness of utilization percentages),
phase-boundary splits (not its job), and compaction-as-failure-signal
(treats compaction as normal).

### 4.3 XState vs Restate decision

For our use case (single-developer, file-based artifacts, git worktrees),
**XState is the better fit**:

| Criterion | XState | Restate |
|---|---|---|
| Operational overhead | Zero (library) | Server (RocksDB, Bifrost) |
| Pipeline abstraction | Native (statecharts) | Build it yourself |
| Crash recovery | Build it (JSON files) | Free (durable execution) |
| Parallel fan-out | Native (parallel states) | Native (async handlers) |
| Composability | Maximum (pure library) | Good (single binary) |
| Scaling to fleet | Rebuild persistence | Already there |

**Decision: XState now, Restate as upgrade path if fleet scale is needed.**

---

## 5. The composed stack — working in concert

### 5.1 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     USER / ENTRY POINT                          │
│  /skylark:implement <input>                                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ input file / description / idea
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: TRIAGE + RISK ROUTING              (Skylark skills)   │
│                                                                 │
│  Classify input type, detect existing artifacts, assess risk.   │
│  Output: risk level, input type, pipeline path.                 │
│                                                                 │
│  Reads: Taskmaster tasks.json, docs/specs/*, git log            │
│  Writes: triage result → XState event                           │
└──────────────────────────┬──────────────────────────────────────┘
                           │ { risk, type, path[] }
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2: ORCHESTRATOR                       (XState v5)        │
│                                                                 │
│  Deterministic state machine. JSON config defines the pipeline  │
│  DAG. Receives events from every other layer, advances state,   │
│  persists snapshots to .skylark/state.json after each           │
│  transition. Never does domain reasoning.                       │
│                                                                 │
│  States: idle → triage → prepare → brainstorm → spec_review →  │
│          write_plan → plan_review → develop → finish → done     │
│                                                                 │
│  On crash: reads .skylark/state.json, calls restoreSnapshot(),  │
│  resumes at last completed transition.                           │
│                                                                 │
│  Reads: .skylark/state.json, Taskmaster task statuses           │
│  Writes: .skylark/state.json, dispatch commands                 │
└────────┬──────────┬──────────┬──────────┬───────────────────────┘
         │          │          │          │
    ┌────┘    ┌─────┘    ┌─────┘    ┌─────┘
    ▼         ▼          ▼          ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: TASK SUBSTRATE + DECOMPOSITION     (Taskmaster AI)    │
│                                                                 │
│  MCP server (7 core tools) providing:                           │
│  - PRD → tasks.json decomposition with DAG dependencies         │
│  - Complexity analysis per task                                 │
│  - Status tracking with rollup to parents                       │
│  - Dependency-aware sequencing (topological order)              │
│                                                                 │
│  The orchestrator queries Taskmaster via MCP to determine       │
│  which tasks are ready (deps satisfied, status=pending).        │
│  Workers update task status via MCP on completion.              │
│                                                                 │
│  Reads: tasks.json, PRD/spec input                              │
│  Writes: tasks.json, individual task files                      │
│  MCP interface: get_task, update_task, next_task, etc.          │
└──────────────────────────┬──────────────────────────────────────┘
                           │ task spec (JSON)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 4: EXPERT GENERATION + REVIEW         (Skylark skills)   │
│                                                                 │
│  This is what Skylark uniquely owns. Nothing else does it.      │
│                                                                 │
│  PRE-DISPATCH (for standard+ risk):                             │
│  - Read task spec from Taskmaster                               │
│  - Generate vocabulary-routed expert prompt (15-30 domain terms │
│    in 3-5 clusters, anti-patterns, identity — the full          │
│    expert-prompt-generator pipeline from _shared/)              │
│  - Write expert prompt to .skylark/experts/TASK-NNN.md          │
│  - Pre-dispatch drift validation: grep planned signatures       │
│    against current code. Block dispatch if drift detected.      │
│                                                                 │
│  POST-IMPLEMENTATION (for standard+ risk):                      │
│  - Spec compliance solo review ("do not trust the implementer") │
│  - Vocabulary-routed code quality panel review                  │
│  - Typed verdict: SHIP / REVISE / RETHINK                       │
│  - Hard 2-round cap, then escalate to user                      │
│                                                                 │
│  Reads: task spec, codebase, _shared/ methodology               │
│  Writes: expert prompts, review reports, verdicts               │
└──────────┬──────────────────────────────────┬───────────────────┘
           │ expert prompt + task spec        │ verdict
           ▼                                  │
┌──────────────────────────────────────┐      │
│  LAYER 5: WORKER EXECUTION           │      │
│  (Claude Code CLI + git worktrees)   │      │
│                                      │      │
│  Per task:                           │      │
│  1. git worktree add (isolated)      │      │
│  2. Write expert prompt as           │      │
│     .claude/CLAUDE.md in worktree    │      │
│  3. claude --bare -p "{task}"        │      │
│     --output-format json             │      │
│     --max-turns 20                   │      │
│  4. Parse JSON result                │      │
│  5. Return structured status:        │      │
│     DONE / DONE_WITH_CONCERNS /      │      │
│     NEEDS_CONTEXT / BLOCKED          │      │
│                                      │      │
│  Reads: task spec, expert CLAUDE.md  │      │
│  Writes: code changes in worktree,   │      │
│          result.json                 │      │
└──────────────────┬───────────────────┘      │
                   │ result.json              │
                   ▼                          │
           ┌───────────────┐                  │
           │ Route by risk │◄─────────────────┘
           │ and verdict   │
           └───────┬───────┘
                   │
    ┌──────────────┼──────────────┐
    ▼              ▼              ▼
  MERGE         REVISE        ESCALATE
  (finish)      (re-dispatch)  (to user)
```

### 5.2 Interface contracts

Each boundary has a defined contract. These are the load-bearing
interfaces — the tools are replaceable, the contracts are not.

#### Contract 1: Triage → Orchestrator

```yaml
# Triage emits an XState event:
type: "TRIAGE_COMPLETE"
payload:
  input_type: spec | plan | task | raw-idea | raw-problem | external-ref
  risk: trivial | standard | elevated | critical
  path: [prepare, develop, finish]    # stages to execute
  artifact_id: SPEC-001              # if existing artifact found
  artifact_path: docs/specs/...
  external_ref: ENG-142              # if applicable
  decompose: false
```

#### Contract 2: Orchestrator → Taskmaster

```yaml
# Orchestrator queries Taskmaster MCP for next dispatchable task:
mcp_tool: next_task
filter:
  status: pending
  dependencies_met: true

# Taskmaster returns:
task:
  id: 42
  title: "Add FTS5 virtual table for search"
  description: "..."
  dependencies: [40, 41]
  subtasks: []
  status: pending
  priority: high
  details: "..."                      # full implementation details
  testStrategy: "..."
  acceptanceCriteria: "..."
  relevantFiles:
    - src/db/search.ts
    - src/db/schema.ts
```

#### Contract 3: Orchestrator → Skylark Expert Generation

```yaml
# Orchestrator passes task to Skylark for expert prompt generation:
type: "GENERATE_EXPERT"
payload:
  task: { ... }                       # full task from Taskmaster
  risk: elevated
  codebase_context:
    entry_points: [src/db/search.ts]
    recent_changes: [...]             # from git log
    related_tests: [test/search.test.ts]

# Skylark returns:
expert_prompt: |
  You are a senior PostgreSQL/SQLite engineer specializing in
  full-text search. Domain vocabulary: FTS5 virtual table,
  bm25() ranking, column weight boosting, ...
  [full vocabulary-routed prompt body]
drift_check: pass | fail              # pre-dispatch code validation
drift_details: null | "buildServer signature changed since plan"
```

#### Contract 4: Expert Generation → Worker

```yaml
# Worker receives:
worktree_path: /tmp/task-42-fts5-search
claude_md: .claude/CLAUDE.md          # expert prompt written here
task_prompt: |
  Implement FTS5 virtual table for search.
  Acceptance criteria: ...
  Files to modify: ...
  Step-by-step instructions: ...
flags:
  --bare
  --output-format json
  --max-turns 20

# Worker returns (parsed from Claude Code JSON output):
result:
  status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
  session_id: "abc123"
  total_cost_usd: 0.42
  duration_ms: 180000
  num_turns: 12
  files_changed: [src/db/search.ts, test/search.test.ts]
  concerns: null | "FTS5 tokenizer choice may need tuning"
```

#### Contract 5: Worker → Review Layer

```yaml
# Review layer receives:
worktree_path: /tmp/task-42-fts5-search
task_spec: { ... }                    # original task
worker_result: { ... }               # from Contract 4
risk: elevated

# Review layer returns:
verdict: SHIP | REVISE | RETHINK
round: 1
findings:
  - severity: blocking
    description: "Missing index on created_at column"
    file: src/db/schema.ts
    line: 42
  - severity: suggestion
    description: "Consider column weight tuning for title vs body"
report_path: docs/reports/R-20260415-panel-fts5.md
```

#### Contract 6: Worker → Telemetry

```yaml
# OpenLLMetry captures per-API-call (if using SDK directly):
span:
  name: "anthropic.messages.create"
  attributes:
    gen_ai.system: "anthropic"
    gen_ai.request.model: "claude-sonnet-4-6"
    gen_ai.usage.input_tokens: 12400
    gen_ai.usage.output_tokens: 3200
    gen_ai.usage.cache_read.input_tokens: 8000
    gen_ai.usage.cache_creation.input_tokens: 4400
    gen_ai.conversation.id: "task-42"

# Langfuse receives via OTLP and provides:
# - Per-task cost rollup
# - Per-stage cost rollup
# - Pipeline-run cost total
# - Dashboard visualization
# - Anomaly detection (configurable)

# NOTE: Claude Code CLI workers cannot be instrumented by
# OpenLLMetry directly. Instrumentation options:
# (a) Parse Claude Code's --output-format json for cost/token data
# (b) Build a thin wrapper that logs to Langfuse's REST API
# (c) Use Claude Agent SDK instead of CLI for workers (enables
#     direct SDK instrumentation)
```

#### Contract 7: Session → context-mode

```yaml
# context-mode hooks fire automatically:
#
# SessionStart:
#   - Load previous session state from SQLite
#   - Inject relevant predecessor decisions via FTS5/BM25
#
# PostToolUse:
#   - Persist tool results, edits, decisions to SQLite
#   - Sandbox large tool outputs (98% reduction)
#
# PreCompact:
#   - Generate priority-tiered XML snapshot (≤2KB)
#   - Persist all uncommitted state to SQLite
#   - Log compaction as a signal (consumed by orchestrator)
#
# The orchestrator treats compaction events as decomposition
# triggers — if a worker hits PreCompact, the task was too large.
```

### 5.3 What each component provides vs. what it doesn't

| Component | Provides | Does NOT provide |
|---|---|---|
| **XState** | Pipeline state machine, typed transitions, parallel fan-out, JSON-serializable snapshots, resume from crash | DAG scheduler, transactional writes, monitoring, worker dispatch infrastructure |
| **Taskmaster** | Task CRUD, DAG decomposition, dependency tracking, status rollup, MCP interface, complexity analysis | Spec/plan/review types, decision capture, pre-dispatch validation, context sizing, risk routing |
| **Skylark** | Vocabulary-routed experts, panel review, risk-tiered gating, typed verdicts, triage/classification | Orchestration, task tracking, monitoring, merge queue, context management |
| **Claude Code CLI** | Worker execution, git worktrees, tool sandboxing, structured JSON output | Telemetry emission, context budget enforcement, session continuity |
| **OpenLLMetry** | OTEL spans for Anthropic SDK calls, token/cache tracking | CLI worker instrumentation, cost calculation, dashboards, supervision |
| **Langfuse** | Trace visualization, cost tracking, dashboards, evaluation/scoring, OTLP ingestion | Fleet supervision, crash recovery, escalation, stall detection |
| **context-mode** | Context conservation, predecessor query (FTS5), auto-persistence, tool-result sandboxing | Context budget monitoring, phase-boundary enforcement, compaction-as-failure |

### 5.4 What must be built (the glue)

Five components need to be built to connect these tools into a working
pipeline. None is a framework-scale effort.

1. **XState pipeline definition + persistence layer** (~200 lines).
   The state machine config (JSON) defining the pipeline DAG, plus a
   thin persistence wrapper that writes `getPersistedSnapshot()` to
   `.skylark/state.json` after each transition and reads it on startup.
   This is the orchestrator's entire codebase.

2. **Typed verdict schema** (~30 lines JSON Schema). The contract
   between Skylark's review layer and the orchestrator. Defines the
   SHIP/REVISE/RETHINK verdict format, finding severities, round
   counting, and escalation conditions. Consumed by the orchestrator
   to decide: advance pipeline, re-dispatch worker, or pause for user.

3. **Pre-dispatch drift validator** (~50 lines shell/Python). Greps
   planned function signatures, file paths, and import statements
   against current code before dispatching a worker. Returns pass/fail.
   The specific fix for ENG-180's two dead-end tasks.

4. **Worker telemetry bridge** (~100 lines). Parses Claude Code CLI's
   `--output-format json` response for `total_cost_usd`, `duration_ms`,
   `num_turns`, and writes structured events to Langfuse's REST API.
   Bridges the gap between CLI workers and the observability stack.
   Alternative: use Claude Agent SDK for workers instead of CLI,
   enabling direct OpenLLMetry instrumentation.

5. **Context budget monitor** (~80 lines shell hooks). Session-kit
   style hooks that monitor context utilization and emit warnings at
   40%, 60%, 70%. At 70%, triggers handoff instead of compaction.
   Complements context-mode's conservation layer with the budget
   enforcement it lacks.

**Total estimated glue: ~460 lines.** Compare to building a full
orchestration engine, artifact substrate, merge queue, telemetry
layer, and supervisor chain from scratch (~Option 4 from first pass).

---

## 6. Option space (updated)

### Path A — Gas Town as monolithic runtime

*Gas Town provides orchestration, artifact substrate, merge queue,
monitoring, and environment isolation. Skylark provides review
discipline and expert generation. Triad patterns layered on top.*

**Strengths:**
- 52 MEETS across all domains — most complete single system
- Refinery merge queue (Bors-style bisecting) — no composable
  equivalent exists
- Four-tier supervisor chain — production-grade monitoring
- Beads substrate — the richest artifact model evaluated

**Weaknesses:**
- Coupling: replacing any single layer means fighting the whole system
- Prompt-channel question still unresolved — Skylark's expert
  generation may not fit Gas Town's dispatch model
- Operational overhead: Dolt database, Go binaries, Mayor LLM session
- Design philosophy mismatch: Gas Town targets fleet-scale (20-50
  agents); our use case is single-developer

**Contingent on:** prompt-channel trial (can `gt sling --var` carry
a full vocabulary-routed expert prompt body cleanly?)

### Path B — Composed stack

*XState orchestrator + Taskmaster tasks + Claude Code CLI workers +
Skylark review layer + OpenLLMetry/Langfuse monitoring + context-mode.
~460 lines of glue code.*

**Strengths:**
- Each layer independently replaceable (Unix philosophy)
- No prompt-channel question — Skylark generates expert prompts and
  writes them directly as CLAUDE.md files in worker worktrees
- No operational overhead beyond Langfuse's 6 containers (optional —
  can start with just JSON cost logs)
- File-based contracts between every layer — debuggable, auditable,
  git-native
- Incremental adoption: start with XState + Taskmaster + Skylark
  review, add monitoring/context layers later

**Weaknesses:**
- No merge queue (GitHub's native merge queue is limited; no OSS
  bisecting alternative exists)
- No fleet supervision daemon (must be built)
- Context budget enforcement (must be built with session-kit hooks)
- More assembly required — 5 glue components to build
- Taskmaster lacks spec/plan/review as first-class types (Skylark's
  artifact conventions fill this gap but aren't queryable without LLM)

**Not contingent on any unresolved question.** Every component has
been evaluated against source code. The unknowns are integration
quality, not feasibility.

### Path C — Hybrid (cherry-pick Gas Town components)

*Use Gas Town's Beads substrate (replacing Taskmaster) and/or Refinery
merge queue, but keep XState as orchestrator and Skylark as review
layer.*

This combines the strongest artifact model (Beads: 11 MEETS on domain
03) with the composable orchestrator, but introduces the Dolt
operational dependency and couples the task layer to Gas Town.

**Viable as an upgrade from Path B** if Taskmaster proves insufficient
at scale (particularly around queryability and atomic writes under
concurrent workers).

### Comparison matrix

| Criterion | Path A (Gas Town) | Path B (Composed) | Path C (Hybrid) |
|---|---|---|---|
| Composability | Low | **High** | Medium |
| Merge queue | **Refinery (bisecting)** | GitHub native (basic) | Refinery |
| Monitoring | **Four-tier supervisor** | Langfuse + build daemon | Langfuse + build daemon |
| Expert generation fit | Unresolved | **Native** | **Native** |
| Operational overhead | High (Dolt, Go, Mayor) | Low-Medium (Langfuse optional) | Medium (Dolt) |
| Artifact model richness | **Beads (11 MEETS)** | Taskmaster (4 MEETS) + Skylark files | Beads |
| Assembly required | Low (adopt framework) | **Medium (~460 lines glue)** | Medium |
| Layer replaceability | Low | **High** | Medium |
| Fleet scaling path | Built in | Swap XState → Restate | Partial |
| Blocking questions | Prompt channel | None | Dolt operational fit |

---

## 7. Triad salvage list (applies to both paths)

Unchanged from first pass. These discipline patterns address gaps in
both Gas Town and the composed stack:

1. **`round`-accounted 2-cycle revision cap** — already in Skylark's
   review layer; formalize in the typed verdict schema.
2. **`## Rationale` / decision capture sections** — enforceable in
   Skylark's artifact conventions or as Taskmaster task metadata.
3. **Hard schema-depth cap** (Project→Epic→Task maximum) — enforceable
   in Taskmaster's decomposition or XState's state machine.
4. **Sonnet-as-sizing-sentinel** — if task can't complete in one Sonnet
   window, task is mis-sized. Cleaner than LOC caps.
5. **Per-task cost telemetry** — worker telemetry bridge (glue #4)
   captures this; Langfuse rolls it up.
6. **`directive` human-override disposition** on review verdicts —
   add to typed verdict schema.
7. **End-to-End Validation Flows** at project-complete — add as a
   `finish` stage step in the XState pipeline definition.

---

## 8. Shared blind spots (what no tool solves)

Updated from first pass. Two resolved, three remain, one new:

- ~~No framework enforces context budget~~ → **Addressed by
  context-mode + session-kit hooks** (glue #5). PARTIAL coverage.
- ~~No framework does pre-dispatch drift validation~~ → **Addressed
  by glue #3** (drift validator). Directly fixes ENG-180's dead-end
  tasks.
- **No tool auto-converts recurring review findings into lint rules.**
  This is ENG-180's suggestion #5 and remains aspirational.
- **No tool provides an agent-aware merge queue.** The AgenticFlict
  dataset (arXiv:2604.03551) documents 336K+ conflict regions in
  agent-generated PRs. GitHub's native queue has no agent-specific
  differentiation.
- **No cross-session trace ID standard exists.** Langfuse, OpenLLMetry,
  and Claude Code each define their own session concept. The worker
  telemetry bridge (glue #4) must map between them.
- **NEW: OpenLLMetry cannot instrument Claude Code CLI processes.**
  This affects both paths equally. Options: (a) parse CLI JSON output,
  (b) use Claude Agent SDK instead of CLI for workers, (c) build a
  thin Langfuse REST wrapper.

---

## 9. Trial scope (updated for both paths)

### Path B trials (composed stack) — recommended first

These are ordered by dependency: each trial unblocks the next.

1. **XState pipeline prototype.** Define the pipeline state machine in
   JSON. Wire `getPersistedSnapshot()`→JSON file→`restoreSnapshot()`.
   Dispatch one task to a Claude Code CLI worker in a worktree. Verify
   crash recovery (kill mid-task, resume). **Validates:** orchestrator
   viability, persistence round-trip, worker dispatch model.

2. **Taskmaster integration.** Connect XState to Taskmaster MCP.
   Decompose a real spec into tasks. Have the orchestrator query
   Taskmaster for the next ready task and dispatch it. Verify status
   rollup on completion. **Validates:** MCP integration, task substrate
   adequacy, contract between layers 2 and 3.

3. **Expert generation + review loop.** Generate a vocabulary-routed
   expert prompt for a task, write it as CLAUDE.md in the worktree,
   dispatch worker, run Skylark's panel review on the result, feed
   verdict back to orchestrator. **Validates:** the full inner loop,
   expert-prompt-as-CLAUDE.md pattern, verdict→orchestrator contract.

4. **Telemetry pipeline.** Instrument one pipeline run with the worker
   telemetry bridge writing to Langfuse. Verify per-task cost
   attribution, trace hierarchy, dashboard rendering. **Validates:**
   observability stack, cost tracking accuracy.

5. **Context engineering.** Run a multi-task pipeline with context-mode
   active. Verify predecessor query works across task boundaries.
   Measure context utilization per worker. Test the budget monitor
   hooks. **Validates:** context conservation, handoff quality.

6. **Full pipeline run.** End-to-end on a real medium-complexity issue.
   Measure: total cost, per-stage cost, compaction count, context
   high-water mark per worker, number of review rounds, wall-clock
   time. Compare to ENG-180 baseline. **Validates:** the whole stack.

### Path A trials (Gas Town) — if Path B proves insufficient

Unchanged from first pass: prompt-channel trial, panel-review-inside-
Polecat trial, artifact import trial, Refinery trial, Witness trial,
cost/context measurement.

---

## 10. Recommendation

**Pursue Path B (composed stack) as the primary path.** Begin with
trial #1 (XState pipeline prototype).

**Rationale:**
- No blocking questions. Every component evaluated against source code.
- Preserves composability — the core design principle the user
  identified.
- Skylark's expert generation fits natively (no prompt-channel
  question).
- Lower operational overhead for a single-developer pipeline.
- Incremental: start with XState + Taskmaster + Skylark review, layer
  in monitoring and context engineering as the pipeline matures.
- ~460 lines of glue vs adopting a monolithic Go framework.

**Keep Path A as the contingency** for two scenarios:
- Taskmaster's task substrate proves insufficient under concurrent
  workers (atomic writes, queryability at scale).
- The pipeline scales to fleet operations where Restate + Beads would
  be justified.

**Keep Path C (hybrid) in reserve** for a specific scenario:
- Beads (Gas Town's artifact substrate) could replace Taskmaster
  without requiring the rest of Gas Town. This is the surgical
  upgrade if Taskmaster's 4-MEETS on domain 03 can't be stretched to
  cover the 11-MEETS Beads provides.

---

## 11. Housekeeping

- Reports now span 6 directories under `reviews/`: `skylark/`,
  `gastown/`, `triad/` (first pass), `xstate/`, `taskmaster/`,
  `restate/`, `openllmetry/`, `langfuse/`, `context-mode/` (second
  pass). 36 total reports.
- The `composable-toolchain-report.md` in `docs/research/` is the
  landscape scan that preceded the tool evaluations. Reference it for
  tools considered but not evaluated (GitHub Spec Kit, session-kit,
  Plane, agent-tasks, etc.).
- Criteria specs in `docs/research/criteria-review/` remain the
  evaluation rubric. All second-pass evaluations used the same criteria
  without modification.
- First-pass synthesis content is preserved in sections 3.x of this
  document. The per-domain analysis remains valid evidence.

## 12. Summary for future-me

The composed stack works. XState provides the deterministic
orchestrator Skylark never had. Taskmaster provides the task substrate
with DAG decomposition, MCP interface, and atomic writes. Skylark
keeps what nothing else can do: vocabulary-routed expert generation,
bounded panel review, risk-proportional gating. context-mode handles
context conservation and predecessor query. Langfuse + OpenLLMetry
provide cost-aware observability. Five small glue components (~460
lines) wire them together via file-based contracts.

Gas Town remains the contingency — strongest overall system (52 MEETS),
but the coupling risk, prompt-channel question, and operational
overhead make it the wrong default for a single-developer composable
pipeline. If fleet scale arrives, the upgrade path is XState → Restate
and Taskmaster → Beads, with the rest of the stack unchanged.

The filesystem is the universal integration layer. Tools that store
state as JSON/YAML/Markdown in git compose naturally. The Unix
philosophy isn't just an aesthetic preference — it's the architecture
that produces the most replaceable, debuggable, and resilient
multi-agent systems.

# Layer 3 — Task Substrate

The data layer for work items in the composed pipeline. Manages the
canonical task DAG — decomposing specs into tasks, tracking dependencies,
managing status, and providing queryable access to task state via MCP.

---

## 1. Purpose

Layer 3 is the pipeline's single source of truth for *what needs to be
done*. The orchestrator (Layer 2) queries it to determine dispatch order.
Workers (Layer 5) update it on completion. Status rolls up from leaf
tasks to parents automatically. Every other layer treats this substrate
as canonical — conversation memory is ephemeral scaffolding around it.

What this layer owns:

- Task decomposition from specs/PRDs into a dependency-aware DAG
- Complexity analysis (scoring tasks 1-10 for difficulty)
- Topological ordering for dependency-safe dispatch
- Atomic, concurrent-safe reads and writes to the task store
- Status lifecycle and automatic parent rollup

What this layer does NOT own (see Section 9):

- Spec/plan/review artifacts (Skylark conventions, Layer 4)
- Risk classification (Layer 1)
- Pre-dispatch code validation (Layer 4 drift check)
- Context-window sizing (Layer 7)

---

## 2. Components

### 2.1 Taskmaster AI

The primary tool. Installed as a Claude Code MCP server plugin.

Provides:

- **MCP server** with 7 core tools (see Section 8) for task CRUD,
  status management, dependency tracking, and decomposition
- **`tasks.json`** as the canonical data store at `.taskmaster/tasks.json`
- **CLI** (`task-master`) for direct human inspection outside agent sessions
- **PRD parsing** — converts a spec or PRD document into an initial task set
- **Complexity analysis** — AI-scored difficulty (1-10) with recommended
  subtask counts and expansion prompts
- **Dependency validation** — detects circular references and invalid targets
- **Atomic writes** — cross-process file locking via `proper-lockfile` with
  write-rename pattern via `steno`. Re-reads inside the lock to prevent
  stale-snapshot writes. Safe for multiple concurrent Claude Code sessions.

### 2.2 Skylark artifact conventions

Taskmaster only knows about tasks and subtasks. It has no concept of
specs, plans, reviews, or session notes as first-class types. These
artifacts live alongside the task substrate as markdown files with YAML
frontmatter, governed by Skylark's `_shared/artifact-conventions.md`:

| Artifact | Location | Managed by |
|---|---|---|
| Specs | `docs/specs/SPEC-NNN-<slug>.md` | Skylark skills (Layer 1/4) |
| Plans | `docs/plans/PLAN-NNN-<slug>.md` | Skylark skills (Layer 4) |
| Task specs | `docs/tasks/TASK-NNN-<slug>.md` | Skylark skills (Layer 4) |
| Reports | `docs/reports/R-<timestamp>-*.md` | Skylark skills (Layer 4) |
| Session notes | `docs/notes/NOTE-NNN-<slug>.md` | Skylark skills (Layer 5) |
| Tasks (data) | `.taskmaster/tasks.json` | Taskmaster AI (this layer) |

The two systems are linked by convention: a Taskmaster task's
`relevantFiles` or `details` field references the spec path, and a
Skylark task spec's `task_number` frontmatter field corresponds to the
Taskmaster task ID.

### 2.3 Configuration

Taskmaster configuration lives at `.taskmaster/config.json`:

```json
{
  "models": {
    "main": { "provider": "anthropic", "modelId": "claude-sonnet-4-20250514" },
    "research": { "provider": "perplexity", "modelId": "sonar-pro" },
    "fallback": { "provider": "anthropic", "modelId": "claude-sonnet-4-20250514" }
  },
  "global": {
    "defaultSubtasks": 5,
    "defaultPriority": "medium",
    "projectName": "<project>"
  }
}
```

The MCP server is registered in the project's `.mcp.json` or Claude
Code's settings under `mcpServers`.

---

## 3. Inputs

### 3.1 DECOMPOSE — from Layer 2 (Orchestrator)

Triggered when the orchestrator receives a triage result that requires
task decomposition (elevated or critical risk).

```yaml
DECOMPOSE:
  spec_path: string           # path to spec or PRD markdown file
  risk: string                # trivial | standard | elevated | critical
                              # informs decomposition granularity:
                              #   elevated  → default subtask count
                              #   critical  → higher subtask count, deeper expansion
```

Implementation: the orchestrator invokes `parse_prd` (for initial
decomposition) or `expand_task` / `expand_all` (for further breakdown)
via MCP. If `risk` is critical, the orchestrator also triggers
`analyze_project_complexity` before expansion so complexity scores
inform subtask counts.

### 3.2 QUERY_NEXT_TASK — from Layer 2 (Orchestrator)

Polled by the orchestrator when it needs to dispatch the next unit of
work to Layer 4/5.

```yaml
QUERY_NEXT_TASK:
  filter:
    status: pending            # only tasks not yet started
    dependencies_met: true     # all dependency task IDs have status: done
```

Implementation: maps to the `next_task` MCP tool. Taskmaster computes
dependency satisfaction, sorts by priority and dependency count, and
returns the highest-priority ready task.

### 3.3 UPDATE_TASK_STATUS — from Layer 5 (Worker)

Sent by the worker (or orchestrator on behalf of the worker) when a
task reaches a terminal or transitional state.

```yaml
UPDATE_TASK_STATUS:
  task_id: number              # integer task or subtask ID (dot notation for subtasks: "3.2")
  status: done | in-progress | blocked | pending | deferred | cancelled
  result_summary: string | null  # brief outcome for the task's record
```

Implementation: maps to `set_task_status` MCP tool. On subtask
completion, Taskmaster automatically evaluates parent rollup (see
Section 4.2).

---

## 4. Workflow

### 4.1 Decomposition flow

```
Spec/PRD file on disk
  │
  ├─ parse_prd ──────────────────→ Initial task set in tasks.json
  │                                  (all status: pending, dependencies declared)
  │
  ├─ analyze_project_complexity ─→ Complexity report (.taskmaster/reports/)
  │                                  (scores 1-10 per task, recommended subtask counts)
  │
  ├─ expand_task / expand_all ───→ Subtasks added to complex tasks
  │                                  (uses complexity report for calibration)
  │
  └─ validate_dependencies ──────→ DAG integrity check
                                     (circular refs, invalid targets)
```

**Step details:**

1. **PRD parsing.** The `parse_prd` tool reads the spec file, uses AI to
   extract tasks with titles, descriptions, details, dependencies, test
   strategies, and priority. All tasks start as `pending`.

2. **Complexity analysis.** The `analyze_project_complexity` tool scores
   every task 1-10 for implementation difficulty. The report recommends
   subtask counts and generates task-specific expansion prompts. For
   critical-risk work, the orchestrator always runs this step.

3. **DAG construction.** `expand_task` (single task) or `expand_all`
   (batch) decomposes tasks into subtasks. Expansion uses the complexity
   report's recommendations when available. Dependencies between
   subtasks are declared during expansion.

4. **Dependency validation.** `validate_dependencies` checks the full
   DAG for circular references and references to nonexistent task IDs.
   `fix_dependencies` can auto-repair issues. The orchestrator gates on
   a clean validation before proceeding to dispatch.

### 4.2 Status tracking and rollup

```
Worker completes subtask 3.2
  │
  ├─ set_task_status(3.2, done) ─→ Subtask 3.2 marked done
  │
  ├─ Auto-rollup check:
  │   All subtasks of task 3 done?
  │     YES → task 3 status = done
  │     NO, any in-progress or done → task 3 status = in-progress
  │     NO, all pending → task 3 status = pending
  │
  └─ Orchestrator observes parent status change via next poll
```

Rollup rules (automatic, triggered on any subtask status change):

| Subtask states | Parent status |
|---|---|
| All done | done |
| Any in-progress or done (not all done) | in-progress |
| All pending | pending |

The `TaskEntity.canComplete()` guard prevents marking a parent as
`done` if any subtask is still incomplete.

Rollup is two-level only (subtask to parent task). The substrate does
not support sub-subtasks. If a subtask is too complex, it must be
promoted to a standalone task via scope adjustment tools.

---

## 5. Data model

### 5.1 tasks.json schema

The canonical store at `.taskmaster/tasks.json`. Pretty-printed JSON
(2-space indent). All mutations go through Taskmaster's file-locking
layer.

```typescript
interface Task {
  id: number;                          // sequential positive integer
  title: string;                       // short descriptive title
  description: string;                 // what the task involves
  details: string;                     // full implementation instructions
  status: TaskStatus;                  // lifecycle state
  priority: "high" | "medium" | "low"; // scheduling priority
  dependencies: number[];              // task IDs that must complete first
  subtasks: Subtask[];                 // child work items (one level only)
  parentId: number | null;             // parent task ID (for subtasks)
  testStrategy: string;                // verification approach
  acceptanceCriteria: string;          // completion conditions
  relevantFiles: RelevantFile[];       // files this task touches
  complexity: number;                  // 1-10, from complexity analysis

  // Additional metadata (not used by pipeline contracts but available):
  createdAt?: string;
  updatedAt?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

type TaskStatus =
  | "pending"       // not started, waiting for dispatch
  | "in-progress"   // actively being worked
  | "done"          // complete
  | "blocked"       // waiting on external dependency
  | "deferred"      // parked, not scheduled
  | "cancelled";    // abandoned

interface Subtask {
  id: number;                          // dot notation relative to parent (e.g., 2 means parent.2)
  title: string;
  description: string;
  details: string;
  status: TaskStatus;
  dependencies: number[];              // sibling subtask IDs
  acceptanceCriteria: string;
  testStrategy: string;
}

interface RelevantFile {
  path: string;                        // relative file path
  description: string;                 // what this file contributes
  action: "create" | "modify" | "reference";
}
```

### 5.2 Relationship to Skylark artifacts

The two systems track complementary data:

| Concern | Taskmaster (tasks.json) | Skylark (docs/ markdown) |
|---|---|---|
| What to build | Task DAG, dependencies, status | Spec rationale, design decisions |
| Implementation details | `details`, `testStrategy`, `relevantFiles` | Plan structure, acceptance criteria prose |
| Review outcomes | Not tracked | Panel reports with typed verdicts |
| Decision rationale | Not tracked | Spec/plan frontmatter, changelog entries |
| Status lifecycle | Canonical (`pending` → `done`) | Mirrors via frontmatter `status` field |
| Cross-references | `dependencies` (task-to-task by ID) | `parent` (artifact-to-artifact by path), `depends_on` (by ID) |

When the orchestrator marks a task as `done` in Taskmaster, the
corresponding Skylark artifact (if one exists in `docs/tasks/`) should
also be updated. This synchronization is the orchestrator's
responsibility, not Taskmaster's.

---

## 6. Outputs

### 6.1 DECOMPOSITION_COMPLETE — to Layer 2 (Orchestrator)

Emitted after `parse_prd` (and optionally `expand_all`) completes.
The orchestrator constructs this from the `get_tasks` response.

```yaml
DECOMPOSITION_COMPLETE:
  task_count: number           # total tasks created
  task_ids: [number]           # all task IDs in the new set
  domains: [string]            # domain clusters (derived from relevantFiles
                               # and task descriptions — e.g., "database",
                               # "api", "auth", "ui")
```

### 6.2 TASK_READY — to Layer 2 (Orchestrator)

Returned by `next_task` when a dispatchable task exists.

```yaml
TASK_READY:
  task_id: number
  task:
    id: number
    title: string
    description: string
    details: string            # full implementation instructions
    status: string             # will be "pending" (ready for dispatch)
    priority: high | medium | low
    dependencies: [number]     # all satisfied (status: done)
    subtasks: [number]         # child task IDs (if expanded)
    parentId: number | null
    testStrategy: string
    acceptanceCriteria: string
    relevantFiles: [string]    # file paths this task touches
    complexity: number         # 1-10
```

### 6.3 STATUS_ROLLUP — to Layer 2 (Orchestrator)

Not emitted as an event by Taskmaster (Taskmaster lacks an event bus
on basic CRUD operations). The orchestrator derives this by polling
`get_task` on the parent after a subtask status change.

```yaml
STATUS_ROLLUP:
  parent_id: number
  children_complete: number    # count of subtasks with status: done
  children_total: number       # total subtask count
  all_complete: boolean        # true when parent auto-promoted to done
```

---

## 7. Downstream

### 7.1 Orchestrator (Layer 2) consumption

The orchestrator interacts with the task substrate at three points:

1. **After triage** — invokes DECOMPOSE to populate the DAG from a
   spec. Waits for DECOMPOSITION_COMPLETE before proceeding.

2. **Dispatch loop** — polls QUERY_NEXT_TASK to get the next ready
   task. Passes the TASK_READY payload to Layer 4 (expert generation)
   and Layer 5 (worker execution).

3. **After worker completion** — receives the worker result, invokes
   UPDATE_TASK_STATUS, then checks STATUS_ROLLUP to determine whether
   the parent unit is complete or more subtasks remain.

The orchestrator's XState machine transitions are driven by task
states: `pending` tasks available triggers dispatch, `done` on all
subtasks triggers the parent completion transition, `blocked` triggers
a hold state.

### 7.2 Worker (Layer 5) consumption

Workers receive the TASK_READY payload (via the orchestrator) as their
work specification. Key fields consumed:

- `details` — primary implementation instructions
- `testStrategy` — what to verify
- `acceptanceCriteria` — definition of done
- `relevantFiles` — files to create/modify/reference
- `complexity` — informs context budget allocation (Layer 7)

On completion, the worker (or orchestrator on its behalf) calls
UPDATE_TASK_STATUS with the final status and a brief result summary.

---

## 8. MCP interface

The 7 core tools and their mapping to pipeline contracts.

### 8.1 `get_task`

Read a single task by ID. Used by the orchestrator to inspect task
state, check rollup status, or retrieve details for a specific task.

- **Parameters:** `id` (integer)
- **Returns:** Full task object
- **Contract mapping:** Supports STATUS_ROLLUP (orchestrator reads parent after subtask update)

### 8.2 `get_tasks`

List all tasks, optionally filtered by status. Used to enumerate the
full DAG or query tasks in a specific state.

- **Parameters:** `status` (optional filter), `tag` (optional)
- **Returns:** Array of task objects
- **Contract mapping:** Supports DECOMPOSITION_COMPLETE (count and enumerate after parse)

### 8.3 `next_task`

Find the highest-priority task with all dependencies satisfied. This
is the primary dispatch query.

- **Parameters:** None (uses current DAG state)
- **Returns:** Single task object or null
- **Contract mapping:** QUERY_NEXT_TASK, TASK_READY
- **Algorithm:** Filters to `pending` status, checks all `dependencies`
  have `done` status, sorts by priority then dependency count then ID

### 8.4 `create_task`

Add a new task to the DAG. Used for ad-hoc additions outside of PRD
parsing.

- **Parameters:** `title`, `description`, `details`, `priority`, `dependencies`, etc.
- **Returns:** Created task object
- **Contract mapping:** Not part of standard pipeline flow; available for manual intervention

### 8.5 `set_task_status`

Change a task or subtask's status. This is the primary write operation
from the pipeline. Triggers automatic parent rollup on subtask changes.

- **Parameters:** `id` (task or subtask), `status` (new status)
- **Returns:** Updated task object
- **Contract mapping:** UPDATE_TASK_STATUS
- **Side effects:** Parent status auto-adjustment (see Section 4.2).
  Idempotent — setting the same status is a no-op.

### 8.6 `update_task`

Modify task fields (title, description, details, priority, etc.).
Used to refine tasks after creation or incorporate review feedback.

- **Parameters:** `id`, plus any fields to update
- **Returns:** Updated task object
- **Contract mapping:** Not part of standard pipeline flow; available for iterative refinement

### 8.7 `expand_task`

Decompose a single task into subtasks using AI. Uses the complexity
report's recommended subtask count and expansion prompt when available.

- **Parameters:** `id` (task to expand), `num_subtasks` (optional override),
  `prompt` (optional additional context)
- **Returns:** Task with newly created subtasks
- **Contract mapping:** Part of DECOMPOSE workflow
- **Guards:** Skips tasks that already have subtasks unless `--force` is specified

**Additional tools used in the decomposition workflow but outside the core 7:**

- `parse_prd` — initial PRD-to-task conversion
- `analyze_project_complexity` — complexity scoring
- `validate_dependencies` — DAG integrity check
- `expand_all` — batch expansion of all eligible tasks

---

## 9. Limitations and compensations

| Limitation | Impact | Compensation |
|---|---|---|
| **No spec/plan/review as artifact types.** Taskmaster only knows tasks and subtasks. | Cannot query "show me the spec for task 7" via MCP. | Skylark artifact conventions handle specs, plans, and reviews as markdown with YAML frontmatter. Cross-reference by path in `relevantFiles` or `details`. |
| **No event emission on status change.** `set_task_status` writes to disk but does not fire events. | Orchestrator cannot subscribe to status transitions. | Orchestrator polls via `get_task` / `next_task` after each worker completion. Polling interval is per-dispatch-cycle, not continuous. |
| **No decision capture fields.** No `rationale`, `alternatives`, or `constraints` in the schema. | Design reasoning not tracked in task data. | Decision rationale lives in Skylark spec/plan frontmatter and changelog entries. Session notes capture deviations from plan. |
| **Two-level depth limit.** Subtasks cannot have sub-subtasks. | Very complex work items cannot be decomposed further in-place. | Promote complex subtasks to standalone tasks using `scope_up_task`, then expand them. |
| **IDs are per-tag sequential integers.** Not globally unique across tags or repos. | Potential ID collision in multi-tag or multi-repo setups. | Pipeline uses a single tag context. Cross-repo references use Skylark's `external_ref` field. |
| **No risk classification.** Priority and complexity are not risk. | Cannot vary gate shape by risk from within Taskmaster. | Risk classification is Layer 1's responsibility. Orchestrator maps risk to gate shape when dispatching through Layer 4. |
| **No context-window estimation.** Complexity scores measure difficulty, not token footprint. | Cannot predict whether a task fits in a single session. | Layer 7 (context engineering) manages budget hooks. Complexity score serves as a heuristic proxy — the orchestrator can set lower `max-turns` for high-complexity tasks. |
| **No pre-dispatch code validation.** `relevantFiles` lists paths but nothing checks them against the live codebase. | Stale file references may cause worker failures. | Layer 4 drift check greps `relevantFiles` paths and key signatures before dispatch. Failures trigger re-planning. |
| **`watch()` API is primitive.** Detects file changes but not *what* changed. | Cannot build a reactive event system on Taskmaster's file watcher alone. | Orchestrator drives the loop imperatively (dispatch → wait → poll) rather than reactively. |

---

## 10. Configuration

### 10.1 Taskmaster MCP server setup

Register in project `.mcp.json`:

```json
{
  "mcpServers": {
    "taskmaster": {
      "command": "npx",
      "args": ["-y", "task-master-ai"],
      "env": {
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

Or install globally and register in Claude Code settings.

### 10.2 Taskmaster project config

At `.taskmaster/config.json`. Key settings for pipeline integration:

| Setting | Default | Pipeline recommendation |
|---|---|---|
| `models.main.modelId` | claude-sonnet-4 | Use Sonnet for standard decomposition |
| `models.research.provider` | perplexity | Use for complexity analysis research |
| `global.defaultSubtasks` | 5 | Adjust per risk: elevated=5, critical=8 |
| `global.defaultPriority` | medium | Leave as default; orchestrator overrides per task |

### 10.3 Complexity thresholds

Used by the orchestrator to calibrate decomposition and dispatch:

| Complexity score | Interpretation | Orchestrator action |
|---|---|---|
| 1-3 | Low — straightforward implementation | Dispatch directly, no expansion needed |
| 4-6 | Medium — moderate logic, some dependencies | Expand into subtasks at default count |
| 7-8 | High — significant complexity | Expand with higher subtask count, run pre-dispatch drift check |
| 9-10 | Very high — architectural scope | Consider re-scoping (`scope_down_task`) before expansion |

These thresholds are enforced by the orchestrator (Layer 2), not by
Taskmaster itself. Taskmaster provides the scores; the orchestrator
interprets them.

### 10.4 File layout summary

```
.taskmaster/
├── tasks.json                         # Canonical task DAG
├── config.json                        # Taskmaster configuration
└── reports/
    └── task-complexity-report.json    # Complexity analysis output
```

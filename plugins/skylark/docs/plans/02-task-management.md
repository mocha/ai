# Domain 2: Task Management & Decomposition — Implementation Plan

Integrating Taskmaster AI (via MCP) as the task substrate for the Skylark
pipeline. Covers: spec-to-DAG decomposition, status tracking, dependency
resolution, queryable task state for the orchestrator, artifact bridging,
and task sizing enforcement at every entry point.

---

## Build order summary

```
Task 1  Taskmaster MCP setup + config
  │
Task 2  Core type definitions
  │
  ├──────────────────┐
Task 3               Task 4
Decomposition        Task query
wrapper              interface
  │                    │
  └──────┬─────────────┘
         │
Task 5  Status update bridge
  │
Task 6  Sizing enforcement module
  │
Task 7  Artifact bridging
  │
Task 8  Integration wiring + smoke test
```

Tasks 3 and 4 can run in parallel after Task 2 completes. All others
are sequential. Total: 8 tasks, estimated 3-4 focused sessions.

---

## Task 1: Taskmaster MCP setup and configuration

### Description

Install Taskmaster AI and create the project-level configuration so the
MCP server is available to Claude Code sessions. This is pure setup --
no application code. Verify the 7 core MCP tools (`get_task`, `get_tasks`,
`next_task`, `create_task`, `set_task_status`, `update_task`,
`expand_task`) plus the decomposition tools (`parse_prd`,
`analyze_project_complexity`, `validate_dependencies`, `expand_all`)
respond correctly.

### Why

Nothing else in this domain works without a running Taskmaster MCP
server. Getting config right first avoids debugging tool failures in
later tasks.

### Files to create/modify

| Action | Path | Notes |
|--------|------|-------|
| create | `.taskmaster/config.json` | Model config, default subtasks, project name |
| create | `.mcp.json` (project root) | Register Taskmaster MCP server; or modify if file already exists |
| modify | `package.json` | Add `task-master-ai` as a devDependency |

### `.taskmaster/config.json` content

```json
{
  "models": {
    "main": {
      "provider": "anthropic",
      "modelId": "claude-sonnet-4-20250514"
    },
    "research": {
      "provider": "perplexity",
      "modelId": "sonar-pro"
    },
    "fallback": {
      "provider": "anthropic",
      "modelId": "claude-sonnet-4-20250514"
    }
  },
  "global": {
    "defaultSubtasks": 5,
    "defaultPriority": "medium",
    "projectName": "skylark"
  }
}
```

### `.mcp.json` registration

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

### Acceptance criteria

- [ ] `npx task-master-ai` starts without error
- [ ] `.taskmaster/config.json` exists with the specified content
- [ ] MCP server is registered and Claude Code sessions can call `get_tasks` (returns empty array or existing tasks)
- [ ] `parse_prd`, `analyze_project_complexity`, `validate_dependencies` are callable (may return "no data" -- that is fine)
- [ ] `.taskmaster/tasks.json` is created (empty or initialized) after first interaction

### Dependencies

None (first task).

### Estimated scope

Small.

---

## Task 2: Core type definitions

### Description

Define the TypeScript interfaces and type aliases that all other tasks
in this domain import. These types encode the contracts between the task
substrate and the orchestrator as specified in the Layer 2 and Layer 3
specs. This includes event types the substrate emits, command types it
receives, the sizing heuristic constants, and a thin result wrapper.

### Why

Shared types prevent drift between modules. Defining them first means
Tasks 3-7 can import rather than reinvent. The orchestrator (Domain 1)
defines the event discriminated union; this domain defines the payloads
specific to Layer 3.

### Files to create/modify

| Action | Path | Notes |
|--------|------|-------|
| create | `src/task-substrate/types.ts` | All shared types for this domain |

### Key types to define

```typescript
// --- Events emitted by the task substrate (to orchestrator) ---

interface DecompositionCompleteEvent {
  type: 'DECOMPOSITION_COMPLETE';
  task_count: number;
  task_ids: number[];
  domains: string[];
}

interface TaskReadyEvent {
  type: 'TASK_READY';
  task_id: number;
  task: TaskPayload;
}

interface StatusRollupEvent {
  type: 'STATUS_ROLLUP';
  parent_id: number;
  children_complete: number;
  children_total: number;
  all_complete: boolean;
}

// --- Commands received from the orchestrator ---

interface DecomposeCommand {
  type: 'DECOMPOSE';
  spec_path: string;
  risk: RiskLevel;
}

interface QueryNextTaskCommand {
  type: 'QUERY_NEXT_TASK';
  filter: { status: 'pending'; dependencies_met: true };
}

interface UpdateTaskStatusCommand {
  type: 'UPDATE_TASK_STATUS';
  task_id: number;
  status: TaskStatus;
  result_summary?: string;
}

// --- Task payload (mirrors Taskmaster schema, typed for our use) ---

interface TaskPayload {
  id: number;
  title: string;
  description: string;
  details: string;
  status: TaskStatus;
  priority: 'high' | 'medium' | 'low';
  dependencies: number[];
  subtasks: SubtaskPayload[];
  parentId: number | null;
  testStrategy: string;
  acceptanceCriteria: string;
  relevantFiles: RelevantFile[];
  complexity: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

// --- Sizing constants ---

const SIZING_CONSTANTS = {
  TOKENS_PER_LOC: 18,
  MAX_LOC_PER_TASK: 500,
  MAX_CODE_TOKENS: 9000,
  CONTEXT_CEILING_TOKENS: 32000,  // JetBrains research threshold
  COMPLEXITY_DECOMPOSE_THRESHOLD: 7,
  SESSION_CONTEXT_WINDOW: 200000,
} as const;
```

### Acceptance criteria

- [ ] `src/task-substrate/types.ts` compiles with `tsc --noEmit`
- [ ] All event types match the shapes defined in `docs/spec/02-orchestrator.md` Section 3 (Layer 3 events)
- [ ] All command types match the shapes defined in `docs/spec/03-task-substrate.md` Section 3 (Inputs)
- [ ] `SIZING_CONSTANTS` values match the heuristics documented in the research (18 tokens/LOC, 500 LOC ceiling, complexity > 7 threshold)
- [ ] Types are exported and importable by other modules in `src/task-substrate/`

### Dependencies

Task 1 (need `package.json` updated with TypeScript if not already present).

### Estimated scope

Small.

---

## Task 3: Decomposition wrapper

### Description

Build a function that takes a spec path and risk level, feeds it through
Taskmaster's PRD parser, runs complexity analysis, flags any task with
complexity > 7 for further decomposition, expands those tasks, validates
the DAG, and returns a `DECOMPOSITION_COMPLETE` event.

This is the handler for the `DECOMPOSE` command from the orchestrator.

### Why

The orchestrator dispatches `DECOMPOSE` after triage for elevated and
critical risk work. This wrapper orchestrates the multi-step Taskmaster
flow (parse -> analyze -> expand -> validate) into a single callable
function that returns a typed event.

### Files to create/modify

| Action | Path | Notes |
|--------|------|-------|
| create | `src/task-substrate/decompose.ts` | Main decomposition function |
| create | `src/task-substrate/mcp-client.ts` | Thin wrapper around MCP tool calls (shared by all modules) |

### `mcp-client.ts` design

Thin wrapper that calls Taskmaster MCP tools and returns typed results.
Each function maps 1:1 to a Taskmaster MCP tool. This isolates MCP
protocol details from business logic.

```typescript
// Core operations
async function parsePrd(specPath: string): Promise<ParsePrdResult>;
async function analyzeComplexity(): Promise<ComplexityReport>;
async function expandTask(taskId: number, opts?: ExpandOpts): Promise<TaskPayload>;
async function expandAll(opts?: ExpandOpts): Promise<TaskPayload[]>;
async function validateDependencies(): Promise<ValidationResult>;
async function getTasks(filter?: TaskFilter): Promise<TaskPayload[]>;
async function getTask(id: number): Promise<TaskPayload>;
async function nextTask(): Promise<TaskPayload | null>;
async function setTaskStatus(id: number, status: TaskStatus): Promise<TaskPayload>;
async function updateTask(id: number, fields: Partial<TaskPayload>): Promise<TaskPayload>;
async function createTask(fields: CreateTaskFields): Promise<TaskPayload>;
```

### `decompose.ts` flow

```
1. Call parsePrd(spec_path) -> initial task set
2. Call analyzeComplexity() -> complexity scores per task
3. For each task with complexity > COMPLEXITY_DECOMPOSE_THRESHOLD:
   a. If risk == 'critical': expandTask(id, { numSubtasks: 8 })
   b. Else: expandTask(id, { numSubtasks: 5 })
4. Call validateDependencies()
   a. If invalid: log issues, attempt auto-fix, re-validate
   b. If still invalid: throw with details (orchestrator will escalate)
5. Call getTasks() to enumerate final set
6. Extract domain clusters from task descriptions and relevantFiles
7. Return DECOMPOSITION_COMPLETE event
```

### Domain cluster extraction heuristic

Scan each task's `description`, `details`, and `relevantFiles` paths for
domain keywords. Match against the default domain set from
`artifact-conventions.md`: `database`, `api`, `auth`, `events`, `ui`,
`infra`, `billing`, `integrations`. Return deduplicated list.

### Acceptance criteria

- [ ] `decompose(specPath, risk)` accepts a valid spec markdown file and returns a `DecompositionCompleteEvent`
- [ ] Tasks with complexity > 7 are automatically expanded into subtasks
- [ ] Critical risk uses higher subtask count (8) than elevated (5)
- [ ] DAG validation runs after expansion; function throws on unresolvable circular dependencies
- [ ] Domain clusters are extracted and included in the returned event
- [ ] `mcp-client.ts` functions are individually callable and return typed results
- [ ] Error cases: missing spec file throws descriptive error; Taskmaster MCP server not running throws descriptive error

### Dependencies

Task 1 (MCP server running), Task 2 (types).

### Estimated scope

Medium.

---

## Task 4: Task query interface

### Description

Build functions that wrap Taskmaster MCP calls to answer the
orchestrator's dispatch queries: "what is the next ready task?",
"what is blocking task X?", and "what is the completion status of
this spec's tasks?" These functions return typed events
(`TASK_READY`, `STATUS_ROLLUP`) that the orchestrator consumes.

### Why

The orchestrator polls the task substrate at two points: the dispatch
loop (next ready task) and after worker completion (status rollup).
These functions translate between Taskmaster's MCP responses and the
orchestrator's event contract.

### Files to create/modify

| Action | Path | Notes |
|--------|------|-------|
| create | `src/task-substrate/query.ts` | Query functions |

### Functions

```typescript
// Returns the next task ready for dispatch, or null if none available
async function queryNextTask(): Promise<TaskReadyEvent | null>;

// Returns what is blocking a specific task (unmet dependencies)
async function queryBlockers(taskId: number): Promise<BlockerReport>;

// Returns completion status for a parent task (rollup)
async function queryStatusRollup(parentId: number): Promise<StatusRollupEvent>;

// Returns completion status for all tasks derived from a spec
async function querySpecProgress(specPath: string): Promise<SpecProgressReport>;
```

### `queryNextTask` implementation

1. Call `nextTask()` via MCP client
2. If null: return null (orchestrator interprets as "all tasks complete or blocked")
3. If task returned: wrap in `TASK_READY` event shape

### `queryStatusRollup` implementation

1. Call `getTask(parentId)` to get the parent task with subtasks
2. Count subtasks by status
3. Construct `STATUS_ROLLUP` event with `children_complete`, `children_total`, `all_complete`

### `queryBlockers` implementation

1. Call `getTask(taskId)` to get the task's dependencies array
2. For each dependency ID, call `getTask(depId)` and check status
3. Return list of dependencies not yet `done`

### `querySpecProgress` implementation

1. Call `getTasks()` to get all tasks
2. Filter to tasks whose `relevantFiles` or `details` reference the spec path
3. Aggregate: total tasks, done tasks, in-progress, blocked, pending

### Acceptance criteria

- [ ] `queryNextTask()` returns a `TaskReadyEvent` when a pending task with all deps met exists
- [ ] `queryNextTask()` returns `null` when no tasks are ready (all complete or all blocked)
- [ ] `queryStatusRollup(parentId)` returns accurate child counts matching the actual subtask states in `tasks.json`
- [ ] `queryBlockers(taskId)` lists dependency tasks that are not yet `done`
- [ ] `querySpecProgress(specPath)` returns aggregate counts for all tasks linked to a spec

### Dependencies

Task 1 (MCP server running), Task 2 (types). Note: uses `mcp-client.ts` from Task 3, but the MCP client is a simple utility -- if building in parallel with Task 3, extract `mcp-client.ts` as a shared subtask first.

### Estimated scope

Medium.

---

## Task 5: Status update bridge

### Description

Build the handler for `UPDATE_TASK_STATUS` commands from the
orchestrator. Receives a task ID and new status, calls Taskmaster's
`set_task_status` MCP tool, then checks for parent rollup and returns
a `STATUS_ROLLUP` event if the parent's effective status changed.

### Why

After a worker completes (or is blocked/cancelled), the orchestrator
sends `UPDATE_TASK_STATUS` to this bridge. The bridge must also detect
rollup -- if a subtask completion causes the parent to transition to
`done` or `in-progress`, the orchestrator needs to know.

### Files to create/modify

| Action | Path | Notes |
|--------|------|-------|
| create | `src/task-substrate/status-bridge.ts` | Status update handler |

### `updateTaskStatus` implementation

```
1. Receive UpdateTaskStatusCommand { task_id, status, result_summary }
2. Call setTaskStatus(task_id, status) via MCP client
3. Read back the updated task to get parentId
4. If parentId is not null:
   a. Call getTask(parentId) to get fresh parent state
   b. Count subtask statuses
   c. Determine if parent status changed (Taskmaster handles rollup
      automatically, but we need to detect the change for the event)
   d. Construct STATUS_ROLLUP event
5. If parentId is null (top-level task):
   a. No rollup needed; return confirmation only
6. Return: { updated_task, rollup: StatusRollupEvent | null }
```

### Rollup detection

Taskmaster automatically rolls up subtask status to parents. The bridge
does not duplicate this logic -- it reads the parent state AFTER the
`set_task_status` call and reports the current state. The orchestrator
compares against its own cached state to detect transitions.

To detect whether the parent status actually changed, the bridge reads
the parent BEFORE the status update (cached from the MCP client), then
AFTER. If the parent's `status` field differs, a rollup event is
emitted.

### Result summary handling

When `result_summary` is provided, the bridge also calls `updateTask`
to append the summary to the task's `details` field or a designated
metadata field, preserving the worker's brief outcome record.

### Acceptance criteria

- [ ] `updateTaskStatus({ task_id, status })` calls Taskmaster's `set_task_status` and returns the updated task
- [ ] When a subtask status change causes parent rollup, a `STATUS_ROLLUP` event is returned
- [ ] When no rollup occurs (top-level task or parent status unchanged), rollup is `null`
- [ ] `result_summary` is persisted to the task record when provided
- [ ] Idempotent: calling with the same status twice does not error (Taskmaster treats same-status as no-op)

### Dependencies

Task 2 (types), Task 3 (mcp-client.ts).

### Estimated scope

Small.

---

## Task 6: Sizing enforcement module

### Description

Build the sizing enforcement logic that applies at every entry point
where work items enter or re-enter the system. This is the PRIMARY home
for the sizing heuristic. The module provides a `checkTaskSize` function
and integrates at four enforcement points:

1. **Pre-decomposition** -- After `parse_prd`, before tasks are dispatched
2. **Triage entry** -- When triage creates work items, verify scoping
3. **Worker compaction signal** -- When a worker signals `COMPACTION_DETECTED`, trigger re-decomposition
4. **Post-execution calibration** -- When status rollup shows a task took too many turns, flag for future sizing calibration

### Why

Research shows AI agent performance drops sharply past ~32K tokens of
context. The sizing heuristic (18 tokens/LOC, 500 LOC max per task)
keeps tasks within a single session. Taskmaster's complexity score
(1-10) is the primary proxy -- complexity > 7 is the trigger for
further decomposition. Additionally, the "Sonnet-as-sizing-sentinel"
heuristic says: if a concise task summary cannot be generated, the task
is too large.

### Files to create/modify

| Action | Path | Notes |
|--------|------|-------|
| create | `src/task-substrate/sizing.ts` | Sizing enforcement functions |

### Core function: `checkTaskSize`

```typescript
interface SizingResult {
  fits_single_session: boolean;
  complexity: number;
  estimated_loc: number;
  estimated_code_tokens: number;
  recommendation: 'dispatch' | 'decompose' | 'scope_down';
  reason: string;
}

async function checkTaskSize(task: TaskPayload): Promise<SizingResult>;
```

**Algorithm:**

1. Read `task.complexity` from Taskmaster's analysis
2. If complexity > 7: `recommendation = 'decompose'`
3. If complexity > 9: `recommendation = 'scope_down'` (needs manual re-scoping)
4. Estimate LOC from `relevantFiles`:
   - Count files with `action: 'create'` or `action: 'modify'`
   - Heuristic: new files average ~100 LOC, modifications average ~50 LOC change
   - If estimated total > `MAX_LOC_PER_TASK` (500): flag
5. Estimate code tokens: `estimated_loc * TOKENS_PER_LOC`
6. If `estimated_code_tokens > MAX_CODE_TOKENS` (9000): flag
7. Determine `fits_single_session` based on whether code tokens leave
   sufficient room in a 200K context window (need ~150K+ for context
   and tool calls)

### Sonnet-as-sizing-sentinel

```typescript
async function sentinelCheck(task: TaskPayload): Promise<boolean>;
```

Feed the task's `description` and `details` to a Sonnet call with the
prompt: "Summarize this task in 2 sentences. If you cannot, respond
OVERSIZED." If the response contains "OVERSIZED" or exceeds 3 sentences,
the task is flagged as too large.

This is a secondary check, not a gate. It produces a warning that
the decompose wrapper (Task 3) can act on.

### Enforcement points

| Entry point | When | Action on oversized |
|-------------|------|---------------------|
| Post-`parse_prd` | Decomposition wrapper calls `checkTaskSize` on each new task | Flag complexity > 7 tasks for `expand_task` |
| Triage | Triage result includes `decompose: true` for multi-context work | Orchestrator dispatches DECOMPOSE before expensive gates |
| Worker compaction | Worker signals `COMPACTION_DETECTED` event | Orchestrator pauses task, calls `expand_task` on the oversized task, re-dispatches subtasks |
| Post-execution | After `set_task_status(done)`, check if worker used > N turns | Log calibration warning: "Task X took Y turns, consider lower complexity threshold" |

### Compaction handler

```typescript
interface CompactionSignal {
  task_id: number;
  tokens_used: number;
  turns_used: number;
}

async function handleCompaction(signal: CompactionSignal): Promise<DecompositionCompleteEvent>;
```

1. Get the task via `getTask(signal.task_id)`
2. Set task status to `pending` (reset for re-decomposition)
3. Call `expandTask(signal.task_id)` with a prompt noting "task exceeded context window"
4. Return a `DECOMPOSITION_COMPLETE` event for the new subtasks

### Calibration logger

```typescript
function logCalibrationWarning(taskId: number, turnsUsed: number, maxTurns: number): void;
```

Writes a structured log entry to `.skylark/telemetry/sizing-calibration.jsonl`
with the task ID, turns used, max turns, and complexity score. Over time
this data informs whether the complexity > 7 threshold needs adjustment.

### Acceptance criteria

- [ ] `checkTaskSize(task)` returns `'decompose'` for tasks with complexity > 7
- [ ] `checkTaskSize(task)` returns `'scope_down'` for tasks with complexity > 9
- [ ] LOC estimation uses `relevantFiles` to produce a reasonable estimate
- [ ] Token estimation uses the 18 tokens/LOC constant
- [ ] `sentinelCheck` calls Sonnet and detects oversized responses
- [ ] `handleCompaction` expands the oversized task and returns a new decomposition event
- [ ] `logCalibrationWarning` appends to the calibration log file
- [ ] Constants are imported from `types.ts` `SIZING_CONSTANTS`, not hardcoded

### Dependencies

Task 2 (types), Task 3 (mcp-client.ts, decompose.ts for the compaction handler).

### Estimated scope

Medium.

---

## Task 7: Artifact bridging

### Description

Build a thin bridge that links Taskmaster task IDs to Skylark artifact
paths. Taskmaster knows tasks and subtasks; Skylark knows specs, plans,
task specs, reports, and session notes as markdown with YAML frontmatter.
The bridge maintains the bidirectional cross-reference between the two
systems.

### Why

The orchestrator needs to answer questions like "which spec did task 7
come from?" and "which Taskmaster tasks correspond to PLAN-003?" The
two systems use different ID schemes and storage formats. The bridge
translates between them.

### Files to create/modify

| Action | Path | Notes |
|--------|------|-------|
| create | `src/task-substrate/artifact-bridge.ts` | Bridging functions |

### Linking strategy

Per the spec (Section 2.2 of `03-task-substrate.md`), the two systems
are linked by convention:

- **Taskmaster -> Skylark:** A task's `relevantFiles` or `details` field
  contains the spec/plan path. The task's `tags` field can include
  `spec:SPEC-001` or `plan:PLAN-003`.
- **Skylark -> Taskmaster:** A Skylark task spec's `task_number`
  frontmatter field corresponds to the Taskmaster task ID.

The bridge does not create a third data store. It reads both systems
and resolves references.

### Functions

```typescript
// Link a Taskmaster task to a Skylark artifact
async function linkTaskToArtifact(
  taskId: number,
  artifactPath: string,
  artifactId: string  // e.g., "SPEC-001"
): Promise<void>;

// Resolve: given a Taskmaster task ID, find the Skylark artifact
async function resolveArtifactForTask(taskId: number): Promise<ArtifactRef | null>;

// Resolve: given a Skylark artifact path, find all Taskmaster tasks
async function resolveTasksForArtifact(artifactPath: string): Promise<number[]>;

// Sync Skylark task spec status from Taskmaster status
async function syncArtifactStatus(
  taskId: number,
  newStatus: TaskStatus
): Promise<void>;
```

### `linkTaskToArtifact` implementation

1. Call `updateTask(taskId, { tags: [...existing, `artifact:${artifactId}`] })`
2. Add `artifactPath` to the task's `relevantFiles` if not already present
3. If the artifact is a Skylark task spec (`docs/tasks/TASK-NNN-*.md`), update its `task_number` frontmatter to match `taskId`

### `resolveArtifactForTask` implementation

1. Call `getTask(taskId)`
2. Search `tags` for entries matching `artifact:*` or `spec:*` or `plan:*`
3. Search `relevantFiles` for paths matching `docs/specs/`, `docs/plans/`, `docs/tasks/`
4. Return the first matching artifact reference, or null

### `resolveTasksForArtifact` implementation

1. Call `getTasks()` to get all tasks
2. Filter to tasks whose `relevantFiles` or `tags` reference the artifact path or ID
3. Return matching task IDs

### `syncArtifactStatus` implementation

1. Resolve the Skylark artifact path for the task
2. If a task spec exists at `docs/tasks/TASK-NNN-*.md`:
   a. Read the file, parse YAML frontmatter
   b. Update the `status` field to match the Taskmaster status
   c. Append a changelog entry: `[TASK-SUBSTRATE] Status updated to <status>.`
   d. Write the file back

### Acceptance criteria

- [ ] `linkTaskToArtifact` adds the artifact reference to the Taskmaster task's tags and relevantFiles
- [ ] `resolveArtifactForTask` returns the correct Skylark artifact for a given Taskmaster task ID
- [ ] `resolveTasksForArtifact` returns all Taskmaster task IDs linked to a given Skylark artifact
- [ ] `syncArtifactStatus` updates the Skylark task spec's frontmatter status field
- [ ] Changelog entries follow the format in `artifact-conventions.md` (timestamp + `[STAGE]` prefix)
- [ ] All functions are no-ops (no error) when the referenced artifact or task does not exist -- they log a warning and return gracefully

### Dependencies

Task 2 (types), Task 3 (mcp-client.ts).

### Estimated scope

Medium.

---

## Task 8: Integration wiring and smoke test

### Description

Wire all modules together into a single entry point (`index.ts`) that
exports the public API for the task substrate domain. Write a smoke test
script that exercises the full flow: decompose a test spec, query the
next task, update status, check rollup, verify sizing enforcement, and
confirm artifact bridging.

### Why

Individual modules are useless until wired together. The smoke test
validates the end-to-end contract before the orchestrator (Domain 1)
tries to consume this domain.

### Files to create/modify

| Action | Path | Notes |
|--------|------|-------|
| create | `src/task-substrate/index.ts` | Public API barrel export |
| create | `src/task-substrate/smoke-test.ts` | End-to-end smoke test script |
| create | `tests/fixtures/test-spec.md` | Minimal spec file for smoke test |

### `index.ts` public API

```typescript
// Decomposition
export { decompose } from './decompose.js';

// Queries
export { queryNextTask, queryStatusRollup, queryBlockers, querySpecProgress } from './query.js';

// Status updates
export { updateTaskStatus } from './status-bridge.js';

// Sizing enforcement
export { checkTaskSize, sentinelCheck, handleCompaction, logCalibrationWarning } from './sizing.js';

// Artifact bridging
export { linkTaskToArtifact, resolveArtifactForTask, resolveTasksForArtifact, syncArtifactStatus } from './artifact-bridge.js';

// MCP client (for direct access when needed)
export { createMcpClient } from './mcp-client.js';

// Types
export type * from './types.js';
```

### Smoke test flow

```
1. Create a minimal test spec at tests/fixtures/test-spec.md
2. Call decompose(specPath, 'elevated')
3. Assert: DECOMPOSITION_COMPLETE event returned with task_count > 0
4. Call checkTaskSize on each task
5. Assert: high-complexity tasks flagged correctly
6. Call queryNextTask()
7. Assert: returns TASK_READY for a pending task with deps met
8. Call linkTaskToArtifact on the first task
9. Assert: resolveArtifactForTask returns the linked artifact
10. Call updateTaskStatus(firstTask.id, 'done')
11. Assert: status updated, rollup event returned if applicable
12. Call querySpecProgress(specPath)
13. Assert: progress report shows 1 done task
14. Clean up: reset tasks.json to empty state
```

### Test spec fixture

A minimal but realistic spec markdown file with:
- YAML frontmatter following artifact conventions
- 3-4 requirements that decompose into multiple tasks
- At least one requirement that would produce a high-complexity task

### Acceptance criteria

- [ ] `src/task-substrate/index.ts` exports all public functions and types
- [ ] Smoke test runs end-to-end without error when Taskmaster MCP server is available
- [ ] Smoke test verifies: decomposition, sizing check, next-task query, status update, rollup, artifact bridge
- [ ] Smoke test cleans up after itself (no leftover state in `tasks.json`)
- [ ] Running `npx tsx src/task-substrate/smoke-test.ts` produces clear pass/fail output
- [ ] Build passes: `tsc --noEmit` reports no errors across all files in `src/task-substrate/`

### Dependencies

Tasks 1-7 (all prior tasks).

### Estimated scope

Medium.

---

## Integration points

### Events this domain emits (consumed by Domain 1: Orchestrator)

| Event | Emitted by | Consumed at orchestrator state |
|-------|------------|-------------------------------|
| `DECOMPOSITION_COMPLETE` | `decompose()` | `develop.decompose` -> `develop.next_task` |
| `TASK_READY` | `queryNextTask()` | `develop.next_task` -> `develop.generate_expert` |
| `STATUS_ROLLUP` | `updateTaskStatus()` | `develop.next_task` (checked via `allTasksComplete` guard) |

### Commands this domain receives (dispatched by Domain 1: Orchestrator)

| Command | Handler | Dispatched from orchestrator state |
|---------|---------|-----------------------------------|
| `DECOMPOSE` | `decompose()` | `develop.decompose` entry action |
| `QUERY_NEXT_TASK` | `queryNextTask()` | `develop.next_task` entry action, also after `SHIP` verdict |
| `UPDATE_TASK_STATUS` | `updateTaskStatus()` | `develop.route_verdict` (`markTaskDone` action) |

### Interfaces with other domains

| Domain | Interface | Direction |
|--------|-----------|-----------|
| Domain 3 (Worker Execution) | Worker completion triggers `UPDATE_TASK_STATUS` via orchestrator | Worker -> Orchestrator -> This domain |
| Domain 3 (Worker Execution) | Worker `COMPACTION_DETECTED` signal triggers `handleCompaction()` | Worker -> Orchestrator -> This domain |
| Domain 4 (Expert Generation) | `TASK_READY` payload is forwarded to expert generation as task context | This domain -> Orchestrator -> Expert Gen |
| Domain 1 (Orchestrator) | Orchestrator calls `syncArtifactStatus()` when marking tasks done | Orchestrator -> This domain |
| Layer 1 (Triage) | Triage sets `decompose: true` which triggers this domain's `decompose()` | Triage -> Orchestrator -> This domain |

### File layout when complete

```
src/task-substrate/
├── index.ts              # Public API exports
├── types.ts              # Shared types, event/command interfaces, sizing constants
├── mcp-client.ts         # Thin wrapper around Taskmaster MCP tool calls
├── decompose.ts          # Spec -> task DAG decomposition
├── query.ts              # Task query functions (next task, blockers, rollup, progress)
├── status-bridge.ts      # Status update handler with rollup detection
├── sizing.ts             # Task sizing enforcement and compaction handling
├── artifact-bridge.ts    # Taskmaster <-> Skylark artifact cross-references
└── smoke-test.ts         # End-to-end integration test

tests/fixtures/
└── test-spec.md          # Fixture spec for smoke test

.taskmaster/
├── config.json           # Taskmaster configuration (Task 1)
├── tasks.json            # Canonical task DAG (managed by Taskmaster)
└── reports/
    └── task-complexity-report.json  # Complexity analysis output

.mcp.json                 # MCP server registration (Task 1)
```

### Prerequisites checklist (from Domain 1)

Before this domain can be fully integrated:

- [ ] Domain 1 defines the `OrchestratorEvent` discriminated union that includes `DECOMPOSITION_COMPLETE`, `TASK_READY`, `STATUS_ROLLUP`
- [ ] Domain 1 defines the `OrchestratorCommand` union that includes `DECOMPOSE`, `QUERY_NEXT_TASK`, `UPDATE_TASK_STATUS`
- [ ] Domain 1's `develop.decompose` state dispatches `DECOMPOSE` and transitions on `DECOMPOSITION_COMPLETE`
- [ ] Domain 1's `develop.next_task` state dispatches `QUERY_NEXT_TASK` and transitions on `TASK_READY`
- [ ] Domain 1's `markTaskDone` action dispatches `UPDATE_TASK_STATUS`

These can be stubbed during development of this domain and wired when Domain 1 is ready.

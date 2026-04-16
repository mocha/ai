# Taskmaster AI -- Artifact and Task Substrate Conformance Evaluation

**Evaluation date:** 2026-04-15
**Repo version:** eyaltoledano/claude-task-master (cloned at `/Users/deuley/code/tools/claude-task-master/`)
**Evaluator role:** Component fitness for a composable AI-agent development pipeline (Skylark/Mocha)

---

## Summary

| Verdict | Count |
|---------|-------|
| MEETS | 4 |
| PARTIAL | 5 |
| DOES NOT MEET | 4 |

**Headline:** Taskmaster provides a solid task-and-subtask JSON substrate with dependency tracking, CLI/MCP queryability, and atomic file writes with cross-process locking. However, it operates exclusively in a task/subtask hierarchy -- specs, plans, reviews, and PRs are not first-class artifact types. There is no event bus on status transitions (only inside the optional TDD workflow orchestrator), no built-in decision-capture fields, and IDs are per-tag sequential integers rather than globally portable identifiers.

---

## Per-Requirement Findings

### 1. Structured schema

**Verdict: PARTIAL**

**Evidence:**
The `Task` interface (`packages/tm-core/src/common/types/index.ts`) defines:

```
id, title, description, status, priority, dependencies, details, testStrategy, subtasks,
createdAt?, updatedAt?, effort?, actualEffort?, tags?, assignee?, metadata?,
complexity?, recommendedSubtasks?, expansionPrompt?, complexityReasoning?,
databaseId?
```

Plus `TaskImplementationMetadata` fields: `relevantFiles`, `codebasePatterns`, `existingInfrastructure`, `scopeBoundaries`, `implementationApproach`, `technicalConstraints`, `acceptanceCriteria`, `skills`, `category`.

The `TaskEntity` class (`packages/tm-core/src/modules/tasks/entities/task.entity.ts`) enforces validation on construction.

Status enum: `pending | in-progress | done | deferred | cancelled | blocked | review`.

**Notes:**
- Present: `id`, `title`, `status`, `dependencies` (equivalent to `blocked_by`), `assignee`, `createdAt`, `updatedAt`, `tags` (labels), `priority`.
- Missing from requirement: There is no `type` field distinguishing tasks from specs/plans/reviews/PRs. Everything is a "task." There is no `blocks` field (only `dependencies`, which is the inverse). There is no `parent` field on tasks (subtasks have `parentId`, but tasks do not form a hierarchical parent chain beyond one level).
- The `metadata` field is a generic `Record<string, unknown>`, so external IDs (like Linear issue IDs) could be stored there, but it is unstructured.
- `blocks` can be computed by inverting the dependency graph, but is not stored directly.

---

### 2. Version-controlled storage

**Verdict: PARTIAL**

**Evidence:**
The file storage adapter writes to `.taskmaster/tasks/tasks.json` which resides inside the project directory and is therefore committed to git alongside code. The `.gitignore` does not exclude `.taskmaster/tasks/`.

**Notes:**
- The file is git-trackable, which gives history replay and auditability through git log.
- However, Taskmaster itself does not interact with git for versioning the task file. There are no snapshots, no commit-on-write, no diffable change log within the substrate. History depends entirely on the user (or pipeline) committing the JSON file.
- The alternative API storage (Supabase/Hamster) is cloud-hosted and has no git backing.
- The workflow state is deliberately stored *outside* git (`~/.taskmaster/{project-id}/sessions/`) to avoid conflicts.

---

### 3. Queryable without LLM

**Verdict: MEETS**

**Evidence:**
- CLI: `task-master list`, `task-master next`, `task-master show <id>`, `task-master validate-dependencies` all operate without any LLM call.
- MCP tools: `get_tasks`, `get_task`, `next_task`, `validate_dependencies`, `complexity_report`, `list_tags` are all deterministic queries.
- The `next_task` tool computes the next available task by checking dependency satisfaction, priority, and status -- no AI involved.
- `validate_dependencies` detects circular references and invalid dependency targets programmatically.
- The `get_tasks` MCP tool (from `@tm/mcp`) and `TasksDomain.list()` support filtering by status and tag.

**Notes:**
- "What's blocking X?" can be answered by reading `dependencies` on task X and checking those tasks' statuses. The `next_task` logic already does this.
- For an XState orchestrator, `TasksDomain.list()` and `TasksDomain.get()` provide the necessary programmatic API.

---

### 4. Atomic writes

**Verdict: MEETS**

**Evidence:**
`FileOperations` class (`packages/tm-core/src/modules/storage/adapters/file-storage/file-operations.ts`) implements:
- Cross-process locking via `proper-lockfile` with configurable stale timeout (10s) and retries (5 retries, exponential backoff).
- Atomic writes via `steno` (write-rename pattern).
- Critical `modifyJson()` method: acquires lock, re-reads file *inside* the lock (preventing stale snapshot writes), applies modifier function, writes atomically, releases lock.
- `ensureFileExists()` uses `'wx'` flag for TOCTOU-safe creation.

`saveTasks()` in `FileStorage` delegates to `modifyJson()` for all write operations (create tag, delete tag, rename tag, save tasks).

**Notes:**
- This is well-engineered for single-machine, multi-process concurrency (e.g., multiple Claude Code sessions hitting the same MCP server, or parallel CLI invocations).
- It does NOT protect against concurrent writes to the API storage (Supabase), but that backend has its own concurrency model.
- The lock scope is per-file, not per-task. All mutations lock the entire `tasks.json`.

---

### 5. Cross-references by ID

**Verdict: PARTIAL**

**Evidence:**
- Tasks reference other tasks via `dependencies: string[]` using task IDs.
- Subtasks reference their parent via `parentId: string`.
- Subtask IDs use dot notation (`"3.2"` = subtask 2 of task 3), which is stable and addressable.
- Cross-tag task movement is supported (`move_task` tool with `fromTag`/`toTag` parameters).

**Notes:**
- Cross-references are limited to task-to-task dependencies. There is no mechanism to link a task to a spec, plan, PR, or review by ID, because those artifact types do not exist in the substrate.
- The `metadata` field could store external references (e.g., `{ "prId": "PR-42", "specId": "SPEC-7" }`), but this is unstructured and not enforced.
- Within the task domain, the cross-referencing is clean and functional.

---

### 6. Survives compaction and session boundaries

**Verdict: MEETS**

**Evidence:**
- `tasks.json` is the canonical store. It persists on disk and is independent of any conversation or session.
- The MCP server reads from and writes to this file on every operation -- there is no in-memory cache that could go stale.
- Workflow state is persisted to `~/.taskmaster/{project-id}/sessions/workflow-state.json` with backup rotation, surviving process restarts.
- The `watch()` method on `IStorage` uses `fs.watch` to detect external changes.

**Notes:**
- This is exactly the substrate-as-source-of-truth pattern the requirement calls for. Agent conversation memory is ephemeral; the tasks.json file is permanent.

---

### 7. Idempotent re-runs

**Verdict: PARTIAL**

**Evidence:**
- Status transitions are guarded: `updateTaskStatus()` returns early with success if `oldStatus === newStatus` (no-op).
- `TaskEntity.updateStatus()` enforces business rules (e.g., cannot move `done` back to `pending`).
- `canComplete()` checks whether all subtasks are done before allowing parent completion.
- `parse_prd` with `--force` overwrites; without it, it refuses to overwrite existing tasks.
- `expand_task` with `--force` regenerates subtasks; without it, it skips tasks that already have subtasks.

**Notes:**
- The system supports idempotent status transitions and guards against re-expansion.
- However, there is no formal concept of "terminal states" that the orchestrator can inspect to decide "skip this, it's done." An external orchestrator would need to check `status === 'done' || status === 'cancelled'` itself.
- Re-running `parse_prd` without `--force` is safe but not truly idempotent -- it fails rather than skipping gracefully.

---

### 8. Human-readable, machine-parseable

**Verdict: MEETS**

**Evidence:**
- `tasks.json` is pretty-printed JSON (2-space indent via `JSON.stringify(data, null, 2)`).
- Individual task markdown files are generated via `generateTaskFiles()` with headers like `# Task ID: <id>`, `# Title: <title>`, etc.
- CLI commands produce formatted, colorized output with status emoji indicators.
- MCP tool responses are structured JSON.

**Notes:**
- A human can open `tasks.json` in any editor and understand the full project state.
- The markdown file generation provides an even more readable format for individual tasks.
- Machine consumption is straightforward -- it's just JSON.

---

### 9. Event emission on transition

**Verdict: PARTIAL**

**Evidence:**
The workflow orchestrator (`packages/tm-core/src/modules/workflow/orchestrators/workflow-orchestrator.ts`) has a full event system:
- Private `emit()` method dispatches to registered listeners.
- Event types include: `workflow:started`, `workflow:completed`, `phase:entered`, `phase:exited`, `tdd:red:started/completed`, `tdd:green:started/completed`, `subtask:started/completed`, `test:run/passed/failed`, `git:branch:created`, `git:commit:created`, `state:persisted`, `progress:updated`, `error:occurred`.
- `WorkflowActivityLogger` writes events to an append-only JSONL file (`activity.jsonl`) with timestamps.

The `IStorage.watch()` interface emits `WatchEvent` (`'change' | 'error'`) when the tasks file is modified.

**Notes:**
- Event emission exists but is scoped to the **workflow orchestrator** (autopilot/TDD loop). It is NOT triggered by basic task CRUD operations.
- Calling `set_task_status` via MCP does NOT emit an event. The `FileStorage.updateTaskStatus()` method writes to disk and returns a result, but does not fire any event.
- For the pipeline use case, the orchestrator would need to either poll the file, use `watch()` (which only knows "something changed"), or wrap mutations with event emission.
- The `watch()` API provides change detection but not structured transition events (it just says "file changed").

---

### 10. Stable, portable, short IDs

**Verdict: PARTIAL**

**Evidence:**
- Task IDs are sequential positive integers (`1`, `2`, `3`, ...) within each tag context.
- Subtask IDs use dot notation (`3.2`).
- API storage supports alphanumeric display IDs like `HAM-123` and internally uses UUIDs (`databaseId`).
- IDs are stable across the task's lifetime within a tag.

**Notes:**
- IDs are short and conversational ("task 7", "subtask 7.3").
- IDs are NOT portable across tags -- each tag starts numbering from 1 independently. Task `1` in the `master` tag and task `1` in a `feature-auth` tag are different tasks.
- IDs are NOT globally unique. Moving a task cross-tag may reassign its ID.
- For a multi-workspace pipeline, the per-tag sequential integers are insufficient for globally stable references. The `metadata` field could carry a UUID, but this is not built in.
- The API storage's `databaseId` (UUID) is globally unique but not short or conversational.

---

### 11. Decision capture

**Verdict: DOES NOT MEET**

**Evidence:**
The task schema includes:
- `details`: implementation instructions
- `testStrategy`: verification approach
- `description`: what the task involves
- `complexityReasoning`: why the complexity score was assigned (from AI analysis)
- `metadata`: generic key-value store

**Notes:**
- None of these fields are designed for decision capture (the *why*, alternatives considered, constraints that led to the decision).
- `complexityReasoning` captures reasoning about complexity, not about design decisions.
- There is no `rationale`, `alternatives`, `constraints`, or `decision_log` field.
- The `metadata` field could be used for this, but it's unstructured and not prompted or enforced.
- An orchestrator could work around this by writing decision context into `details`, but the substrate does not model it.

---

### 12. Specs and plans are first-class

**Verdict: DOES NOT MEET**

**Evidence:**
The substrate has exactly two entity types:
1. `Task` -- top-level work item
2. `Subtask` -- child of a task (cannot nest further)

There is no `type` field, no spec entity, no plan entity, no review entity, no PR entity.

The `category` field on `TaskImplementationMetadata` supports: `'research' | 'design' | 'development' | 'testing' | 'documentation' | 'review'`. However, this is an AI-generated metadata hint, not a structural type that changes behavior.

**Notes:**
- PRDs are external files (`.taskmaster/docs/prd.md`) parsed by the `parse_prd` tool into tasks. The PRD itself is not tracked as an artifact in the substrate.
- Plans are implicit in the task DAG structure. There is no "plan" artifact that groups tasks or captures planning rationale.
- Reviews exist only as a status (`review`) on tasks, not as standalone artifacts with their own schema (reviewer, verdict, comments).
- This is a fundamental architectural gap for the pipeline use case. Specs, plans, and reviews would need to be modeled externally (e.g., in a separate substrate layer) or shoehorned into tasks via `metadata` and `category`.

---

### 13. Migration path

**Verdict: DOES NOT MEET**

**Evidence:**
- The `IntegrationDomain` supports exporting tasks to Hamster (cloud API) via `generateBriefFromTasks()` and importing from PRD via `generateBriefFromPrd()`.
- Legacy `tasks.json` format (flat `{"tasks": [...]}`) is auto-migrated to tagged format.
- There is no import mechanism for external sources like Linear, GitHub Issues, Jira, or markdown files in `docs/`.

**Notes:**
- Importing existing Linear issues into Taskmaster tasks is not supported.
- Importing markdown specs from `docs/` as substrate artifacts is not supported (they can be parsed as PRDs, but that generates new tasks rather than importing existing artifacts).
- The `metadata` field on tasks could store Linear issue IDs for cross-referencing, but there is no tooling to populate or sync this.
- For the pipeline, existing ad-hoc artifacts would need custom tooling to map into the task substrate.

---

## Surprises

1. **Cross-process locking is well-implemented.** The `proper-lockfile` + `steno` combination with re-read-inside-lock semantics is production-grade concurrency handling. This is better than many task management tools.

2. **The workflow orchestrator is a near-XState implementation.** The `WorkflowOrchestrator` in tm-core implements a state machine with defined transitions, guards, event listeners, and auto-persistence. It even has a `persistCallback` pattern. This is very close to what an XState orchestrator would need, but it's tightly coupled to the TDD workflow (RED/GREEN/COMMIT phases).

3. **`TaskImplementationMetadata` is richer than expected.** Fields like `relevantFiles`, `scopeBoundaries`, `acceptanceCriteria`, `existingInfrastructure`, and `technicalConstraints` provide AI-agent-friendly context that goes well beyond typical task managers. These are generated by the AI during task creation and expansion.

4. **Tag isolation is strict.** Tags are fully isolated namespaces with independent ID sequences. This is good for branch-based development but means task IDs are not globally addressable without specifying the tag.

5. **The `watch()` API exists but is primitive.** It detects file changes but doesn't tell you *what* changed. An orchestrator would need to diff the before/after state itself.

---

## Open Questions for Trial

1. **How does the file lock perform under heavy concurrent writes?** The 10-second stale timeout and 5 retries should be tested with, say, 5 parallel agents each making rapid status updates.

2. **Can `metadata` carry structured decision context reliably?** If we define a convention like `metadata: { decisions: [...] }`, does it survive AI-powered updates (which are documented to preserve `metadata` via spread operator)?

3. **What happens when `tasks.json` gets very large?** With hundreds of tasks across multiple tags, does the "load all tasks, modify, save all tasks" pattern create performance issues?

4. **Can the `watch()` API be extended to emit structured transition events?** The `WatchEvent` only contains `type: 'change'` -- can we intercept at the storage layer to provide before/after diffs?

5. **How does the API storage (Supabase) handle the same requirements?** Many findings here are specific to file storage. The API storage may have different characteristics for atomicity, events, and ID portability.

---

## Source Index

| File | What was examined |
|------|-------------------|
| `packages/tm-core/src/common/types/index.ts` | Task, Subtask, TaskStatus, TaskPriority, TaskImplementationMetadata interfaces |
| `packages/tm-core/src/modules/tasks/entities/task.entity.ts` | TaskEntity class with validation and business rules |
| `packages/tm-core/src/modules/tasks/tasks-domain.ts` | TasksDomain facade -- public API for task operations |
| `packages/tm-core/src/modules/storage/adapters/file-storage/file-storage.ts` | FileStorage implementation -- CRUD, tag management, watch |
| `packages/tm-core/src/modules/storage/adapters/file-storage/file-operations.ts` | Atomic writes, cross-process locking (proper-lockfile + steno) |
| `packages/tm-core/src/common/interfaces/storage.interface.ts` | IStorage interface, WatchEvent, StorageConfig |
| `packages/tm-core/src/modules/storage/adapters/activity-logger.ts` | JSONL append-only activity logging |
| `packages/tm-core/src/modules/workflow/types.ts` | WorkflowPhase, WorkflowEvent, WorkflowEventType definitions |
| `packages/tm-core/src/modules/workflow/orchestrators/workflow-orchestrator.ts` | State machine with transitions, event emission, guards |
| `packages/tm-core/src/modules/workflow/workflow-domain.ts` | WorkflowDomain facade |
| `packages/tm-core/src/modules/workflow/services/workflow.service.ts` | WorkflowService -- lifecycle management |
| `packages/tm-core/src/modules/workflow/managers/workflow-state-manager.ts` | Workflow state persistence to disk |
| `packages/tm-core/src/modules/integration/integration-domain.ts` | Export/import to Hamster API |
| `src/schemas/base-schemas.js` | Zod schemas for AI-facing task/subtask validation |
| `src/schemas/parse-prd.js` | PRD parsing response schema |
| `src/schemas/analyze-complexity.js` | Complexity analysis response schema |
| `src/constants/task-status.js` | Status enum definition |
| `mcp-server/src/tools/tool-registry.js` | 46 registered MCP tools (7 core, 14 standard, 46 total) |
| `mcp-server/src/tools/set-task-status.js` | Status update MCP tool |
| `mcp-server/src/tools/validate-dependencies.js` | Dependency validation MCP tool |
| `mcp-server/src/tools/analyze.js` | Complexity analysis MCP tool |
| `mcp-server/src/tools/next-task.js` | Next-task selection MCP tool |
| `docs/task-structure.md` | Task structure documentation with tagged format |
| `.taskmaster/tasks/tasks.json` | Live task data (schema example) |
| `.taskmaster/config.json` | Configuration file |
| `.taskmaster/state.json` | Tag state, migration metadata |
| `.taskmaster/reports/task-complexity-report.json` | Complexity analysis output |
| `CLAUDE.md` | Architecture guidelines, test and code quality standards |
| `CLAUDE_CODE_PLUGIN.md` | Plugin marketplace documentation |
| `.taskmaster/CLAUDE.md` | Agent integration guide, CLI commands, project structure |

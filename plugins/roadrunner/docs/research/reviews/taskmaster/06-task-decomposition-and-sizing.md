# Taskmaster AI -- Task Decomposition and Sizing Conformance Evaluation

**Evaluation date:** 2026-04-15
**Repo version:** eyaltoledano/claude-task-master (cloned at `/Users/deuley/code/tools/claude-task-master/`)
**Evaluator role:** Component fitness for a composable AI-agent development pipeline (Skylark/Mocha)

---

## Summary

| Verdict | Count |
|---------|-------|
| MEETS | 3 |
| PARTIAL | 7 |
| DOES NOT MEET | 4 |

**Headline:** Taskmaster's complexity analysis and AI-driven task expansion provide a good foundation for decomposition, and its dependency DAG with topological ordering is solid. However, it does not enforce sizing constraints (context utilization, LOC caps), has no pre-dispatch validation against live code, no concept of compaction-as-trigger, and no risk-based gating. The tool is a decomposition *assistant* that needs an outer orchestrator to enforce the pipeline discipline this evaluation demands.

---

## Per-Requirement Findings

### 1. Single-session fit

**Verdict: DOES NOT MEET**

**Evidence:**
There is no mechanism in Taskmaster that measures, estimates, or constrains task size relative to an LLM context window.

The complexity analysis (`analyze_project_complexity` MCP tool, `ComplexityAnalysisItemSchema`) scores tasks 1-10 and recommends a subtask count, but:
- The score measures *difficulty*, not *token footprint*.
- There is no estimation of output size, tool call count, or context utilization.
- The `effort` field on `Task` exists but is not populated by any built-in logic.

The `scope_down_task` and `scope_up_task` tools adjust task scope using AI with strength levels (`light`, `regular`, `heavy`), but this is about conceptual scope, not context-window sizing.

**Notes:**
- An outer orchestrator could use complexity scores as a heuristic proxy (e.g., "complexity >= 7 means likely to exceed session budget"), but Taskmaster itself does not measure or enforce the 60% context utilization target.
- The `scope_down_task` tool is useful for manually reducing scope, but it has no awareness of context windows.

---

### 2. ~500 LOC PR cap

**Verdict: DOES NOT MEET**

**Evidence:**
Taskmaster has no concept of lines of code, PR size, or artifact boundaries. There is no field for estimated LOC, no validation against PR size, and no tooling to measure or constrain the output of a task in terms of code volume.

The `relevantFiles` metadata on `TaskImplementationMetadata` lists files with `action: 'create' | 'modify' | 'reference'`, but there is no size estimation.

**Notes:**
- PR boundary enforcement is fundamentally outside Taskmaster's scope. It is a task manager, not a PR sizing tool.
- An outer pipeline layer could estimate LOC from file lists and complexity scores, but Taskmaster provides no built-in support.

---

### 3. DAG decomposition

**Verdict: MEETS**

**Evidence:**
- Tasks declare explicit dependencies via `dependencies: string[]` (task IDs that must complete first).
- Subtasks also have `dependencies` arrays referencing sibling subtask IDs.
- The `validate_dependencies` MCP tool and CLI command detect circular references and invalid dependency targets.
- The `fix_dependencies` tool can auto-repair dependency issues.
- The `next_task` tool performs dependency-aware scheduling: it selects tasks where all dependencies are satisfied (status `done`), prioritized by priority level, dependency count, and task ID.
- `TasksDomain.getExecutionOrder()` computes topological ordering for subtasks.

The decomposition structure is: PRD -> Tasks (via `parse_prd`) -> Subtasks (via `expand_task`), with dependencies at both levels.

**Notes:**
- The DAG is well-formed. Tasks declare `dependencies` (what blocks them). The inverse (`blocks`) is not stored but is computable.
- The `expand_all` tool can expand all eligible tasks in complexity order (highest first), respecting the complexity report recommendations.
- There is no explicit `blocked_by` / `blocks` pair, only `dependencies`. An orchestrator would need to invert the graph to answer "what does task X block?"

---

### 4. Self-contained DONE contract

**Verdict: PARTIAL**

**Evidence:**
Every task has:
- `testStrategy`: A verification approach string (e.g., "Deploy and call endpoint to confirm 'Hello World' response").
- `acceptanceCriteria`: An array of strings defining completion conditions (from `TaskImplementationMetadata`).
- `details`: Implementation instructions.

The `SubtaskSchema` (`src/schemas/base-schemas.js`) includes `testStrategy: z.string().nullable()`.

Subtasks generated during expansion (e.g., in the live `tasks.json`) include `acceptanceCriteria` as bullet points.

**Notes:**
- `testStrategy` and `acceptanceCriteria` together form a reasonable DONE contract.
- However, "integration-test evidence" is not enforced. The TDD workflow orchestrator (autopilot) does execute tests and track RED/GREEN phases, but this is an optional workflow, not a substrate-level constraint.
- There is no mechanism to verify that the DONE contract was actually satisfied before marking a task as done. `set_task_status --status=done` succeeds regardless of whether tests passed.
- The `TaskEntity.canComplete()` method only checks that all subtasks are done/cancelled and that the task is not blocked -- it does not check test results.

---

### 5. Pre-dispatch plan validation

**Verdict: PARTIAL**

**Evidence:**
The `PreflightChecker` service (`packages/tm-core/src/modules/tasks/services/preflight-checker.service.ts`) performs environment validation:
- Detects test command from `package.json`
- Checks git working tree status
- Validates required tools (git, gh CLI)
- Detects default git branch

The `TaskImplementationMetadata` includes:
- `relevantFiles`: Files with paths, descriptions, and actions (`create`/`modify`/`reference`)
- `technicalConstraints`: Architecture decisions, framework requirements
- `scopeBoundaries`: What is in/out of scope
- `existingInfrastructure`: Services to leverage

**Notes:**
- The preflight checker validates *environment*, not *plan correctness against current code*.
- There is no grep-check of file paths, function signatures, or external assumptions against the live codebase before dispatch.
- `relevantFiles` provides the *information* needed for such validation, but no tool actually performs it.
- An orchestrator could implement pre-dispatch validation using `relevantFiles` paths + codebase grep, but Taskmaster does not do this natively.
- The `scope_down_task` and `scope_up_task` tools could be triggered when drift is detected, but drift detection itself is not implemented.

---

### 6. PR boundary = wave boundary

**Verdict: DOES NOT MEET**

**Evidence:**
Taskmaster has no concept of PRs, waves, or merge strategies. Tasks and subtasks are work items, not merge units. There is no mapping from tasks to PRs.

The autopilot workflow (`autopilot_start`, `autopilot_commit`, `autopilot_finalize`) does create git branches and commits per subtask in the TDD loop, and uses `git:commit:created` events, but:
- It commits per subtask within a single workflow, not per task across a pipeline.
- There is no PR creation or merge coordination.

**Notes:**
- The workflow orchestrator creates a branch per task and commits per subtask, which is closer to "PR per task" than "PR per wave," but this is only in the autopilot workflow.
- PR boundary enforcement would need to live in the orchestrator layer, not in Taskmaster.

---

### 7. Compaction as decomposition trigger

**Verdict: DOES NOT MEET**

**Evidence:**
There is no awareness of LLM compaction events anywhere in the Taskmaster codebase. The word "compaction" does not appear in the source code. There is no mechanism to count compaction events, detect them, or use them as triggers.

**Notes:**
- This requirement is specific to the pipeline's compaction-aware design. Taskmaster operates at a different abstraction level.
- An outer orchestrator could detect compaction and invoke `scope_down_task` or `expand_task`, but Taskmaster itself has no hooks for this.

---

### 8. Iterative planning

**Verdict: PARTIAL**

**Evidence:**
The recommended workflow (documented in `.taskmaster/CLAUDE.md` and `docs/task-structure.md`) is explicitly iterative:

1. Create PRD -> `parse_prd` generates initial tasks
2. `analyze_complexity` scores all tasks
3. `expand_task` or `expand_all` breaks complex tasks into subtasks (using complexity report recommendations)
4. `update` or `update_task` refines tasks based on new context
5. `scope_down_task` / `scope_up_task` adjusts scope
6. Repeat as understanding deepens

The complexity analysis creates a `task-complexity-report.json` that drives subsequent expansion. The `expand_task` tool automatically uses this report's recommended subtask count and expansion prompt.

**Notes:**
- This is iterative planning in spirit: analyze, decompose, refine, repeat.
- However, there are no explicit "re-planning gates" -- no checkpoint where the system pauses and says "you should re-plan before continuing."
- The `update --from=<id>` command bulk-updates all tasks from a given ID forward, which is a re-planning mechanism, but it's manually triggered.
- The `complexity_report` tool provides a "review point" but does not enforce a gate.

---

### 9. Status rollup

**Verdict: MEETS**

**Evidence:**
The `FileStorage.updateSubtaskStatusInFile()` method (`packages/tm-core/src/modules/storage/adapters/file-storage/file-storage.ts`, line 499) implements automatic parent status rollup:

```
if (allDone) parentNewStatus = 'done';
else if (anyInProgress || anyDone) parentNewStatus = 'in-progress';
else if (allPending) parentNewStatus = 'pending';
```

When any subtask status changes, the parent task status is automatically adjusted:
- All subtasks done -> parent done
- Any subtask in-progress or done -> parent in-progress
- All subtasks pending -> parent pending

The `TaskEntity.canComplete()` method prevents marking a parent as done if any subtask is incomplete.

**Notes:**
- This is robust two-level rollup (subtask -> parent task).
- There is no rollup beyond two levels because the substrate is only task/subtask deep (no sub-subtasks, no epic/story/task hierarchy).
- For the pipeline, this means the orchestrator can observe parent task status to know when all subtasks in a work unit are complete.

---

### 10. Risk-dictated gate shape

**Verdict: DOES NOT MEET**

**Evidence:**
There is no concept of risk level, gate shape, or differentiated validation based on risk in Taskmaster.

The `priority` field (`low | medium | high | critical`) is about scheduling priority, not risk.
The `complexity` field (1-10 score) measures implementation difficulty, not risk.

**Notes:**
- The pipeline requirement is that higher-risk tasks get stricter gates (e.g., mandatory review, integration tests). Taskmaster does not model risk or gates.
- An orchestrator could use `priority` or `complexity` as risk proxies and apply different gates externally, but Taskmaster provides no native support.

---

### 11. Triage funnel

**Verdict: PARTIAL**

**Evidence:**
The task lifecycle starts with `status: 'pending'` for all new tasks. The status progression is:
`pending -> in-progress -> review -> done` (or `deferred`/`cancelled`/`blocked` as lateral transitions).

The `parse_prd` tool generates tasks directly in `pending` status from a PRD document.
The `add_task` tool creates tasks via AI or manual input, also in `pending` status.

There is no `triage`, `intake`, `idea`, or `raw` status. The `deferred` status is the closest to a parking lot.

**Notes:**
- All new items are immediately tasks in `pending` status. There is no intermediate stage for raw ideas, problems, or feature requests that need evaluation before becoming actionable tasks.
- The `status` enum could be extended with a `triage` value, but this is not built in.
- An outer pipeline could implement triage by using a dedicated tag (e.g., `triage`) and moving tasks to `master` after evaluation, using the `move_task` cross-tag capability.

---

### 12. Coarse-to-fine decomposition cap

**Verdict: PARTIAL**

**Evidence:**
The substrate enforces a maximum decomposition depth of 2 levels:
1. Tasks (top level)
2. Subtasks (children of tasks)

The `Subtask` interface explicitly prevents further nesting: `subtasks?: never` (in `packages/tm-core/src/common/types/index.ts`).

The `expand_task` tool generates subtasks for a task, but there is no "expand subtask" capability -- subtasks cannot be further decomposed.

**Notes:**
- The 2-level cap is hardcoded in the type system, not configurable.
- For the pipeline, this means any task that needs more than one level of decomposition must be restructured: a complex subtask would need to be promoted to a task (via `scope_up_task` or `move_task`) and then expanded.
- This is a reasonable bound for preventing infinite decomposition, but it's not a configurable maximum depth -- it's a fixed architectural limit.

---

### 13. Parallelizable by default

**Verdict: MEETS**

**Evidence:**
- The `parse_prd` tool generates tasks with explicit dependency declarations. Tasks without dependencies on each other are implicitly parallel.
- The `expand_task` tool generates subtasks with dependencies. Subtasks without mutual dependencies can run in parallel.
- The `next_task` tool finds tasks with all dependencies satisfied, which implicitly identifies parallelizable work.
- The complexity analysis processes tasks in order of complexity (highest first), but execution order respects dependencies.

The `dependencies: []` default means tasks are parallelizable unless explicitly constrained.

**Notes:**
- Taskmaster does not explicitly label tasks as "parallelizable." Instead, the DAG structure implicitly determines parallelism: any two tasks whose dependency chains do not intersect can run concurrently.
- An orchestrator can identify all "ready" tasks (pending, all deps satisfied) at any point and dispatch them in parallel.
- The tag system provides additional isolation for parallel development contexts.

---

### 14. Validated scope before dispatch

**Verdict: PARTIAL**

**Evidence:**
The `TaskImplementationMetadata` (populated during AI-driven task creation/expansion) includes:
- `relevantFiles`: Array of `{ path, description, action }` -- files to create, modify, or reference
- `acceptanceCriteria`: Array of completion conditions
- `scopeBoundaries`: `{ included, excluded }` -- what is in/out of scope
- `technicalConstraints`: Architecture decisions and limitations
- `implementationApproach`: Step-by-step guidance
- `codebasePatterns`: Code conventions to follow
- `existingInfrastructure`: Services to leverage
- `skills`: Required technical skills
- `category`: Work category (research, design, development, etc.)

The `details` field provides implementation instructions.
The `testStrategy` field defines verification approach.

**Notes:**
- The *information* needed for validated scope is present: inputs (`relevantFiles` with `reference`), outputs (`relevantFiles` with `create`/`modify`), affected files, acceptance criteria.
- However, no tool *validates* this information against the live codebase before dispatch. The `PreflightChecker` only checks environment prerequisites (git, tools), not task scope.
- An orchestrator could use `relevantFiles` paths to grep-check file existence and signature compatibility, but this validation is not built in.
- The `scope_down_task` tool can reduce scope if validation fails, but it requires manual triggering.

---

## Surprises

1. **Complexity analysis is more sophisticated than expected.** The `analyze_project_complexity` tool uses AI (optionally with Perplexity research) to score each task 1-10, recommend subtask counts, and generate tailored expansion prompts. The complexity report (`task-complexity-report.json`) is then consumed by `expand_task` to auto-calibrate decomposition. This is a genuine complexity-driven decomposition pipeline, even if it doesn't measure context-window fit.

2. **Scope adjustment tools exist.** `scope_down_task` and `scope_up_task` are unusual features that allow AI-driven scope reduction or expansion with configurable strength (`light`/`regular`/`heavy`). This is valuable for iterative sizing even without formal LOC caps.

3. **The autopilot workflow is surprisingly complete.** The `autopilot_*` MCP tools (`start`, `resume`, `next`, `status`, `complete`, `commit`, `finalize`, `abort`) implement a full TDD workflow with RED/GREEN/COMMIT phases, branch management, test validation, and subtask iteration. This goes well beyond task management into execution orchestration.

4. **Parent status auto-adjustment is automatic.** Setting a subtask to `done` automatically checks if all siblings are done and promotes the parent to `done`. Setting a subtask to `in-progress` promotes the parent to `in-progress`. This removes manual bookkeeping from the orchestrator.

5. **The `generate` MCP tool exists** (registered in tool-registry.js from `@tm/mcp`) but was not examined in detail. It may provide code generation capabilities that could relate to PR sizing.

---

## Open Questions for Trial

1. **How well does complexity score correlate with actual context utilization?** If complexity 8 tasks consistently require 80% of context window, the score could serve as a proxy for session fit. This needs empirical testing.

2. **Can `scope_down_task` reliably reduce tasks to single-session size?** If an orchestrator detects a task is too large (via complexity score or failed execution), can iterative `scope_down_task` calls bring it to a manageable size?

3. **How does `expand_all` handle already-expanded tasks?** If re-run after partial completion, does it skip tasks with existing subtasks, or does it require `--force`?

4. **Can the autopilot workflow be used as a component?** The workflow orchestrator has event listeners, state persistence, and a state machine. Can an XState orchestrator delegate to it for task execution, or does it need to be replaced entirely?

5. **What does the `generate` MCP tool do?** If it generates implementation code, it may provide LOC estimates or code structure that could feed into PR sizing.

6. **How does `acceptanceCriteria` interact with the TDD workflow?** Does the autopilot use acceptance criteria to determine when a subtask is truly done, or does it rely solely on test results?

7. **Can the DAG be extracted as a machine-readable graph?** For XState orchestrator integration, the dependency graph needs to be consumable as a data structure, not just queryable via `next_task`.

---

## Source Index

| File | What was examined |
|------|-------------------|
| `packages/tm-core/src/common/types/index.ts` | Task, Subtask, TaskImplementationMetadata, RelevantFile, ScopeBoundaries interfaces |
| `packages/tm-core/src/modules/tasks/entities/task.entity.ts` | TaskEntity -- canComplete(), updateStatus(), addSubtask() |
| `packages/tm-core/src/modules/tasks/tasks-domain.ts` | TasksDomain facade -- expand(), getNext(), getExecutionOrder(), runPreflightChecks() |
| `packages/tm-core/src/modules/tasks/services/task-execution-service.ts` | StartTaskOptions, conflict checking, execution command preparation |
| `packages/tm-core/src/modules/tasks/services/preflight-checker.service.ts` | PreflightChecker -- test command detection, git checks, tool validation |
| `packages/tm-core/src/modules/storage/adapters/file-storage/file-storage.ts` | updateSubtaskStatusInFile() -- parent status rollup logic |
| `packages/tm-core/src/modules/workflow/types.ts` | WorkflowPhase, TDDPhase, WorkflowEvent, SubtaskInfo |
| `packages/tm-core/src/modules/workflow/workflow-domain.ts` | WorkflowDomain -- start(), completePhase(), finalize() |
| `packages/tm-core/src/modules/workflow/services/workflow.service.ts` | WorkflowService -- startWorkflow(), getNextAction() |
| `packages/tm-core/src/modules/workflow/orchestrators/workflow-orchestrator.ts` | State machine transitions, TDD phase handling, event emission |
| `packages/tm-core/src/modules/workflow/managers/workflow-state-manager.ts` | Workflow state persistence |
| `packages/tm-core/src/modules/reports/types.ts` | ComplexityAnalysis, ComplexityReport types |
| `packages/tm-core/src/modules/loop/loop-domain.ts` | LoopDomain -- run(), sandbox auth |
| `src/schemas/base-schemas.js` | BaseTaskSchema, SubtaskSchema (Zod) |
| `src/schemas/parse-prd.js` | PRD parsing response schema |
| `src/schemas/analyze-complexity.js` | ComplexityAnalysisItemSchema, ComplexityAnalysisResponseSchema |
| `src/schemas/expand-task.js` | ExpandTaskResponseSchema |
| `src/schemas/add-task.js` | AddTaskResponseSchema |
| `src/constants/task-status.js` | TaskStatus enum and validation |
| `mcp-server/src/tools/tool-registry.js` | Full tool registry -- 46 tools |
| `mcp-server/src/tools/analyze.js` | analyze_project_complexity MCP tool |
| `mcp-server/src/tools/expand-task.js` | expand_task MCP tool |
| `mcp-server/src/tools/expand-all.js` | expand_all MCP tool |
| `mcp-server/src/tools/next-task.js` | next_task MCP tool |
| `mcp-server/src/tools/set-task-status.js` | set_task_status MCP tool |
| `mcp-server/src/tools/scope-down.js` | scope_down_task MCP tool |
| `mcp-server/src/tools/scope-up.js` | scope_up_task MCP tool |
| `mcp-server/src/tools/parse-prd.js` | parse_prd MCP tool |
| `mcp-server/src/tools/validate-dependencies.js` | validate_dependencies MCP tool |
| `mcp-server/src/tools/update.js` | update (bulk) MCP tool |
| `mcp-server/src/tools/add-task.js` | add_task MCP tool |
| `mcp-server/src/tools/move-task.js` | move_task MCP tool (cross-tag support) |
| `docs/task-structure.md` | Task structure, complexity analysis, expansion workflow |
| `.taskmaster/reports/task-complexity-report.json` | Sample complexity report |
| `.taskmaster/CLAUDE.md` | Agent integration guide, recommended workflow |
| `CLAUDE.md` | Architecture guidelines, tm-core separation |

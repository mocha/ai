# Domain 2a: Task Management — Plan Amendments

Amendments to the task management plan (`02-task-management.md`) based on
pressure-testing against the orchestrator amendments spec
(`02a-orchestrator-amendments.md`), framework evaluations, and
task-complexity research. These changes extend the existing plan; they do
not replace it.

---

## 1. Unified QUERY_RESULT response

### Problem

The plan defines separate `TaskReadyEvent` and `StatusRollupEvent` types.
Task 4's `queryNextTask()` returns `TaskReadyEvent | null`, treating
null as "all tasks complete or blocked." The orchestrator amendments
(spec 02a, Section 5) replace this with a three-way `QUERY_RESULT` event
that distinguishes `task_ready`, `all_complete`, and `all_blocked`. Without
the three-way discrimination, the orchestrator cannot route `all_blocked`
to `escalate_blocked` — it wedges in `next_task` until a timeout fires.

### Changes

#### Task 2: Replace TaskReadyEvent with QueryResultEvent

Remove `TaskReadyEvent` from the type definitions. Add:

```typescript
interface QueryResultEvent {
  type: 'QUERY_RESULT';
  outcome: 'task_ready' | 'all_complete' | 'all_blocked';
  task?: TaskPayload;              // present when outcome === 'task_ready'
  blocked_task_ids?: number[];     // present when outcome === 'all_blocked'
  blocked_reasons?: string[];      // present when outcome === 'all_blocked'
}
```

`StatusRollupEvent` is retained — it is still emitted by the status
bridge (Task 5) and consumed globally by the orchestrator for context
counter updates. It is no longer load-bearing for routing in
`develop.next_task`.

#### Task 4: Rewrite queryNextTask()

Replace the `queryNextTask(): Promise<TaskReadyEvent | null>` signature
with:

```typescript
async function queryNextTask(): Promise<QueryResultEvent>;
```

Implementation:

```
1. Call nextTask() via MCP client
2. If task returned:
   → return { type: 'QUERY_RESULT', outcome: 'task_ready', task }
3. If null returned:
   a. Call getTasks() to get all tasks
   b. Filter to non-terminal tasks (status not in ['done', 'cancelled'])
   c. If no non-terminal tasks remain:
      → return { type: 'QUERY_RESULT', outcome: 'all_complete' }
   d. If non-terminal tasks exist but none are ready:
      - For each non-terminal pending task, check which dependencies
        are unsatisfied (call queryBlockers)
      → return {
          type: 'QUERY_RESULT',
          outcome: 'all_blocked',
          blocked_task_ids: [...],
          blocked_reasons: [...]    // e.g., "TASK-003 blocked by TASK-002 (status: blocked)"
        }
```

The `blocked_reasons` array should be human-readable strings that the
orchestrator can forward directly to the user in `escalate_blocked`.

#### Task 4: Remove querySpecProgress (scope reduction)

`querySpecProgress` was a convenience function not consumed by any
orchestrator state. Remove it to keep the API surface minimal.
Re-introduce if a consumer emerges.

Retained query functions:
- `queryNextTask()` — primary dispatch query (amended above)
- `queryBlockers(taskId)` — used internally by queryNextTask and useful
  for diagnostics
- `queryStatusRollup(parentId)` — consumed by Task 5 status bridge

---

## 2. Artifact-level sizing

### Problem

The orchestrator amendments (spec 02a, Section 1) introduce mechanical
sizing gates (`size_check_pre_spec`, `size_check_pre_plan`) that need
three metrics computed from spec/plan markdown files: prose token count,
prose line count, and file blast radius. The plan's Task 6 only handles
task-level sizing (complexity scores, LOC from relevantFiles).

The artifact *splitting* — breaking an oversized spec into smaller specs
or a plan into smaller plans — is a Skylark artifact convention operation
(Layer 4). But the mechanical sizing check belongs in Layer 3, alongside
the existing task-sizing logic.

### Changes

#### Task 6: Add checkArtifactSize()

Add to the sizing enforcement module:

```typescript
interface ArtifactSizingResult {
  token_count: number;           // prose tokens (excluding code blocks)
  prose_line_count: number;      // hard-wrapped lines (excluding code blocks)
  file_blast_radius: number;     // distinct files referenced in artifact
  verdict: 'under' | 'over' | 'ambiguous';
}

interface ArtifactSizingThresholds {
  max_prose_tokens: number;      // default: 2500
  max_prose_lines: number;       // default: 200
  max_file_blast_radius: number; // default: 4
}

async function checkArtifactSize(
  artifactPath: string,
  thresholds?: Partial<ArtifactSizingThresholds>
): Promise<ArtifactSizingResult>;
```

Implementation:

```
1. Read the artifact file from disk
2. Parse: separate YAML frontmatter, prose sections, and code blocks
3. Token count: count tokens in prose sections only (exclude fenced
   code blocks, JSON examples, YAML frontmatter). Use a simple
   whitespace tokenizer (word count * 1.3) — this is a heuristic
   gate, not a billing calculation.
4. Prose line count: count non-blank lines in prose sections only
5. File blast radius: count distinct file paths referenced in the
   artifact body (match patterns like `src/...`, `*.ts`, backtick-
   quoted paths)
6. Verdict:
   - All metrics strictly below thresholds → 'under'
   - Any metric exceeds its threshold → 'over'
   - Any metric within 80-100% of its threshold → 'ambiguous'
     (the orchestrator dispatches a Haiku evaluation for ambiguous)
```

The thresholds are configurable via the function parameter, with
defaults matching the orchestrator amendments spec (2500 tokens,
200 lines, 4 files). The orchestrator reads overrides from
`.skylark/config.json` (`sizing.max_prose_tokens`, etc.) and passes
them through.

#### Task 6: Updated acceptance criteria

Add:

- [ ] `checkArtifactSize(path)` returns `verdict: 'over'` for a spec file exceeding 2500 prose tokens
- [ ] `checkArtifactSize(path)` excludes fenced code blocks from token and line counts
- [ ] `checkArtifactSize(path)` counts file references in the artifact body
- [ ] Thresholds are configurable via function parameter with sensible defaults

#### Task 3: Document DECOMPOSE_ARTIFACT interface

Add to Task 3's description a documented interface for artifact-level
decomposition. Task 3 does NOT implement the splitting logic — that
belongs in the Layer 4 plan (Domain 4: Review and Expert). Task 3
documents the contract:

```typescript
// Layer 3 provides the sizing check (checkArtifactSize, Task 6).
// Layer 4 provides the splitting logic.
//
// When the orchestrator's size_check_pre_spec gate returns 'over':
//   1. Orchestrator sends DECOMPOSE_ARTIFACT to Layer 4
//   2. Layer 4 reads the artifact, splits it into sub-artifacts
//      following Skylark artifact conventions (new SPEC-NNN IDs,
//      frontmatter with parent reference to original)
//   3. Layer 4 returns sub-artifact paths to orchestrator
//   4. Each sub-artifact re-enters the pipeline at triage
//
// The DECOMPOSE_ARTIFACT command:
interface DecomposeArtifactCommand {
  type: 'DECOMPOSE_ARTIFACT';
  artifact_path: string;
  artifact_type: 'spec' | 'plan';
  reason: 'size_gate_mechanical' | 'size_gate_haiku' | 'agent_recommended';
  sizing_result?: ArtifactSizingResult;
}
//
// This command is handled by Layer 4, not Layer 3.
// Layer 3's contribution is checkArtifactSize() which provides
// the sizing_result that triggers the command.
```

---

## 3. File blast radius as independent task decomposition gate

### Problem

The plan uses complexity > 7 as the sole trigger for task decomposition.
SWE-Bench research shows multi-file edits are a cliff in agent success
rates: only 3.09% of easy tasks require multi-file changes, but 55.56%
of hard tasks do. File blast radius is an independent predictor of
failure that the complexity score does not always capture — a task with
complexity 5 that touches 6 files still needs decomposition.

### Changes

#### Task 6: Add file blast radius check to checkTaskSize()

Update the `checkTaskSize` algorithm. After step 2 (complexity check),
add:

```
2a. Count files in relevantFiles with action 'create' or 'modify'
    (exclude 'reference')
    If count >= FILE_BLAST_RADIUS_THRESHOLD (default: 4):
      recommendation = 'decompose'
      reason = 'file blast radius >= 4 (multi-file cliff)'
```

Add to `SIZING_CONSTANTS`:

```typescript
const SIZING_CONSTANTS = {
  // ... existing constants ...
  FILE_BLAST_RADIUS_THRESHOLD: 4,  // SWE-Bench: cliff at multi-file changes
} as const;
```

The file blast radius check fires independently of complexity. A task
can have complexity 4 but still trigger decomposition if it touches 4+
files. The two signals are complementary: complexity measures conceptual
difficulty, blast radius measures coordination surface.

#### Task 6: Updated acceptance criteria

Add:

- [ ] `checkTaskSize(task)` returns `'decompose'` for tasks with 4+ non-reference files in relevantFiles, regardless of complexity score

---

## 4. Over-decomposition guardrail

### Problem

Research warns that over-decomposition increases coordination overhead
and compounds error probability (0.95^N per step). The plan has no
floor on task size — nothing prevents decomposing a complexity-3 task
into 5 subtasks that are each trivially small, creating integration
risk without reducing execution risk.

### Changes

#### Task 6: Add minimum complexity floor to checkTaskSize()

Update the `checkTaskSize` algorithm. Before the complexity > 7 check,
add:

```
1a. If complexity <= COMPLEXITY_FLOOR (default: 3):
      recommendation = 'dispatch'
      reason = 'complexity below floor — already atomic'
      (skip all further sizing checks; return immediately)
```

Add to `SIZING_CONSTANTS`:

```typescript
const SIZING_CONSTANTS = {
  // ... existing constants ...
  COMPLEXITY_FLOOR: 3,  // below this, never decompose further
} as const;
```

The floor is a soft guardrail: it blocks automatic decomposition via
`checkTaskSize`, but does not prevent manual `expand_task` calls. The
orchestrator respects the recommendation; a human can override.

#### Task 3: Respect the floor in the decomposition wrapper

In `decompose.ts` step 3 ("For each task with complexity >
COMPLEXITY_DECOMPOSE_THRESHOLD"), add the inverse guard:

```
3. For each task:
   a. If complexity <= COMPLEXITY_FLOOR: skip (already atomic)
   b. If complexity > COMPLEXITY_DECOMPOSE_THRESHOLD:
      expand as before
```

#### Task 6: Updated acceptance criteria

Add:

- [ ] `checkTaskSize(task)` returns `'dispatch'` immediately for tasks with complexity <= 3, skipping all further checks

---

## 5. Subtask promotion as compaction fallback

### Problem

When a subtask triggers compaction (too complex for one session) but is
at Taskmaster's depth limit (subtasks cannot have sub-subtasks), the
only option is promoting it to a standalone task. The plan's compaction
handler calls `expandTask` but does not handle the case where the
target is already a subtask.

### Changes

#### Task 6: Add promoteSubtask() to compaction handler

Add to the sizing module:

```typescript
async function promoteSubtask(subtaskId: string): Promise<TaskPayload>;
```

Implementation:

```
1. Parse subtaskId (dot notation, e.g., "3.2")
2. Get the parent task via getTask(parentId)
3. Find the subtask in parent.subtasks
4. Create a new top-level task via createTask() with:
   - title, description, details, testStrategy copied from subtask
   - dependencies: [parentId]  (must complete after parent's other subtasks)
   - relevantFiles: copied from subtask or inherited from parent
   - tags: ['promoted-from:' + subtaskId]
5. Mark the original subtask as 'cancelled' via setTaskStatus()
6. Update the original subtask's details with a reference:
   "Promoted to TASK-{newId} — subtask exceeded depth limit"
7. Return the new top-level task
```

Update `handleCompaction`:

```
1. Get the task via getTask(signal.task_id)
2. If task is a subtask (has parentId or dot-notation ID):
   a. Call promoteSubtask(signal.task_id)
   b. Then call expandTask on the new top-level task
3. Else (top-level task):
   a. Call expandTask(signal.task_id) as before
4. Return DECOMPOSITION_COMPLETE event
```

#### Task 6: Updated acceptance criteria

Add:

- [ ] `promoteSubtask("3.2")` creates a new top-level task with the subtask's content
- [ ] `promoteSubtask` marks the original subtask as cancelled with a reference to the new task
- [ ] `handleCompaction` calls `promoteSubtask` when the compacted task is a subtask

---

## 6. Vertical slice guidance in decomposition prompts

### Problem

Research shows vertical slice decomposition (end-to-end through all
layers) produces better subtask boundaries than horizontal decomposition
(all database, then all service, then all API). LLMs naturally produce
horizontal slices unless instructed otherwise.

### Changes

#### Task 3: Add prompt guidance to expandTask calls

This is not a structural change. When calling `expandTask` in the
decomposition wrapper, include a prompt parameter:

```typescript
await expandTask(taskId, {
  numSubtasks: subtaskCount,
  prompt: `Decompose into vertical slices. Each subtask should deliver
end-to-end value through all affected layers (e.g., database + service
+ API + test for one feature slice), not horizontal slices across one
layer (e.g., all database changes, then all service changes). If the
task only touches one layer, this guidance does not apply.`
});
```

No new acceptance criteria. This is implementation guidance for Task 3's
existing flow.

---

## 7. Updated integration points table

### Problem

The integration points table at the bottom of the plan lists
`TASK_READY` and `STATUS_ROLLUP` in `develop.next_task` with the
`allTasksComplete` guard. Per the orchestrator amendments, both are
replaced by `QUERY_RESULT` for routing. `STATUS_ROLLUP` is retained
as a global notification only.

### Changes

Replace the "Events this domain emits" table:

| Event | Emitted by | Consumed at orchestrator state |
|-------|------------|-------------------------------|
| `DECOMPOSITION_COMPLETE` | `decompose()` | `develop.decompose` -> `develop.next_task` |
| `QUERY_RESULT` | `queryNextTask()` | `develop.next_task` -> routes on outcome: `task_ready` -> `generate_expert`, `all_complete` -> `finish_develop`, `all_blocked` -> `escalate_blocked` |
| `STATUS_ROLLUP` | `updateTaskStatus()` | Global handler — updates `context.tasks_complete` counter. Not load-bearing for routing. |

Replace the "Commands this domain receives" table:

| Command | Handler | Dispatched from orchestrator state |
|---------|---------|-----------------------------------|
| `DECOMPOSE` | `decompose()` | `develop.decompose` entry action |
| `QUERY_NEXT_TASK` | `queryNextTask()` | `develop.next_task` entry action, also after `SHIP` verdict |
| `UPDATE_TASK_STATUS` | `updateTaskStatus()` | `develop.route_verdict` (`markTaskDone` action) |

Add to "Interfaces with other domains":

| Domain | Interface | Direction |
|--------|-----------|-----------|
| Domain 1 (Orchestrator) | Orchestrator calls `checkArtifactSize()` from `size_check_pre_spec` and `size_check_pre_plan` states | Orchestrator -> This domain |
| Domain 4 (Review/Expert) | `DECOMPOSE_ARTIFACT` dispatched by orchestrator, handled by Layer 4. Layer 3 provides sizing data only. | Orchestrator -> Layer 4 (documented here for contract clarity) |

---

## 8. Updated build order

The build order is unchanged. The amendments add functions to existing
tasks, not new tasks:

- **Task 2**: Add `QueryResultEvent`, `DecomposeArtifactCommand`,
  `ArtifactSizingResult`, `ArtifactSizingThresholds` types. Add
  `FILE_BLAST_RADIUS_THRESHOLD` and `COMPLEXITY_FLOOR` to
  `SIZING_CONSTANTS`.
- **Task 3**: Add vertical slice prompt guidance. Add
  complexity floor guard. Document `DECOMPOSE_ARTIFACT` interface
  contract (Layer 4 responsibility).
- **Task 4**: Rewrite `queryNextTask()` to return `QueryResultEvent`.
  Remove `querySpecProgress()`.
- **Task 6**: Add `checkArtifactSize()`, file blast radius check,
  complexity floor, `promoteSubtask()`, promote-then-expand path in
  `handleCompaction`.
- **Task 8**: Smoke test should verify the three-way `QUERY_RESULT`
  outcomes (task_ready, all_complete, all_blocked).

No new tasks. No change to the dependency graph. Estimated scope
increase: small — each amendment is additive to an existing task.

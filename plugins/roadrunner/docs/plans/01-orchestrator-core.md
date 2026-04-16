# Domain 1: Orchestrator Core -- Implementation Plan

The XState v5 state machine that coordinates the Skylark pipeline. This
is the first domain to build. It is testable in isolation with mock
events before any other domain exists.

---

## Build Order Summary

| # | Task | Depends On | Scope |
|---|------|-----------|-------|
| 1 | Project scaffolding | -- | small |
| 2 | Event type definitions | 1 | medium |
| 3 | Command type definitions | 1 | medium |
| 4 | Context and shared types | 1 | small |
| 5 | Guard functions | 4 | medium |
| 6 | Action functions (stubs) | 2, 3, 4 | medium |
| 7 | XState machine definition | 5, 6 | large |
| 8 | Persistence wrapper | 4 | medium |
| 9 | Event bus and command dispatcher | 2, 3 | small |
| 10 | CLI entry point | 7, 8, 9 | medium |
| 11 | Unit tests: guards | 5 | medium |
| 12 | Unit tests: machine transitions | 7 | large |
| 13 | Unit tests: persistence | 8 | medium |
| 14 | Integration test: full pipeline walkthrough | 7, 8, 9 | medium |

Total: ~14 tasks. Tasks 11-14 can be built incrementally alongside
their subjects but are listed separately for sequencing clarity.

---

## Task 1: Project scaffolding

### Description

Set up the TypeScript project with XState v5 as the only runtime
dependency. This creates the directory structure, package.json
dependencies, tsconfig, and a build script. Everything else builds on
top of this.

### Files to create

- `plugins/skylark/src/orchestrator/` -- directory
- `plugins/skylark/tsconfig.json`
- `plugins/skylark/package.json` -- modify (add dependencies and scripts)

### Acceptance criteria

- `npm install` completes without errors.
- `npx tsc --noEmit` passes with zero errors on an empty barrel file
  (`src/orchestrator/index.ts` exporting nothing).
- `package.json` has `xstate` ^5.x as a dependency.
- `package.json` has `vitest` and `typescript` as devDependencies.
- `tsconfig.json` targets ES2022, uses NodeNext module resolution,
  enables strict mode, sets `outDir` to `dist/`, `rootDir` to `src/`.
- `package.json` scripts include `build` (`tsc`), `test`
  (`vitest run`), and `test:watch` (`vitest`).

### Dependencies

None.

### Estimated scope

Small (< 100 LOC of config files).

---

## Task 2: Event type definitions

### Description

Define the TypeScript discriminated union of all events the
orchestrator receives. Each event is a member keyed on `type`. These
types are the input contract for the state machine -- every other
domain will import them to construct events.

Also includes `COMPACTION_DETECTED` from Layer 7 (context
engineering), which is consumed by the orchestrator as a task-sizing
signal triggering re-decomposition.

### Files to create

- `plugins/skylark/src/orchestrator/events.ts`

### Implementation details

Define these event interfaces and export a discriminated union:

```typescript
// From Layer 1 (Triage)
interface TriageComplete {
  type: 'TRIAGE_COMPLETE';
  input_type: InputType;
  risk: RiskLevel;
  path: Stage[];
  existing_artifact: ArtifactRef | null;
  external_ref: string | null;
  decompose: boolean;
  domain_clusters: string[];
}

// From Layer 3 (Task Substrate)
interface TaskReady {
  type: 'TASK_READY';
  task_id: number;
  task: TaskSpec;
}

interface DecompositionComplete {
  type: 'DECOMPOSITION_COMPLETE';
  task_count: number;
  task_ids: number[];
  domains: string[];
}

interface StatusRollup {
  type: 'STATUS_ROLLUP';
  parent_id: number;
  children_complete: number;
  children_total: number;
  all_complete: boolean;
}

// From Layer 4 (Expert Generation)
interface ExpertReady {
  type: 'EXPERT_READY';
  task_id: number;
  expert_prompt_path: string;
  drift_check: 'pass' | 'fail';
  drift_details: string | null;
}

// From Layer 4 (Review)
interface ReviewComplete {
  type: 'REVIEW_COMPLETE';
  task_id: number;
  verdict: 'SHIP' | 'REVISE' | 'RETHINK';
  round: number;
  report_path: string;
  findings: ReviewFinding[];
}

// From Layer 5 (Worker Execution)
interface WorkerComplete {
  type: 'WORKER_COMPLETE';
  task_id: number;
  status: 'DONE' | 'DONE_WITH_CONCERNS' | 'NEEDS_CONTEXT' | 'BLOCKED';
  result_path: string;
  cost_usd: number;
  duration_ms: number;
  files_changed: string[];
  concerns: string | null;
}

// From Layer 7 (Context Engineering)
interface CompactionDetected {
  type: 'COMPACTION_DETECTED';
  task_id: number;
  session_id: string;
  utilization_at_compaction: number;
}

// From User
interface UserApprove {
  type: 'USER_APPROVE';
  stage: string;
  decision: 'proceed' | 'abort';
}

interface UserEscalationResponse {
  type: 'USER_ESCALATION_RESPONSE';
  task_id: number;
  action: 'retry' | 'skip' | 'abort';
}

// Internal
interface Start {
  type: 'START';
  input: { type: string; content: string; user_risk_override: RiskLevel | null };
}

interface PrepareComplete {
  type: 'PREPARE_COMPLETE';
  spec_path: string;
}

interface BrainstormComplete {
  type: 'BRAINSTORM_COMPLETE';
  spec_path: string;
}

interface PlanComplete {
  type: 'PLAN_COMPLETE';
  plan_path: string;
}

interface FinishComplete {
  type: 'FINISH_COMPLETE';
  summary: string;
}

interface DispatchError {
  type: 'DISPATCH_ERROR';
  failed_command: string;
  error_message: string;
}

type OrchestratorEvent =
  | Start
  | TriageComplete
  | TaskReady
  | DecompositionComplete
  | StatusRollup
  | ExpertReady
  | ReviewComplete
  | WorkerComplete
  | CompactionDetected
  | UserApprove
  | UserEscalationResponse
  | PrepareComplete
  | BrainstormComplete
  | PlanComplete
  | FinishComplete
  | DispatchError;
```

Also define the `ReviewFinding` and `TaskSpec` sub-types:

```typescript
interface ReviewFinding {
  severity: string;
  description: string;
  file: string;
  line: number;
}

interface TaskSpec {
  id: number;
  title: string;
  dependencies: number[];
  status: string;
  details: string;
  acceptanceCriteria: string[];
  relevantFiles: string[];
}
```

### Acceptance criteria

- File compiles with `npx tsc --noEmit`.
- The `OrchestratorEvent` union covers all 16 event types listed above.
- Each event interface has the exact fields from the spec (Section 3
  of `02-orchestrator.md`), plus `COMPACTION_DETECTED` from
  `07-context-engineering.md`.
- `TaskSpec` and `ReviewFinding` are exported separately for reuse.
- No runtime code -- types only.

### Dependencies

Task 1.

### Estimated scope

Medium (100-300 LOC).

---

## Task 3: Command type definitions

### Description

Define TypeScript types for all commands the orchestrator dispatches
to other layers. These are the output contract. Layer handlers (stubs
for now) will receive these typed payloads.

### Files to create

- `plugins/skylark/src/orchestrator/commands.ts`

### Implementation details

```typescript
interface RunTriage {
  type: 'RUN_TRIAGE';
  input: { type: string; content: string; user_risk_override: RiskLevel | null };
}

interface Decompose {
  type: 'DECOMPOSE';
  spec_path: string;
  risk: RiskLevel;
}

interface QueryNextTask {
  type: 'QUERY_NEXT_TASK';
  filter: { status: 'pending'; dependencies_met: true };
}

interface UpdateTaskStatus {
  type: 'UPDATE_TASK_STATUS';
  task_id: number;
  status: TaskStatus;
}

interface GenerateExpert {
  type: 'GENERATE_EXPERT';
  task_id: number;
  task: TaskSpec;
  risk: RiskLevel;
  codebase_context: {
    entry_points: string[];
    recent_changes: string[];
    related_tests: string[];
  };
}

interface RunReview {
  type: 'RUN_REVIEW';
  task_id: number;
  worktree_path: string;
  task_spec: TaskSpec;
  worker_result: WorkerResult;
  risk: RiskLevel;
  round: number;
}

interface DispatchWorker {
  type: 'DISPATCH_WORKER';
  task_id: number;
  expert_prompt_path: string;
  task_spec: TaskSpec;
  worktree_branch: string;
  max_turns: number;
  model: 'sonnet' | 'opus';
}

interface RequestApproval {
  type: 'REQUEST_APPROVAL';
  stage: string;
  summary: string;
  risk: RiskLevel;
}

interface Escalate {
  type: 'ESCALATE';
  task_id: number;
  reason: string;
  options: Array<'retry' | 'skip' | 'abort'>;
}

// Re-decompose a task that triggered compaction
interface RedecomposeTask {
  type: 'REDECOMPOSE_TASK';
  task_id: number;
  reason: 'compaction_detected';
}

type OrchestratorCommand =
  | RunTriage
  | Decompose
  | QueryNextTask
  | UpdateTaskStatus
  | GenerateExpert
  | RunReview
  | DispatchWorker
  | RequestApproval
  | Escalate
  | RedecomposeTask;
```

Also define the `WorkerResult` type referenced by `RunReview`:

```typescript
interface WorkerResult {
  status: 'DONE' | 'DONE_WITH_CONCERNS' | 'NEEDS_CONTEXT' | 'BLOCKED';
  result_path: string;
  cost_usd: number;
  duration_ms: number;
  files_changed: string[];
  concerns: string | null;
}
```

### Acceptance criteria

- File compiles with `npx tsc --noEmit`.
- The `OrchestratorCommand` union covers all 10 command types.
- `RedecomposeTask` is included for the compaction-triggered
  re-decomposition flow.
- Field types match the spec (Section 5 of `02-orchestrator.md`).
- No runtime code -- types only.

### Dependencies

Task 1.

### Estimated scope

Medium (100-300 LOC).

---

## Task 4: Context and shared types

### Description

Define the `OrchestratorContext` type (the XState machine context),
shared enums/types (`RiskLevel`, `InputType`, `Stage`, `TaskStatus`,
`ArtifactRef`), and the default context factory function. The context
is the single mutable state record that all guards and actions read
and write.

### Files to create

- `plugins/skylark/src/orchestrator/types.ts`
- `plugins/skylark/src/orchestrator/context.ts`

### Implementation details

**`types.ts`** -- shared type aliases and enums:

```typescript
type InputType = 'spec' | 'plan' | 'task' | 'raw-idea' | 'raw-problem' | 'raw-input' | 'external-ref';
type RiskLevel = 'trivial' | 'standard' | 'elevated' | 'critical';
type TaskStatus = 'pending' | 'expert_ready' | 'in_progress' | 'review' | 'done' | 'blocked' | 'skipped';
type Stage = 'triage' | 'prepare' | 'brainstorm' | 'spec_review' | 'write_plan' | 'plan_review' | 'develop' | 'finish';

interface ArtifactRef {
  type: 'spec' | 'plan' | 'task';
  path: string;
}

interface TaskSummary {
  id: number;
  title: string;
  status: TaskStatus;
  review_round: number;
  worker_result_path: string | null;
  expert_prompt_path: string | null;
  cost_usd: number;
  duration_ms: number;
}
```

**`context.ts`** -- the machine context interface and its factory:

```typescript
interface OrchestratorContext {
  // From triage
  input_type: InputType;
  risk: RiskLevel;
  path: Stage[];
  existing_artifact: ArtifactRef | null;
  external_ref: string | null;
  decompose: boolean;
  domain_clusters: string[];

  // Task tracking (use Record<number, TaskSummary> instead of Map for serialization)
  tasks: Record<number, TaskSummary>;
  current_task_id: number | null;
  task_count: number;
  tasks_complete: number;

  // Review tracking
  review_round: number;
  last_review_verdict: 'SHIP' | 'REVISE' | 'RETHINK' | null;
  last_review_findings: ReviewFinding[];

  // Spec/plan paths
  spec_path: string | null;
  plan_path: string | null;

  // Configuration (set once from risk level)
  max_review_rounds: number;
  worker_model: 'sonnet' | 'opus';
  worker_max_turns: number;
  review_model: 'sonnet' | 'opus';
  review_panel_size: number;
  worker_timeout_ms: number;
  review_timeout_ms: number;

  // Pipeline metadata
  abort_reason: string | null;
  error: string | null;
}
```

Important: use `Record<number, TaskSummary>` instead of `Map` for
the `tasks` field. `Map` does not serialize to JSON, which would break
the persistence layer. Guards and actions that need task lookups use
bracket access (`context.tasks[id]`).

The factory function `createDefaultContext()` returns a context with
all fields at their zero/null/empty defaults, `risk` set to
`'standard'`, and configuration values set to the standard-risk
defaults from the spec (Section 9 of `02-orchestrator.md`).

### Acceptance criteria

- Both files compile with `npx tsc --noEmit`.
- `OrchestratorContext` matches the spec (Section 2 of
  `02-orchestrator.md`) with the `Map` -> `Record` change noted.
- `createDefaultContext()` returns a valid context where:
  - `tasks` is `{}`, `task_count` is `0`, `tasks_complete` is `0`.
  - `risk` is `'standard'`, `path` is `[]`.
  - `max_review_rounds` is `2` (standard default).
  - `worker_model` is `'sonnet'`, `worker_max_turns` is `20`.
- All types from `types.ts` are re-exported from a barrel
  `src/orchestrator/index.ts`.

### Dependencies

Task 1.

### Estimated scope

Small (< 100 LOC).

---

## Task 5: Guard functions

### Description

Implement all guard functions as pure functions of
`({ context, event }) => boolean`. Guards control stage skipping,
verdict routing, worker status routing, decomposition gating, user
decision evaluation, drift checking, task completion, user approval
requirements, and compaction-triggered re-decomposition.

### Files to create

- `plugins/skylark/src/orchestrator/guards.ts`

### Implementation details

Every guard is a named export. XState v5's `setup()` API registers
them by name so the machine definition references them as strings.

```typescript
// Path-based stage skipping
shouldSkipPrepare: ({ context }) => !context.path.includes('prepare')
shouldSkipBrainstorm: ({ context }) => !context.path.includes('brainstorm')
shouldSkipSpecReview: ({ context }) => !context.path.includes('spec_review')
shouldSkipWritePlan: ({ context }) => !context.path.includes('write_plan')
shouldSkipPlanReview: ({ context }) => !context.path.includes('plan_review')

// Inverse: stage is active
isInPathPrepare: ({ context }) => context.path.includes('prepare')
isInPathBrainstorm: ({ context }) => context.path.includes('brainstorm')
// ... etc for each stage

// Verdict routing (reads from context.last_review_verdict,
// set by storeReviewResult action before guards evaluate)
isShip: ({ context }) => context.last_review_verdict === 'SHIP'
isRevise: ({ context }) => context.last_review_verdict === 'REVISE'
isRethink: ({ context }) => context.last_review_verdict === 'RETHINK'

// Round limits
belowMaxRounds: ({ context }) => context.review_round < context.max_review_rounds
atMaxRounds: ({ context }) => context.review_round >= context.max_review_rounds

// Worker status routing
workerSucceeded: ({ context, event }) =>
  event.type === 'WORKER_COMPLETE' &&
  (event.status === 'DONE' || event.status === 'DONE_WITH_CONCERNS')
workerBlocked: ({ context, event }) =>
  event.type === 'WORKER_COMPLETE' &&
  (event.status === 'NEEDS_CONTEXT' || event.status === 'BLOCKED')

// Decomposition
shouldDecompose: ({ context }) => context.decompose === true

// User decisions
isProceed: ({ context, event }) =>
  event.type === 'USER_APPROVE' && event.decision === 'proceed'
isAbort: ({ context, event }) =>
  event.type === 'USER_APPROVE' && event.decision === 'abort'
isRetry: ({ context, event }) =>
  event.type === 'USER_ESCALATION_RESPONSE' && event.action === 'retry'
isSkip: ({ context, event }) =>
  event.type === 'USER_ESCALATION_RESPONSE' && event.action === 'skip'
isAbortEscalation: ({ context, event }) =>
  event.type === 'USER_ESCALATION_RESPONSE' && event.action === 'abort'

// Drift check
driftPass: ({ context, event }) =>
  event.type === 'EXPERT_READY' && event.drift_check === 'pass'
driftFail: ({ context, event }) =>
  event.type === 'EXPERT_READY' && event.drift_check === 'fail'

// Task completion
allTasksComplete: ({ context }) =>
  context.tasks_complete >= context.task_count && context.task_count > 0

// User approval gate (risk-dependent)
requiresUserApproval: ({ context }) => context.risk === 'critical'

// Compaction-triggered re-decomposition
// True when a COMPACTION_DETECTED event arrives and the task has no subtasks
taskHasNoSubtasks: ({ context }) => {
  const taskId = context.current_task_id;
  if (taskId === null) return false;
  // A task "has subtasks" if any other task in the record has this as a dependency parent.
  // For the orchestrator's purposes, we check if task_count > tasks tracked at the
  // parent level. Simplified: if decomposition was already done for this task.
  // In practice, Layer 3 tracks this. The orchestrator tracks it via a flag
  // on the TaskSummary or via the decompose field.
  // Conservative: always true for the first compaction. Layer 3 will determine
  // actual subtask state during re-decomposition.
  return true;
}
```

Note on verdict guards: The spec shows guards reading from the event
directly (e.g., `isShip({ event })`), but `always` transitions (used
in `route_verdict`) do not have an event. The pattern is:
1. `storeReviewResult` action fires first on `REVIEW_COMPLETE`,
   writing `last_review_verdict` and `last_review_findings` to context.
2. The machine transitions to `route_verdict`.
3. `always` transitions in `route_verdict` read from
   `context.last_review_verdict`.

For event-triggered transitions (like `WORKER_COMPLETE`), guards read
from the event directly.

### Acceptance criteria

- File compiles with `npx tsc --noEmit`.
- Every guard listed in Section 7 of `02-orchestrator.md` has a
  corresponding named export.
- Guards for stage skipping exist for all 5 skippable stages
  (`prepare`, `brainstorm`, `spec_review`, `write_plan`,
  `plan_review`).
- Verdict guards (`isShip`, `isRevise`, `isRethink`) read from
  `context.last_review_verdict`, not from the event.
- Worker status guards (`workerSucceeded`, `workerBlocked`) read from
  the event.
- `requiresUserApproval` returns `true` only for `critical` risk.
- All guards are pure functions with no side effects.

### Dependencies

Task 4.

### Estimated scope

Medium (100-300 LOC).

---

## Task 6: Action functions (stubs)

### Description

Implement XState action functions. Actions are side-effecting
functions that run on transitions. They fall into two categories:

1. **Context mutations** -- update the machine context (assign
   actions). Examples: `storeTriageResult`, `configureFromRisk`,
   `storeReviewResult`, `incrementRound`, `resetReviewRound`,
   `markTaskDone`, `markTaskSkipped`, `recordAbort`.

2. **Command dispatchers** -- construct a command payload and push it
   to the command dispatcher. Examples: `dispatchTriage`,
   `dispatchDecompose`, `dispatchQueryNextTask`,
   `dispatchGenerateExpert`, `dispatchWorker`, `dispatchReview`,
   `requestApproval`, `escalateDrift`, `escalateWorker`,
   `escalateReview`.

Command dispatchers call a `dispatch` function injected via the
machine's `input` (or a module-level callback). For this task, the
dispatch function is a stub that logs the command. It will be replaced
by the real event bus in Task 9.

### Files to create

- `plugins/skylark/src/orchestrator/actions.ts`

### Implementation details

**Context mutation actions** (use XState v5 `assign()`):

- `storeTriageResult`: Copy `input_type`, `risk`, `path`,
  `existing_artifact`, `external_ref`, `decompose`,
  `domain_clusters` from the `TRIAGE_COMPLETE` event to context.
- `configureFromRisk`: Set `max_review_rounds`, `worker_model`,
  `worker_max_turns`, `review_model`, `review_panel_size`,
  `worker_timeout_ms`, `review_timeout_ms` based on `context.risk`
  using the table from Section 9 of the spec:
  - trivial: `{ max_review_rounds: 1, worker_model: 'sonnet', worker_max_turns: 10, review_model: 'sonnet', review_panel_size: 0, worker_timeout_ms: 600_000, review_timeout_ms: 300_000 }`
  - standard: `{ max_review_rounds: 2, worker_model: 'sonnet', worker_max_turns: 20, review_model: 'sonnet', review_panel_size: 3, worker_timeout_ms: 1_200_000, review_timeout_ms: 600_000 }`
  - elevated: `{ max_review_rounds: 2, worker_model: 'sonnet', worker_max_turns: 30, review_model: 'sonnet', review_panel_size: 4, worker_timeout_ms: 1_800_000, review_timeout_ms: 600_000 }`
  - critical: `{ max_review_rounds: 3, worker_model: 'opus', worker_max_turns: 40, review_model: 'opus', review_panel_size: 5, worker_timeout_ms: 1_800_000, review_timeout_ms: 600_000 }`
- `storeCurrentTask`: Set `current_task_id` from `TASK_READY` event.
  Add/update the task in `context.tasks` with status `'expert_ready'`.
- `storeExpertResult`: Update current task's `expert_prompt_path` from
  `EXPERT_READY` event.
- `storeWorkerResult`: Update current task's `worker_result_path`,
  `cost_usd`, `duration_ms` from `WORKER_COMPLETE`. Set task status to
  `'review'`.
- `storeReviewResult`: Set `context.last_review_verdict` and
  `context.last_review_findings` from `REVIEW_COMPLETE` event.
  Increment `context.review_round`.
- `storeDecomposition`: Set `context.task_count` and create
  `TaskSummary` entries from `DECOMPOSITION_COMPLETE`.
- `storePrepareResult`: Set `context.spec_path` from event.
- `storeBrainstormResult`: Set `context.spec_path` from event.
- `storePlanResult`: Set `context.plan_path` from event.
- `resetReviewRound`: Set `context.review_round = 0`,
  `context.last_review_verdict = null`,
  `context.last_review_findings = []`.
- `incrementRound`: Increment `context.review_round` by 1.
- `markTaskDone`: Set current task's status to `'done'`. Increment
  `context.tasks_complete`.
- `markTaskSkipped`: Set current task's status to `'skipped'`.
  Increment `context.tasks_complete`.
- `recordAbort`: Set `context.abort_reason` to a descriptive string.
- `handleCompactionDetected`: When `COMPACTION_DETECTED` arrives,
  set the current task's status to `'pending'` (reset it for
  re-decomposition). This is the context-side half; the command-side
  is `dispatchRedecompose`.

**Command dispatcher actions** -- each builds the command payload and
calls `dispatch()`:

- `dispatchTriage`: Emit `RUN_TRIAGE`.
- `dispatchPrepare`: Emit a prepare command (internal to Layer 4; for
  now, just log it).
- `dispatchBrainstorm`: Emit a brainstorm command.
- `dispatchSpecReview`: Emit `RUN_REVIEW` with `stage: 'spec'`.
- `dispatchWritePlan`: Emit a write-plan command.
- `dispatchPlanReview`: Emit `RUN_REVIEW` with `stage: 'plan'`.
- `dispatchDecompose`: Emit `DECOMPOSE` with `spec_path` and `risk`
  from context.
- `dispatchQueryNextTask`: Emit `QUERY_NEXT_TASK`.
- `dispatchGenerateExpert`: Emit `GENERATE_EXPERT` with current task
  info.
- `dispatchWorker`: Emit `DISPATCH_WORKER` with current task info,
  expert prompt path, model, and max turns from context config.
- `dispatchReview`: Emit `RUN_REVIEW` with current task info.
- `requestApproval`: Emit `REQUEST_APPROVAL` with stage and risk.
- `escalateDrift`: Emit `ESCALATE` with reason "drift check failed".
- `escalateWorker`: Emit `ESCALATE` with reason from worker status.
- `escalateReview`: Emit `ESCALATE` with reason from review verdict.
- `dispatchRedecompose`: Emit `REDECOMPOSE_TASK` for the current task.
  This is triggered when `COMPACTION_DETECTED` is received.
- `dispatchFinish`: Emit a finish command (cleanup, summary).
- `emitPipelineSummary`: Log the final pipeline summary (tasks
  completed, total cost, total duration).

The `dispatch` function signature:
```typescript
type DispatchFn = (command: OrchestratorCommand) => void;
```

Actions access it via the machine's system context or a module-level
`setDispatcher(fn)` call. For this task, default to `console.log`.

### Acceptance criteria

- File compiles with `npx tsc --noEmit`.
- Every action listed in the transition table (Section 4 of
  `02-orchestrator.md`) has a corresponding named export.
- `configureFromRisk` produces correct config values for all 4 risk
  levels per the table in Section 9.
- Context mutation actions use XState v5 `assign()` pattern.
- Command dispatcher actions call `dispatch()` with correctly typed
  command payloads.
- `handleCompactionDetected` resets the task to `'pending'` status.
- `dispatchRedecompose` emits `REDECOMPOSE_TASK`.

### Dependencies

Tasks 2, 3, 4.

### Estimated scope

Medium (100-300 LOC). Many actions are structurally similar.

---

## Task 7: XState machine definition

### Description

Define the complete XState v5 state machine using `setup()` and
`createMachine()`. This is the core of the orchestrator. It wires
together all states, transitions, guards, and actions from the spec.

The machine has 10 top-level states (`idle`, `triage`, `prepare`,
`brainstorm`, `spec_review`, `write_plan`, `plan_review`, `develop`,
`finish`, `done`) plus a `failed` terminal state. The `develop` state
is a compound state with its own sub-states (`decompose`, `next_task`,
`generate_expert`, `dispatch_worker`, `await_worker`, `review_task`,
`route_verdict`, `escalate_drift`, `escalate_worker`,
`escalate_review`, `finish_develop`, `abort`).

### Files to create

- `plugins/skylark/src/orchestrator/machine.ts`

### Implementation details

Use XState v5's `setup()` API to register all guards and actions by
name with full type inference:

```typescript
import { setup, createMachine, assign } from 'xstate';

const orchestratorMachine = setup({
  types: {
    context: {} as OrchestratorContext,
    events: {} as OrchestratorEvent,
  },
  guards: {
    shouldSkipPrepare,
    shouldSkipBrainstorm,
    shouldSkipSpecReview,
    shouldSkipWritePlan,
    shouldSkipPlanReview,
    isInPathPrepare,
    // ... all guards from Task 5
    isShip,
    isRevise,
    isRethink,
    belowMaxRounds,
    atMaxRounds,
    workerSucceeded,
    workerBlocked,
    shouldDecompose,
    isProceed,
    isAbort,
    isRetry,
    isSkip,
    isAbortEscalation,
    driftPass,
    driftFail,
    allTasksComplete,
    requiresUserApproval,
  },
  actions: {
    storeTriageResult,
    configureFromRisk,
    // ... all actions from Task 6
  },
}).createMachine({
  id: 'skylark-orchestrator',
  context: createDefaultContext,
  initial: 'idle',
  states: {
    idle: {
      on: {
        START: {
          target: 'triage',
          actions: ['dispatchTriage'],
        },
      },
    },
    triage: {
      on: {
        TRIAGE_COMPLETE: {
          target: 'prepare',
          actions: ['storeTriageResult', 'configureFromRisk'],
        },
        USER_APPROVE: {
          guard: 'isAbort',
          target: 'done',
          actions: ['recordAbort'],
        },
      },
    },
    prepare: {
      always: [
        { guard: 'shouldSkipPrepare', target: 'brainstorm' },
      ],
      entry: ['dispatchPrepare'],
      on: {
        PREPARE_COMPLETE: {
          target: 'brainstorm',
          actions: ['storePrepareResult'],
        },
      },
    },
    brainstorm: {
      always: [
        { guard: 'shouldSkipBrainstorm', target: 'spec_review' },
      ],
      entry: ['dispatchBrainstorm'],
      on: {
        BRAINSTORM_COMPLETE: {
          target: 'spec_review',
          actions: ['storeBrainstormResult'],
        },
      },
    },
    // ... spec_review, write_plan, plan_review follow the same pattern
    // with review loops and approval gates per the transition table.
    develop: {
      initial: 'decompose',
      states: {
        decompose: {
          always: [
            {
              guard: { type: 'not', params: { guard: 'shouldDecompose' } },
              // XState v5 uses `not` guard combinator
              target: 'next_task',
              actions: ['dispatchQueryNextTask'],
            },
          ],
          entry: ['dispatchDecompose'],
          on: {
            DECOMPOSITION_COMPLETE: {
              target: 'next_task',
              actions: ['storeDecomposition', 'dispatchQueryNextTask'],
            },
          },
        },
        next_task: {
          on: {
            TASK_READY: {
              target: 'generate_expert',
              actions: ['storeCurrentTask', 'dispatchGenerateExpert'],
            },
            STATUS_ROLLUP: {
              guard: 'allTasksComplete',
              target: 'finish_develop',
            },
          },
        },
        generate_expert: {
          on: {
            EXPERT_READY: [
              {
                guard: 'driftPass',
                target: 'dispatch_worker',
                actions: ['storeExpertResult', 'dispatchWorker'],
              },
              {
                guard: 'driftFail',
                target: 'escalate_drift',
                actions: ['escalateDrift'],
              },
            ],
          },
        },
        dispatch_worker: {
          entry: ['resetReviewRound'],
          always: { target: 'await_worker' },
        },
        await_worker: {
          on: {
            WORKER_COMPLETE: [
              {
                guard: 'workerSucceeded',
                target: 'review_task',
                actions: ['storeWorkerResult', 'dispatchReview'],
              },
              {
                guard: 'workerBlocked',
                target: 'escalate_worker',
                actions: ['storeWorkerResult', 'escalateWorker'],
              },
            ],
            COMPACTION_DETECTED: {
              target: 'escalate_worker',
              actions: ['handleCompactionDetected', 'dispatchRedecompose'],
            },
          },
        },
        review_task: {
          on: {
            REVIEW_COMPLETE: {
              target: 'route_verdict',
              actions: ['storeReviewResult'],
            },
          },
        },
        route_verdict: {
          always: [
            {
              guard: 'isShip',
              target: 'next_task',
              actions: ['markTaskDone', 'dispatchQueryNextTask'],
            },
            {
              guard: { type: 'and', guards: ['isRevise', 'belowMaxRounds'] },
              target: 'dispatch_worker',
              actions: ['dispatchWorker'],
            },
            {
              // isRethink OR atMaxRounds -- fallthrough
              target: 'escalate_review',
              actions: ['escalateReview'],
            },
          ],
        },
        escalate_drift: {
          on: {
            USER_ESCALATION_RESPONSE: [
              { guard: 'isSkip', target: 'next_task', actions: ['markTaskSkipped', 'dispatchQueryNextTask'] },
              { guard: 'isRetry', target: 'generate_expert', actions: ['dispatchGenerateExpert'] },
              { guard: 'isAbortEscalation', target: 'abort', actions: ['recordAbort'] },
            ],
          },
        },
        escalate_worker: {
          on: {
            USER_ESCALATION_RESPONSE: [
              { guard: 'isSkip', target: 'next_task', actions: ['markTaskSkipped', 'dispatchQueryNextTask'] },
              { guard: 'isRetry', target: 'dispatch_worker', actions: ['dispatchWorker'] },
              { guard: 'isAbortEscalation', target: 'abort', actions: ['recordAbort'] },
            ],
          },
        },
        escalate_review: {
          on: {
            USER_ESCALATION_RESPONSE: [
              { guard: 'isSkip', target: 'next_task', actions: ['markTaskSkipped', 'dispatchQueryNextTask'] },
              { guard: 'isRetry', target: 'generate_expert', actions: ['dispatchGenerateExpert'] },
              { guard: 'isAbortEscalation', target: 'abort', actions: ['recordAbort'] },
            ],
          },
        },
        finish_develop: { type: 'final' },
        abort: { type: 'final' },
      },
      onDone: [
        // Reached when a final child state is entered.
        // Need to distinguish finish_develop vs abort.
        // XState v5: use `state.matches('develop.finish_develop')` in a guard,
        // or use two separate onDone handlers. Simplest: check context.abort_reason.
        {
          guard: ({ context }) => context.abort_reason !== null,
          target: 'done',
        },
        {
          target: 'finish',
        },
      ],
    },
    finish: {
      entry: ['dispatchFinish'],
      on: {
        FINISH_COMPLETE: {
          target: 'done',
        },
      },
    },
    done: {
      type: 'final',
      entry: ['emitPipelineSummary'],
    },
    failed: {
      type: 'final',
    },
  },
});
```

**Key XState v5 patterns to use:**

- `setup()` for type-safe guard/action registration.
- `always` transitions for stage skipping (evaluated on state entry).
- `assign()` for context mutations.
- Compound states for the `develop` loop.
- `type: 'final'` for terminal states.
- `onDone` on compound states to detect child completion.
- Guard combinators: `not`, `and`, `or` for compound conditions.

**Stage skipping chain:** When `prepare` is skipped, the `always`
transition targets `brainstorm`. If `brainstorm` is also skipped, its
own `always` transition targets `spec_review`, and so on. Each
skippable state has an `always` guard that checks its own presence in
`path`. This creates a forward-scanning chain that lands on the first
active state.

**`spec_review` and `plan_review` review loops:** These need internal
sub-states or re-entry patterns for the REVISE loop. Use a simpler
approach: on `REVIEW_COMPLETE` with `isRevise && belowMaxRounds`,
self-transition back to the same state with re-entry (triggering
the review dispatch action again). On `SHIP`, check
`requiresUserApproval`; if true, stay and wait for `USER_APPROVE`;
if false, advance directly.

**`COMPACTION_DETECTED` handling in `await_worker`:** When this
event arrives while waiting for a worker, the orchestrator:
1. Runs `handleCompactionDetected` (resets task to pending).
2. Runs `dispatchRedecompose` (tells Layer 3 to re-decompose).
3. Transitions to `escalate_worker` where the user is notified.

The user can then `retry` (with the now-decomposed subtasks),
`skip`, or `abort`.

### Acceptance criteria

- File compiles with `npx tsc --noEmit`.
- The machine has all 10 top-level states from the spec.
- The `develop` compound state has all 12 sub-states.
- Every transition from the transition table (Section 4 of
  `02-orchestrator.md`) is represented.
- Stage skipping works: a machine started with
  `path: ['triage', 'develop', 'finish']` transitions from `prepare`
  through `brainstorm`, `spec_review`, `write_plan`, `plan_review`
  directly to `develop` via the `always` chain.
- `COMPACTION_DETECTED` in `await_worker` transitions to
  `escalate_worker` with both `handleCompactionDetected` and
  `dispatchRedecompose` actions.
- The `not` guard combinator is used for `shouldDecompose` negation
  in `develop.decompose`.
- The `and` guard combinator is used for `isRevise && belowMaxRounds`
  in `route_verdict`.
- The machine definition exports `orchestratorMachine` as a named
  export.

### Dependencies

Tasks 5, 6.

### Estimated scope

Large (300+ LOC). The machine definition is the single largest file.

---

## Task 8: Persistence wrapper

### Description

Thin module that serializes the XState actor state to
`.skylark/state.json` after every transition and restores it on
startup. Uses atomic write (write to temp file, rename) to prevent
corruption from crashes mid-write.

### Files to create

- `plugins/skylark/src/orchestrator/persistence.ts`

### Implementation details

```typescript
import { createActor, type AnyActorRef, type Snapshot } from 'xstate';
import * as fs from 'node:fs';
import * as path from 'node:path';

const STATE_DIR = '.skylark';
const STATE_FILE = 'state.json';
const STATE_PATH = path.join(STATE_DIR, STATE_FILE);
const TMP_PATH = path.join(STATE_DIR, `${STATE_FILE}.tmp`);

function persist(actor: AnyActorRef): void {
  const snapshot = actor.getPersistedSnapshot();
  const json = JSON.stringify(snapshot, null, 2);

  // Ensure directory exists
  fs.mkdirSync(STATE_DIR, { recursive: true });

  // Atomic write: write to tmp, then rename
  fs.writeFileSync(TMP_PATH, json, 'utf-8');
  fs.renameSync(TMP_PATH, STATE_PATH);
}

function restore(): Snapshot<unknown> | null {
  try {
    if (!fs.existsSync(STATE_PATH)) return null;
    const raw = fs.readFileSync(STATE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    // Corrupt state file -- archive and start fresh
    const timestamp = Date.now();
    const corruptPath = path.join(STATE_DIR, `${STATE_FILE}.corrupt.${timestamp}`);
    try {
      fs.renameSync(STATE_PATH, corruptPath);
    } catch {
      // If rename fails too, just delete
      fs.unlinkSync(STATE_PATH);
    }
    console.warn(`Corrupt state file archived to ${corruptPath}. Starting fresh.`);
    return null;
  }
}

function cleanTmp(): void {
  try {
    if (fs.existsSync(TMP_PATH)) {
      fs.unlinkSync(TMP_PATH);
    }
  } catch {
    // Ignore
  }
}
```

The `persist` function is called from a subscription on the actor:

```typescript
actor.subscribe((state) => {
  persist(actor);
});
```

The `restore` function is called before actor creation:

```typescript
const snapshot = restore();
const actor = createActor(orchestratorMachine, snapshot ? { snapshot } : {});
actor.start();
```

**Configurable base directory:** The `STATE_DIR` should be
configurable for testing. Export a `createPersistence(baseDir: string)`
factory that returns `{ persist, restore, cleanTmp }` bound to the
given directory. The default export uses `.skylark`.

### Acceptance criteria

- File compiles with `npx tsc --noEmit`.
- `persist()` writes valid JSON to the state file via atomic rename.
- `restore()` returns a parsed snapshot when the file exists.
- `restore()` returns `null` when no state file exists.
- `restore()` archives a corrupt file to
  `.skylark/state.json.corrupt.<timestamp>` and returns `null`.
- `cleanTmp()` removes the `.tmp` file if it exists.
- The factory `createPersistence(baseDir)` allows overriding the
  directory for tests (write to a temp dir, not the real `.skylark/`).
- No use of `Map`, `Set`, or other non-serializable types (the
  context uses `Record` per Task 4).

### Dependencies

Task 4.

### Estimated scope

Medium (100-300 LOC).

---

## Task 9: Event bus and command dispatcher

### Description

Thin in-process event bus that connects external layer handlers to
the XState actor. For v1, all layers run in the same process, so the
bus is just function calls. This module provides:

1. `sendEvent(event)` -- validates and forwards an event to the actor.
2. `onCommand(handler)` -- registers a callback for dispatched
   commands.
3. A default handler that logs commands to stdout (replaced by real
   layer handlers when those domains are built).

### Files to create

- `plugins/skylark/src/orchestrator/bus.ts`

### Implementation details

```typescript
import type { OrchestratorEvent } from './events.js';
import type { OrchestratorCommand } from './commands.js';

type CommandHandler = (command: OrchestratorCommand) => void;

interface EventBus {
  sendEvent: (event: OrchestratorEvent) => void;
  onCommand: (handler: CommandHandler) => void;
  dispatch: (command: OrchestratorCommand) => void;
}

function createEventBus(actor: AnyActorRef): EventBus {
  const handlers: CommandHandler[] = [];

  return {
    sendEvent(event) {
      actor.send(event);
    },

    onCommand(handler) {
      handlers.push(handler);
    },

    dispatch(command) {
      if (handlers.length === 0) {
        console.log(`[orchestrator] command: ${command.type}`, JSON.stringify(command, null, 2));
        return;
      }
      for (const handler of handlers) {
        try {
          handler(command);
        } catch (err) {
          console.error(`[orchestrator] handler error for ${command.type}:`, err);
          // Send DISPATCH_ERROR back to the actor
          actor.send({
            type: 'DISPATCH_ERROR',
            failed_command: command.type,
            error_message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
  };
}
```

The `dispatch` function from this bus is what gets wired into the
machine's action functions (Task 6). The actions call
`bus.dispatch(command)` instead of `console.log`.

### Acceptance criteria

- File compiles with `npx tsc --noEmit`.
- `sendEvent()` forwards events to the actor via `actor.send()`.
- `dispatch()` calls all registered handlers.
- `dispatch()` catches handler errors and sends `DISPATCH_ERROR` back
  to the actor.
- When no handlers are registered, `dispatch()` logs the command to
  stdout (default stub behavior).
- `onCommand()` accepts multiple handlers (they all run).

### Dependencies

Tasks 2, 3.

### Estimated scope

Small (< 100 LOC).

---

## Task 10: CLI entry point

### Description

A simple script that starts the orchestrator, loads persisted state if
it exists, and accepts events from stdin (one JSON object per line) or
from a file. This is the primary interface for manual testing and for
other domains to interact with the orchestrator during development.

### Files to create

- `plugins/skylark/src/orchestrator/cli.ts`
- `plugins/skylark/package.json` -- modify (add `bin` entry)

### Implementation details

```typescript
#!/usr/bin/env node

import { createActor } from 'xstate';
import { orchestratorMachine } from './machine.js';
import { createPersistence } from './persistence.js';
import { createEventBus } from './bus.js';
import * as readline from 'node:readline';

const baseDir = process.env.SKYLARK_STATE_DIR || '.skylark';
const persistence = createPersistence(baseDir);

// Restore or create fresh
const snapshot = persistence.restore();
const actor = createActor(
  orchestratorMachine,
  snapshot ? { snapshot } : {}
);

// Wire up event bus
const bus = createEventBus(actor);

// Wire dispatch into actor system (actions use this)
// The dispatch function is set via a module-level setter
import { setDispatcher } from './actions.js';
setDispatcher(bus.dispatch);

// Persist after every transition
actor.subscribe((state) => {
  persistence.persist(actor);
  console.log(`[state] ${JSON.stringify(state.value)}`);
});

// Start
actor.start();
console.log(`[orchestrator] started in state: ${JSON.stringify(actor.getSnapshot().value)}`);

// If a file arg is provided, read events from it
const eventFile = process.argv[2];
if (eventFile) {
  const content = fs.readFileSync(eventFile, 'utf-8');
  const events = content.trim().split('\n').map(line => JSON.parse(line));
  for (const event of events) {
    console.log(`[input] ${event.type}`);
    bus.sendEvent(event);
  }
} else {
  // Read from stdin, one JSON per line
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    try {
      const event = JSON.parse(line.trim());
      console.log(`[input] ${event.type}`);
      bus.sendEvent(event);
    } catch (err) {
      console.error(`[error] invalid JSON: ${line}`);
    }
  });
  console.log('[orchestrator] reading events from stdin (one JSON per line)');
}
```

Add to `package.json`:
```json
{
  "bin": {
    "skylark-orchestrator": "./dist/orchestrator/cli.js"
  }
}
```

**Usage examples:**

```bash
# Start fresh, read events from stdin
npx tsx src/orchestrator/cli.ts

# Paste a START event:
{"type":"START","input":{"type":"raw-idea","content":"add dark mode","user_risk_override":null}}

# Feed events from a file (one JSON per line)
npx tsx src/orchestrator/cli.ts events.jsonl

# Resume from persisted state
npx tsx src/orchestrator/cli.ts
# (automatically loads .skylark/state.json if it exists)
```

### Acceptance criteria

- `npx tsx src/orchestrator/cli.ts` starts without errors and prints
  the initial state (`idle`).
- Sending `{"type":"START","input":{"type":"raw-idea","content":"test","user_risk_override":null}}`
  via stdin transitions the machine to `triage` and logs the
  `RUN_TRIAGE` command.
- Sending a sequence of events from a `.jsonl` file drives the machine
  through multiple transitions.
- State is persisted to `.skylark/state.json` after each transition.
- Restarting the CLI picks up from the persisted state.
- Invalid JSON on stdin prints an error but does not crash the process.

### Dependencies

Tasks 7, 8, 9.

### Estimated scope

Medium (100-300 LOC).

---

## Task 11: Unit tests -- guards

### Description

Test every guard function in isolation with synthetic context and
event objects. Guards are pure functions, so these are straightforward
unit tests.

### Files to create

- `plugins/skylark/src/orchestrator/__tests__/guards.test.ts`

### Test cases

**Stage skipping guards:**
- `shouldSkipPrepare` returns `true` when `path` does not include `'prepare'`.
- `shouldSkipPrepare` returns `false` when `path` includes `'prepare'`.
- Repeat for all 5 skippable stages.

**Verdict guards:**
- `isShip` returns `true` when `context.last_review_verdict === 'SHIP'`.
- `isRevise` returns `true` when `context.last_review_verdict === 'REVISE'`.
- `isRethink` returns `true` when `context.last_review_verdict === 'RETHINK'`.
- Each returns `false` for non-matching values.

**Round limit guards:**
- `belowMaxRounds` returns `true` when `review_round` (1) < `max_review_rounds` (2).
- `belowMaxRounds` returns `false` when `review_round` (2) >= `max_review_rounds` (2).
- `atMaxRounds` is the inverse.

**Worker status guards:**
- `workerSucceeded` returns `true` for `DONE` and `DONE_WITH_CONCERNS`.
- `workerSucceeded` returns `false` for `NEEDS_CONTEXT` and `BLOCKED`.
- `workerBlocked` is the inverse.

**Decomposition guard:**
- `shouldDecompose` returns `true` when `context.decompose === true`.
- `shouldDecompose` returns `false` when `context.decompose === false`.

**User decision guards:**
- `isProceed` returns `true` for `{ decision: 'proceed' }`.
- `isAbort` returns `true` for `{ decision: 'abort' }`.
- `isRetry`, `isSkip`, `isAbortEscalation` tested similarly.

**Drift guards:**
- `driftPass` returns `true` for `{ drift_check: 'pass' }`.
- `driftFail` returns `true` for `{ drift_check: 'fail' }`.

**Task completion:**
- `allTasksComplete` returns `true` when `tasks_complete >= task_count > 0`.
- `allTasksComplete` returns `false` when `tasks_complete < task_count`.
- `allTasksComplete` returns `false` when `task_count === 0` (no
  tasks loaded yet).

**User approval gate:**
- `requiresUserApproval` returns `true` for `risk: 'critical'`.
- `requiresUserApproval` returns `false` for `'elevated'`, `'standard'`, `'trivial'`.

### Acceptance criteria

- `npm test` runs all guard tests and they pass.
- Every guard function has at least one positive and one negative test
  case.
- Tests use a helper `makeContext(overrides)` that merges overrides
  into `createDefaultContext()` to reduce boilerplate.

### Dependencies

Task 5.

### Estimated scope

Medium (100-300 LOC).

---

## Task 12: Unit tests -- machine transitions

### Description

Test the state machine transitions by creating an actor, sending
events, and asserting the resulting state. These tests validate the
wiring between states, guards, and actions.

### Files to create

- `plugins/skylark/src/orchestrator/__tests__/machine.test.ts`

### Test cases

**Happy path: trivial risk (skip everything except develop):**
1. Start in `idle`.
2. Send `START`. Assert state is `triage`.
3. Send `TRIAGE_COMPLETE` with `risk: 'trivial'`,
   `path: ['triage', 'develop', 'finish']`, `decompose: false`.
4. Assert state skips `prepare`, `brainstorm`, `spec_review`,
   `write_plan`, `plan_review` and lands in `develop.decompose`.
5. Assert `develop.decompose` immediately transitions to
   `develop.next_task` (because `decompose: false`).
6. Send `TASK_READY`. Assert state is `develop.generate_expert`.
7. Send `EXPERT_READY` with `drift_check: 'pass'`. Assert state is
   `develop.dispatch_worker` then `develop.await_worker`.
8. Send `WORKER_COMPLETE` with `status: 'DONE'`. Assert state is
   `develop.review_task`.
9. Send `REVIEW_COMPLETE` with `verdict: 'SHIP'`. Assert state
   transitions through `develop.route_verdict` to `develop.next_task`.
10. Send `STATUS_ROLLUP` with `all_complete: true`. Assert state is
    `finish`.
11. Send `FINISH_COMPLETE`. Assert state is `done`.

**REVISE loop:**
1. Set up machine in `develop.await_worker` state with
   `max_review_rounds: 2`.
2. Send `WORKER_COMPLETE` with `status: 'DONE'`.
3. Send `REVIEW_COMPLETE` with `verdict: 'REVISE'`.
4. Assert state goes back to `develop.dispatch_worker` (round 1).
5. Send `WORKER_COMPLETE`, then `REVIEW_COMPLETE` with `verdict: 'REVISE'` again.
6. Assert state goes to `develop.escalate_review` (round 2 >= max).

**RETHINK escalation:**
1. Send `REVIEW_COMPLETE` with `verdict: 'RETHINK'`.
2. Assert state goes to `develop.escalate_review`.
3. Send `USER_ESCALATION_RESPONSE` with `action: 'skip'`.
4. Assert state goes to `develop.next_task` and task is marked skipped.

**Drift failure:**
1. Get to `develop.generate_expert`.
2. Send `EXPERT_READY` with `drift_check: 'fail'`.
3. Assert state is `develop.escalate_drift`.
4. Send `USER_ESCALATION_RESPONSE` with `action: 'retry'`.
5. Assert state is `develop.generate_expert`.

**Worker blocked:**
1. Get to `develop.await_worker`.
2. Send `WORKER_COMPLETE` with `status: 'BLOCKED'`.
3. Assert state is `develop.escalate_worker`.

**Abort from user:**
1. In `triage`, send `USER_APPROVE` with `decision: 'abort'`.
2. Assert state is `done`.

**Compaction detected:**
1. Get to `develop.await_worker`.
2. Send `COMPACTION_DETECTED` with a task_id.
3. Assert state is `develop.escalate_worker`.
4. Assert the current task's status was reset to `'pending'`.

**Stage skipping for elevated risk:**
1. Send `TRIAGE_COMPLETE` with
   `path: ['triage', 'prepare', 'spec_review', 'write_plan', 'plan_review', 'develop', 'finish']`.
2. Assert `prepare` is entered (not skipped).
3. After `PREPARE_COMPLETE`, assert `brainstorm` is skipped.
4. Assert `spec_review` is entered.

**Critical risk user approval gate:**
1. Set `risk: 'critical'`.
2. Get to `spec_review`. Send `REVIEW_COMPLETE` with `verdict: 'SHIP'`.
3. Assert machine waits for `USER_APPROVE` before advancing.

### Acceptance criteria

- `npm test` runs all machine tests and they pass.
- The happy-path test drives the machine from `idle` to `done`.
- The REVISE loop test proves the round cap is enforced.
- The compaction test proves `COMPACTION_DETECTED` triggers escalation.
- Tests create real XState actors and send real events (not mocked).
- Tests do NOT rely on persistence (they create fresh actors).

### Dependencies

Task 7.

### Estimated scope

Large (300+ LOC).

---

## Task 13: Unit tests -- persistence

### Description

Test the persistence wrapper: write, restore, corrupt file handling,
and atomic write safety.

### Files to create

- `plugins/skylark/src/orchestrator/__tests__/persistence.test.ts`

### Test cases

**Write and restore round-trip:**
1. Create an actor, send `START`, persist.
2. Read the state file, assert it is valid JSON.
3. Create a new actor with the restored snapshot.
4. Assert the new actor is in `triage` state.

**Restore from empty directory:**
1. Call `restore()` on a directory with no state file.
2. Assert it returns `null`.

**Corrupt state file:**
1. Write garbage to the state file path.
2. Call `restore()`.
3. Assert it returns `null`.
4. Assert the corrupt file was moved to `state.json.corrupt.<timestamp>`.
5. Assert the original state file no longer exists.

**Atomic write safety:**
1. Persist a snapshot.
2. Assert no `.tmp` file remains after persist completes.
3. Assert the state file exists and is valid JSON.

**Temp file cleanup:**
1. Manually create a `.tmp` file.
2. Call `cleanTmp()`.
3. Assert the `.tmp` file is removed.

### Acceptance criteria

- All persistence tests pass.
- Tests use a temporary directory (not the real `.skylark/`) via the
  `createPersistence(baseDir)` factory.
- Each test cleans up its temp directory in `afterEach`.

### Dependencies

Task 8.

### Estimated scope

Medium (100-300 LOC).

---

## Task 14: Integration test -- full pipeline walkthrough

### Description

End-to-end test that drives the orchestrator through a complete
pipeline run with mock events, verifying state transitions,
persistence, and command dispatch at every step. This simulates what
happens when all other domains are connected.

### Files to create

- `plugins/skylark/src/orchestrator/__tests__/integration.test.ts`

### Test cases

**Standard risk, two tasks, one REVISE cycle:**

Scenario: A standard-risk input with decomposition enabled. Two tasks.
The first task passes review on the first try. The second task gets a
REVISE verdict, passes on the second try.

Event sequence:
```
START
-> (dispatches RUN_TRIAGE)
TRIAGE_COMPLETE { risk: 'standard', path: ['triage','prepare','develop','finish'], decompose: true }
-> (skips brainstorm, spec_review, write_plan, plan_review)
-> (dispatches prepare command)
PREPARE_COMPLETE { spec_path: 'docs/specs/SPEC-001.md' }
-> (enters develop, dispatches DECOMPOSE)
DECOMPOSITION_COMPLETE { task_count: 2, task_ids: [1, 2] }
-> (dispatches QUERY_NEXT_TASK)
TASK_READY { task_id: 1, task: {...} }
-> (dispatches GENERATE_EXPERT)
EXPERT_READY { task_id: 1, drift_check: 'pass', expert_prompt_path: '.skylark/experts/TASK-001.md' }
-> (dispatches DISPATCH_WORKER)
WORKER_COMPLETE { task_id: 1, status: 'DONE', cost_usd: 0.12, duration_ms: 45000 }
-> (dispatches RUN_REVIEW)
REVIEW_COMPLETE { task_id: 1, verdict: 'SHIP', round: 1 }
-> (marks task 1 done, dispatches QUERY_NEXT_TASK)
TASK_READY { task_id: 2, task: {...} }
-> (dispatches GENERATE_EXPERT)
EXPERT_READY { task_id: 2, drift_check: 'pass', expert_prompt_path: '.skylark/experts/TASK-002.md' }
-> (dispatches DISPATCH_WORKER)
WORKER_COMPLETE { task_id: 2, status: 'DONE', cost_usd: 0.15, duration_ms: 60000 }
-> (dispatches RUN_REVIEW)
REVIEW_COMPLETE { task_id: 2, verdict: 'REVISE', round: 1 }
-> (round 1 < max 2, re-dispatches DISPATCH_WORKER)
WORKER_COMPLETE { task_id: 2, status: 'DONE', cost_usd: 0.08, duration_ms: 30000 }
-> (dispatches RUN_REVIEW)
REVIEW_COMPLETE { task_id: 2, verdict: 'SHIP', round: 2 }
-> (marks task 2 done, dispatches QUERY_NEXT_TASK)
STATUS_ROLLUP { all_complete: true }
-> (finish_develop -> finish)
FINISH_COMPLETE
-> (done)
```

Assertions at each step:
- The machine is in the expected state.
- The correct commands were dispatched (collect them via the bus).
- Context values are updated correctly (risk, task_count,
  tasks_complete, review_round, cost, etc.).
- After `done`, `tasks_complete === 2`, both tasks have status `'done'`.

**Crash recovery mid-pipeline:**

1. Drive the machine to `develop.await_worker`.
2. Persist the state.
3. Create a new actor from the persisted snapshot.
4. Assert the new actor is in `develop.await_worker`.
5. Continue sending events from that point. Assert it completes.

**Compaction-triggered re-decomposition:**

1. Drive to `develop.await_worker` for task 1.
2. Send `COMPACTION_DETECTED { task_id: 1 }`.
3. Assert `REDECOMPOSE_TASK` command was dispatched.
4. Assert state is `develop.escalate_worker`.
5. Send `USER_ESCALATION_RESPONSE { action: 'retry' }`.
6. Assert the machine re-enters the dispatch flow.

### Acceptance criteria

- The full standard-risk scenario runs to `done` with correct state
  at every step.
- The crash-recovery test proves persistence and restore work
  end-to-end.
- The compaction test proves the re-decomposition flow works.
- All dispatched commands are collected and verified in order.
- The test uses a temp directory for persistence.

### Dependencies

Tasks 7, 8, 9.

### Estimated scope

Medium (100-300 LOC). The event sequence is long but structurally
repetitive.

---

## Integration Points with Other Domains

This section documents how other domains will plug into the
orchestrator. During Domain 1 development, these boundaries are
stubs. When each domain is built, it replaces the stub with a real
handler.

### Domain 2: Task Management (Layer 3)

**Events it sends to orchestrator:**
- `TASK_READY` -- when a task with all dependencies met is available.
- `DECOMPOSITION_COMPLETE` -- when spec decomposition produces a task DAG.
- `STATUS_ROLLUP` -- when task status changes bubble up to parent.

**Commands it receives from orchestrator:**
- `DECOMPOSE` -- decompose a spec into tasks.
- `QUERY_NEXT_TASK` -- find the next ready task.
- `UPDATE_TASK_STATUS` -- mark a task done/skipped/blocked.
- `REDECOMPOSE_TASK` -- re-decompose a task that triggered compaction.

### Domain 3: Worker Execution (Layer 5)

**Events it sends to orchestrator:**
- `WORKER_COMPLETE` -- when a worker session finishes.

**Commands it receives from orchestrator:**
- `DISPATCH_WORKER` -- start a worker session for a task.

### Domain 4: Review & Expert Generation (Layer 4)

**Events it sends to orchestrator:**
- `EXPERT_READY` -- when an expert prompt is generated and drift-checked.
- `REVIEW_COMPLETE` -- when a review produces a verdict.
- `PREPARE_COMPLETE` -- when spec preparation finishes.
- `BRAINSTORM_COMPLETE` -- when brainstorming finishes.
- `PLAN_COMPLETE` -- when plan writing finishes.

**Commands it receives from orchestrator:**
- `GENERATE_EXPERT` -- generate a vocabulary-routed expert for a task.
- `RUN_REVIEW` -- run spec, plan, or code review.

### Domain 5: Telemetry (Layer 6)

**Events it sends to orchestrator:**
None directly. Telemetry is a passive observer.

**Commands it receives from orchestrator:**
None directly. Telemetry hooks into worker sessions via Layer 7.

### Domain 6: Context Engineering (Layer 7)

**Events it sends to orchestrator:**
- `COMPACTION_DETECTED` -- when PreCompact fires despite budget enforcement. The orchestrator treats this as evidence the task is too large and triggers re-decomposition via `REDECOMPOSE_TASK` to Layer 3.

**Commands it receives from orchestrator:**
None directly. Context engineering hooks attach to worker sessions.

### Compaction Signal Flow

The full flow when compaction is detected:
1. Layer 7 `PreCompact` hook fires inside a worker session.
2. Layer 7 emits `COMPACTION_DETECTED { task_id, session_id, utilization_at_compaction }` to the orchestrator.
3. The orchestrator's `await_worker` state receives the event.
4. Guard matches: transition to `escalate_worker`.
5. Actions fire: `handleCompactionDetected` resets task to `pending`, `dispatchRedecompose` emits `REDECOMPOSE_TASK` to Layer 3.
6. Layer 3 receives `REDECOMPOSE_TASK`, breaks the task into subtasks.
7. The user is notified via escalation. On `retry`, the develop loop re-enters with the now-smaller subtasks.

This ensures that context window pressure is surfaced as a structural signal (task too large) rather than a runtime coping mechanism (better compaction summaries).

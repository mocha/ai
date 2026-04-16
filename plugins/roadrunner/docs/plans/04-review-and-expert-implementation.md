# Domain 4: Review & Expert Pipeline — Roadrunner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the review and expert generation handler (Layer 4) for Roadrunner — vocabulary-routed expert prompt generation, pre-dispatch drift validation, spec compliance solo review, code quality panel review, verdict synthesis, and round management. Replaces the Layer 4 stubs in the worker handler (plan 03a Task 11).

**Architecture:** TypeScript command handler following the `createTaskSubstrateHandler()` pattern from `src/task-substrate/handler.ts`. Registers on the bus via `bus.onCommand()`, handles Layer 4 commands (`GENERATE_EXPERT`, `RUN_REVIEW`). All sub-agent dispatch goes through `claude` CLI.

**Tech Stack:** TypeScript, Node.js `child_process`, Zod (runtime validation), Claude Code CLI, Vitest

**Module location:** `src/review/` (follows naming convention of `src/orchestrator/`, `src/task-substrate/`, `src/worker/`)

**Artifact paths:** `.roadrunner/experts/`, `.roadrunner/verdicts/`, `.roadrunner/reports/` (follows `WorkerConfig.artifact_root` convention from plan 03a)

**Depends on:**
- Orchestrator (Layer 2) — command/event types in `src/orchestrator/`
- Worker handler (Layer 5) — plan 03a stubs for GENERATE_EXPERT + RUN_REVIEW; this plan replaces them
- Skylark methodology — `skills/_shared/` files read at runtime by sub-agents

---

## Architecture Decisions (Corrections from Original Plan)

### 1. Handler pattern, not fromPromise actors

The orchestrator dispatches commands via `bus.dispatch()` and receives events via `bus.sendEvent()`. All layers use the `create*Handler(deps, sendEvent)` factory pattern. Layer 4 follows suit with `createReviewHandler()`. The original plan's `fromPromise` actor approach does not match the implemented bus architecture.

### 2. Import orchestrator types, define only internal types

`GenerateExpert`, `ExpertReady`, `RunReview`, `ReviewComplete`, `ReviewFinding`, `TaskSpec`, `RiskLevel` are already defined in `src/orchestrator/`. This plan imports them and defines only Layer 4-internal types: `DriftResult`, `PanelConfig`, `VerdictFile`, `FindingSeverity`.

### 3. Gate field on ReviewComplete

The spec compliance loop must not count against the 2-round code quality cap. The orchestrator's `storeReviewResult` always increments `review_round`. Fix: add `gate: 'spec_compliance' | 'code_quality'` to `ReviewComplete`, conditionally increment only for code quality. Small orchestrator amendment (Task 7).

### 4. Trivial fast-path

The risk matrix skips expert generation and review for trivial tasks. The machine always enters `generate_expert` and `review_task` states regardless of risk. The handler short-circuits: trivial → minimal EXPERT_READY with `drift_check: pass`; trivial → auto-SHIP REVIEW_COMPLETE.

---

## Build Order Summary

```
Task 1: Internal types + Zod schemas (foundation)
Task 2: Expert prompt generator
  depends on: Task 1
Task 3: Drift validator
  depends on: Task 1
Task 4: Spec compliance review adapter
  depends on: Task 1
Task 5: Panel review adapter + config + synthesis
  depends on: Task 1, Task 4 (shared output parser)
Task 6: Verdict writer
  depends on: Task 1
Task 7: Orchestrator amendment — gate field on ReviewComplete
  depends on: none (modifies existing orchestrator code)
Task 8: Review handler (wires everything together)
  depends on: all above
Task 9: Integration test — pre-dispatch flow
  depends on: Task 8
Task 10: Integration test — post-implementation flow
  depends on: Task 8
```

Critical path: 1 → 2 → 8 → 9/10 (types → expert gen → handler → tests)

Parallel tracks:
- 1 → 2 (types → expert generator)
- 1 → 3 (types → drift validator)
- 1 → 4 (types → spec compliance)
- 1 → 5 (types → panel review)
- 1 → 6 (types → verdict writer)
- 7 (orchestrator amendment, independent)

---

## Task 1: Internal Types + Zod Schemas

**Description**

Define Layer 4-internal types and Zod schemas. These are types NOT already in the orchestrator — the orchestrator's `ReviewFinding`, `TaskSpec`, `RiskLevel`, `GenerateExpert`, `ExpertReady`, `RunReview`, `ReviewComplete` are imported, not redefined.

**Files to create**

- `src/review/types.ts`
- `src/review/schemas.ts`

**Key types (internal only)**

```typescript
import type { RiskLevel, ReviewFinding } from '../orchestrator/types.js';

/** Severity levels for review findings */
export type FindingSeverity = 'blocking' | 'major' | 'minor' | 'suggestion';

/** Typed finding with literal severity (narrows orchestrator's string type) */
export interface TypedFinding {
  severity: FindingSeverity;
  description: string;
  file: string;
  line: number | null;
}

/** Drift validation result */
export interface DriftResult {
  pass: boolean;
  mismatches: DriftMismatch[];
}

export interface DriftMismatch {
  type: 'file_missing' | 'identifier_not_found' | 'location_changed';
  reference: string;
  expected_location: string | null;
  actual_location: string | null;
  details: string;
}

/** Panel configuration derived from risk level */
export interface PanelConfig {
  panel_size: number;
  model: 'sonnet' | 'opus';
  max_rounds: number;
  adaptive_narrowing: boolean;
}

/** Verdict JSON file schema (persisted to .roadrunner/verdicts/) */
export interface VerdictFile {
  task_id: number;
  verdict: 'SHIP' | 'REVISE' | 'RETHINK';
  gate: 'spec_compliance' | 'code_quality';
  round: number;
  timestamp: string;
  report_path: string;
  findings_summary: {
    blocking: number;
    major: number;
    minor: number;
    suggestion: number;
  };
  panel_size: number;
  model: string;
}

/** Spec compliance review result (internal to handler) */
export interface SpecComplianceResult {
  compliant: boolean;
  findings: TypedFinding[];
}

/** Panel review synthesized result (internal to handler) */
export interface PanelSynthesis {
  verdict: 'SHIP' | 'REVISE' | 'RETHINK';
  consensus: TypedFinding[];
  unique: TypedFinding[];
  disagreements: string[];
  all_findings: TypedFinding[];
}

/** Per-expert result from panel dispatch */
export interface ExpertResult {
  expert_id: string;
  identity: string;
  verdict: 'SHIP' | 'REVISE' | 'RETHINK';
  findings: TypedFinding[];
  report_path: string;
}

/** Review handler configuration */
export interface ReviewConfig {
  /** Root directory for artifacts (default: '.roadrunner') */
  artifact_root: string;
  /** Path to claude CLI binary (default: 'claude') */
  claude_bin: string;
  /** Path to Skylark _shared/ methodology directory */
  methodology_path: string;
  /** Project root for drift validation */
  project_root: string;
}

export function createDefaultReviewConfig(): ReviewConfig;
```

**Zod schemas (`schemas.ts`)**

Runtime validation schemas for:
- `VerdictFile` (parsed when reading/writing verdict JSON)
- `TypedFinding` (parsed from sub-agent output)
- `DriftResult` (validated before emitting EXPERT_READY)

**Acceptance criteria**

- All types compile with strict TypeScript
- Types import `RiskLevel`, `ReviewFinding`, `TaskSpec` from `../orchestrator/types.js` — no duplication
- `FindingSeverity` is a literal union, not string
- Zod schemas parse valid data and reject invalid data (tested)
- `createDefaultReviewConfig()` returns sensible defaults
- No runtime dependencies beyond Zod — pure type definitions + one factory function + validation schemas

**Dependencies**

None. Foundation.

**Estimated scope**

~120 lines types + ~80 lines schemas.

---

## Task 2: Expert Prompt Generator

**Description**

Callable TypeScript function that generates a vocabulary-routed expert prompt. Shells out to `claude` CLI with a metaprompt that instructs the sub-agent to read the `_shared/` methodology files and produce a complete expert prompt following the 5-step process.

Two modes via `context` parameter:
- `"build"` — expert prompt for a worker/implementer
- `"critique"` — expert prompt for a reviewer

**Files to create**

- `src/review/generate-expert.ts`
- `src/review/prompts/expert-metaprompt.ts`
- `src/review/__tests__/generate-expert.test.ts`

**Key function**

```typescript
import type { GenerateExpert } from '../orchestrator/commands.js';
import type { ReviewConfig } from './types.js';

export interface GenerateExpertResult {
  expert_prompt_path: string;
  vocabulary_cluster_count: number;
}

export async function generateExpert(
  command: GenerateExpert,
  mode: 'build' | 'critique',
  config: ReviewConfig,
): Promise<GenerateExpertResult>;
```

**Metaprompt structure**

The metaprompt instructs the sub-agent to:
1. Read `expert-prompt-generator.md`, `vocabulary-guide.md`, `prompt-template.md` by absolute path
2. Receive task spec raw material (title, details, acceptanceCriteria, relevantFiles)
3. Receive codebase context (entry_points, recent_changes, related_tests)
4. Follow the 5-step process: analyze → identity → vocabulary → anti-patterns → assemble
5. Output a complete expert prompt following the 4-part structure (identity → vocabulary → anti-patterns → context)

Mode controls context-specific sections:
- `"build"`: Operational Guidance, Testing Expectations, Deliverables
- `"critique"`: Review Focus, Output Format, mandatory review directive

**Acceptance criteria**

- Function accepts `GenerateExpert` command payload and returns expert prompt path
- Expert prompt written to `.roadrunner/experts/TASK-{id}.md`
- Directory created if it doesn't exist
- Metaprompt references `_shared/` files by absolute path
- `"build"` mode requests implementation-focused sections
- `"critique"` mode requests review-focused sections with mandatory review directive
- If sub-agent produces <3 vocabulary clusters, logs warning but does not fail
- Error handling: CLI failure throws with stderr
- Tests mock the `claude` CLI call (do not invoke real CLI)

**Dependencies**

Task 1 (types)

**Estimated scope**

~200 lines function + ~100 lines metaprompt + ~100 lines test.

---

## Task 3: Drift Validator

**Description**

TypeScript function that checks the task spec's `relevantFiles` and text references against the current codebase. Catches stale assumptions from decomposition (the ENG-180 fix).

**Files to create**

- `src/review/drift-validator.ts`
- `src/review/__tests__/drift-validator.test.ts`

**Key function**

```typescript
import type { TaskSpec } from '../orchestrator/types.js';
import type { DriftResult } from './types.js';

export async function validateDrift(
  task: TaskSpec,
  projectRoot: string,
): Promise<DriftResult>;

/** Extract code identifiers from text (function names, type names, import paths) */
export function extractIdentifiers(text: string): string[];
```

**Validation steps**

1. Check each file in `relevantFiles` exists
2. Extract identifiers from `details` and `acceptanceCriteria` using regex
3. For each identifier: grep the codebase to verify it exists
4. Report mismatches as `DriftMismatch` entries

**Acceptance criteria**

- Detects missing files: `type: 'file_missing'`
- Detects missing identifiers: `type: 'identifier_not_found'`
- Returns `pass: true` when all checks succeed
- Returns `pass: false` with populated `mismatches` when any check fails
- Handles tasks with no extractable identifiers gracefully (pass: true)
- Runs in <5 seconds for a typical project
- Tests use a temporary directory with known files

**Dependencies**

Task 1 (types)

**Estimated scope**

~100 lines logic + ~50 lines regex extraction + ~80 lines test.

---

## Task 4: Spec Compliance Review Adapter

**Description**

Dispatches a solo reviewer sub-agent for spec compliance checking. Constructs the dispatch prompt, invokes `claude` CLI, parses structured output into typed findings.

**Files to create**

- `src/review/spec-compliance.ts`
- `src/review/prompts/spec-compliance-prompt.ts`
- `src/review/parsers/review-output-parser.ts`
- `src/review/__tests__/spec-compliance.test.ts`

**Key function**

```typescript
import type { RunReview } from '../orchestrator/commands.js';
import type { SpecComplianceResult, ReviewConfig } from './types.js';

export async function runSpecComplianceReview(
  command: RunReview,
  config: ReviewConfig,
): Promise<SpecComplianceResult>;
```

**Prompt construction**

- Identity: "spec compliance reviewer" (not code quality)
- Includes "do not trust the implementer's report" directive
- Receives: full task requirements, acceptance criteria, worker's claimed report, worktree path
- Reviews by reading actual code, not trusting the report

**Output parser** (`parsers/review-output-parser.ts`)

Parses the sub-agent's structured markdown output (Strengths / Issues / Missing / Verdict sections) into `TypedFinding[]`. Shared between spec compliance and panel review.

**Acceptance criteria**

- Function accepts `RunReview` command and returns `SpecComplianceResult`
- Uses `generateExpert()` in `"critique"` mode for vocabulary-routed reviewer prompt
- "Do not trust the implementer" directive present in dispatch prompt
- Reviewer identity is "spec compliance reviewer"
- Output parsed into typed findings with severity
- `compliant: true` when no blocking or major findings
- `compliant: false` when any blocking or major finding
- Parser handles non-conforming sub-agent output (warning + single "unparseable" finding)
- Tests mock CLI call

**Dependencies**

Task 1 (types), Task 2 (expert generator in critique mode)

**Estimated scope**

~150 lines adapter + ~80 lines prompt + ~100 lines parser + ~100 lines test.

---

## Task 5: Panel Review Adapter + Config + Synthesis

**Description**

Dispatches multiple parallel expert reviewers for code quality review. Determines panel config from risk level, generates vocabulary-routed prompts per panelist, dispatches in parallel, synthesizes findings.

**Files to create**

- `src/review/panel-review.ts`
- `src/review/panel-config.ts`
- `src/review/synthesize-findings.ts`
- `src/review/prompts/panel-expert-prompt.ts`
- `src/review/__tests__/panel-review.test.ts`
- `src/review/__tests__/synthesize-findings.test.ts`

**Key functions**

```typescript
// panel-config.ts
import type { RiskLevel } from '../orchestrator/types.js';
import type { PanelConfig } from './types.js';

export function getPanelConfig(risk: RiskLevel): PanelConfig;

// panel-review.ts
import type { RunReview } from '../orchestrator/commands.js';
import type { PanelSynthesis, ReviewConfig } from './types.js';

export async function runPanelReview(
  command: RunReview,
  config: ReviewConfig,
): Promise<PanelSynthesis>;

// synthesize-findings.ts
import type { ExpertResult, PanelSynthesis } from './types.js';

export function synthesizeFindings(results: ExpertResult[]): PanelSynthesis;
```

**Panel sizing by risk**

| Risk | Panel size | Model | Adaptive |
|------|-----------|-------|----------|
| trivial | 0 (skip) | — | no |
| standard | 2-3 | sonnet | no |
| elevated | 3-4 | sonnet | no |
| critical | 3-4 (5 in round 1) | opus | yes |

**Synthesis rules**

- Consensus: flagged by 2+ experts
- Unique: flagged by exactly 1 expert
- "One Rethink vetoes": any expert Rethink → consolidated Rethink
- "All Ship": every expert Ship → consolidated Ship
- Otherwise: Revise

**Acceptance criteria**

- Panel size matches risk matrix
- Each panelist gets distinct vocabulary-routed prompt via `generateExpert()` in critique mode
- All panelists dispatched in parallel (`Promise.all`)
- Synthesis correctly identifies consensus, unique findings, disagreements
- "One Rethink vetoes" rule applied
- Adaptive narrowing for critical risk round 2: retain 2-3 strongest experts
- Independence rule: round 2 experts do NOT receive round 1 findings
- Panel report written to `.roadrunner/reports/`
- Tests mock CLI calls, verify synthesis logic independently

**Dependencies**

Task 1 (types), Task 4 (shared output parser)

**Estimated scope**

~250 lines adapter + ~60 lines config + ~150 lines synthesis + ~60 lines prompt + ~200 lines test.

---

## Task 6: Verdict Writer

**Description**

Writes verdict JSON to `.roadrunner/verdicts/TASK-{id}.json`. Validates against Zod schema before writing.

**Files to create**

- `src/review/verdict-writer.ts`
- `src/review/__tests__/verdict-writer.test.ts`

**Key function**

```typescript
import type { ReviewComplete } from '../orchestrator/events.js';
import type { VerdictFile, ReviewConfig } from './types.js';

export function writeVerdict(
  event: ReviewComplete,
  gate: 'spec_compliance' | 'code_quality',
  panelSize: number,
  model: string,
  config: ReviewConfig,
): string; // returns verdict file path
```

**Acceptance criteria**

- Writes valid JSON to `.roadrunner/verdicts/TASK-{id}.json`
- Directory created if needed
- JSON validated against VerdictFile Zod schema before writing
- `findings_summary` counts computed from findings array
- Overwrites previous verdict for same task (round 2 replaces round 1)
- Tests verify JSON structure and schema validation

**Dependencies**

Task 1 (types/schemas)

**Estimated scope**

~60 lines + ~40 lines test.

---

## Task 7: Orchestrator Amendment — Gate Field on ReviewComplete

**Description**

Small, surgical change to support the spec compliance loop not counting against the code quality round cap. Adds `gate` field to `ReviewComplete` event, makes `storeReviewResult` conditionally increment `review_round` only for code quality verdicts.

**Files to modify**

- `src/orchestrator/events.ts` — add `gate` field to `ReviewComplete`
- `src/orchestrator/actions.ts` — conditional increment in `storeReviewResult`
- `src/orchestrator/__tests__/machine.test.ts` — test conditional increment

**Code changes**

In `events.ts`:

```typescript
export interface ReviewComplete {
  type: 'REVIEW_COMPLETE';
  task_id: number;
  verdict: 'SHIP' | 'REVISE' | 'RETHINK';
  round: number;
  report_path: string;
  findings: ReviewFinding[];
  gate: 'spec_compliance' | 'code_quality';  // NEW
}
```

In `actions.ts`, `storeReviewResult`:

```typescript
export const storeReviewResult = assign(
  ({ context, event }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    if (event.type !== 'REVIEW_COMPLETE') return {};
    return {
      last_review_verdict: event.verdict,
      last_review_findings: event.findings,
      // Only increment round counter for code quality verdicts
      review_round: event.gate === 'code_quality'
        ? context.review_round + 1
        : context.review_round,
    };
  },
);
```

**Acceptance criteria**

- `ReviewComplete` event type includes `gate` field
- `storeReviewResult` increments `review_round` only when `gate === 'code_quality'`
- Spec compliance REVISE does not consume a review round
- All existing tests pass (update test events to include `gate: 'code_quality'` for backward compat)
- New test: verify spec compliance REVISE does not increment round counter

**Dependencies**

None (modifies existing orchestrator code).

**Estimated scope**

~30 lines changed across 3 files.

---

## Task 8: Review Handler

**Description**

The integration hub. Command handler following `createTaskSubstrateHandler()` pattern that handles `GENERATE_EXPERT` and `RUN_REVIEW` commands. Routes to the appropriate modules and manages internal state (spec compliance attempt tracking).

Replaces the Layer 4 stubs in the worker handler (plan 03a Task 11).

**Files to create**

- `src/review/handler.ts`
- `src/review/index.ts` (barrel exports)
- `src/review/__tests__/handler.test.ts`

**Key structure**

```typescript
import type { OrchestratorCommand } from '../orchestrator/commands.js';
import type { OrchestratorEvent } from '../orchestrator/events.js';
import type { ReviewConfig } from './types.js';

type SendEvent = (event: OrchestratorEvent) => void;

export function createReviewHandler(
  config: ReviewConfig,
  sendEvent: SendEvent,
): (command: OrchestratorCommand) => void;
```

**Command routing**

| Command | Handler | Notes |
|---------|---------|-------|
| `GENERATE_EXPERT` | `handleGenerateExpert()` | Generate expert prompt + drift validation |
| `RUN_REVIEW` | `handleRunReview()` | Spec compliance → panel review → verdict |
| Other | Ignored | Commands for other layers pass through |

**GENERATE_EXPERT flow**

1. Check risk: trivial → short-circuit with minimal EXPERT_READY (drift_check: pass)
2. Call `generateExpert()` in build mode
3. Call `validateDrift()` against current codebase
4. Emit `EXPERT_READY` with expert_prompt_path and drift result

**RUN_REVIEW flow**

1. Check risk: trivial → short-circuit with SHIP verdict (gate: code_quality)
2. Run `runSpecComplianceReview()`
3. If not compliant:
   - Track spec compliance attempt count (internal state per task)
   - If 3 consecutive failures: emit REVIEW_COMPLETE with RETHINK (gate: spec_compliance)
   - Otherwise: emit REVIEW_COMPLETE with REVISE (gate: spec_compliance)
4. If compliant: run `runPanelReview()`
5. Write verdict via `writeVerdict()`
6. Emit REVIEW_COMPLETE with panel verdict (gate: code_quality)

**Internal state**

```typescript
// Spec compliance failure count per task
const specFailures: Map<number, number> = new Map();
```

**Acceptance criteria**

- Handler registers on bus and routes both command types
- GENERATE_EXPERT: trivial fast-path + full expert generation + drift validation
- RUN_REVIEW: trivial fast-path + spec compliance → panel → verdict
- Spec compliance failures tracked per task; 3 consecutive → RETHINK
- Gate field set correctly on all REVIEW_COMPLETE events
- Error handling: exceptions send DISPATCH_ERROR event, do not throw
- Barrel export (`index.ts`) exports: createReviewHandler, all types
- Tests mock generateExpert, validateDrift, runSpecComplianceReview, runPanelReview
- Tests verify: happy path, trivial fast-path, spec compliance failure loop, RETHINK escalation

**Dependencies**

All previous tasks (1-7)

**Estimated scope**

~200 lines handler + ~30 lines barrel + ~200 lines test.

---

## Task 9: Integration Test — Pre-Dispatch Flow

**Description**

End-to-end test of the pre-dispatch pipeline: mock GENERATE_EXPERT → expert prompt generated → drift validation → EXPERT_READY emitted.

**Files to create**

- `src/review/__tests__/pre-dispatch.test.ts`

**Test scenarios**

1. Standard risk, drift passes: expert prompt written, EXPERT_READY with drift_check: pass
2. Standard risk, drift fails (missing file): expert prompt still written, EXPERT_READY with drift_check: fail
3. Trivial risk: fast-path, no expert generation, EXPERT_READY with minimal content

**Acceptance criteria**

- Tests mock claude CLI (no real invocation)
- Expert prompt file written to `.roadrunner/experts/TASK-{id}.md`
- Drift result correctly propagated
- Trivial fast-path verified

**Dependencies**

Task 8 (handler)

**Estimated scope**

~100 lines test.

---

## Task 10: Integration Test — Post-Implementation Flow

**Description**

End-to-end test of the post-implementation pipeline: mock RUN_REVIEW → spec compliance → panel review → verdict → REVIEW_COMPLETE emitted.

**Files to create**

- `src/review/__tests__/post-implementation.test.ts`

**Test scenarios**

1. SHIP path: spec compliant + all panelists SHIP → REVIEW_COMPLETE with SHIP, gate: code_quality
2. REVISE path: spec compliant + blocking findings → REVIEW_COMPLETE with REVISE, gate: code_quality
3. RETHINK path: one panelist RETHINK → REVIEW_COMPLETE with RETHINK, gate: code_quality
4. Spec compliance failure: not compliant → REVIEW_COMPLETE with REVISE, gate: spec_compliance
5. Spec compliance 3x failure: → REVIEW_COMPLETE with RETHINK, gate: spec_compliance
6. Trivial risk: auto-SHIP fast-path
7. Round cap: round 2 with REVISE → includes all findings + escalation signal

**Acceptance criteria**

- Tests mock all sub-agent dispatch
- Verdict JSON written and valid
- Gate field set correctly in all scenarios
- Spec compliance failure count tracked across calls

**Dependencies**

Task 8 (handler)

**Estimated scope**

~200 lines test.

---

## File Inventory

### New files (18)

| File | Task | Purpose |
|------|------|---------|
| `src/review/types.ts` | 1 | Layer 4-internal types + config |
| `src/review/schemas.ts` | 1 | Zod runtime validation schemas |
| `src/review/generate-expert.ts` | 2 | Expert prompt generator |
| `src/review/prompts/expert-metaprompt.ts` | 2 | Metaprompt template for sub-agent |
| `src/review/__tests__/generate-expert.test.ts` | 2 | Expert generator tests |
| `src/review/drift-validator.ts` | 3 | Pre-dispatch drift validation |
| `src/review/__tests__/drift-validator.test.ts` | 3 | Drift validator tests |
| `src/review/spec-compliance.ts` | 4 | Spec compliance solo review adapter |
| `src/review/prompts/spec-compliance-prompt.ts` | 4 | Spec reviewer prompt template |
| `src/review/parsers/review-output-parser.ts` | 4 | Parse reviewer markdown into typed findings |
| `src/review/__tests__/spec-compliance.test.ts` | 4 | Spec compliance tests |
| `src/review/panel-review.ts` | 5 | Code quality panel review adapter |
| `src/review/panel-config.ts` | 5 | Risk → panel config mapping |
| `src/review/synthesize-findings.ts` | 5 | Finding synthesis + verdict consolidation |
| `src/review/prompts/panel-expert-prompt.ts` | 5 | Panelist prompt template |
| `src/review/__tests__/panel-review.test.ts` | 5 | Panel review tests |
| `src/review/__tests__/synthesize-findings.test.ts` | 5 | Synthesis unit tests |
| `src/review/verdict-writer.ts` | 6 | Write verdict JSON |
| `src/review/__tests__/verdict-writer.test.ts` | 6 | Verdict writer tests |
| `src/review/handler.ts` | 8 | Command handler (integration hub) |
| `src/review/index.ts` | 8 | Barrel exports |
| `src/review/__tests__/handler.test.ts` | 8 | Handler unit tests |
| `src/review/__tests__/pre-dispatch.test.ts` | 9 | Pre-dispatch integration test |
| `src/review/__tests__/post-implementation.test.ts` | 10 | Post-implementation integration test |

### Modified files (3)

| File | Task | Change |
|------|------|--------|
| `src/orchestrator/events.ts` | 7 | Add `gate` field to `ReviewComplete` |
| `src/orchestrator/actions.ts` | 7 | Conditional round increment based on gate |
| `src/orchestrator/__tests__/machine.test.ts` | 7 | Test gate-conditional round increment |

---

## Total Estimated Scope

| Task | LOC | Test LOC | Total |
|------|-----|----------|-------|
| 1. Types + schemas | 200 | — | 200 |
| 2. Expert generator | 300 | 100 | 400 |
| 3. Drift validator | 150 | 80 | 230 |
| 4. Spec compliance | 330 | 100 | 430 |
| 5. Panel review + synthesis | 520 | 200 | 720 |
| 6. Verdict writer | 60 | 40 | 100 |
| 7. Orchestrator amendment | 30 | 30 | 60 |
| 8. Review handler | 230 | 200 | 430 |
| 9. Pre-dispatch test | — | 100 | 100 |
| 10. Post-impl test | — | 200 | 200 |
| **Total** | **~1,820** | **~1,050** | **~2,870** |

---

## Integration Points

### Upstream: Orchestrator (Layer 2)

The orchestrator dispatches commands and receives events via the event bus. The review handler registers via `bus.onCommand()` alongside the task substrate handler and worker handler.

| Command | Source action | Response event |
|---------|-------------|---------------|
| `GENERATE_EXPERT` | `dispatchGenerateExpert()` | `EXPERT_READY` |
| `RUN_REVIEW` | `dispatchReview()` | `REVIEW_COMPLETE` |

### Upstream: Worker Handler (Layer 5)

Plan 03a's worker handler has stubs for GENERATE_EXPERT and RUN_REVIEW. When the review handler is registered on the bus, it handles these commands instead. The worker handler stubs can be removed or left as fallback (the first handler to respond wins).

### Downstream: Skylark Methodology

Sub-agents read `_shared/` files at runtime:
- `expert-prompt-generator.md` — 5-step process
- `vocabulary-guide.md` — term extraction and validation
- `prompt-template.md` — prompt skeleton and rules
- `risk-matrix.md` — panel sizing reference

These files are NOT modified. The review handler passes their paths to sub-agents.

### Event Flow

```
Orchestrator                Review Handler              Claude CLI (sub-agents)
    |                            |                            |
    |-- GENERATE_EXPERT -------->|                            |
    |                            |-- generateExpert() ------->|
    |                            |<-- expert prompt written --|
    |                            |-- validateDrift()          |
    |<-- EXPERT_READY -----------|                            |
    |                            |                            |
    |-- RUN_REVIEW ------------->|                            |
    |                            |-- spec compliance -------->|
    |                            |<-- findings/pass ---------|
    |                            |                            |
    |                            |   [if spec compliant:]     |
    |                            |-- panel dispatch --------->|
    |                            |   (N experts in parallel)  |
    |                            |<-- N expert results -------|
    |                            |-- synthesizeFindings()     |
    |                            |-- writeVerdict()           |
    |<-- REVIEW_COMPLETE --------|                            |
```

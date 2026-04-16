# Domain 4: Review & Expert Pipeline -- Implementation Plan

## Scope

This domain implements the two phases of Layer 4 that bookend worker execution:

- **Pre-dispatch:** Generate a vocabulary-routed expert prompt for the task, run pre-dispatch drift validation against current code, emit `EXPERT_READY`.
- **Post-implementation:** Run spec compliance solo review, then code quality panel review, emit `REVIEW_COMPLETE` with a typed verdict (`SHIP` / `REVISE` / `RETHINK`).

Vocabulary routing is applied in both phases: once for the worker's expert prompt, once for each reviewer panelist's expert prompt. Same methodology, two application points.

## What this domain does NOT cover

- Worker execution itself (Domain 3 / Layer 5)
- Task decomposition (Domain 2 / Layer 3)
- The orchestrator state machine (Domain 1 / Layer 2)

## Key constraint: adapt, do not rewrite

The existing Skylark `_shared/` methodology files and review skills (`panel-review`, `solo-review`, `spec-review`, `develop`) already implement most of this domain's functionality as Claude Code skills. They are battle-tested. This plan adapts them to the new event-driven orchestrator architecture. It does not replace them.

## Prerequisites

| Prerequisite | Source | What it provides |
|---|---|---|
| Domain 1 Orchestrator types | `src/orchestrator/types.ts` | `GENERATE_EXPERT`, `EXPERT_READY`, `RUN_REVIEW`, `REVIEW_COMPLETE` event type definitions |
| Domain 2 Task substrate | `src/substrate/` | Task spec shape (`id`, `title`, `description`, `details`, `acceptanceCriteria`, `relevantFiles`, `complexity`) |
| XState v5 `fromPromise` pattern | Domain 1 plan | Convention for wrapping async work as invocable actors |

---

## Task 1: Define typed event and verdict schemas

### Description

Define the TypeScript types and Zod schemas for the four Layer 4 events (`GENERATE_EXPERT`, `EXPERT_READY`, `RUN_REVIEW`, `REVIEW_COMPLETE`) and the persisted verdict JSON format. These types are the contract between Layer 4 and the orchestrator. They must be importable by both the orchestrator machine definition (Domain 1) and every Layer 4 component.

Also define the `FindingSeverity` enum (`blocking | major | minor | suggestion`) and the `Finding` type (`severity`, `description`, `file`, `line`).

### Files to create/modify

| File | Action | Notes |
|---|---|---|
| `src/layer4/types.ts` | **NEW** | All Layer 4 event types, verdict schema, finding types |
| `src/layer4/schemas.ts` | **NEW** | Zod runtime schemas matching the types (used for validation when reading/writing verdict JSON files) |

### Acceptance criteria

- `GENERATE_EXPERT` type matches the input shape from spec section 3 (`task_id`, `task`, `risk`, `codebase_context`)
- `EXPERT_READY` type matches spec section 6 output (`task_id`, `expert_prompt_path`, `drift_check`, `drift_details`)
- `RUN_REVIEW` type matches spec section 3 post-implementation input (`task_id`, `worktree_path`, `task_spec`, `worker_result`, `risk`, `round`)
- `REVIEW_COMPLETE` type matches spec section 6 output (`task_id`, `verdict`, `round`, `report_path`, `findings`)
- Verdict JSON schema matches spec section 5.4 format (`task_id`, `verdict`, `round`, `timestamp`, `report_path`, `findings_summary`, `panel_size`, `model`)
- Zod schemas parse and reject invalid payloads (tested)
- `FindingSeverity` and `Verdict` are literal union types, not string

### Dependencies

- Domain 1 must have established the project's TypeScript + Zod conventions (tsconfig, Zod version). If not yet established, this task establishes them for `src/layer4/` and Domain 1 adopts the same.

### Estimated scope

Small. ~150 lines of types + schemas + a test file. Pure data definitions, no logic.

---

## Task 2: Build the expert prompt generator (callable)

### Description

Extract the expert generation logic from the existing `_shared/` methodology into a callable TypeScript function that the orchestrator can invoke via `fromPromise`. The function reads the task spec and codebase context, then shells out to `claude` CLI with a metaprompt that follows the 5-step process from `expert-prompt-generator.md`. The metaprompt instructs the sub-agent to read `vocabulary-guide.md` and `prompt-template.md` and produce a complete expert prompt.

The key insight: the _shared/ methodology files already define the process. This function does not re-implement vocabulary routing in TypeScript. It constructs a dispatch prompt that references the methodology files by path and provides the task-specific raw material (task spec, entry point files, recent changes, related tests). The sub-agent does the vocabulary extraction and prompt assembly.

The function writes the resulting expert prompt to `.skylark/experts/TASK-NNN.md`.

Two modes, controlled by a `context` parameter:
- `"build"` -- generates an expert prompt for a worker/implementer (includes Operational Guidance, Testing Expectations, Deliverables sections per `prompt-template.md`)
- `"critique"` -- generates an expert prompt for a reviewer (includes Review Focus, Output Format sections per `prompt-template.md`)

Same 4-part methodology (identity + vocabulary + anti-patterns + context) in both modes. The `context` parameter controls which context-specific sections the sub-agent appends.

### Files to create/modify

| File | Action | Notes |
|---|---|---|
| `src/layer4/generate-expert.ts` | **NEW** | `generateExpert(input: GenerateExpertInput): Promise<ExpertReadyEvent>` -- the callable function |
| `src/layer4/prompts/expert-metaprompt.ts` | **NEW** | Template for the metaprompt dispatched to the sub-agent. Interpolates task spec, codebase context, methodology file paths, and context mode (`build` / `critique`) |
| `skills/_shared/expert-prompt-generator.md` | **NO CHANGE** | Read by the sub-agent at runtime. Not modified. |
| `skills/_shared/vocabulary-guide.md` | **NO CHANGE** | Read by the sub-agent at runtime. Not modified. |
| `skills/_shared/prompt-template.md` | **NO CHANGE** | Read by the sub-agent at runtime. Not modified. |

### Acceptance criteria

- Function accepts a `GENERATE_EXPERT` event payload and returns an `EXPERT_READY` event payload
- Expert prompt is written to `.skylark/experts/TASK-{id}.md`
- `.skylark/experts/` directory is created if it does not exist
- The metaprompt explicitly instructs the sub-agent to read the three `_shared/` files by absolute path
- The metaprompt passes `codebase_context.entry_points`, `related_tests`, and `recent_changes` as raw material for vocabulary extraction
- `"build"` mode metaprompt requests Operational Guidance + Testing Expectations + Deliverables sections
- `"critique"` mode metaprompt requests Review Focus + Output Format sections with the mandatory review directive
- If the sub-agent returns a prompt with fewer than 3 vocabulary clusters, the function logs a warning but does not fail (the drift validator may still catch problems)
- Error handling: if the `claude` CLI call fails, the function throws with the stderr output

### Dependencies

- Task 1 (types)
- A working `claude` CLI on `$PATH` (the function shells out to `claude --print` or equivalent)

### Estimated scope

Medium. ~200 lines for the function + ~100 lines for the metaprompt template. The heavy lifting is done by the sub-agent following the existing methodology -- this function is plumbing.

---

## Task 3: Build the pre-dispatch drift validator

### Description

New component (~80 lines). Reads the task spec's `relevantFiles` and `details`/`acceptanceCriteria`, extracts function signatures, type names, import paths, and file paths mentioned in the plan text, then checks each against the current codebase.

This is the specific fix for ENG-180's dead-end tasks, where workers were dispatched with stale assumptions about code that had changed since decomposition.

Implementation: a TypeScript function (not a separate script) that:
1. Collects all file paths from `relevantFiles`
2. Extracts identifiers from `details` and `acceptanceCriteria` using regex (function names, type names, import paths -- anything that looks like a code reference)
3. For each file path: checks that the file exists
4. For each extracted identifier: runs `grep -rn` against the codebase to verify it exists where expected
5. Returns a structured result: `{ pass: boolean, mismatches: DriftMismatch[] }`

### Files to create/modify

| File | Action | Notes |
|---|---|---|
| `src/layer4/drift-validator.ts` | **NEW** | `validateDrift(task: TaskSpec, projectRoot: string): Promise<DriftResult>` |
| `src/layer4/types.ts` | **MODIFY** | Add `DriftResult` and `DriftMismatch` types |

### Acceptance criteria

- Detects missing files: a file listed in `relevantFiles` that does not exist returns a mismatch with `type: "file_missing"`
- Detects missing identifiers: a function name referenced in `details` that cannot be found via grep returns a mismatch with `type: "identifier_not_found"`
- Detects signature changes: a function name found but at a different location than expected returns a mismatch with `type: "location_changed"` (best-effort -- grep finds occurrences, compares against expected file)
- Returns `pass: true` when all checks succeed
- Returns `pass: false` with populated `mismatches` array when any check fails
- Does not fail on tasks with no extractable identifiers (returns `pass: true` with empty mismatches)
- Runs in under 5 seconds for a typical project (grep is fast)
- Test: given a mock task spec referencing a file that exists and one that does not, returns the correct result

### Dependencies

- Task 1 (types)
- Node.js `child_process` for running grep (or use `node:fs` for file existence checks and grep for identifier search)

### Estimated scope

Small. ~80 lines of logic + ~50 lines of identifier extraction regexes + a test file.

---

## Task 4: Build the pre-dispatch orchestration function

### Description

Compose Tasks 2 and 3 into a single `fromPromise`-compatible async function that the orchestrator invokes when it sends `GENERATE_EXPERT`. This function:

1. Calls `generateExpert()` (Task 2) in `"build"` mode to produce the worker's expert prompt
2. Calls `validateDrift()` (Task 3) against the current codebase
3. Assembles and returns the `EXPERT_READY` event with `expert_prompt_path` and `drift_check` result

This is the "glue" between the orchestrator and the two pre-dispatch components.

### Files to create/modify

| File | Action | Notes |
|---|---|---|
| `src/layer4/pre-dispatch.ts` | **NEW** | `preDispatch(event: GenerateExpertEvent): Promise<ExpertReadyEvent>` -- the orchestrator-callable function |

### Acceptance criteria

- Accepts a `GENERATE_EXPERT` event and returns an `EXPERT_READY` event
- Calls `generateExpert` then `validateDrift` sequentially (expert prompt must be written before drift check, per spec section 4)
- On drift pass: returns `{ drift_check: "pass", drift_details: null, ... }`
- On drift fail: returns `{ drift_check: "fail", drift_details: "<mismatch descriptions>", ... }` -- the expert prompt is still written (per spec section 11)
- Expert prompt path is included in the response regardless of drift result
- Validates the returned event against the Zod schema (Task 1) before returning
- Error handling: if expert generation fails, propagates the error (orchestrator handles). If drift validation fails (runtime error, not drift detection), logs warning and returns `drift_check: "pass"` (fail-open on validator errors, fail-closed on actual drift)

### Dependencies

- Task 1 (types/schemas)
- Task 2 (expert generator)
- Task 3 (drift validator)

### Estimated scope

Small. ~60 lines. Pure composition and error handling.

---

## Task 5: Build the spec compliance solo review adapter

### Description

Adapt the existing `solo-review` skill to be invocable programmatically by the orchestrator. The adapter:

1. Receives a `RUN_REVIEW` event
2. Constructs a spec compliance review prompt following the existing `solo-review` methodology, but with the "do not trust the implementer's report" directive from spec section 5.1
3. Dispatches a sub-agent via `claude` CLI with the constructed prompt
4. Parses the sub-agent's structured output (Strengths / Issues / Missing / Verdict)
5. Returns a typed result: `{ compliant: boolean, findings: Finding[] }`

The prompt construction follows `solo-review/SKILL.md` step 2 exactly, with one key addition: the identity is forced to "spec compliance reviewer" (not code quality reviewer) and the focus directives from spec section 5.1 are injected.

### What stays the same vs what changes

| Aspect | Status |
|---|---|
| Vocabulary routing methodology | **Same** -- sub-agent reads `_shared/` files |
| "Do not trust the implementer" directive | **Same** -- already in `develop/SKILL.md` step 7 |
| Expert prompt structure (identity + vocab + anti-patterns + context) | **Same** |
| Mandatory review directive | **Same** |
| Invocation mechanism | **Changes** -- from skill-level prose instructions to a callable TypeScript function |
| Output format | **Changes** -- from free-text to parsed `Finding[]` typed array |
| Caller | **Changes** -- from `develop` skill to orchestrator via `fromPromise` |

### Files to create/modify

| File | Action | Notes |
|---|---|---|
| `src/layer4/spec-compliance-review.ts` | **NEW** | `runSpecComplianceReview(input: SpecReviewInput): Promise<SpecReviewResult>` |
| `src/layer4/prompts/spec-compliance-prompt.ts` | **NEW** | Template for the spec compliance reviewer dispatch prompt. References `_shared/` methodology files. Embeds the "do not trust" directive. |
| `src/layer4/parsers/review-output-parser.ts` | **NEW** | Parse the sub-agent's structured markdown output into `Finding[]`. Handles Strengths/Issues/Missing/Verdict sections. |
| `skills/solo-review/SKILL.md` | **NO CHANGE** | The skill itself is not modified. The adapter constructs equivalent prompts programmatically. |

### Acceptance criteria

- Function accepts task spec, worktree path, and worker result
- Uses `generateExpert()` (Task 2) in `"critique"` mode to generate a vocabulary-routed reviewer prompt scoped to spec compliance
- The reviewer's identity is explicitly "spec compliance reviewer" -- does not evaluate code quality
- The "do not trust the implementer's report" directive is present in the dispatch prompt
- The reviewer sub-agent receives: full task requirements + acceptance criteria, implementer's claimed report, and the worktree path to read actual code
- Output is parsed into typed `Finding[]` with severity, description, file, line
- `compliant: true` when no blocking or major findings
- `compliant: false` when any blocking or major finding exists
- Parser handles the case where the sub-agent returns non-conforming output (logs warning, treats as non-compliant with a single "unparseable output" finding)

### Dependencies

- Task 1 (types)
- Task 2 (expert generator in `"critique"` mode)

### Estimated scope

Medium. ~150 lines for the adapter + ~80 lines for the prompt template + ~100 lines for the output parser.

---

## Task 6: Build the code quality panel review adapter

### Description

Adapt the existing `panel-review` skill to be invocable programmatically by the orchestrator. The adapter:

1. Receives a `RUN_REVIEW` event (only after spec compliance passes)
2. Determines panel size and model from risk level using `_shared/risk-matrix.md` configuration
3. Generates vocabulary-routed expert prompts for each panelist using `generateExpert()` in `"critique"` mode -- each panelist gets a distinct identity and at least one unique vocabulary cluster
4. Dispatches all panelists in parallel via `claude` CLI
5. Synthesizes findings using the `panel-review` consolidation logic (consensus, unique, disagreements, blocking)
6. Applies the "one Rethink vetoes" consolidation rule
7. Returns the consolidated verdict and findings

### What stays the same vs what changes

| Aspect | Status |
|---|---|
| Panel sizing by risk level | **Same** -- from `risk-matrix.md` |
| Expert prompt methodology | **Same** -- vocabulary routing via `_shared/` files |
| Parallel dispatch | **Same** -- all experts dispatched concurrently |
| Synthesis structure (consensus, unique, disagreements, blocking) | **Same** |
| "One Rethink vetoes" rule | **Same** |
| Mandatory review directive | **Same** |
| Invocation mechanism | **Changes** -- from skill-level prose to callable TypeScript function |
| Output format | **Changes** -- from markdown report to typed verdict + findings |
| Multi-round independence rule | **Changes** -- when called by the orchestrator, round 2 experts do NOT receive round 1 findings (overrides the `panel-review` skill's default multi-round behavior per spec section 9) |
| Adaptive narrowing | **NEW** -- for critical risk, round 2 narrows to 2-3 strongest experts from round 1 |

### Files to create/modify

| File | Action | Notes |
|---|---|---|
| `src/layer4/panel-review.ts` | **NEW** | `runPanelReview(input: PanelReviewInput): Promise<ReviewCompleteEvent>` |
| `src/layer4/prompts/panel-expert-prompt.ts` | **NEW** | Template for each panelist's dispatch prompt. Parameterized by expert identity, vocabulary clusters, and review angle. |
| `src/layer4/panel-config.ts` | **NEW** | `getPanelConfig(risk: RiskLevel): PanelConfig` -- maps risk level to panel size, model, and round count. Encodes the table from spec section 10. |
| `src/layer4/synthesize-findings.ts` | **NEW** | `synthesizeFindings(expertResults: ExpertResult[]): SynthesizedFindings` -- implements consensus/unique/disagreement/blocking logic and "one Rethink vetoes" |
| `skills/panel-review/SKILL.md` | **NO CHANGE** | The skill itself is not modified. |

### Acceptance criteria

- Panel size matches risk matrix: standard=2-3, elevated=3-4, critical=3-4 (up to 5 in adaptive round 1)
- Model matches risk matrix: standard=Sonnet, elevated=Sonnet, critical=Opus
- Each panelist gets a distinct vocabulary-routed prompt generated via `generateExpert()` in `"critique"` mode
- Each panelist has at least one vocabulary cluster unique to their perspective
- All panelists are dispatched concurrently (parallel `Promise.all` or equivalent)
- Synthesis correctly identifies consensus findings (flagged by 2+ experts)
- Synthesis correctly identifies unique findings (flagged by exactly 1 expert)
- "One Rethink vetoes": if any expert says Rethink, consolidated verdict is Rethink
- "All Ship": if every expert says Ship (with nits), consolidated verdict is Ship
- Otherwise: consolidated verdict is Revise
- Panel report is written to `docs/reports/R-{timestamp}-panel-synthesis.md`
- Per-expert reports are written to `docs/reports/R-{timestamp}-panel-{expert-slug}.md`
- Returns a fully populated `REVIEW_COMPLETE` event

### Dependencies

- Task 1 (types/schemas)
- Task 2 (expert generator in `"critique"` mode)
- Task 5 (output parser -- shared)

### Estimated scope

Large. ~250 lines for the adapter + ~80 lines for panel config + ~150 lines for synthesis logic + ~60 lines for prompt template. This is the most complex component in the domain.

---

## Task 7: Build the verdict writer

### Description

Write the verdict JSON file to `.skylark/verdicts/TASK-NNN.json` after review completes. Validates the verdict against the Zod schema before writing. Also appends a changelog entry to the task artifact per `artifact-conventions.md`.

### Files to create/modify

| File | Action | Notes |
|---|---|---|
| `src/layer4/verdict-writer.ts` | **NEW** | `writeVerdict(event: ReviewCompleteEvent, panelSize: number, model: string): Promise<string>` -- returns the verdict file path |
| `src/layer4/types.ts` | **MODIFY** | Add `VerdictFile` type matching the JSON schema from spec section 5.4 |

### Acceptance criteria

- Writes valid JSON to `.skylark/verdicts/TASK-{id}.json`
- `.skylark/verdicts/` directory is created if it does not exist
- JSON matches the schema from spec section 5.4: `task_id`, `verdict`, `round`, `timestamp` (ISO-8601), `report_path`, `findings_summary` (counts by severity), `panel_size`, `model`
- File is validated against the Zod schema before writing (throws on invalid data)
- Overwrites previous verdict for the same task (round 2 replaces round 1)
- `findings_summary` counts are computed from the `findings` array, not passed in

### Dependencies

- Task 1 (types/schemas)

### Estimated scope

Small. ~60 lines.

---

## Task 8: Build the review round manager

### Description

Compose Tasks 5, 6, and 7 into the post-implementation orchestration function that the orchestrator invokes when it sends `RUN_REVIEW`. This function:

1. Runs spec compliance solo review (Task 5)
2. If spec compliant: runs code quality panel review (Task 6)
3. Writes the verdict (Task 7)
4. Handles round management:
   - On `REVISE` with `round < 2`: returns `REVIEW_COMPLETE` with findings for re-dispatch
   - On `REVISE` with `round = 2`: forces escalation, returns `REVIEW_COMPLETE` with full findings
   - On `RETHINK` at any round: returns `REVIEW_COMPLETE` with immediate escalation signal
5. Returns the `REVIEW_COMPLETE` event

Also handles the spec compliance loop: if spec compliance fails, the function returns a `REVISE` verdict targeting the spec gaps (not code quality), without counting against the 2-round cap. The orchestrator re-dispatches the worker, then re-invokes `RUN_REVIEW`. After 3 consecutive spec compliance failures, the function returns `RETHINK`.

### What stays the same vs what changes

| Aspect | Status |
|---|---|
| Dual-gate review (spec first, then quality) | **Same** -- from `develop/SKILL.md` steps 7-8 |
| 2-round cap | **Same** -- from spec section 7 |
| Spec compliance loop not counting against cap | **Same** -- from spec section 9 |
| Independence rule (round 2 does not see round 1 findings) | **Same** -- from spec section 9 |
| Adaptive narrowing for critical risk | **Same** -- from spec section 10 |
| Spec compliance 3-failure escalation | **NEW** -- from spec section 11 |
| Round tracking | **Changes** -- moved from skill-level prose to explicit `round` counter in the event |

### Files to create/modify

| File | Action | Notes |
|---|---|---|
| `src/layer4/post-implementation.ts` | **NEW** | `postImplementation(event: RunReviewEvent): Promise<ReviewCompleteEvent>` -- the orchestrator-callable function |
| `src/layer4/types.ts` | **MODIFY** | Add `SpecComplianceLoopState` type for tracking consecutive failures |

### Acceptance criteria

- Accepts a `RUN_REVIEW` event and returns a `REVIEW_COMPLETE` event
- Gate 1 (spec compliance) runs before Gate 2 (code quality) -- never skipped, never reversed
- If spec compliance fails: returns `REVISE` verdict with `findings` describing spec gaps, does NOT increment the round counter
- If spec compliance fails 3 consecutive times for the same task: returns `RETHINK` verdict
- If spec compliance passes: proceeds to panel review
- Panel review round matches the `round` field from the input event
- Verdict is written to `.skylark/verdicts/TASK-{id}.json`
- On `REVISE` with `round = 2`: the returned event includes all unresolved findings from both rounds and signals escalation
- On `RETHINK`: the returned event includes the fundamental concerns from the expert who triggered it
- Validates the returned event against the Zod schema before returning

### Dependencies

- Task 1 (types/schemas)
- Task 5 (spec compliance review)
- Task 6 (panel review)
- Task 7 (verdict writer)

### Estimated scope

Medium. ~120 lines. Mostly composition and branching logic.

---

## Task 9: Wire Layer 4 functions as XState actors

### Description

Export the two orchestrator-callable functions (`preDispatch` from Task 4, `postImplementation` from Task 8) as XState v5 `fromPromise` actors that can be invoked by the orchestrator machine. Define the actor factory functions and their input/output mappings.

This task also creates the barrel export (`src/layer4/index.ts`) that Domain 1 imports.

### Files to create/modify

| File | Action | Notes |
|---|---|---|
| `src/layer4/actors.ts` | **NEW** | `preDispatchActor = fromPromise(...)` and `postImplementationActor = fromPromise(...)` |
| `src/layer4/index.ts` | **NEW** | Barrel export: types, schemas, actors, and individual functions for testing |

### Acceptance criteria

- `preDispatchActor` accepts `GENERATE_EXPERT` event context and produces `EXPERT_READY` event
- `postImplementationActor` accepts `RUN_REVIEW` event context and produces `REVIEW_COMPLETE` event
- Both actors are importable from `src/layer4/index.ts`
- Both actors handle errors by throwing (XState `fromPromise` error handling propagates to the machine)
- The barrel export re-exports all public types, schemas, and actor factories
- Domain 1 can import `{ preDispatchActor, postImplementationActor }` from `src/layer4`

### Dependencies

- Task 4 (pre-dispatch function)
- Task 8 (post-implementation function)
- Domain 1 must have established XState v5 `fromPromise` conventions

### Estimated scope

Small. ~40 lines for actors + ~20 lines for barrel export. Pure wiring.

---

## Task 10: Integration test -- full pre-dispatch flow

### Description

End-to-end test of the pre-dispatch pipeline: given a mock `GENERATE_EXPERT` event, verify that the expert prompt is generated, drift validation runs, and a valid `EXPERT_READY` event is returned. Test both the pass and fail drift scenarios.

### Files to create/modify

| File | Action | Notes |
|---|---|---|
| `src/layer4/__tests__/pre-dispatch.test.ts` | **NEW** | Integration test |

### Acceptance criteria

- Test with a task spec that references existing files: expects `drift_check: "pass"` and expert prompt file written
- Test with a task spec that references a nonexistent file: expects `drift_check: "fail"` and expert prompt file still written
- Test that the returned event validates against the `EXPERT_READY` Zod schema
- Test that the expert prompt file contains vocabulary clusters (at least a `## Domain Vocabulary` heading)
- Tests can run without a real `claude` CLI by mocking the sub-agent dispatch (the expert generator function should accept a dispatcher dependency)

### Dependencies

- Tasks 1-4 complete

### Estimated scope

Small. ~100 lines of test code.

---

## Task 11: Integration test -- full post-implementation flow

### Description

End-to-end test of the post-implementation pipeline: given a mock `RUN_REVIEW` event with a worktree containing changed files, verify that spec compliance review runs, panel review runs, verdict is written, and a valid `REVIEW_COMPLETE` event is returned.

### Files to create/modify

| File | Action | Notes |
|---|---|---|
| `src/layer4/__tests__/post-implementation.test.ts` | **NEW** | Integration test |

### Acceptance criteria

- Test SHIP path: mock reviewers return no blocking findings, expect `verdict: "SHIP"`, verdict JSON written
- Test REVISE path: mock reviewers return blocking findings, expect `verdict: "REVISE"`, findings populated
- Test RETHINK path: mock one reviewer returning Rethink, expect `verdict: "RETHINK"` regardless of other verdicts (one Rethink vetoes)
- Test spec compliance failure: mock spec reviewer finding missing requirements, expect `REVISE` without incrementing round
- Test round cap: input `round: 2` with REVISE findings, expect escalation signal in response
- Test that the returned event validates against the `REVIEW_COMPLETE` Zod schema
- Test that verdict JSON is written to `.skylark/verdicts/TASK-{id}.json` and is valid
- Tests mock sub-agent dispatch (no real `claude` CLI needed)

### Dependencies

- Tasks 1, 5-8 complete

### Estimated scope

Medium. ~200 lines of test code.

---

## Dependency graph

```
Task 1  (types/schemas)
  |
  +---> Task 2  (expert generator)
  |       |
  |       +---> Task 4  (pre-dispatch composition)
  |       |       |
  |       |       +---> Task 9  (XState actors) ---> Task 10 (pre-dispatch test)
  |       |
  |       +---> Task 5  (spec compliance adapter)
  |       |       |
  |       +---> Task 6  (panel review adapter)
  |               |
  +---> Task 3  (drift validator)
  |       |
  |       +---> Task 4
  |
  +---> Task 7  (verdict writer)
          |
          +---> Task 8  (review round manager)
                  |
                  +---> Task 9  (XState actors) ---> Task 11 (post-impl test)
```

Tasks 2, 3, and 7 can be built in parallel after Task 1.
Tasks 5 and 6 can be built in parallel after Task 2.
Task 4 requires Tasks 2 + 3.
Task 8 requires Tasks 5 + 6 + 7.
Task 9 requires Tasks 4 + 8.
Tasks 10 and 11 are final validation.

## File inventory

### New files (13)

| File | Task | Purpose |
|---|---|---|
| `src/layer4/types.ts` | 1 | All Layer 4 types |
| `src/layer4/schemas.ts` | 1 | Zod runtime schemas |
| `src/layer4/generate-expert.ts` | 2 | Expert prompt generator function |
| `src/layer4/prompts/expert-metaprompt.ts` | 2 | Metaprompt template for expert generation |
| `src/layer4/drift-validator.ts` | 3 | Pre-dispatch drift validation |
| `src/layer4/pre-dispatch.ts` | 4 | Pre-dispatch composition function |
| `src/layer4/spec-compliance-review.ts` | 5 | Spec compliance solo review adapter |
| `src/layer4/prompts/spec-compliance-prompt.ts` | 5 | Spec compliance reviewer prompt template |
| `src/layer4/parsers/review-output-parser.ts` | 5 | Parse reviewer markdown into typed findings |
| `src/layer4/panel-review.ts` | 6 | Code quality panel review adapter |
| `src/layer4/prompts/panel-expert-prompt.ts` | 6 | Panelist prompt template |
| `src/layer4/panel-config.ts` | 6 | Risk-to-panel-config mapping |
| `src/layer4/synthesize-findings.ts` | 6 | Finding synthesis and verdict consolidation |
| `src/layer4/verdict-writer.ts` | 7 | Write verdict JSON to disk |
| `src/layer4/post-implementation.ts` | 8 | Post-implementation composition function |
| `src/layer4/actors.ts` | 9 | XState fromPromise actor factories |
| `src/layer4/index.ts` | 9 | Barrel export |
| `src/layer4/__tests__/pre-dispatch.test.ts` | 10 | Pre-dispatch integration test |
| `src/layer4/__tests__/post-implementation.test.ts` | 11 | Post-implementation integration test |

### Existing files NOT modified (6)

| File | Reason |
|---|---|
| `skills/_shared/expert-prompt-generator.md` | Read at runtime by sub-agents. Not changed. |
| `skills/_shared/vocabulary-guide.md` | Read at runtime by sub-agents. Not changed. |
| `skills/_shared/prompt-template.md` | Read at runtime by sub-agents. Not changed. |
| `skills/_shared/risk-matrix.md` | Configuration reference. Not changed. |
| `skills/panel-review/SKILL.md` | Methodology reference. Not changed. |
| `skills/solo-review/SKILL.md` | Methodology reference. Not changed. |

## Total estimated scope

~1,800 lines across 19 files. Roughly 4-6 focused implementation sessions.

- Types + schemas: ~200 lines (Task 1)
- Expert generation: ~300 lines (Task 2)
- Drift validator: ~130 lines (Task 3)
- Pre-dispatch composition: ~60 lines (Task 4)
- Spec compliance adapter: ~330 lines (Task 5)
- Panel review adapter: ~540 lines (Task 6)
- Verdict writer: ~60 lines (Task 7)
- Review round manager: ~120 lines (Task 8)
- XState actors + barrel: ~60 lines (Task 9)
- Tests: ~300 lines (Tasks 10-11)

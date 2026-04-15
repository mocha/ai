# Skylark — Task Decomposition and Sizing Conformance Evaluation

## Summary

- Conformance at a glance: 4 MEETS, 6 PARTIAL, 4 MISSING, 0 N/A (out of 14)
- Headline: Skylark has structural scaffolding for decomposition (triage funnel, plan → task decomposition, risk-dictated gates, iterative phases), but lacks quantitative sizing constraints (LOC caps, single-session fit targets, compaction triggers), pre-dispatch plan-vs-code validation, and per-task PR boundaries — exactly the gaps the ENG-180 retrospective identifies as producing the 6000+ LOC single-PR failure mode.

## Per-Requirement Findings

### Req 1: Single-session fit. Every leaf task is sized to fit one worker session ≤60% context utilization, including its outputs and tool calls.

- Verdict: MISSING
- Evidence: No references to context utilization, token budgets, session-fit targets, or compaction thresholds in any SKILL.md under `skills/`. Grep for "session", "context", "utilization", "60%", "fit" in `skills/` returns only qualitative notes like `write-plan/SKILL.md:25` ("you reason best about code you can hold in context at once"). The `write-plan` SKILL specifies "Each step is one action (2-5 minutes)" (line 33) for steps, not leaf tasks, and no token/LOC budget bounds a task as a whole.
- Notes: The retrospective (`docs/research/2026-04-15-eng-180-retrospective.md:28`) records "We compacted at least four times" on ENG-180, demonstrating the gap in practice.

### Req 2: ~500 LOC PR cap. Artifact boundaries (PRs) cap at roughly 500 lines of code. If a "slice" produces more, the slice was wrong and is re-decomposed.

- Verdict: MISSING
- Evidence: Grep for "500 LOC", "PR size", "LOC cap" in `skills/` returns no matches. The retro (`docs/research/2026-04-15-eng-180-retrospective.md:99-103`) proposes the 500-LOC cap as a recommendation ("Cap PR size at ~500 LOC. If a 'foundational slice' produces 6000 LOC, it is not a slice."), but no SKILL.md encodes this. `plan-review/SKILL.md:58-62` only checks for "8+ tasks or tasks have dense cross-dependencies" as a decomposition flag — a count of tasks, not a LOC bound per artifact.
- Notes: The failure being evaluated (6000+ LOC PR) is the motivating case; the framework does not yet encode the rule.

### Req 3: DAG decomposition. Decomposition produces a DAG with explicit dependencies, not a flat list. Each node declares what it blocks and what blocks it.

- Verdict: PARTIAL
- Evidence: `plan-review/SKILL.md:33-38` writes per-task frontmatter including `depends_on: []` and `plan-review/SKILL.md:95-106` returns a structured list with `depends_on` per task and `recommended_order`. `write-plan/SKILL.md:73` requires `**Dependencies:** [tasks that must complete first, or "none"]`. `artifact-conventions.md:72-76` defines `depends_on: []` in task frontmatter. However, no "what this blocks" (reverse edge) is declared; it is only derivable. No validation step checks the DAG for cycles in `plan-review`. `dispatch-with-mux/SKILL.md:75` validates "no circular dependencies" but that is only in the optional parallel-dispatch path.
- Notes: Forward edges exist, reverse edges are implicit, cycle-check exists only in the optional Mux path.

### Req 4: Self-contained DONE contract. Every task has an explicit completion contract — what must be true, including integration-test evidence where applicable. No "I think it's done" signals.

- Verdict: PARTIAL
- Evidence: `plan-review/SKILL.md:43-53` requires each task spec to include "Acceptance criteria — concrete, testable" and "Steps — the ordered steps from the plan, with code and verification". `write-plan/SKILL.md:83-84` requires "Acceptance Criteria: [Concrete, testable — traced from spec ACs]". `develop/SKILL.md:186-199` defines a DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED report format. `develop/SKILL.md:276` requires a spec compliance review before panel review and states "Accept 'close enough' on spec compliance (issues found = not done)" as a red flag (line 348). However, there is no requirement that the DONE contract include an integration-test run. The retro explicitly proposes this (`docs/research/2026-04-15-eng-180-retrospective.md:135-138`: "Make the DONE contract require a local integration-test run. `pnpm docker:up && … && pnpm test` as the last step before a worker returns DONE") — which is absent from `develop/SKILL.md` as a requirement.
- Notes: Acceptance criteria and verification steps exist; integration-test-as-DONE-gate does not.

### Req 5: Pre-dispatch plan validation. A task's signatures, file paths, and external assumptions are grep-checked against current code *before* the task is dispatched to a worker. Drift blocks dispatch.

- Verdict: MISSING
- Evidence: `develop/SKILL.md:24-32` ("Step 1: Read the Task Spec") instructs reading the task/plan/spec/CLAUDE.md for the dispatcher's own context, but does not grep-check signatures or file paths against current code. `write-plan/SKILL.md:153` covers type consistency ("Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks?") — but this is a self-review against sibling tasks, not against current code. The retro (`docs/research/2026-04-15-eng-180-retrospective.md:56-64`) documents the exact failure: "The plan said `buildServer({ verifyToken })`; the real API was `buildServer({ auth: { verifyToken } })`" and recommends at line 131-134: "Pre-validate plan signatures against real code before dispatching." Not implemented in any SKILL.md.
- Notes: Grep exists in `triage/SKILL.md:19` for prior-art, not for signature drift.

### Req 6: PR boundary = wave boundary. Tasks merge individually. There is no "multi-task wave" that merges as a single PR. The integration checkpoint is each merge to main.

- Verdict: PARTIAL
- Evidence: `implement/SKILL.md:128-133` (sequential path) states "One worktree per task, merged as each completes … After each task merge, verify previous work isn't broken: `git merge <task-branch>` / `pnpm test`". This aligns with per-task merges. However, there is no explicit prohibition against multi-task PRs, and the retro (`docs/research/2026-04-15-eng-180-retrospective.md:14,104-109`) records that the pipeline-as-run actually shipped "53 commits … as one stack" — the pipeline's canonical prior run did not enforce this. `finish/SKILL.md` (per review of structure) presents "branch options" allowing merge/PR flexibility rather than mandating per-task PRs. The concept is implicit in the sequential execution path but not stated as a rule.
- Notes: Mechanical support (worktree-per-task, inter-task merge) exists; the "PR = task" invariant is not named.

### Req 7: Compaction as decomposition trigger. Exceeding 2 compactions in a plan's execution is a pipeline-level signal to pause and decompose further, not to continue.

- Verdict: MISSING
- Evidence: Grep for "compact" across `skills/` returns no matches. No SKILL.md references compaction count, thresholds, or pause-on-compaction behavior. The retro (`docs/research/2026-04-15-eng-180-retrospective.md:110-112`) proposes exactly this rule ("If a project needs more than 2 compactions, stop and decompose."), but it is not encoded.
- Notes: Closest adjacent rule is `plan-review/SKILL.md:58-62` (flag 8+ tasks), which is a count-based trigger on plan shape, not on runtime compaction.

### Req 8: Iterative planning. Decomposition happens in phases: coarse plan → refined plan → task specs. Re-planning gates are explicit so new information can restructure the DAG without silent drift.

- Verdict: MEETS
- Evidence: The pipeline in `implement/SKILL.md:19-21` is `TRIAGE → PREPARE → BRAINSTORM → SPEC-REVIEW → WRITE-PLAN → PLAN-REVIEW → DEVELOP → FINISH`. `brainstorm` produces a spec (coarse). `write-plan/SKILL.md:14` produces `docs/plans/PLAN-NNN-<slug>.md` (refined). `plan-review/SKILL.md:22-40` produces per-task specs `docs/tasks/TASK-NNN-<slug>.md` (leaves). Re-planning gates: `implement/SKILL.md:159-167` ("Handle Scope Escalation") and `plan-review/SKILL.md:82` ("Rethink → Flag to user immediately. This task may require plan restructuring.") provide explicit re-plan points.
- Notes: Conforms on structure, though drift-detection (Req 5) is absent.

### Req 9: Status rollup. Parent work items track children and roll up completion / blocker status without manual bookkeeping.

- Verdict: PARTIAL
- Evidence: `artifact-conventions.md:89-100` defines a provenance chain (`parent` frontmatter), and `implement/SKILL.md:135-144` shows a "Progress reporting after each task" block that lists completed/active/pending/skipped tasks. `plan-review/SKILL.md:86-89` appends a plan-level changelog entry summarizing `Approved: N. Needs revision: N. Blocked: N.` However, the rollup is produced on demand by the orchestrator reading task files; there is no automated parent-state recomputation, no stored rollup on the plan frontmatter, and no rollup to external trackers beyond the Linear skill conventions. Changelog entries are manually appended per the conventions file.
- Notes: Enough provenance exists to compute rollup; it is not automated.

### Req 10: Risk-dictated gate shape. A task's risk level determines its gate (trivial → no panel; elevated → panel; critical → panel + human). Sizing and review cost scale together.

- Verdict: MEETS
- Evidence: `_shared/risk-matrix.md:21-35` defines the explicit "Gate Activation Matrix":
  ```
  PREPARE                skip       yes          yes            yes
  ...
  DEVELOP panel          no         Sonnet 2-3   Sonnet 3-4     Opus 3-4, 2 rounds
  User confirm gates     no         no           on escalation  every gate
  ```
  `implement/SKILL.md:182-188` mirrors this as a "Quick Reference: Risk × Pipeline Path" table. `triage/SKILL.md:73-83` assigns risk, and `triage/SKILL.md:86-103` determines pipeline path by risk.
- Notes: Risk → gates mapping is explicit, tabled, and cited by multiple skills. Sizing scaling (i.e., smaller tasks at higher risk) is not explicit — the matrix scales review, not task size.

### Req 11: Triage funnel. Raw ideas and problems enter a triage/intake stage before becoming tasks. No direct "implement this" on unclassified input.

- Verdict: MEETS
- Evidence: `implement/SKILL.md:27-40` makes triage the mandatory Step 1 of the orchestrator. `triage/SKILL.md:26-45` classifies input into {spec, plan, task, raw-idea, raw-problem, raw-input, external-ref}. `triage/SKILL.md:93-94` routes `raw-problem` through "PREPARE (investigate) → re-triage by risk" and `raw-idea` at feature-scale through "BRAINSTORM → SPEC-REVIEW → ...". No alternative direct-to-develop path exists for unclassified input.
- Notes: Satisfies the funnel requirement completely.

### Req 12: Coarse-to-fine decomposition cap. Maximum decomposition depth (e.g., project → epic → task → subtask) is bounded; deeper nesting is a sign of unclear scope.

- Verdict: PARTIAL
- Evidence: The artifact hierarchy in `artifact-conventions.md:7-19` and `artifact-conventions.md:90-100` is fixed at four levels: `spec → plan → task → (report|notes)`. There is no `subtask` concept; depth is structurally capped by schema. `brainstorm/SKILL.md:19-22` and `brainstorm/SKILL.md:76-78` enforce scope splitting at the spec level; `plan-review/SKILL.md:58-62` enforces it at the plan level ("If decomposition produces 8+ tasks or tasks have dense cross-dependencies … Consider splitting into sub-plans"). However, this is an implicit cap (the schema doesn't allow deeper nesting) rather than a named "max depth" rule, and there is no guidance about when too-deep nesting signals unclear scope.
- Notes: Cap-by-schema rather than cap-by-policy.

### Req 13: Parallelizable by default. Decomposition produces independent leaf tasks wherever possible so the fleet can fan out. Serial chains are explicit and justified.

- Verdict: PARTIAL
- Evidence: `plan-review/SKILL.md:70-73` supports parallel task review ("Tasks with no review-outcome dependencies MAY be reviewed in parallel"). `implement/SKILL.md:102-123` describes a parallel execution path via `.muxrc`/`dispatch-with-mux` for independent task batches. Dependencies are declared per task in frontmatter. However, nothing in `write-plan/SKILL.md` or `plan-review/SKILL.md` instructs the planner to *maximize* independence, and "serial chains are explicit and justified" is not required anywhere — tasks can declare `depends_on` without justification. `develop/SKILL.md:346` ("Dispatch multiple implementation subagents in parallel (conflicts)") lists parallel dispatch as a red flag in the standard path, reserving parallelism to the optional Mux path.
- Notes: Mechanism exists (dispatch-with-mux), but "parallel-by-default" is not a planning directive.

### Req 14: Validated scope before dispatch. The task spec includes its inputs, outputs, affected files, and acceptance criteria. A worker receiving it should not have to re-discover scope.

- Verdict: MEETS
- Evidence: `plan-review/SKILL.md:43-49` requires each task body to include Scope, Files (create/modify/test), Acceptance criteria, Key considerations, Steps with code and verification, and Changelog. `write-plan/SKILL.md:71-124` specifies the same schema with concrete code blocks and "No Placeholders" rules (`write-plan/SKILL.md:126-136`). `develop/SKILL.md:30` states "The subagent receives the full text inline — do NOT make the subagent read the plan or task file. You curate exactly what context is needed." `develop/SKILL.md:100-103` confirms the full task description is pasted into the dispatch prompt.
- Notes: Scope-in-spec is tightly enforced; the only unvalidated dimension is "does the spec match current code" (Req 5).

## Surprises

- **The retrospective's fixes are not yet encoded.** `docs/research/2026-04-15-eng-180-retrospective.md` lists precise, actionable fixes (500-LOC cap, 2-compaction rule, pre-dispatch grep, DONE = integration test). The current `skills/*/SKILL.md` tree does not reference any of them by name. The retro is an input for future work, not implemented policy.
- **Plan-review has a task-count decomposition trigger (8+ tasks) that is unrelated to LOC.** `plan-review/SKILL.md:58-60`: "If decomposition produces 8+ tasks or tasks have dense cross-dependencies … Consider splitting into sub-plans." This is the only quantitative decomposition guard in the pipeline, and it fires on task count, not on LOC or session-fit.
- **Sizing is qualitative throughout.** The "bite-sized" language (`write-plan/SKILL.md:31-38`) targets *steps* (2–5 minutes) not *tasks*. No explicit task-size target exists.
- **The parallel path is gated on `.muxrc`.** `implement/SKILL.md:106-115` only offers parallel dispatch when the project has opted in via `.muxrc`. Default is sequential, one task at a time.
- **Finish stage decides merge strategy per project, not per task.** `implement/SKILL.md:154-157` delegates to `finish/SKILL.md` which "presents structured options (merge/PR/keep/discard)" — strategy is an orchestrator-level choice, not a per-task invariant.

## Open Questions for Trial

- On a medium-complexity issue, would the pipeline actually produce leaf tasks that fit ≤60% context utilization, or only "bite-sized steps" inside oversized tasks?
- Does the "8+ tasks" decomposition trigger in `plan-review` fire often enough to prevent ENG-180-style runs, or does it underfire because wave-sized plans decompose into 5-7 tasks each?
- Without pre-dispatch grep validation, how often does plan-to-code drift land at the worker instead of at plan-review?
- When `finish` presents merge/PR options, do users consistently pick per-task PRs, or does the pipeline drift back toward the single-PR shape unless nudged?

## Source Index

- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/06-task-decomposition-and-sizing.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/evaluation-prompts.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/implement/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/triage/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/brainstorm/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/write-plan/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/plan-review/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/develop/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/risk-matrix.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/artifact-conventions.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/dispatch-with-mux/SKILL.md` (referenced for parallel dispatch)
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/2026-04-15-eng-180-retrospective.md`
- Grep queries: `compact|500 LOC|PR size|LOC cap` (no matches in `skills/`); `grep|validate|signature|drift`; `session|context|utilization|60%|fit`; `rollup|parent.*status|children`.

# Skylark — Orchestration Model Conformance Evaluation

## Summary

- Conformance at a glance: 0 MEETS, 7 PARTIAL, 3 MISSING, 0 N/A (out of 10)
- Headline: Skylark encodes the pipeline as prose-in-SKILL.md executed by an LLM orchestrator with disk-first artifact state, but lacks a machine-readable plan, bounded-context guarantees, typed status enum, true DAG parallelism, and atomic/crash-safe transition semantics.

## Per-Requirement Findings

### Req 1: Declarative pipeline definition. The pipeline is expressed in a machine-readable format (YAML/TOML/equivalent) separate from any LLM prompt. Stage order, dependencies, and transitions are data, not prose.

- Verdict: MISSING
- Evidence: The pipeline is defined as prose in `skills/implement/SKILL.md`. The canonical expression is `skills/implement/SKILL.md:19-21`: "TRIAGE → PREPARE → BRAINSTORM → SPEC-REVIEW → WRITE-PLAN → PLAN-REVIEW → DEVELOP → FINISH". Stage transitions and skip logic are described in narrative form (e.g., `skills/implement/SKILL.md:67-74` on SPEC-REVIEW: "If `rethink`: STOP... If `approved`: proceed to WRITE-PLAN"). The risk-to-path mapping is a markdown table in `skills/triage/SKILL.md:87-103` and `skills/_shared/risk-matrix.md:22-35` — human-readable but not consumed by a deterministic engine. The only YAML in the system is per-skill frontmatter `name`/`description` (e.g., `skills/implement/SKILL.md:1-4`), not pipeline structure.
- Notes: The risk-matrix table and triage path table are close to "data" but are inside prose SKILL.md files, interpreted by the orchestrator LLM each invocation.

### Req 2: Bounded orchestrator context. The orchestrator's working context has a measurable ceiling (target ≤20K tokens) that is invariant to pipeline length or run count.

- Verdict: MISSING
- Evidence: No context-size ceiling is declared anywhere in `skills/implement/SKILL.md`, `skills/_shared/`, or `CLAUDE.md`. The orchestrator reads each stage's SKILL.md inline ("For each stage, read the corresponding skill file and follow its process" — `skills/implement/SKILL.md:51`) and retains the pipeline trace across stages. The retrospective `docs/research/2026-04-15-eng-180-retrospective.md:28-33` reports concrete failure of bounding: "We compacted at least four times. Each reset required reconstructing state from markdown resumption notes (150–300 lines each)." The pipeline explicitly prescribes no budget; the retrospective treats compaction as a symptom rather than a guarded invariant.
- Notes: Subagent dispatch in `develop` does isolate worker context (`skills/develop/SKILL.md:10`), but this is about worker isolation, not orchestrator bounding.

### Req 3: Typed state transitions. Every pipeline step has a typed status (`pending`, `in_progress`, `complete`, `failed`, `needs_review`, `blocked`). Transitions are explicit; re-entry from any terminal state is supported.

- Verdict: PARTIAL
- Evidence: Task/artifact frontmatter defines a status enum at `skills/_shared/artifact-conventions.md:60` — "status: draft | reviewed | approved | in-progress | complete | blocked". Triage also uses `state: new | draft | reviewed | approved | decomposed | in-progress` (`skills/triage/SKILL.md:112`). Implementer status from worker is a second enum: "Status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED" (`skills/develop/SKILL.md:188`). Re-entry is supported via triage re-reading artifact state ("State is determined from artifacts, not from memory or conversation history" — `skills/triage/SKILL.md:48`).
- Notes: There is no unified `failed` or `needs_review` status — "revise" is a panel verdict (`skills/_shared/artifact-conventions.md:83`), not an artifact status. The three separate enums (artifact status, triage state, implementer status) are not reconciled in one schema. Transitions are prose-described, not typed.

### Req 4: Disk-first state resolution. The orchestrator determines the current pipeline state by reading persisted artifacts, not by recalling conversation history.

- Verdict: PARTIAL
- Evidence: Explicitly declared in multiple places. `skills/triage/SKILL.md:48`: "State is determined from **artifacts**, not from memory or conversation history." `skills/_shared/artifact-conventions.md:104-114` provides a "State Detection from Artifacts" table. `skills/implement/SKILL.md:173-178` on interruptions: "All state is in artifacts... Triage detects state from artifacts and resumes at the correct stage." Frontmatter + changelog + report files together are the declared source of truth.
- Notes: Partial because the resolution itself is an LLM-driven read of markdown artifacts, which the retrospective evidences as lossy: resumption notes "duplicated content already in the plan" and compaction "paraphrased details, dropped invariants" (`docs/research/2026-04-15-eng-180-retrospective.md:142-146, 28-33`). The discipline is declared; whether the LLM reliably honors it is run-dependent. No deterministic state-reconstruction function is defined.

### Req 5: DAG dependency tracking. Steps declare `blocked_by` relations. Completion of one step automatically unblocks dependents.

- Verdict: PARTIAL
- Evidence: Task frontmatter includes `depends_on: []` ("Other task IDs this depends on") — `skills/_shared/artifact-conventions.md:73-75`. Plan-review output includes "task list with statuses, recommended execution order, blocked tasks" (`skills/implement/SKILL.md:83`). The sequential develop loop processes tasks "in dependency order" (`skills/implement/SKILL.md:125`).
- Notes: No automatic unblocking — the orchestrator LLM walks the list and decides what is runnable. There is no explicit DAG data structure or resolver; dependency resolution is prose direction. `blocked_by` uses the field name `depends_on`, which is semantically equivalent but not the spec's term. Parent provenance is tracked separately via `parent:` field (`skills/_shared/artifact-conventions.md:91-102`).

### Req 6: Bounded reasoning for edge cases. The orchestrator follows the declarative plan for the happy path but has a constrained reasoning affordance for naming/pattern mismatches without requiring code changes to the state machine.

- Verdict: PARTIAL
- Evidence: Because the orchestrator IS an LLM reading prose, all edge-case reasoning is unbounded-by-design. Triage explicitly invites judgment: "If ambiguous, ask the user" (`skills/triage/SKILL.md:43`), "Evaluating raw input files: The user may point at a file they've scribbled notes into. Read it and assess maturity" (`skills/triage/SKILL.md:36-42`). Backwards-compat affordance at `skills/_shared/artifact-conventions.md:21`: "Skills also check `docs/superpowers/specs/` and `docs/superpowers/plans/` when searching for existing artifacts." Scope escalation has prescribed bounded actions (`skills/_shared/risk-matrix.md:53-59`: "Pause. Notify user... User decides").
- Notes: There is no "happy path" vs "escape hatch" separation — the whole orchestrator is LLM reasoning. The spec's ideal is a deterministic engine with a narrow LLM affordance; Skylark inverts this. That said, escalation is always "pause + notify, never automatic pipeline restart" (`skills/_shared/risk-matrix.md:60`), which bounds unilateral re-planning.

### Req 7: Explicit resume semantics. Any new orchestrator session can resume at the last terminal artifact state, without replaying prior conversation.

- Verdict: PARTIAL
- Evidence: `skills/implement/SKILL.md:171-178` ("Step 4: Handle Interruptions"): "If the session ends mid-pipeline: All state is in artifacts... Next session: user runs `/skylark:implement` again with the same input. Triage detects state from artifacts and resumes at the correct stage." The triage state table (`skills/triage/SKILL.md:87-103`) includes re-entry rows (e.g., `task | in-progress | DEVELOP (resume) → FINISH`). Changelog entries (`skills/_shared/artifact-conventions.md:117-139`) are the intended breadcrumbs.
- Notes: The retrospective shows real-world resume was not clean: "Each reset required reconstructing state from markdown resumption notes (150–300 lines each)" and Suggestion 8 explicitly calls this out — "Stop rewriting the plan in resumption notes" (`docs/research/2026-04-15-eng-180-retrospective.md:142-146`). So the semantics are declared but not fully achieved — mid-pipeline resume still requires re-reading significant prose.

### Req 8: Parallel fan-out. Independent DAG branches can run concurrently; the orchestrator schedules them without serializing.

- Verdict: PARTIAL
- Evidence: A hard gate in `skills/implement/SKILL.md:101-123` offers parallel execution via Mux when `.muxrc` exists. Delegates to `skills/dispatch-with-mux/SKILL.md` which "Dispatches independent tasks to isolated worktrees in parallel, monitors completion, runs reviews, and merges results back in dependency order." Without `.muxrc`, the default is sequential: `skills/implement/SKILL.md:124-133` ("If user chooses sequential... Read and invoke `develop/SKILL.md` for each task in dependency order"). `skills/develop/SKILL.md:345` forbids parallel implementation dispatch within a single task ("Dispatch multiple implementation subagents in parallel (conflicts)").
- Notes: Parallel fan-out exists but is opt-in, gated on external infrastructure (a running Mux server), and falls back to sequential (`skills/implement/SKILL.md:121-123`). The orchestrator itself does not natively schedule concurrent branches — it delegates to Mux or runs serially. No evidence of parallel review gates (panel-review internally fans out reviewers, but that is worker-level parallelism).

### Req 9: No substantive delegation of domain decisions. The orchestrator never decides "is this spec approved?" or "is this code correct?" — those are always delegated to specialized workers or to human gates.

- Verdict: PARTIAL
- Evidence: Strong delegation pattern. Spec/plan approval delegated to panel-review (`skills/implement/SKILL.md:67-74`, `skills/_shared/risk-matrix.md:24-28`). Code quality delegated to panel-review after spec-compliance review (`skills/develop/SKILL.md:277-293`). Hard gates pause for user: "on escalation" (standard→elevated), "every gate" for critical (`skills/_shared/risk-matrix.md:35`). `skills/implement/SKILL.md:190-196` "What This Skill Does NOT Do" lists: "Contain review or execution logic itself — delegates to stage skills", "Skip gates based on its own judgment — follows the risk matrix", "Merge without user decision — finish presents options".
- Notes: The orchestrator still makes two substantive domain-like decisions: (a) risk classification in triage ("Domain analysis: Single file, clear fix → trivial; ..." — `skills/triage/SKILL.md:76-80`), and (b) scope-escalation detection during stages (`skills/implement/SKILL.md:163-169`). The retrospective shows the plan-to-reality drift (`docs/research/2026-04-15-eng-180-retrospective.md:55-64`) was a domain judgment the orchestrator/plan author made without worker verification. Risk classification arguably IS a domain decision, albeit a meta one.

### Req 10: Crash-safe transitions. A mid-transition crash leaves the pipeline in a recoverable state; no transition writes are half-applied.

- Verdict: MISSING
- Evidence: No transactional or atomic-write semantics are described. State transitions are multi-step LLM actions: e.g., on DEVELOP completion the orchestrator is supposed to "Update task frontmatter: `status: complete`", "Append changelog entry" (`skills/develop/SKILL.md:296-301`), then "merges the worktree branch and proceeds to the next task" (`skills/develop/SKILL.md:333`). These are sequential edits with no fsync/lock/atomic-rename discipline. No evidence found in `skills/implement/SKILL.md`, `skills/_shared/artifact-conventions.md`, `skills/develop/SKILL.md`, `skills/finish/SKILL.md`, or `CLAUDE.md` of crash-safety guarantees, rollback, or half-applied-transition detection.
- Notes: The changelog is append-only per `skills/_shared/artifact-conventions.md:141` ("Append only — never modify or delete existing changelog entries"), which provides monotonicity but not atomicity across multiple artifacts. Git commits provide after-the-fact crash recovery, but the frontmatter/reports/changelog update sequence is not coordinated.



## Surprises

- **Two parallel state-enums.** Artifact frontmatter `status` (`skills/_shared/artifact-conventions.md:60`) and triage `state` (`skills/triage/SKILL.md:112`) use overlapping but non-identical vocabularies ("reviewed" appears in both; "decomposed" only in triage; "in-progress" in both; "approved" in both). Implementer status (DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED) is a third vocabulary at `skills/develop/SKILL.md:188`. A single unified status taxonomy does not exist.
- **Backwards compatibility to `docs/superpowers/`** is baked into artifact conventions (`skills/_shared/artifact-conventions.md:21`), suggesting the pipeline already experienced a schema migration.
- **Triage is declared ephemeral and re-runnable:** "This classification is ephemeral — not persisted. Triage is cheap to re-run." (`skills/triage/SKILL.md:122`). This is a deliberate anti-memoization stance — the pipeline re-classifies on every implement invocation.
- **Retrospective evidence of orchestrator-reasoning drift:** Plan said `buildServer({ verifyToken })`; real API was `buildServer({ auth: { verifyToken } })` (`docs/research/2026-04-15-eng-180-retrospective.md:57-59`). Orchestrator/plan author substantive reasoning was not re-validated against code at dispatch time — Suggestion 6 (`docs/research/2026-04-15-eng-180-retrospective.md:131-134`) addresses this, but it is not yet a pipeline invariant.
- **The risk matrix activates panels, not steps.** Risk controls gate activation (`skills/_shared/risk-matrix.md:22-35`), but panel size and review round counts are parameters baked into the matrix rather than into a per-run config.
- **Scope escalation is explicitly non-automatic.** "Never automatically restart the pipeline. Pause, explain, let the user decide." (`skills/implement/SKILL.md:169`). This is a principled choice but makes the pipeline dependent on user availability for any non-trivial surprise.

## Open Questions for Trial

- What is the actual end-of-run orchestrator context token count for a standard vs elevated run? (Req 2 ceiling is unprovable from static reading.)
- Does a fresh `/skylark:implement` invocation mid-pipeline genuinely recover state from artifacts alone, or does the orchestrator lean on residual conversation memory in practice?
- On filename/naming drift (e.g., task file renamed, status enum typo), does triage self-correct via the prose affordances in `skills/triage/SKILL.md:36-43`, or does it wedge?
- When parallel Mux dispatch is active, how is merge-back ordering enforced against `depends_on`? The SKILL says "merges results back in dependency order" but the mechanism is not shown in the files read.
- If the orchestrator is killed between "update task frontmatter status" and "append changelog entry," what is observed next session — inconsistent state, or does the next triage paper over it?
- Does the retrospective's six-thousand-LOC outcome recur if the `.muxrc` / parallel path is exercised, or is the merge-at-end problem specifically a product of sequential merge timing?

## Source Index

- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/01-orchestration-model.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/evaluation-prompts.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/CLAUDE.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/implement/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/triage/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/prepare/SKILL.md` (partial read)
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/develop/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/plan-review/SKILL.md` (partial read)
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/finish/SKILL.md` (partial read)
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/dispatch-with-mux/SKILL.md` (partial read)
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/artifact-conventions.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/risk-matrix.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/2026-04-15-eng-180-retrospective.md`

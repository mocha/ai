# Skylark — Context Engineering Conformance Evaluation

## Summary

- Conformance at a glance: 2 MEETS, 4 PARTIAL, 7 MISSING, 0 N/A (out of 13)
- Headline: Skylark has strong disk-canonical artifact discipline and per-task worker isolation, but lacks any measurable context budget, handoff protocol schema, predecessor query, auto-persistence, compaction instrumentation, or tiered utilization alerts — and the ENG-180 retrospective documents 4+ compactions in a single run with no automated handling.

## Per-Requirement Findings

### Req 1: Hard 60% ceiling per worker. Every worker session has a measurable context budget with a hard stop at ≤60% utilization. Exceeding it triggers handoff, not compaction.

- Verdict: MISSING
- Evidence: No references to "60%", "budget", "utilization", or "ceiling" exist anywhere in `skills/` or Skylark-authored docs. The only numeric thresholds found are in `docs/research/context-window-mgmt-and-compaction.md` (the inbound research report, not a Skylark control) and `docs/research/criteria-review/05-context-engineering.md` (the spec under evaluation). `skills/develop/SKILL.md` dispatches subagents with no context-size accounting. ENG-180 retro: "We compacted at least four times" with no indication any ceiling was enforced or measurable.
- Notes: Risk matrix (`skills/_shared/risk-matrix.md`) routes by domain complexity, not by projected token usage per worker.

### Req 2: Disk-canonical state. Canonical state is on disk (artifacts, notes, decision logs). Conversation history is treated as ephemeral scaffolding, not source of truth.

- Verdict: MEETS
- Evidence: `skills/_shared/artifact-conventions.md:104-116` ("State Detection from Artifacts … Skills detect pipeline state by examining artifacts, not by relying on agent memory"). `README.md:76`: "all pipeline state lives in files with YAML frontmatter and provenance chains, not in agent memory. A session can crash and resume by detecting state from artifacts." Every artifact carries an in-file changelog (`artifact-conventions.md:117-146`) recording stage events as the audit trail. `skills/implement/SKILL.md:174-178`: "All state is in artifacts … Triage detects state from artifacts and resumes at the correct stage."
- Notes: The artifact system is explicitly designed as source of truth; conversation is downstream.

### Req 3: Defined handoff protocol. Handoff artifacts contain at minimum: completed work with commit hashes, pending work, key decisions with rationale, modified file paths, known blockers, next steps.

- Verdict: PARTIAL
- Evidence: `skills/finish/SKILL.md:182-204` defines `NOTE-NNN` session notes with fields "What shipped / Decisions that deviated from plan / Codebase discoveries / Deferred questions / Process observations" — but only at end-of-work, not as an inter-stage handoff. `artifact-conventions.md:117-146` defines a changelog format with stage-tagged events. `skills/develop/SKILL.md:319-332` defines a return payload (`status / task_id / worktree_path / branch / changes / test_results / review_rounds / outstanding_issues`) between develop and implement. No specified field captures "commit hashes" explicitly, and no schema for between-session resumption exists beyond triage re-detecting state.
- Notes: ENG-180 retro item 8 explicitly calls out the gap: "Stop rewriting the plan in resumption notes. Our `*-resumption.md` files duplicated content already in the plan. A 'project state ledger' (one line per merged task + current HEAD SHA + open decisions) is a fraction of the context footprint." Skylark has no such ledger artifact type today.

### Req 4: Predecessor query. A new session can query "what did the previous session decide/find about X?" without replaying its conversation or re-reading every file it touched.

- Verdict: PARTIAL
- Evidence: `artifact-conventions.md:117-146` (changelog) and the provenance chain (`artifact-conventions.md:88-102`) allow a reader to trace spec→plan→task→report. `skills/implement/SKILL.md:172-178`: triage detects state from artifacts on re-entry. However, "query" is only by manual reading of the relevant artifact — no indexed search, no session registry, no structured predecessor-session API. To learn "what did the previous session decide about X" a new session must know which artifact(s) to read and read them in full.
- Notes: No equivalent to a handoff directory, session registry, or queryable state ledger. ENG-180 reconstructed state from "markdown resumption notes (150–300 lines each)" — manual replay, not query.

### Req 5: Stable static prefix. System prompt, tool definitions, and long-lived rules are stable across turns to preserve prompt cache. Changes to this prefix are recognized as cache-invalidating events.

- Verdict: MISSING
- Evidence: No mentions of "cache", "prompt caching", or "static prefix" in `skills/`. `skills/solo-review/SKILL.md:97` and `skills/panel-review/SKILL.md:109` mention writing prompts as CLAUDE.md files to "enable prompt caching and reduce token waste", but this is about per-worker prompt files, not orchestrator-prefix stability. No policy anywhere treats prefix changes as cache-invalidating events.
- Notes: `skills/develop/SKILL.md:93` writes a new CLAUDE.md per worktree per task — fresh by design, not stable across turns within a worker's life.

### Req 6: Append-only where possible. Context mutations invalidate cache; prefer appending new information over rewriting existing.

- Verdict: PARTIAL
- Evidence: `artifact-conventions.md:145-146`: "Append only — never modify or delete existing changelog entries." This applies to the changelog section of artifacts. However, artifact bodies themselves are revised in-place (e.g., spec-review round 1 revise verdicts edit the spec body — `skills/spec-review/SKILL.md`, `skills/develop/SKILL.md:304-309`). No guidance about append-only conversation context for cache preservation.
- Notes: Append-only is applied to the audit-trail subsection, not to the broader context-engineering concern.

### Req 7: Deferred tool loading. Tool schemas and MCP tool definitions load on demand, not all-up-front, to keep the static context small.

- Verdict: MISSING
- Evidence: No references to deferred tool loading, on-demand schemas, or tool-schema management in `skills/` or Skylark docs. Skylark is a plugin inside Claude Code and does not configure tool loading; whatever the host provides is what subagents receive.
- Notes: This is largely a host-harness responsibility, but Skylark has no policy either way (e.g., no restriction on `tools:` frontmatter per skill).

### Req 8: Mode isolation. Prose, decision/task, and code contexts are kept in distinct sessions or distinct files, not freely mixed.

- Verdict: PARTIAL
- Evidence: Artifacts are typed and filed into distinct directories: `docs/specs/`, `docs/plans/`, `docs/tasks/`, `docs/reports/`, `docs/notes/` (`artifact-conventions.md:6-19`). Workers run in separate subagent sessions per stage (`skills/develop/SKILL.md:10` "They should never inherit your session's context or history"). However, within a single session (e.g., the orchestrator running implement), prose brainstorming, task decisions, and code exploration freely mix. The PD_Comment annotations in `docs/research/context-window-mgmt-and-compaction.md:24-30` explicitly identify mode-isolation as an open concern: "prose content, task content, and code content probably all need to have separate layers in the management stack" — framed as a wish, not an implemented control.
- Notes: File-level mode separation exists; session-level mode isolation is not enforced.

### Req 9: Phase-boundary splits. Research/planning/implementation run in separate sessions (RPI pattern), not one long session. Each phase starts fresh with the prior phase's artifact as input.

- Verdict: PARTIAL
- Evidence: Per-task workers are dispatched as fresh subagents with a fresh CLAUDE.md (`skills/develop/SKILL.md:93-95`), and each reviewer is a fresh subagent (`skills/panel-review/SKILL.md`, `skills/solo-review/SKILL.md`). However, the orchestrator (`skills/implement/SKILL.md`) drives TRIAGE → PREPARE → BRAINSTORM → SPEC-REVIEW → WRITE-PLAN → PLAN-REVIEW → DEVELOP → FINISH sequentially within a single session — there is no enforced phase-boundary split between planning and implementation at the orchestrator layer. ENG-180 retro item 2: "We compacted at least four times" — evidence that the orchestrator session ran long enough to exhaust context, confirming phase splits are not enforced.
- Notes: Subagent dispatch provides fresh context at worker level. Orchestrator-level RPI split is not the Skylark design.

### Req 10: Auto-persisted state. A session's working state is persisted to disk automatically at key lifecycle events (pre-compact, stop, subagent completion) — not dependent on worker discipline to remember.

- Verdict: MISSING
- Evidence: No hooks, Stop handlers, PreCompact handlers, or auto-save mechanisms are defined in Skylark. Persistence depends on workers writing artifacts at stage boundaries (`skills/implement/SKILL.md:174-178`: "All state is in artifacts (specs, plans, tasks, reports with frontmatter and changelogs)"). Changelog updates are procedural steps in skill files, not harness hooks. No `.claude/settings.json` hooks exist for pre-compact or stop events.
- Notes: ENG-180 retro: "Each reset required reconstructing state from markdown resumption notes" — i.e., manually written, not auto-persisted.

### Req 11: Compaction as a failure signal. Compaction events are logged and treated as a signal to decompose further — never as a normal operating mode.

- Verdict: MISSING
- Evidence: No code, hook, or policy in `skills/` logs or responds to compaction. The phrase "compact" does not appear in any `SKILL.md`. ENG-180 retro item 2 documents four+ compactions in a real run with no automated response: "Every compaction is a correctness risk — details get paraphrased, invariants get dropped." Retro suggestion 3 ("If a project needs more than 2 compactions, stop and decompose") is a recommendation, not a Skylark-implemented control.
- Notes: This is the domain's most load-bearing miss — the real pipeline hit this exact failure mode and had no instrumentation to detect it, let alone respond.

### Req 12: Three-tier context alerts. Workers emit warnings at 40%, 60%, and 70% utilization to drive decomposition decisions proactively.

- Verdict: MISSING
- Evidence: No references to 40%, 60%, 70%, or tiered alerts anywhere in Skylark skills. The 40/60/70 pattern is mentioned in `docs/research/context-window-mgmt-and-compaction.md:182` as an external practice (claude-code-session-kit hooks), not as something Skylark implements.
- Notes: No hook infrastructure or monitor exists.

### Req 13: Tool-result containment. Long tool results are stored to disk and referenced by path, not dumped verbatim into context.

- Verdict: MISSING
- Evidence: No policy in `skills/` about writing large tool outputs to disk and referencing by path. The only "write to disk then reference" pattern is for generated prompts (`skills/develop/SKILL.md:93` writes expert prompt as CLAUDE.md; `skills/panel-review/SKILL.md:109` similar), which is about prompt caching, not tool-result containment. No microcompaction-equivalent convention.
- Notes: ENG-180 retro does not call this out specifically, but 6000+ LOC of implementation plus 40+ panel reviews flowed into and out of subagent contexts without any truncation discipline visible in skill text.

## Surprises

- **Worker context is tightly curated at dispatch.** `skills/develop/SKILL.md:32` is explicit: "Extract the full task text now. The subagent receives the full text inline — do NOT make the subagent read the plan or task file. You curate exactly what context is needed." This is the strongest context-engineering move in the framework and is well-aligned with the spec's intent, even though it is not framed against a measurable budget.
- **Per-worktree CLAUDE.md as the worker's system prompt** (`skills/develop/SKILL.md:93`) gives each worker a bespoke vocabulary-routed context, but is the opposite of Req 5's "stable static prefix" — it regenerates the prefix per task.
- **Orchestrator runs the full pipeline in-session.** The implement skill walks TRIAGE through FINISH in one session by default. ENG-180's four-compaction run is a direct consequence of this design.
- **Mux dispatch path exists** (`skills/dispatch-with-mux/SKILL.md`) and enables parallel per-task workers via a separate server, which functionally achieves phase-boundary split for `develop` tasks — but it is optional, gated on `.muxrc`, and not invoked for spec/plan/review phases.
- **The ENG-180 retro itself proposes a "project state ledger"** (item 8) and a "next minimum-viable merge anchor" (item 9) as fixes. Neither has been added to the framework between the retro (2026-04-15) and the current evaluation; they remain recommendations in a retrospective.

## Open Questions for Trial

- At what orchestrator stage does context utilization first cross 60% in a realistic elevated-risk run? Is it PREPARE (heavy code reading), WRITE-PLAN (many files referenced), or PLAN-REVIEW (reports accumulating)?
- Can triage's artifact-based resumption actually reconstruct mid-DEVELOP state on a fresh session, or does it need worktree inspection + git log + report reading that in practice requires re-loading substantial context?
- Does writing per-worktree CLAUDE.md for each task invalidate the host cache, and what is the per-task cache-miss cost?
- If a session auto-compacts mid-pipeline, does the orchestrator correctly resume and update changelogs, or does the compacted summary silently corrupt the provenance chain?

## Source Index

- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/implement/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/develop/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/finish/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/artifact-conventions.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/risk-matrix.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/panel-review/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/solo-review/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/spec-review/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/triage/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/prepare/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/dispatch-with-mux/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/README.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/WORKFLOW.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/2026-04-15-eng-180-retrospective.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/context-window-mgmt-and-compaction.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/05-context-engineering.md`
- Grep queries across `skills/` for: context, compact, budget, 60%, token, utilization, resumption, handoff, predecessor, ledger, CLAUDE.md, isolation, subagent, worktree

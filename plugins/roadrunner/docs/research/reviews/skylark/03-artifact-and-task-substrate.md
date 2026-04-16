# Skylark — Artifact and Task Substrate Conformance Evaluation

## Summary

- Conformance at a glance: 3 MEETS, 8 PARTIAL, 2 MISSING, 0 N/A (out of 13)
- Headline: Skylark defines a disciplined markdown-with-YAML-frontmatter artifact convention that covers schema, git-backing, cross-referencing, and changelog capture, but it lacks any non-LLM query tooling, atomic-write primitives, or event emission — the substrate is a filesystem convention, not a queryable store.

## Per-Requirement Findings

### Req 1: Structured schema. Work items have a defined schema: at minimum `id`, `title`, `type` (task/spec/plan/review/PR/etc.), `status`, `blocked_by`, `blocks`, `parent`, `assignee`, `created_at`, `updated_at`, `labels`.

- Verdict: PARTIAL
- Evidence: `skills/_shared/artifact-conventions.md:57-67` defines the minimum frontmatter:
  ```yaml
  id: SPEC-001
  title: Human-readable title
  type: spec | plan | task | report | notes
  status: draft | reviewed | approved | in-progress | complete | blocked
  external_ref: ""
  parent: <relative path>
  created: YYYY-MM-DD
  updated: YYYY-MM-DD
  ```
  Task specs add `task_number`, `depends_on`, `domain` (lines 70-76). Reports add `round`, `verdict`, `target`, `expert`, `model` (lines 80-86).
- Notes: Present fields cover `id`, `title`, `type`, `status`, `parent`, `created`, `updated`. `depends_on` exists for tasks only (approximates `blocked_by`). Missing: `blocks` (inverse of `depends_on`), `assignee`, `labels`. "blocked" is a status value but not a blocking-relationship field at the spec/plan level.

### Req 2: Version-controlled storage. The substrate is git-backed (or equivalent) so history is replayable and auditable.

- Verdict: MEETS
- Evidence: Artifacts live under `docs/specs/`, `docs/plans/`, `docs/tasks/`, `docs/reports/`, `docs/notes/` inside the project git repo (`skills/_shared/artifact-conventions.md:7-19`). `skills/write-plan/SKILL.md:165` says "Save the plan to `docs/plans/PLAN-NNN-<slug>.md` with frontmatter. Commit to git." The append-only changelog rule (`artifact-conventions.md:146` "Append only — never modify or delete existing changelog entries") is reinforced by git history.
- Notes: Git-backing is implicit in the convention rather than enforced by tooling; relies on user/plugin committing.

### Req 3: Queryable without LLM. State can be inspected by dependency graph, status, label, or origin using a CLI or simple query — no LLM scan required to answer "what's blocking X?"

- Verdict: MISSING
- Evidence: No CLI, script, or query tool shipped. `skills/triage/SKILL.md:16-21` describes state detection as "Grep `docs/specs/`, `docs/plans/`, `docs/tasks/` for matching keywords from the input" and reading frontmatter — all LLM-driven scans. `artifact-conventions.md:107-114` state-detection table is procedural inspection by an agent, not a query primitive.
- Notes: Frontmatter is YAML and parseable by `yq`/`grep`, but nothing in the plugin provides query tooling; every state question routes through an agent reading files.

### Req 4: Atomic writes. Concurrent worker writes cannot corrupt state via interleaved edits. Transitions are all-or-nothing.

- Verdict: MISSING
- Evidence: No evidence found in `skills/_shared/`, `skills/implement/SKILL.md`, or any stage skill. Searches for `lock|atomic|concurrent|race` returned only "blocking" verdict text and unrelated uses. `skills/_shared/artifact-conventions.md` describes "Internal ID Allocation" as "Scan the relevant directory... Extract the highest NNN... Increment by 1" (lines 24-31) — a read-modify-write sequence with no locking protocol.
- Notes: Parallel execution via `dispatch-with-mux` (referenced in `skills/implement/SKILL.md:116-123`) could produce ID collisions or interleaved changelog appends; no mitigation specified.

### Req 5: Cross-references by ID. Artifacts link to each other by stable ID — task → spec → plan → PR — not by file path or title.

- Verdict: PARTIAL
- Evidence: IDs exist (`SPEC-NNN`, `PLAN-NNN`, `TASK-NNN`, `NOTE-NNN`; see `artifact-conventions.md:24-32`). However `parent` is defined as `<relative path>` (line 64: `parent: <relative path>`) and examples use paths (`parent: docs/specs/SPEC-NNN-slug.md` in `write-plan/SKILL.md:50`, `parent: docs/plans/PLAN-NNN-slug.md` in `plan-review/SKILL.md:32`). Only `depends_on` uses IDs (`plan-review/SKILL.md:33`: `depends_on: []` with example `["TASK-001"]` from `artifact-conventions.md:74`). Report `target` is also a path (`artifact-conventions.md:83`).
- Notes: Cross-reference model is dual — IDs appear in filenames and `id` fields, but linking fields (`parent`, `target`) are path-based. Mixed semantics.

### Req 6: Survives compaction and session boundaries. The substrate is canonical; conversation memory is ephemeral scaffolding around it.

- Verdict: MEETS
- Evidence: `skills/implement/SKILL.md:172-178`:
  > "If the session ends mid-pipeline:
  > - All state is in artifacts (specs, plans, tasks, reports with frontmatter and changelogs)
  > - Next session: user runs `/skylark:implement` again with the same input
  > - Triage detects state from artifacts and resumes at the correct stage
  > This is why artifact discipline matters — every stage must leave a recoverable artifact trail."
  `artifact-conventions.md:106` "Skills detect pipeline state by examining artifacts, not by relying on agent memory."
- Notes: Explicit design principle. Depends on stage skills actually writing the artifact on each transition; no framework-level enforcement.

### Req 7: Idempotent re-runs. Re-running the pipeline skips items already in terminal states; the orchestrator inspects the substrate rather than replaying.

- Verdict: MEETS
- Evidence: `skills/triage/SKILL.md:47-65` State Detection reads artifact status and panel reports to determine re-entry point. Pipeline path table (lines 86-104) routes by `(type, state, risk)` — e.g., `spec | approved | any | PLAN → ...` (line 96), `plan | decomposed | any | DEVELOP → FINISH` (line 99), `task | in-progress | any | DEVELOP (resume)` (line 101). `implement/SKILL.md:174-177` reinforces resumption.
- Notes: Idempotency is by substrate inspection, which depends on Req 3 (LLM-scanned, not CLI-queried), but the semantic guarantee is present.

### Req 8: Human-readable, machine-parseable. Items can be inspected by a human without special tools (plain text fallback) but are structured enough for CLI queries and tool automation.

- Verdict: PARTIAL
- Evidence: Markdown body with YAML frontmatter satisfies "human-readable" and "machine-parseable" at the file level. Changelog entries use a structured prefix: `artifact-conventions.md:143`: "Always use `[STAGE_NAME]` prefix for machine-parseable events".
- Notes: Format is parseable in principle (frontmatter via any YAML tool, changelog via regex) but no tooling ships to demonstrate automation; parseability is latent.

### Req 9: Event emission on transition. Item status changes emit structured events for telemetry and downstream automation (e.g., "item X moved to ready" triggers dispatch).

- Verdict: PARTIAL
- Evidence: Two event surfaces exist, both narrative:
  1. In-file changelog appends: `artifact-conventions.md:117-140` — human-readable log entries tagged `[STAGE]`.
  2. Linear comments: `skills/linear/SKILL.md:20-45` "Event Comments" table with per-stage format (`[TRIAGE] Classified as [risk]...`, `[DEVELOP] Task [N/total] complete...`, etc.).
- Notes: No machine event bus, webhook, or structured emission. "Events" are markdown entries that downstream automation would need to parse. Nothing is triggered *by* an event; Linear comments are sinks, not sources.

### Req 10: Stable, portable, short IDs. IDs are short enough for conversational reference (agents can say "gt-abc12" or similar), stable across the item's lifetime, and portable across workspaces.

- Verdict: PARTIAL
- Evidence: `artifact-conventions.md:32` "The internal ID is the canonical reference used in cross-references, changelogs, branch names, and commit messages." Format `TYPE-NNN` (e.g., `SPEC-001`, `TASK-012`) is short and conversational. Stability is implied by "The internal ID is the canonical reference" and by filenames that embed the ID.
- Notes: IDs are per-repo sequential counters (lines 24-31). Portability across workspaces is not guaranteed — `SPEC-001` in repo A collides with `SPEC-001` in repo B; no namespace or hash component. `external_ref` is the designated cross-workspace link but is optional and free-form.

### Req 11: Decision capture. Items store the *why* of decisions — rationale, alternatives considered, constraints — not just the *what*.

- Verdict: PARTIAL
- Evidence: Changelog entries can carry rationale (example in `artifact-conventions.md:135`: "[SPEC-REVIEW] Round 1: revise. 2 blocking issues."). Session notes in `finish/SKILL.md:197-203` explicitly capture "Decisions that deviated from plan — why and what changed", "Codebase discoveries", "Deferred questions". Brainstorm and spec-review stages produce panel reports with verdicts.
- Notes: The convention invites decision capture (session notes, changelog) but the frontmatter schema itself has no `rationale`, `alternatives`, or `constraints` fields. Depends on discipline in free-text body. No structured place for "alternatives considered."

### Req 12: Specs and plans are first-class. Specs, plans, and reviews are artifact types in the substrate, not ad-hoc files in a docs directory.

- Verdict: PARTIAL
- Evidence: `artifact-conventions.md:7-19` enumerates `specs/`, `plans/`, `tasks/`, `reports/`, `notes/` as first-class directories with dedicated ID counters and `type` frontmatter values (line 60: `type: spec | plan | task | report | notes`).
- Notes: They are first-class conceptually, but the substrate *is* the docs directory — the critique embedded in the requirement ("not ad-hoc files in a docs directory") literally applies. There is no separate store; first-class status is encoded by directory convention and frontmatter typing alone.

### Req 13: Migration path. Existing ad-hoc artifacts (markdown in `docs/`, Linear issues) can be imported into or referenced from the substrate without rewriting history.

- Verdict: PARTIAL
- Evidence: Backwards-compat clause: `artifact-conventions.md:21` "Skills also check `docs/superpowers/specs/` and `docs/superpowers/plans/` when searching for existing artifacts. New artifacts always go in `docs/specs/`, `docs/plans/`, etc." External references: `artifact-conventions.md:42-51`:
  ```yaml
  external_ref: "ENG-142"
  external_ref: "owner/repo#42"
  external_ref: "PROJ-1234"
  ```
  `skills/linear/SKILL.md:74-80` "Issue-to-Spec Graduation" describes how Linear issues can escalate to a spec file with `external_ref` link.
- Notes: Read-path migration exists (legacy dirs scanned); no import tool, no rewriting of history, no structured importer from Linear. Migration is "point at the old file" rather than "bring it into the substrate."

## Surprises

- **No tooling at all ships with the plugin.** The substrate is a convention document (`artifact-conventions.md`) interpreted by LLM agents at runtime. There are no scripts, CLIs, or hooks. Every claim about state is re-derived per session by reading markdown.
- **Dual ID/path cross-reference model.** `parent` and `target` link by relative path; `depends_on` links by ID. An artifact moved on disk would silently break parent/target chains.
- **Sequential ID allocation is inherently racy.** "Scan directory, take max, +1" (lines 24-31) has no locking, yet `dispatch-with-mux` supports parallel task execution.
- **Linear is an out-of-band mirror, not the substrate.** `skills/linear/SKILL.md:78` "The Linear issue remains the source of truth for status. The spec file holds the detailed design." — this contradicts Req 6/7's "substrate is canonical", because two sources of truth exist for status at elevated+ risk.
- **`docs/` is overloaded.** Same top-level directory holds `specs/`, `plans/`, `tasks/`, `reports/`, `notes/` (artifacts) alongside `research/`, `spec/` (non-artifact prose). No separation between the canonical substrate and human-authored docs.
- **`status` enum for tasks vs. specs differs.** `artifact-conventions.md:60` lists `draft | reviewed | approved | in-progress | complete | blocked`; `plan-review/SKILL.md:37` uses `status: pending` for tasks (not in the master enum). Minor but indicates schema drift.

## Open Questions for Trial

- Can two parallel `develop` workers running under Mux allocate overlapping `TASK-NNN` IDs under real load?
- How does re-running `/skylark:implement` behave when `docs/` artifact state disagrees with Linear status (drift scenario)?
- Is the changelog-based history sufficient to answer "show every elevated-risk item blocked for >3 days" without LLM scan, or does it require building a parser?
- What happens to `parent:` path references when an artifact is renamed or moved?
- Can a spec be imported from another repo's `docs/specs/` and retain its `SPEC-NNN` ID, or does it collide with local numbering?
- How does compaction actually interact with this substrate in a long session — is every stage verified to re-read artifacts from disk instead of relying on in-context copies?

## Source Index

- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/03-artifact-and-task-substrate.md` (criteria spec)
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/evaluation-prompts.md` (method + report format)
- `/Users/deuley/code/mocha/ai/plugins/skylark/CLAUDE.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/artifact-conventions.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/implement/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/triage/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/write-plan/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/plan-review/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/finish/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/linear/SKILL.md`
- Directory listings: `skills/`, `skills/_shared/`, `docs/`, `docs/research/reviews/skylark/`
- Grep scans for `event|emit|hook|webhook`, `lock|atomic|concurrent|race`, `jq|yq|grep|find` across `skills/`

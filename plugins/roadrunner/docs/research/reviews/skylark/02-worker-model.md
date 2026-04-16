# Skylark — Worker Model Conformance Evaluation

## Summary

- Conformance at a glance: 4 MEETS, 3 PARTIAL, 5 MISSING, 0 N/A (out of 12)
- Headline: Skylark's per-task vocabulary-routed expert generation and ephemeral subagent dispatch are strong, but structured typed returns, per-role tool scoping, runtime pluggability, peer-awareness logging, context-budget hand-off, and bounded-lifetime timeouts have no evidence in the codebase.

## Per-Requirement Findings

### Req 1: Ephemeral sessions. Worker session terminates at task completion. No long-lived worker accumulates conversation across tasks.

- Verdict: MEETS
- Evidence: `skills/develop/SKILL.md:12` states as a core principle "Fresh vocabulary-routed expert per task (never reuse expert context across tasks)". The Red Flags section (`skills/develop/SKILL.md:339`) says "Never: Reuse expert context from other tasks — always generates fresh". `skills/panel-review/SKILL.md:170` likewise disclaims pre-built profiles: "always generates bespoke experts". The Agent tool dispatch is one-shot per task.
- Notes: `skills/dispatch-with-mux/SKILL.md:253-255` describes "Send a follow-up message to the same Mux workspace" for `NEEDS_CONTEXT`, meaning within a single task the workspace persists — but it still terminates at task completion, not across tasks.

### Req 2: Persistent identity, ephemeral state. Worker identity (role, accumulated telemetry, reputation) persists across sessions, decoupled from the conversation state of any one session.

- Verdict: MISSING
- Evidence: No evidence found in `skills/`, `_shared/`, or `CLAUDE.md` of any cross-session identity store, role registry with telemetry, or reputation tracking. Each expert prompt is generated fresh at dispatch (`skills/develop/SKILL.md:36` "scoped to THIS TASK's domain", `skills/panel-review/SKILL.md:172` "always generates bespoke experts"). No persisted role/identity records exist — only per-artifact changelogs (`_shared/artifact-conventions.md:117`).
- Notes: The vocabulary-routing methodology is explicitly stateless per task; identity is a function of the current task, not a persistent entity.

### Req 3: Per-task prompt generation. Worker prompts are generated at dispatch time based on the specific task, not baked into static config at orchestrator startup. A dispatch call can pass a full prompt body.

- Verdict: MEETS
- Evidence: `skills/develop/SKILL.md:34` "Step 2: Generate Expert Developer Prompt ... scoped to THIS TASK's domain (not the whole project)". `skills/_shared/expert-prompt-generator.md:10` "5-Step Process" builds the prompt at dispatch. `skills/develop/SKILL.md:93` "Write the expert developer prompt as CLAUDE.md in the worktree root" and `skills/develop/SKILL.md:97` "The dispatch prompt (in addition to the CLAUDE.md) should include..." — full prompt body passes on each call.
- Notes: This is Skylark's stated differentiator. It is consistently applied in `develop`, `panel-review`, `solo-review`, and `dispatch-with-mux`.

### Req 4: Dynamic context injection. Prompt generation supports injecting domain vocabulary, scoped file paths, relevant prior artifacts, and task-specific constraints.

- Verdict: MEETS
- Evidence: `skills/_shared/expert-prompt-generator.md:41` "Extract Vocabulary — 3-5 clusters, 15-30 terms total". `skills/develop/SKILL.md:46` "Pull from the vocabulary payload built during prepare, but filter to what's relevant for this task". `skills/develop/SKILL.md:100` shows the dispatch template with "Task Description", "Context" (scene-setting, architectural context), and "Deliverables" (concrete files). `skills/_shared/prompt-template.md:6-30` defines Identity, Domain Vocabulary, Anti-Patterns, Operational Guidance, Testing Expectations, Deliverables sections.
- Notes: Vocabulary payload originates in `prepare` and is narrowed per task.

### Req 5: Curated inputs only. Workers never receive a blanket dump of parent context or unrelated artifacts — only the inputs the task requires.

- Verdict: MEETS
- Evidence: `skills/develop/SKILL.md:10` "They should never inherit your session's context or history — you construct exactly what they need". `skills/develop/SKILL.md:32` "Extract the full task text now. The subagent receives the full text inline — do NOT make the subagent read the plan or task file. You curate exactly what context is needed." `skills/develop/SKILL.md:346` Red Flag "Make subagent read plan file (provide full text instead)".
- Notes: Review skills pass a file path rather than inlining content to leverage prompt caching across parallel panelists (`skills/panel-review/SKILL.md:107-110`) — still curated (single target document).

### Req 6: Structured outputs. Worker returns a typed result (status enum + typed fields), not free-form prose.

- Verdict: PARTIAL
- Evidence: `skills/develop/SKILL.md:187` defines a report format: "Status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED" plus sections "What you implemented", "What you tested", "Files changed", "Self-review findings", "Any issues or concerns". `skills/develop/SKILL.md:322` return to implement is also structured: `status`, `task_id`, `task_path`, `worktree_path`, `branch`, `changes`, `test_results`, `review_rounds`, `outstanding_issues`. Review skills have a format: "Strengths / Issues / Missing / Verdict" (`skills/_shared/prompt-template.md:37-57`).
- Notes: The format is specified in the prompt, not enforced by a schema or parser. `skills/dispatch-with-mux/SKILL.md:243` parses `reportMarkdown` for the status format — string parsing rather than typed return.

### Req 7: Typed status outcomes. At minimum: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, BLOCKED.

- Verdict: MEETS
- Evidence: `skills/develop/SKILL.md:188` "Status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED". `skills/develop/SKILL.md:203-215` "Step 6: Handle Implementer Status" has explicit handling for each of the four statuses. `skills/dispatch-with-mux/SKILL.md:243-266` mirrors this for parallel dispatch: "Parse `reportMarkdown` from each completed workspace for the skylark status format: DONE ... DONE_WITH_CONCERNS ... NEEDS_CONTEXT ... BLOCKED".
- Notes: Reviewers emit a separate verdict enum: "Ship | Revise | Rethink" (`skills/_shared/prompt-template.md:56`, `skills/panel-review/SKILL.md:125`) — an additional typed outcome on top of the four required statuses.

### Req 8: Per-role tool scoping. Worker tool access is configurable per-role (narrowing, not broadening).

- Verdict: MISSING
- Evidence: No evidence found in any SKILL.md or `_shared/` file of a `tools:` frontmatter or per-role tool restriction. `skills/develop/SKILL.md:95` mentions "Dispatch using the `Agent` tool with `isolation: "worktree"`" but does not specify tool narrowing. A grep for `tools:`, `permissionMode`, and `isolation:` across `skills/` returns only the single reference in `develop/SKILL.md:95` and no frontmatter examples on dispatched agents. The docs research file `docs/research/claude-code-sandbox-ergonomics-report.md:399-401` describes the Claude Code `tools` / `permissionMode` / `isolation` frontmatter mechanism as a recommendation, but Skylark itself does not set them.
- Notes: The Mux agent-definition example in `skills/dispatch-with-mux/SKILL.md:151-159` shows `name`, `base`, `subagent.runnable`, `prompt.append` — no tools or permissionMode fields.

### Req 9: Pluggable runtime. The same task definition runs under multiple runtimes (Claude Code, Codex, Copilot CLI) via a thin adapter — no per-task rewrite.

- Verdict: PARTIAL
- Evidence: `skills/dispatch-with-mux/SKILL.md` is an alternative dispatcher that uses the Mux ORPC API (`/api/workspace.create`, `/api/workspace.sendMessage` at lines 126, 189). `skills/dispatch-with-mux/SKILL.md:48-51` maps a `.muxrc` `models` section ("sonnet", "opus", "haiku") to Anthropic identifiers. Both paths (`develop` and `dispatch-with-mux`) consume the same task spec files in `docs/tasks/` and use the same expert-prompt generator.
- Notes: Mux is itself a layer over Anthropic models (`claude-sonnet-4-*`, `claude-opus-4-*`), not a cross-vendor runtime (Codex, Copilot CLI). No adapter abstraction for non-Claude runtimes exists. The "pluggable runtime" requirement targets cross-vendor parity, which Skylark does not provide.

### Req 10: Peer-awareness log. Workers emit a decision/work log that concurrent or subsequent workers can consume to avoid conflicting choices. Format must be short enough to inject without context bloat.

- Verdict: PARTIAL
- Evidence: `_shared/artifact-conventions.md:117-140` defines an in-file changelog appended after every pipeline event: "Every artifact maintains a changelog section at the bottom of the file. This is the primary audit trail". Example entry: `- **YYYY-MM-DD HH:MM** — [DEVELOP] Task complete. Tests pass. Branch: task/TASK-012-schema-migration.`. `skills/dispatch-with-mux/SKILL.md:314-328` dispatches waves sequentially — within a wave tasks are independent, and after each wave the main branch is updated before the next wave runs, providing de-facto peer awareness via git state.
- Notes: There is no mechanism described for injecting the changelog into a concurrent worker's prompt to prevent conflicting choices at runtime — the log is consumed post-hoc by the orchestrator when building the next task's context. `skills/dispatch-with-mux/SKILL.md:220-225` explicitly says "Dispatch ALL tasks in the wave before monitoring any of them" with no peer-log exchange between live workers.

### Req 11: Single-session discipline. Any worker exceeding ~60% of its context window must hand off (produce a structured continuation artifact) rather than compact.

- Verdict: MISSING
- Evidence: No evidence found. A grep of `skills/` for "60%", "context window", "continuation", "handoff", and "hand off" returned no hits. `skills/develop/SKILL.md:144-157` addresses escalation via `BLOCKED`/`NEEDS_CONTEXT` ("It is always OK to stop and say 'this is too hard for me.'") but frames it around task difficulty, not context budget. There is no continuation-artifact schema.
- Notes: The `NEEDS_CONTEXT` status is the closest analogue but targets missing information, not context-window saturation.

### Req 12: Bounded lifetime. Workers have an explicit timeout; exceeding it escalates rather than silently hangs.

- Verdict: MISSING
- Evidence: No evidence found. A grep for "timeout" in `skills/` returns a single match in `_shared/expert-prompt-generator.md:34` ("cascading timeout risks") as an example identity phrase — unrelated. `skills/dispatch-with-mux/SKILL.md:389` notes a failure mode "Task times out (no completion after extended period) | Report to user" but specifies no explicit timeout value or mechanism — it is left as an ambient condition.
- Notes: The sequential `develop` path has a 2-review-round cap (`skills/develop/SKILL.md:304-318`) which bounds iteration but is not a worker-lifetime timeout.

## Surprises

- Skylark has two worker-dispatch paths: `develop/SKILL.md` (sequential, via the Agent tool) and `dispatch-with-mux/SKILL.md` (parallel, via a Mux server ORPC API). Both converge on the same expert-prompt artifact and the same typed status set, but `dispatch-with-mux` introduces a `reportMarkdown` string-parse boundary rather than a typed return.
- The "review" subagents (`panel-review`, `solo-review`) pass a file path rather than inlining the document — the comment `skills/panel-review/SKILL.md:108-110` says "This enables prompt caching (all agents read the same file) and reduces token waste." This is a deliberate optimization at odds with the Req-1 framing of the Worker Model spec's key force about subagent prompt caching being disabled in Claude Code.
- The expert prompt lands in two distinct slots depending on dispatcher: a worktree-root CLAUDE.md for sequential develop (`skills/develop/SKILL.md:93`), and a Mux agent-definition file (`.mux/agents/task-NNN-expert.md`) at position 4 in the Mux system-prompt assembly for parallel dispatch (`skills/dispatch-with-mux/SKILL.md:140-182`).
- The expert-prompt template has a "Mandatory Review Directive" (`skills/_shared/prompt-template.md:94-98`) requiring reviewers to identify at least one substantive issue — a guardrail against rubber-stamping that is unique to review roles.
- `skills/develop/SKILL.md:346` forbids dispatching multiple implementation subagents in parallel ("Dispatch multiple implementation subagents in parallel (conflicts)") — parallelism is only reached via the optional Mux path, and the sequential path is strictly serial.

## Open Questions for Trial

- What actually happens when an implementation worker crosses the 60% context utilization threshold? No skill mentions detecting or reacting to it.
- Does the Agent tool dispatch in `skills/develop/SKILL.md:95` honor `isolation: "worktree"` as a first-class parameter, or is that a description of intent rather than a passed argument? The single reference does not clarify.
- How is a silently hung subagent detected in the sequential path? Only `dispatch-with-mux` mentions a timeout failure mode, and only informally.
- Do concurrent Mux workers in the same wave ever read each other's in-flight changelog entries, or is peer awareness entirely deferred to wave boundaries?

## Source Index

- `/Users/deuley/code/mocha/ai/plugins/skylark/CLAUDE.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/develop/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/panel-review/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/solo-review/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/dispatch-with-mux/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/expert-prompt-generator.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/vocabulary-guide.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/prompt-template.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/artifact-conventions.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/risk-matrix.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/02-worker-model.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/evaluation-prompts.md`
- Grep across `/Users/deuley/code/mocha/ai/plugins/skylark/skills/` for `permissionMode`, `isolation`, `tools:`, `timeout`, `60%`, `context window`, `continuation`, `handoff`, `hand off`, `peer`, `runtime adapter`, `pluggable`

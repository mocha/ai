# Skylark — Monitoring and Recovery Conformance Evaluation

## Summary

- Conformance at a glance: 0 MEETS, 3 PARTIAL, 10 MISSING, 0 N/A (out of 13)
- Headline: Skylark is a prompt-and-skills plugin with no runtime supervisor, no telemetry emission, no dashboard, and no automated recovery; its only monitoring-adjacent substrate is the in-artifact changelog plus bounded review-round escalation, so almost the entire Monitoring and Recovery domain is delegated (implicitly) to the Claude Code host harness.

## Per-Requirement Findings

### Req 1: Structured telemetry (OTEL-compatible). Every worker emits structured events: session lifecycle, tool calls, status transitions, decision log entries. Compatible with standard OTLP backends.

- Verdict: MISSING
- Evidence: No OTEL / OTLP / telemetry references exist in `skills/`, `CLAUDE.md`, or any settings file. A `grep -i "telemetry|otel|otlp"` across `skills/` returns zero hits. The closest substrate is the in-artifact changelog (`skills/_shared/artifact-conventions.md` lines 118–146) which specifies `[STAGE]` prefixed Markdown entries — "machine-parseable events" per the spec, but plain text, not OTLP-compatible, and per-artifact rather than per-worker.
- Notes: Skylark does not provide telemetry; it relies on whatever logging the Claude Code host session emits. No evidence of instrumentation for tool calls or session lifecycle.

### Req 2: Classified health states. Workers are classified into states (e.g., working, stalled, GUPP-violation, zombie, idle) based on observable signals (recent activity, progress metrics).

- Verdict: PARTIAL
- Evidence: Skylark defines a small state vocabulary for implementer subagents in `skills/develop/SKILL.md` line 188: "**Status:** DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED". These are *self-reported* terminal statuses, not observable-signal-based health classifications. `skills/dispatch-with-mux/SKILL.md` adds a progress view with `completed | running | pending | skipped` (lines 234–239, 347–355) but these are also orchestrator-tracked lifecycle states, not stall/zombie detection.
- Notes: No "stalled", "zombie", or "GUPP-violation" class. No signal-based classifier — the worker declares its own status in its final report.

### Req 3: Continuous fleet supervision. A supervisor process runs continuously, monitors all workers, and triggers recovery (nudge, handoff, restart) automatically.

- Verdict: MISSING
- Evidence: No supervisor process or daemon exists. `skills/implement/SKILL.md` is an orchestrator that walks the pipeline sequentially (lines 17–21: `TRIAGE → PREPARE → … → DEVELOP → FINISH`). `skills/dispatch-with-mux/SKILL.md` polls workspaces: "Poll each workspace for completion. Use Mux's streaming chat API or poll the workspace status endpoint" (line 230), but there is no automated nudge/handoff/restart — only progress display and then `Handle Task Statuses` which routes BLOCKED back to the user (lines 257–265).
- Notes: Supervision is orchestrator-responsibility, not daemon-based, and is step-sequential rather than continuous.

### Req 4: Supervisor-of-supervisors. Supervisors themselves are monitored. Failure modes in the monitoring layer cannot silently disable it.

- Verdict: MISSING
- Evidence: No evidence of meta-supervision. The implement skill itself runs inside a single Claude Code session; if that session stalls or compacts, nothing watches it. `skills/implement/SKILL.md` lines 171–178 acknowledge session loss: "If the session ends mid-pipeline: All state is in artifacts … Next session: user runs `/skylark:implement` again." Recovery is user-initiated, not automated meta-monitoring.
- Notes: Skylark relies on the human operator to notice and restart, not on a supervisor-of-supervisors.

### Req 5: Severity-routed escalation. Stuck workers escalate rather than waiting indefinitely. Severity (P0/P1/P2) routes to the appropriate target (human operator, peer agent, logged-only).

- Verdict: PARTIAL
- Evidence: Escalation exists but is single-channel (always to the user). `skills/develop/SKILL.md` lines 311–317: "**Revise (round 2) or Rethink** → Escalate. Present unresolved findings to user". `skills/_shared/risk-matrix.md` line 60: "Escalation is always **pause + notify**, never automatic pipeline restart." The review round cap (max 2) prevents indefinite waiting on review loops. There is no P0/P1/P2 taxonomy and no alternative routing (peer agent, logged-only).
- Notes: Stuck-in-review ≠ stuck-worker. No stall-timer; if a subagent hangs the Agent tool call, Skylark has no hook to detect it.

### Req 6: Full audit log. Every tool call is logged with session + task + worker attribution. Queryable after the fact.

- Verdict: PARTIAL
- Evidence: `skills/_shared/artifact-conventions.md` line 118: "Every artifact maintains a changelog section at the bottom of the file. This is the primary audit trail — no external system required." Entries use `[STAGE]` prefixes with timestamps (lines 122–127) and reference reports/branches. This is stage-level, not tool-call-level. It also does not capture per-tool-invocation attribution or token counts.
- Notes: Skylark provides task/artifact-level audit. Tool-call-level audit with session+task+worker attribution is delegated to the Claude Code host (session transcripts), not a Skylark feature.

### Req 7: Crash recovery automation. Handles stale git locks, orphaned worktrees, half-complete task states, zombie processes. No manual `rm -f` required.

- Verdict: MISSING
- Evidence: `skills/finish/SKILL.md` performs *orderly* worktree cleanup (lines 216–234: `git worktree remove <worktree-path>`) but only as part of a successful completion flow. No handler for stale `.git/index.lock`, orphaned worktrees from killed sessions, or zombie processes. `skills/implement/SKILL.md` lines 171–178 addresses half-complete state by re-reading artifacts on restart — "Triage detects state from artifacts and resumes at the correct stage" — but this is state *discovery*, not lock/worktree cleanup.
- Notes: The ENG-180 retrospective does not flag lock/zombie cleanup as an observed failure, but the spec requires the capability; none is provided. Skylark relies on the host and on the user to run manual cleanup.

### Req 8: Human-visible dashboard. Fleet state, convoy progress, stuck agents, escalations, and cost metrics render in a dashboard or TUI. No log spelunking for normal operations.

- Verdict: MISSING
- Evidence: No dashboard or TUI. The only "view" is Markdown progress reports printed into the Claude Code session, e.g. `skills/implement/SKILL.md` lines 137–144:
  ```
  ## Progress: [N/total] tasks complete
  completed  TASK-001: [title] — complete
  …
  ```
  and the richer variant in `skills/dispatch-with-mux/SKILL.md` lines 394–410. These are inline chat messages, not a persistent dashboard, and carry no cost metrics.
- Notes: Skylark does not provide a dashboard; it relies on the Claude Code host UI (chat + transcript).

### Req 9: Cost telemetry. Tokens per worker, cache hit rate, and cost per pipeline run are measured and visible. Anomalies surface quickly.

- Verdict: MISSING
- Evidence: No token counting, cache-hit tracking, or cost aggregation exists in Skylark. The word "cost" appears only as a *model-selection* heuristic — `skills/develop/SKILL.md` line 81: "Use the least powerful model that can handle the task to conserve cost and increase speed" — and in `skills/_shared/risk-matrix.md` line 39 ("Sonnet … fast, lower cost"). Neither measures nor surfaces actual token/cost numbers.
- Notes: Any cost metrics available are provided by the Claude Code host (`/cost`, `/insights`), not by Skylark.

### Req 10: Idempotent recovery actions. Repeated recovery attempts (e.g., nudge, handoff) do not amplify damage. Safe to retry.

- Verdict: PARTIAL
- Evidence: Skylark's *resumption* model is idempotent by artifact-state inspection: `skills/implement/SKILL.md` lines 171–178: "All state is in artifacts … Triage detects state from artifacts and resumes at the correct stage." `skills/_shared/artifact-conventions.md` lines 106–114 enumerates state detection rules (`Task complete? Task frontmatter has status: complete`). Changelog is append-only (line 146: "Append only — never modify or delete existing changelog entries"). However, no recovery *action* taxonomy exists (no nudge, no handoff mechanism), so idempotency of recovery actions is only meaningful for the pipeline-resume case.
- Notes: Worktree recreation on retry is not guarded: `skills/develop/SKILL.md` Step 3 calls `git worktree add <worktree-path> -b <task-branch-name>` unconditionally, which would fail if the worktree already exists; there is no check-and-reuse logic.

### Req 11: Severity-routed notifications. Human notifications are routed by severity through a configured channel. P0 interrupts; lower severity batches.

- Verdict: MISSING
- Evidence: No notification channel or severity router. All communication to the operator is in-band chat output in the current Claude Code session. No hooks configured for notifications — there is no `.claude/settings.json` in the plugin at all (`ls` shows no `.claude/` directory). `CLAUDE.md` makes no notification statement.
- Notes: Skylark relies entirely on the host harness's in-session chat presentation.

### Req 12: Predecessor-session discovery. Stuck or restarted workers can discover and query predecessor sessions for context before giving up or starting over.

- Verdict: PARTIAL
- Evidence: Skylark approximates this via artifact-first state persistence. `skills/implement/SKILL.md` line 178: "This is why artifact discipline matters — every stage must leave a recoverable artifact trail." `skills/finish/SKILL.md` Step 7 writes session notes (`docs/notes/NOTE-NNN-…md`) that capture decisions and discoveries (lines 182–204). A restarted pipeline re-reads these plus the artifact changelog. There is no session-ID-indexed query layer and no cross-session transcript query — only Markdown re-reading of structured artifacts.
- Notes: Predecessor "session" here is really "predecessor artifact". The ENG-180 retrospective (lines 28–34, 142–150) flags that 150–300 line resumption notes were being hand-written and are lossy — empirical confirmation that Skylark's predecessor-discovery story is informal.

### Req 13: Loop detection. Infinite revision loops, doom loops, and repeated tool-call patterns are detected automatically and break the loop with an escalation.

- Verdict: PARTIAL
- Evidence: Revision loops are *bounded by fiat*, not detected by pattern analysis. `skills/develop/SKILL.md` line 341: "Iterate beyond 2 review rounds — escalates to user". `skills/spec-review/SKILL.md` line 98 and `skills/plan-review/SKILL.md` line 3 apply the same 2-round cap. `skills/panel-review/SKILL.md` line 167: "Maximum 2 rounds. If blocking issues persist after round 2, escalate". No detection of tool-call repetition patterns or within-worker doom loops — those rely on the host.
- Notes: The cap prevents one specific loop (review ping-pong). Loops *inside* a worker subagent (e.g., reading files forever) are not Skylark-detected; `skills/develop/SKILL.md` lines 148–157 merely ask the implementer to self-escalate: "You've been reading file after file trying to understand without progress" → "Report back with status BLOCKED or NEEDS_CONTEXT." This is a cooperative check, not a detector.

## Surprises

- No `.claude/settings.json` or any hooks file ships with the plugin (`ls` confirms no `.claude/` directory at the plugin root). The `CLAUDE.md` user rules reference adding rules to `./.claude/settings.json`, but Skylark itself provides none — every monitoring/notification hook that *could* be configured is not.
- The ENG-180 retrospective documents real monitoring-adjacent failures ("We compacted at least four times. Each reset required reconstructing state from markdown resumption notes", lines 29–34) that are not addressed by any dedicated mechanism in Skylark — the proposed fix at line 142 ("Stop rewriting the plan in resumption notes … A 'project state ledger' … is a fraction of the context footprint") is an unimplemented proposal, not a current feature.
- Skylark's only "continuous" monitoring is the Mux polling loop in `skills/dispatch-with-mux/SKILL.md` (line 230), which exists only when the user opted into parallel execution and a Mux server is running. The Mux server itself is explicitly out of scope: "This skill does NOT start the server" (line 30).
- The audit trail is a *per-artifact* Markdown changelog (`_shared/artifact-conventions.md` lines 118–146), not a centralised log. Cross-run queries would require grepping across `docs/specs/`, `docs/plans/`, `docs/tasks/`, `docs/notes/`.

## Open Questions for Trial

- If a dispatched Agent subagent genuinely hangs (no BLOCKED, no DONE), what timeout — if any — fires? This appears to be entirely host-harness behaviour; Skylark has no stall timer.
- If a session is killed mid-merge during `skills/dispatch-with-mux/SKILL.md` Step 6 (between `git merge` and `pnpm test`), does a subsequent `/skylark:implement` invocation detect the half-merged state, or does triage re-enter at DEVELOP as if the task were still pending?
- Does the host harness's `/insights` cost view get surfaced anywhere inside Skylark's progress reports? No file references it.
- Can review-round counters survive a session compaction event? The round counter lives in transient orchestrator state, not in the task artifact changelog explicitly; a compaction between round 1 and round 2 could reset it.

## Source Index

- `/Users/deuley/code/mocha/ai/plugins/skylark/CLAUDE.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/implement/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/develop/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/finish/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/dispatch-with-mux/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/panel-review/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/spec-review/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/plan-review/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/solo-review/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/prepare/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/artifact-conventions.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/risk-matrix.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/expert-prompt-generator.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/2026-04-15-eng-180-retrospective.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/08-monitoring-and-recovery.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/evaluation-prompts.md`
- Directory listing of `/Users/deuley/code/mocha/ai/plugins/skylark/` (confirmed absence of `.claude/` directory, hooks files, or settings files)
- Grep across `/Users/deuley/code/mocha/ai/plugins/skylark/skills/` for `telemetry|OTEL|otel|audit log|dashboard|stuck|stall|doom loop|escalat|cost|token spend|supervis|health check|crash recovery|zombie|orphan|nudge|predecessor|loop detection|runaway`

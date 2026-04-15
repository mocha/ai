# Gas Town — Context Engineering Conformance Evaluation

## Summary

- Conformance at a glance: 4 MEETS, 4 PARTIAL, 5 MISSING, 0 N/A (out of 13)
- Headline: Gas Town treats compaction as a failure signal and provides strong predecessor-session discovery (Seance), disk-canonical state (Beads/git), and PreCompact-triggered session cycling — but has no per-worker context budget, no proactive utilization alerts, and no deferred tool loading / static-prefix discipline.

## Per-Requirement Findings

### Req 1: Hard 60% ceiling per worker. Every worker session has a measurable context budget with a hard stop at ≤60% utilization. Exceeding it triggers handoff, not compaction.

- Verdict: MISSING
- Evidence: No numeric utilization budget found in docs or code. The only session-level context-management trigger is Claude Code's native `PreCompact` hook, which fires at Claude's own compaction threshold (75–95%), not at 60%. From `docs/design/polecat-lifecycle-patrol.md:53`: "Context filling | Claude Code | Auto-compaction; PreCompact hook saves state". Gas Town does not itself measure or cap utilization — it reacts to Claude's event.
- Notes: `gt handoff --cycle` does substitute a fresh session at compaction time, but the ceiling is whatever Claude Code chose, not a Gas Town-enforced ≤60%.

### Req 2: Disk-canonical state. Canonical state is on disk (artifacts, notes, decision logs). Conversation history is treated as ephemeral scaffolding, not source of truth.

- Verdict: MEETS
- Evidence: `docs/design/polecat-lifecycle-patrol.md:74` — "No explicit 'handoff payload' is needed. The beads state IS the handoff." Canonical state is enumerated in the same doc: "Git state: Commits, staged changes, branch position; Beads state: Molecule progress; Hook state: `hook_bead` on agent bead persists across sessions; Agent bead: `agent_state`, `cleanup_status`, `hook_bead` fields". `docs/glossary.md` — "Bead: Git-backed atomic work unit stored in Dolt." Polecat identity is described (`docs/glossary.md`) as "persistent identity but ephemeral sessions… Sessions and sandboxes are ephemeral… but the identity persists."
- Notes: Combined with `.events.jsonl` (`internal/events/events.go:80`) and OTEL event export (`docs/otel-data-model.md`), all durable state is off-conversation.

### Req 3: Defined handoff protocol. Handoff artifacts contain at minimum: completed work with commit hashes, pending work, key decisions with rationale, modified file paths, known blockers, next steps.

- Verdict: PARTIAL
- Evidence: `gt handoff --collect` / `--cycle` auto-collects structured state via `collectHandoffState()` in `internal/cmd/handoff.go:1443`. Collected sections (from code): Git state (branch, modified files, untracked files, stash count, unpushed commit count, "Recent commits: last 5"), Hooked Work (`gt hook`), Inbox (first 10 messages), Ready Work (`bd ready`), In Progress (`bd list --status=in_progress`). Help text for `gt handoff`: "The --collect (-c) flag gathers current state (hooked work, inbox, ready beads, in-progress items) and includes it in the handoff mail." From `docs/design/agent-api-inventory.md:273`: "10-section output: beacon, handoff warning, role context, CONTEXT.md, handoff content, attachment status, autonomous directive, molecule context, checkpoint, startup directive."
- Notes: Spec minimums covered: completed work (recent commits / closed steps), pending work (hooked / ready / in-progress), modified file paths (git modified files), next steps (hooked bead). NOT explicitly covered by the collector: "key decisions with rationale" and "known blockers" as distinct structured fields — decisions/rationale are only present insofar as the user adds a `-m` message or Seance can later retrieve them from prior transcripts. Commit hashes are implied by the `Recent commits` git log but not explicitly labelled as "completed work with hashes".

### Req 4: Predecessor query. A new session can query "what did the previous session decide/find about X?" without replaying its conversation or re-reading every file it touched.

- Verdict: MEETS
- Evidence: `gt seance --help`: "Seance lets you literally talk to predecessor sessions. 'Where did you put the stuff you left for me?' - The #1 handoff question. Instead of parsing logs, seance spawns a Claude subprocess that resumes a predecessor session with full context. You can ask questions directly… `gt seance --talk <id> -p 'Where is X?'` # One-shot question. The --talk flag spawns: claude --fork-session --resume <id>. This loads the predecessor's full context without modifying their session. Sessions are discovered from: 1. Events emitted by SessionStart hooks (~/gt/.events.jsonl) 2. The [GAS TOWN] beacon makes sessions searchable in /resume." Discovery flags: `--role`, `--rig`, `--recent`.
- Notes: This is the strongest implementation of Req 4 — predecessor query is a first-class primitive with one-shot and interactive modes.

### Req 5: Stable static prefix. System prompt, tool definitions, and long-lived rules are stable across turns to preserve prompt cache. Changes to this prefix are recognized as cache-invalidating events.

- Verdict: MISSING
- Evidence: No evidence found in `docs/`, `internal/hooks/`, `internal/cmd/prime.go`, or `docs/otel-data-model.md` for prompt-cache awareness or treatment of prefix changes as cache-invalidating events. `gt prime` does render a "10-section output" (`docs/design/agent-api-inventory.md:273`) at SessionStart and PreCompact, but there is no documented discipline about keeping earlier sections stable, and no telemetry tracks cache hit/miss.
- Notes: `agent.usage` event in `docs/otel-data-model.md` captures `cache_read_tokens` and `cache_creation_tokens`, but only as observed outcomes — not tied to a cache-preservation policy.

### Req 6: Append-only where possible. Context mutations invalidate cache; prefer appending new information over rewriting existing.

- Verdict: PARTIAL
- Evidence: Durable artefact stores are append-only: `internal/events/events.go:3` — "Events are written to ~/gt/.events.jsonl (raw audit log)"; `docs/design/ledger-export-triggers.md:38` — "Export Is One-Way and Append-Only"; OTEL telemetry is append-only by nature. Beads are git-backed and additive.
- Notes: Append-only property is present for state stores but the requirement targets in-context mutations to preserve prompt cache. There is no documented in-context append-only discipline (e.g., forbidding rewrites of CLAUDE.md mid-session). Partial because the foundational persistence layer has the property but it is not expressed as a cache-preservation strategy.

### Req 7: Deferred tool loading. Tool schemas and MCP tool definitions load on demand, not all-up-front, to keep the static context small.

- Verdict: MISSING
- Evidence: No evidence found for deferred/on-demand tool schema loading. `docs/HOOKS.md` describes a fixed hooks set (`pr-workflow-guard`, `session-prime`, `pre-compact-prime`, `mail-check`, `costs-record`, `clone-guard`, `dangerous-command-guard`) installed globally via base+overrides. `docs/design/plugin-system.md` describes a plugin system but nothing indicates lazy tool-schema injection.
- Notes: Tool exposure is governed by the host runtime (Claude Code, OpenCode, Copilot) and its settings; Gas Town does not layer deferred loading on top.

### Req 8: Mode isolation. Prose, decision/task, and code contexts are kept in distinct sessions or distinct files, not freely mixed.

- Verdict: PARTIAL
- Evidence: Roles are session-isolated by design — `docs/glossary.md` enumerates Mayor, Deacon, Polecat, Refinery, Witness, Crew as distinct agent identities, each in their own tmux pane with their own `.claude/settings.json` (`docs/HOOKS.md` table of "Generated targets"). Work is physically separated: "They work in isolated git worktrees to avoid conflicts" (`docs/glossary.md`).
- Notes: Isolation is by role, not by mode (prose vs. decision vs. code). There is no evidence of a distinction inside a single agent's session between prose-writing context and code-writing context. A single Polecat session mixes code reasoning and task/decision content.

### Req 9: Phase-boundary splits. Research/planning/implementation run in separate sessions (RPI pattern), not one long session. Each phase starts fresh with the prior phase's artifact as input.

- Verdict: PARTIAL
- Evidence: The Polecat step model enforces step-level session boundaries: `docs/design/polecat-lifecycle-patrol.md:40` — "Session cycle | Handoff, compaction, crash | Claude context window | Branch, worktree, molecule state" and lines 43–45: "A single step may span multiple session cycles (if the step is complex or compaction occurs). Multiple steps may fit in a single session (if steps are small…)." Step cleanup in 3.1 terminates the session while sandbox/molecule persist; the successor discovers "its position via: `bd mol current` / `bd show <step-id>`" (line 69).
- Notes: The substrate exists (molecules → steps → per-step session) but Gas Town does not prescribe an explicit R/P/I decomposition. Whether a molecule has separate research/plan/implement steps is up to the formula author, not enforced by the framework.

### Req 10: Auto-persisted state. A session's working state is persisted to disk automatically at key lifecycle events (pre-compact, stop, subagent completion) — not dependent on worker discipline to remember.

- Verdict: MEETS
- Evidence: `docs/HOOKS.md` default base config (lines 247–251): "SessionStart: PATH setup + `gt prime --hook`; PreCompact: PATH setup + `gt prime --hook`; UserPromptSubmit: PATH setup + `gt mail check --inject`; Stop: PATH setup + `gt costs record`." Registry table (line ~148): `session-prime` (SessionStart, all), `pre-compact-prime` (PreCompact, all), `costs-record` (Stop). For Crew specifically, `internal/hooks/config.go:240` overrides PreCompact to `gt handoff --cycle --reason compaction`, which calls `collectHandoffState()` and writes a handoff marker + mail before respawn (`internal/cmd/handoff.go:376` `runHandoffAuto`, line 440 `runHandoffCycle`). Polecats get a `Stop` override (`internal/hooks/config.go`) running `gt tap polecat-stop-check` to run `gt done` idempotently. Every event also lands in `~/gt/.events.jsonl` (`internal/events/events.go:80`).
- Notes: Persistence is harness-level and does not rely on the agent remembering to act.

### Req 11: Compaction as a failure signal. Compaction events are logged and treated as a signal to decompose further — never as a normal operating mode.

- Verdict: PARTIAL
- Evidence: Compaction is logged (PreCompact is a registered hook; handoff events go to `.events.jsonl`). For Crew, compaction is actively subverted: `internal/hooks/config.go:230` comment — "Crew workers: auto-cycle session on context compaction (gt-op78). Instead of compacting (lossy), replace with fresh session that inherits hooked work." `docs/HOOKS.md` — "pre-compact-prime" is enabled for all roles. `internal/cmd/prime.go:354` references gt-op78. `docs/design/polecat-lifecycle-patrol.md:44`: "A single step may span multiple session cycles (if the step is complex or compaction occurs)." For Polecats, compaction is accepted as a normal event that triggers state save, not as a trigger for decomposition.
- Notes: Gas Town logs compaction and replaces-rather-than-compacts for Crew, satisfying the "failure signal" spirit. It does not automatically flag a compaction event as a decomposition prompt for the Mayor or formula author — there is no feedback from compaction frequency to task sizing.

### Req 12: Three-tier context alerts. Workers emit warnings at 40%, 60%, and 70% utilization to drive decomposition decisions proactively.

- Verdict: MISSING
- Evidence: No evidence found. Grepping `docs/` for "40%", "60%", "70%", "utilization", "budget" returns no context-utilization alert mechanism. `docs/otel-data-model.md` `agent.usage` event records `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens` per assistant turn but there is no threshold-based warning emission.
- Notes: Raw token counts are captured, making downstream alerting theoretically derivable, but the alerts themselves do not exist.

### Req 13: Tool-result containment. Long tool results are stored to disk and referenced by path, not dumped verbatim into context.

- Verdict: MISSING
- Evidence: No evidence found. `agent.event` in `docs/otel-data-model.md:121` truncates tool results only for telemetry logging ("content truncated to 512 bytes"), not for in-context substitution. No microcompaction or placeholder-swap mechanism is documented.
- Notes: Whatever the host runtime puts into the conversation is what the agent sees; Gas Town does not intervene.

## Surprises

- Seance is unusually powerful: rather than parsing a summary artefact, a new session can literally `claude --fork-session --resume <id>` and interrogate the predecessor's full transcript without mutating it. This changes the handoff-fidelity trade-off — the "handoff artefact" can be thinner because the predecessor remains queryable.
- Gas Town's Crew role is the only role whose PreCompact hook performs a full session cycle rather than letting Claude compact in place (`internal/hooks/config.go:230`). Polecats let compaction happen and rely on beads state to survive it.
- `collectHandoffState()` at `internal/cmd/handoff.go:1443` is explicitly "Go library calls (no shelling out) to ensure the handoff always contains useful context even when external commands fail (GH#1996)" — a robustness guarantee uncommon in handoff-mail collectors.
- `docs/design/agent-api-inventory.md:273` describes the prime output as a fixed "10-section output" — this is closer to a stable static prefix than Req 5 credit suggests, but there is no documented cache-invalidation awareness, so it doesn't meet the bar.

## Open Questions for Trial

- Does `gt seance --talk <id>` produce a predecessor answer sufficient to replace the handoff artefact's "decisions with rationale" section in practice, or only surface-level recall?
- What is the actual token cost of the prime output's 10 sections at SessionStart, and does it reset cache?
- Can `collectHandoffState()` be extended by formula authors to include decision logs, or is it a fixed collector?
- At what Claude Code utilization does PreCompact actually fire in current Claude Code builds, and how does that compare to the spec's 60% target?

## Source Index

- `/Users/deuley/code/tools/gastown/docs/glossary.md`
- `/Users/deuley/code/tools/gastown/docs/HOOKS.md`
- `/Users/deuley/code/tools/gastown/docs/otel-data-model.md`
- `/Users/deuley/code/tools/gastown/docs/design/polecat-lifecycle-patrol.md`
- `/Users/deuley/code/tools/gastown/docs/design/persistent-polecat-pool.md`
- `/Users/deuley/code/tools/gastown/docs/design/agent-api-inventory.md`
- `/Users/deuley/code/tools/gastown/docs/design/ledger-export-triggers.md`
- `/Users/deuley/code/tools/gastown/docs/design/otel/otel-architecture.md`
- `/Users/deuley/code/tools/gastown/docs/design/otel/otel-data-model.md`
- `/Users/deuley/code/tools/gastown/internal/cmd/handoff.go` (lines 59, 90–91, 112, 120, 180, 340–460, 1439–1560)
- `/Users/deuley/code/tools/gastown/internal/cmd/prime.go` (lines 354–394, 340–460)
- `/Users/deuley/code/tools/gastown/internal/hooks/config.go` (lines 201–244)
- `/Users/deuley/code/tools/gastown/internal/events/events.go` (lines 3, 80, 83)
- CLI: `gt --help`, `gt seance --help`, `gt handoff --help`, `gt prime --help`, `gt resume --help`

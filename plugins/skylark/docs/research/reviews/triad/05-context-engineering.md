# Triad — Context Engineering Conformance Evaluation

## Summary

- Conformance at a glance: 0 MEETS, 5 PARTIAL, 8 MISSING, 0 N/A (out of 13)
- Headline: Triad's architecture is the inverse of this domain's requirements — long-running per-role Claude Code sessions accumulating context across the full project lifecycle, with disk-based inbox messages as the only handoff substrate and no context-budget instrumentation.

## Per-Requirement Findings

### Req 1: Hard 60% ceiling per worker. Every worker session has a measurable context budget with a hard stop at ≤60% utilization. Exceeding it triggers handoff, not compaction.

- Verdict: MISSING
- Evidence: No mention of context utilization percentage, budget, or handoff-at-threshold anywhere in `triad-source/`. The only requirement approximating sizing is at the dev-worker (not manager) level: "Completable in a single context window. If a task requires the worker to hold more context than fits, split it." (`agents/engineering-manager/CLAUDE.md:97`). The three manager sessions (PM/PgM/EM) are explicitly architected as long-running: "Agents are always running" (`docs/specs/2026-03-23-agent-triad-protocol-design.md:83`). Grep for `compact|context window|60%|token budget|utilization` found only decision-confidence uses of 60%, not context-utilization uses.
- Notes: All "60%" matches in the codebase refer to decision-confidence thresholds (e.g., `agents/program-manager/CLAUDE.md:221` "Below 60%: Escalate immediately"), not context utilization. No threshold-triggered handoff exists.

### Req 2: Disk-canonical state. Canonical state is on disk (artifacts, notes, decision logs). Conversation history is treated as ephemeral scaffolding, not source of truth.

- Verdict: PARTIAL
- Evidence: The protocol explicitly makes documents canonical: "The canonical document is the single source of truth — messages reference it, they don't duplicate it" (`docs/specs/2026-03-23-agent-triad-protocol-design.md:381`). Proposals, projects, and tasks live on disk under `docs/proposals/`, `docs/projects/`, `docs/tasks/`. Inbox messages archive to `docs/inbox/*/read/` as a committed decision trail (`docs/specs/2026-03-23-agent-triad-protocol-design.md:368-374`). However, each agent's running session accumulates conversation history as primary working memory — state is only reconstructable from disk on restart: "If an agent restarts and has lost its in-memory context about which negotiation cycle it is in, it can reconstruct state by reading the messages in `docs/inbox/<agent>/read/`" (`docs/specs/2026-03-23-agent-triad-protocol-design.md:366`). Conversation history is not treated as ephemeral; it is the default working state.
- Notes: README retirement list confirms this gap: "Conversation context wasn't shared. An agent couldn't cheaply ask 'what did you already tell PM?' without re-reading the inbox log" (`README.md:67-69`).

### Req 3: Defined handoff protocol. Handoff artifacts contain at minimum: completed work with commit hashes, pending work, key decisions with rationale, modified file paths, known blockers, next steps.

- Verdict: PARTIAL
- Evidence: A structured inter-agent message format exists (`templates/message.md`) with fields `type`, `from`, `to`, `disposition`, `references`, `proposal`, `project`, `task`, `round`, `timestamp`, `urgency`, `reason`, plus Summary and Detail sections. Task files carry `actual_tokens`, `actual_duration_minutes`, `depends_on`, `blocks`, `scope.boundaries`, `scope.references` (`docs/specs/2026-03-23-agent-triad-protocol-design.md:201-237`). EM task-completion process records "Set `status: done`... Set `disposition:` with a one-line summary... Set `completed:`, `actual_tokens:`, `actual_duration_minutes:`... Check acceptance criteria boxes" (`agents/engineering-manager/CLAUDE.md:172-176`). A handoff exists between dev worker and EM (completion summary), but there is no defined session-to-session handoff artifact — the manager agents never hand off; they run continuously.
- Notes: Commit hashes are not required in any handoff field; `git log --oneline -1` is used for verification but not persisted in handoff artifacts (`agents/engineering-manager/CLAUDE.md:150`). The protocol covers inter-agent negotiation, not in-role session handoff.

### Req 4: Predecessor query. A new session can query "what did the previous session decide/find about X?" without replaying its conversation or re-reading every file it touched.

- Verdict: MISSING
- Evidence: The retirement README explicitly names this as a failure: "Conversation context wasn't shared. An agent couldn't cheaply ask 'what did you already tell PM?' without re-reading the inbox log" (`README.md:67-69`). The recovery mechanism is full replay: "scan `docs/inbox/engineering-manager/read/` to reconstruct negotiation state — the `round` field and chronological filenames provide the full history" (`agents/engineering-manager/CLAUDE.md:91`). `/triad:kick` assembles a resume prompt by grepping statuses, listing unread, and listing recent read messages (`skills/kick/SKILL.md:28-52`), which is a linear scan of the entire inbox archive rather than an indexed query.
- Notes: No indexed predecessor-memory mechanism exists.

### Req 5: Stable static prefix. System prompt, tool definitions, and long-lived rules are stable across turns to preserve prompt cache. Changes to this prefix are recognized as cache-invalidating events.

- Verdict: PARTIAL
- Evidence: Each agent has a stable `CLAUDE.md` file at `agents/<role>/CLAUDE.md` that functions as its system-prompt-level identity and operating manual. Session startup routine is fixed (`agents/engineering-manager/CLAUDE.md:83-91`). Philosophy documents are referenced at session start (`agents/program-manager/CLAUDE.md:42`). However, there is no explicit mention of prompt caching, cache invalidation, or stability as a design goal anywhere in the source. The stability is incidental to the file-based role design, not deliberate.
- Notes: No cache-invalidation awareness in documentation.

### Req 6: Append-only where possible. Context mutations invalidate cache; prefer appending new information over rewriting existing.

- Verdict: PARTIAL
- Evidence: Inbox messages are append-only by construction (each is a new file with a timestamped filename: `<YYMMDDHHMMSS>-<object-id>-<step>.md`, `docs/specs/2026-03-23-agent-triad-protocol-design.md:296`). Read archive grows monotonically. However, canonical documents (proposal, project, task files) are mutated in place — status field transitions (`status: draft → review → approved → in-progress → completed`, `docs/specs/2026-03-23-agent-triad-protocol-design.md:99`), revisions of project plans, and task completion updates all rewrite existing files. Task completion writes into the same file below a `---` divider (`docs/specs/2026-03-23-agent-triad-protocol-design.md:235-237`). `project-context.md` template says "Update at the start and end of each session" (`templates/project-context.md:29`) — mutation, not append.
- Notes: No explicit append-only policy; mixed.

### Req 7: Deferred tool loading. Tool schemas and MCP tool definitions load on demand, not all-up-front, to keep the static context small.

- Verdict: MISSING
- Evidence: No mention of deferred tool loading, MCP configuration, tool budget, or on-demand skill loading in `triad-source/`. Each agent directory bundles all skills (`agents/engineering-manager/CLAUDE.md:48-63` lists: assign-task, check-inbox, create-task, propose-tasks, send-message, update-task, validate-project) available from session start.
- Notes: No evidence found in any spec, CLAUDE.md, or skill file.

### Req 8: Mode isolation. Prose, decision/task, and code contexts are kept in distinct sessions or distinct files, not freely mixed.

- Verdict: PARTIAL
- Evidence: Role separation does create mode isolation at the agent-type level: PM does prose/strategy, PgM does decision/sequencing, EM does code-adjacent task management, Dev does code. Context access table enforces this: "Product Manager: DEEP vault... Engineering Manager: — (no vault), FULL source code" (`docs/specs/2026-03-23-agent-triad-protocol-design.md:64-72`). However, within a single long-running manager session, prose (proposal review), decisions (feedback/approve), and task/status management are all interleaved in the same context window across the entire project lifecycle. Within an EM session, task files, source-code reads, and worker completion summaries mix freely.
- Notes: The isolation is between roles, not between modes within a role's session.

### Req 9: Phase-boundary splits. Research/planning/implementation run in separate sessions (RPI pattern), not one long session. Each phase starts fresh with the prior phase's artifact as input.

- Verdict: MISSING
- Evidence: The architecture is explicitly the opposite: "Each agent ran as its own Claude Code session in a tmux pane" (`README.md:30`) for the lifetime of the project. "Agents are always running. They process messages when notified, complete their current atomic operation before checking the inbox" (`docs/specs/2026-03-23-agent-triad-protocol-design.md:83`). A single PM session handles a proposal from draft through completion across every phase. No RPI split exists for the manager agents. The dev worker is the only ephemeral session: "Create a worktree from main inside the project... Use the dispatch template in `.claude/worker-dispatch-template.md` — fill in the variables, dispatch" (`agents/engineering-manager/CLAUDE.md:120-123`), but that is task-scoped, not phase-scoped.
- Notes: The persistent-session model is a central design choice, not an oversight.

### Req 10: Auto-persisted state. A session's working state is persisted to disk automatically at key lifecycle events (pre-compact, stop, subagent completion) — not dependent on worker discipline to remember.

- Verdict: MISSING
- Evidence: No pre-compact, stop, or SessionEnd hooks documented. Persistence is manual and dependent on the agent executing skills correctly: EM "Move the task file from `docs/tasks/` to `docs/tasks/_completed/`" (`agents/engineering-manager/CLAUDE.md:178-179`) and "After processing, move each message to `docs/inbox/engineering-manager/read/`" (`agents/engineering-manager/CLAUDE.md:81`). Retirement README acknowledges: "Each agent kept its own read cursor, so recovery after a crash (`/triad:kick`) required careful state reconstruction that the skill tried to automate but never fully nailed" (`README.md:61-64`).
- Notes: State is disk-reconstructable but not auto-persisted at lifecycle events.

### Req 11: Compaction as a failure signal. Compaction events are logged and treated as a signal to decompose further — never as a normal operating mode.

- Verdict: MISSING
- Evidence: No reference to compaction anywhere in the source. Grep for `compact|/compact` returned zero hits across all triad-source files. Given manager sessions run for the full lifecycle of a project, any real run would inevitably hit Claude Code's auto-compaction, but it is neither anticipated nor instrumented.
- Notes: Absence is notable given the long-running design.

### Req 12: Three-tier context alerts. Workers emit warnings at 40%, 60%, and 70% utilization to drive decomposition decisions proactively.

- Verdict: MISSING
- Evidence: No utilization reporting by any agent. No 40/60/70% alerts. No evidence found in `agents/*/CLAUDE.md`, skills, or docs.

### Req 13: Tool-result containment. Long tool results are stored to disk and referenced by path, not dumped verbatim into context.

- Verdict: PARTIAL
- Evidence: The protocol is built around path references: "The canonical document is the single source of truth — messages reference it, they don't duplicate it" (`docs/specs/2026-03-23-agent-triad-protocol-design.md:381`). Messages carry `references: [path/to/canonical/document.md]` (`templates/message.md:8`). Worker dispatch provides "task file path + pattern file paths" rather than file contents (`agents/engineering-manager/CLAUDE.md:122`). Task scope uses `scope.boundaries` and `scope.references` as paths. However, no microcompaction mechanism exists for runtime tool results — when an agent reads a proposal or runs `tmux capture-pane` in `/triad:status` (`skills/status/SKILL.md:27-30`), the full output enters context. Nothing replaces bulky tool results with placeholders.
- Notes: Document-reference discipline is strong; tool-result containment is absent.

## Surprises

1. **Retirement diagnostics map directly onto this spec.** The README's "What went wrong" section reads like a confession against several of these requirements: no cheap predecessor query (Req 4), read-cursor drift requiring reconstruction (Req 10), conversation context not shared (Req 2, 4). Triad's failure modes were context-engineering failure modes.

2. **Dev workers are the only part of Triad that resembles the spec's worker model.** They are dispatched fresh per task into an isolated worktree with a curated task file and pattern files — ephemeral, bounded, atomic. The three manager agents are the opposite shape.

3. **60% appears throughout the codebase but always as a decision-confidence threshold, never a context threshold.** `agents/program-manager/CLAUDE.md:213` "When below 60% confidence after context gathering, escalate." A reader skimming for conformance might misread these as context-utilization signals; they are not.

4. **Tmux pane visibility was itself a context-engineering failure vector.** `README.md:70` "Session access tempts humans to fiddle. Access to the visible tmux panes was too tempting for me and I kept poking at things mid-stream, causing ripples in the otherwise highly-regimented process." Human intrusion into session context degraded agent behavior — an unintended cache/context invalidation mechanism.

5. **Filename convention serves as a crude index.** `<YYMMDDHHMMSS>-<object-id>-<step>.md` lets the `round` field plus chronological ordering substitute for a real state store (`docs/specs/2026-03-23-agent-triad-protocol-design.md:296-304, 366`). This is the closest thing to structured state recovery Triad offers, and it still requires linear scan.

## Open Questions for Trial

- What was the real-world context utilization curve of a PM or PgM session running a multi-project proposal? Retirement happened before any such telemetry was captured.
- Did auto-compaction actually fire in practice during Triad runs, and if so, how did the agents behave after? No logs in `triad-source/`.
- How much of `/triad:kick`'s state reconstruction actually reproduced prior session reasoning vs. just surface state (inbox counts, statuses)? README hints it "never fully nailed" this.

## Source Index

- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/README.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/skills/start/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/skills/resume/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/skills/status/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/skills/kick/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/templates/message.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/templates/project-context.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/CLAUDE.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/program-manager/CLAUDE.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/docs/specs/2026-03-23-agent-triad-protocol-design.md`
- Repo-wide grep for `compact|context window|60%|token budget|utilization|/compact` across `triad-source/`
- Repo-wide grep for `handoff|resume|session|inbox.*read|reconstruct` across `triad-source/agents/`

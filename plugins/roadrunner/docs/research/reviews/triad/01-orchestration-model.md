# Triad — Orchestration Model Conformance Evaluation

## Summary

- Conformance at a glance: 0 MEETS, 6 PARTIAL, 4 MISSING, 0 N/A (out of 10)
- Headline: Triad has no orchestrator — it is a set of long-running peer agents coordinating through filesystem inboxes and tmux notifications; the "pipeline" is encoded as narrative protocol rules and per-agent skills rather than as a machine-readable plan, and there is no central scheduler, DAG, or crash-safe transition engine.

## Per-Requirement Findings

### Req 1: Declarative pipeline definition. The pipeline is expressed in a machine-readable format (YAML/TOML/equivalent) separate from any LLM prompt. Stage order, dependencies, and transitions are data, not prose.

- Verdict: MISSING
- Evidence: The pipeline is defined as prose in `docs/specs/2026-03-23-agent-triad-protocol-design.md` §3.1, §6.2–§6.5, and §Appendix A. Stage order is given as markdown tables like "Phase 1: Proposal → Project Plan (PM ↔ PgM)" with human-readable Submit/Initial/Review/Cycle 1/Cycle 2 steps. `README.md` shows the pipeline as an ASCII arrow diagram: `Human (strategy) → PM (proposals) → PgM (projects) → EM (tasks) → Dev (code)`. No YAML/TOML pipeline file exists; only per-artifact YAML frontmatter (proposal, project, task) declares per-artifact fields. The transitions themselves (who sends what to whom on which disposition) are encoded in English prose inside agent `CLAUDE.md` files and skill SKILL.md files (e.g., `agents/engineering-manager/.claude/skills/check-inbox/SKILL.md` uses a markdown table mapping message type to action).
- Notes: Artifact schemas are structured; orchestration logic is not.

### Req 2: Bounded orchestrator context. The orchestrator's working context has a measurable ceiling (target ≤20K tokens) that is invariant to pipeline length or run count.

- Verdict: MISSING
- Evidence: There is no distinct orchestrator component. Three long-running Claude Code sessions (PM, PgM, EM) each accumulate their own context over the life of a project. No token ceiling is specified or enforced in `skills/start/SKILL.md`, `skills/kick/SKILL.md`, or the agent `CLAUDE.md` files. `skills/kick/SKILL.md` exists specifically because agents crash or hit API errors and need restart: "Restart crashed or stuck agent triad sessions … Use when agents are disconnected, stuck, or hit API errors." This implies unbounded growth in practice.
- Notes: `kick` attempts state recovery on restart, but that is crash recovery, not a context budget.

### Req 3: Typed state transitions. Every pipeline step has a typed status (`pending`, `in_progress`, `complete`, `failed`, `needs_review`, `blocked`). Transitions are explicit; re-entry from any terminal state is supported.

- Verdict: PARTIAL
- Evidence: Artifacts carry typed status fields in YAML frontmatter. Proposal: `status: draft | review | approved | in-progress | completed | cancelled` (protocol spec §4.1). Project: `status: draft | review | approved | in-progress | completed | blocked` (§4.2). Task: `status: todo | in-progress | done | blocked` (§4.3, and `templates/task.md`: `status: todo  # todo | in-progress | blocked | done | cancelled`). Message dispositions are typed: `approved | revise | escalate | info | directive` (§5.3). There is no `failed` or `needs_review` status, and re-entry semantics from terminal states (`completed`, `done`) are only addressed informally: §6.5 says "Validation failure … the recipient determines whether this requires new tasks … or a scope discussion (escalate)" — i.e., re-entry is handled by creating new tasks rather than re-entering an old one.
- Notes: The state vocabulary exists per artifact but is not a unified orchestrator state machine; transitions are performed by whichever agent owns the artifact, not by a central driver.

### Req 4: Disk-first state resolution. The orchestrator determines the current pipeline state by reading persisted artifacts, not by recalling conversation history.

- Verdict: PARTIAL
- Evidence: State recovery is disk-based for restart scenarios. Protocol spec §5.4: "If an agent restarts and has lost its in-memory context about which negotiation cycle it is in, it can reconstruct state by reading the messages in `docs/inbox/<agent>/read/` for the relevant object ID. The `round` field in each message and the chronological filename ordering provide a complete history of the negotiation." `skills/kick/SKILL.md` step 1 ("Assess current state") reads statuses via `grep -r '^status:' <project-path>/docs/proposals/*/proposal.md`, lists `docs/tasks/*.md`, and counts unread/read messages. `skills/status/SKILL.md` does the same. Engineering Manager `CLAUDE.md` §Session Startup step 5: "If resuming after a restart, scan `docs/inbox/engineering-manager/read/` to reconstruct negotiation state."
  However, during normal operation each agent relies on its live Claude Code conversation context; the `README.md` explicitly cites this as a retirement reason: "Conversation context wasn't shared. An agent couldn't cheaply ask 'what did you already tell PM?' without re-reading the inbox log."
- Notes: Disk is canonical for restart; in-session state lives in conversation memory.

### Req 5: DAG dependency tracking. Steps declare `blocked_by` relations. Completion of one step automatically unblocks dependents.

- Verdict: PARTIAL
- Evidence: Artifacts declare dependencies. Project frontmatter (§4.2): `depends_on: []` and `blocks: [PRJ-002]`. Task frontmatter (§4.3 and `templates/task.md`): `depends_on: []  # List of task IDs that must complete before this one starts`, `blocks: []`. `assign-task` skill step 3: "Read each task in `depends_on`. If any has `status` other than `done`, stop — task is blocked." Step 2 handles automatic unblocking: "If `status` is `blocked`, check `depends_on`: Read each dependency task. If all are `done` (in `docs/tasks/_completed/`), update this task to `todo` and proceed."
  There is no scheduler that automatically unblocks dependents — unblocking happens lazily when a human or EM invokes `/assign-task` on a specific task. No cross-artifact-type DAG (proposal→project→task) is represented as a graph object.
- Notes: Declarations exist at the task/project level; automatic fan-out on completion does not.

### Req 6: Bounded reasoning for edge cases. The orchestrator follows the declarative plan for the happy path but has a constrained reasoning affordance for naming/pattern mismatches (e.g., "PR name slightly off but carries correct info") without requiring code changes to the state machine.

- Verdict: PARTIAL
- Evidence: Every agent is an LLM session, so reasoning is always available. The "escape hatches" are `escalate`, `stop-the-line`, and `escalation` messages. Protocol spec §6.6: "Escalate: Max negotiation rounds exhausted without agreement; Agent lacks clarity and the adjacent agent cannot provide it; Agent identifies a one-way door decision outside their authority; Agent discovers a contradiction between documents at different levels; Agent believes the process itself is not working correctly." §6.7 describes `stop the line`. `check-inbox` skill: "If a message references a project or task that does not exist, send an `escalation` to PgM requesting clarification." Because there is no declarative state machine, there is no bounded-vs-unbounded distinction — reasoning is unbounded everywhere.
- Notes: The retirement lessons (README "Inbox watchers were noisy … Debouncing helped but never felt solid") suggest edge-case handling was in practice brittle.

### Req 7: Explicit resume semantics. Any new orchestrator session can resume at the last terminal artifact state, without replaying prior conversation.

- Verdict: PARTIAL
- Evidence: `/triad:resume` and `/triad:kick` skills exist for exactly this. `skills/resume/SKILL.md`: "Reconnect to an existing triad session and ensure everything is running." `skills/kick/SKILL.md` step 3: "Each agent gets a resume prompt tailored to the current state … Project name and path; Current proposal/project statuses; Any unread messages in their inbox." Protocol spec §5.4: state is reconstructable from `docs/inbox/<agent>/read/` chronological messages plus the `round` field.
  README flags this as imperfect: "Each agent kept its own read cursor, so recovery after a crash (`/triad:kick`) required careful state reconstruction that the skill tried to automate but never fully nailed." Kick sends a narrative resume prompt into the tmux pane that the agent must re-read; it does not hand the agent a typed resumption token.
- Notes: Resume is designed-for but acknowledged as fragile.

### Req 8: Parallel fan-out. Independent DAG branches can run concurrently; the orchestrator schedules them without serializing.

- Verdict: PARTIAL
- Evidence: Parallelism exists only at the dev-worker layer. `assign-task` skill: "`/assign-task T-042 T-043 T-044` for parallel dispatch … When multiple task IDs are provided, dispatch all agents simultaneously using separate worktree isolations." Engineering Manager CLAUDE.md describes worktrees under `.worktrees/<task-id>`.
  The manager pipeline itself is serialized by protocol. §6.1 Core Rules: "Negotiations are sequential — one active negotiation per document at a time." Negotiation rules include: "One active negotiation per project at a time" (EM CLAUDE.md §Negotiation Rules). No scheduler selects parallel branches; the three managers each run continuously but each processes their own inbox sequentially.
- Notes: Fan-out is explicit at task dispatch; upstream pipeline stages are explicitly serialized per artifact.

### Req 9: No substantive delegation of domain decisions. The orchestrator never decides "is this spec approved?" or "is this code correct?" — those are always delegated to specialized workers or to human gates.

- Verdict: MISSING
- Evidence: There is no thin orchestrator to delegate from. Each manager agent IS a reasoning agent that makes domain decisions. Protocol spec §7.1 PM "Validates business outcomes achieved for this project"; §7.2 PgM "Validate task acceptance criteria against project intent; Validate completed projects against acceptance criteria"; §7.3 EM "Validate PRs against task specs; Aggregate completed tasks into project-level validation." EM CLAUDE.md §Task Completion Validation walks through multi-step review including "Dispatch spec compliance review; Dispatch code quality review" — so some review is delegated, but the EM itself makes the final pass/fail determination.
  This requirement contemplates a thin-orchestrator design; Triad's design is the opposite — three substantive reasoners coordinating peer-to-peer.
- Notes: Marking MISSING because the spec asks the orchestrator to not make domain decisions; Triad has no orchestrator layer and its managers do make them.

### Req 10: Crash-safe transitions. A mid-transition crash leaves the pipeline in a recoverable state; no transition writes are half-applied.

- Verdict: MISSING
- Evidence: No atomic-write or transaction primitives are specified. Transitions consist of: (1) writing a message markdown file to a recipient's `unread/`; (2) the recipient moving it to `read/` after processing (`check-inbox` skill: "Move each processed message from `unread/` to `read/` after handling: `mv docs/inbox/engineering-manager/unread/<filename> docs/inbox/engineering-manager/read/`"); (3) updating artifact frontmatter status; (4) moving done tasks to `_completed/` (EM CLAUDE.md §6: "Move the task file from `docs/tasks/` to `docs/tasks/_completed/`"). These are separate non-atomic operations — a crash between writing a message and updating the sender's artifact status is not addressed. README retirement notes: "State drift between agents … recovery after a crash (`/triad:kick`) required careful state reconstruction that the skill tried to automate but never fully nailed."
  No use of temp-file-plus-rename, file locks, or write-ahead logs is described in any skill, script, or spec.
- Notes: Filesystem message archive is the closest thing to a crash-safe log, and is explicitly called out as "never fully nailed."

## Surprises

- **No central orchestrator at all.** The spec is written for a single orchestrator component; Triad's architecture is fundamentally peer-to-peer with three long-running reasoning agents. The `/triad:start`, `/triad:kick`, `/triad:status`, `/triad:resume` skills run in a separate supervisor session and do session management, not pipeline scheduling. They capture tmux panes, count unread messages, and restart crashed Claude processes — they do not route artifacts or advance states.
- **Bounded negotiation via revision cycle counts.** Protocol spec §6.1: "Max 2 revision cycles at each boundary before escalation to human." This is the only quantitative bound on pipeline behavior; it is enforced in narrative ("Cycle 2 (max)") rather than by a state-machine counter.
- **Messages are the audit log.** §5.5 Git Integration keeps `docs/inbox/*/read/` committed "as decision record." This doubles as a crash-recovery substrate (§5.4).
- **Ad hoc tasks bypass the DAG.** §6.4: "Dev identifies additional work needed → reports in completion summary; EM creates new task file; … PgM acknowledges (no round consumed, no approval gate)." So the task DAG is mutated mid-run without approval, which the declarative-plan model does not account for.
- **Safehouse sandbox integration** (`skills/start/SKILL.md`): agents run under `safehouse --workdir=$PROJECT_PATH --add-dirs=$HOME/code --add-dirs-ro=$HOME/vault` with `--dangerously-skip-permissions`. This is an isolation concern, not orchestration, but affects what the "orchestrator" is responsible for during session setup.
- **Named retirement reasons are all orchestration failures:** inbox watcher debouncing (coordination), state drift (disk-state resolution), unshared conversation context (bounded orchestrator context / disk-first), human-in-the-loop routing, human fiddling mid-stream (no isolation of orchestrator from supervisor). Five of the six retirement reasons listed in `README.md` §"What went wrong" map directly to orchestration-model requirements that are PARTIAL or MISSING here.

## Open Questions for Trial

- What does a real `docs/inbox/<agent>/read/` archive look like mid-flight, and how long does an agent actually take to reconstruct negotiation state from it after `/triad:kick`?
- How does the system behave when two revision cycles complete but the human escalation pathway is not picked up — does the pipeline wedge silently, or does `/triad:status` surface it?
- With three long-running Claude sessions, do any of them hit `/compact` before a proposal completes, and what happens to the already-archived messages when they do?
- The `templates/workspace-layout/` directory is referenced by `README.md` but was not visible in the mirrored sources — does it contain additional declarative pipeline configuration, or is it only artifact skeletons?
- How do the `inbox-watcher.service` / `com.deuleyville.inbox-watcher.plist` files handle debounce, and what is the actual failure mode when watchers fire rapidly (the retirement README cites this)?

## Source Index

- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/README.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/skills/start/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/skills/kick/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/skills/status/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/skills/resume/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/docs/specs/2026-03-23-agent-triad-protocol-design.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/docs/operations/session-startup.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/scripts/init-project.sh`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/templates/task.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/CLAUDE.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/skills/check-inbox/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/skills/assign-task/SKILL.md`
- Glob enumeration of `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/**/*.md` and `**/*.sh`
- Criteria spec: `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/01-orchestration-model.md`
- Method: `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/evaluation-prompts.md`

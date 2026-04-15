# Gas Town — Monitoring and Recovery Conformance Evaluation

## Summary

- Conformance at a glance: 10 MEETS, 3 PARTIAL, 0 MISSING, 0 N/A (out of 13)
- Headline: Gas Town treats monitoring and recovery as a first-class product surface, with a three-tier patrol hierarchy (Daemon / Deacon / Witness / Dogs), a full OTel data model, severity-routed escalation with configurable routes, cost telemetry, a TUI with a dedicated problems view, and predecessor-session seance — with the main gaps being an explicit "loop detection" mechanism beyond crash-loop counting and a partial (mostly-implicit) idempotency story for recovery actions.

## Per-Requirement Findings

### Req 1: Structured telemetry (OTEL-compatible). Every worker emits structured events: session lifecycle, tool calls, status transitions, decision log entries. Compatible with standard OTLP backends.

- Verdict: MEETS
- Evidence: `docs/otel-data-model.md` defines a complete OTLP log-record schema with identity hierarchy (`instance`, `run.id`, `agent_type`, `role`, `agent_name`, `session_id`, `rig`) and per-event schemas including `agent.instantiate`, `session.start`/`session.stop`, `prime`, `prompt.send`, `agent.event` (per tool call / tool result / thinking block), `agent.usage`, `bd.call`, `mail`, `agent.state_change`, `mol.cook`/`mol.wisp`/`mol.squash`/`mol.burn`, `bead.create`, `sling`, `nudge`, `done`, `polecat.spawn`, `polecat.remove`, `formula.instantiate`, `convoy.create`, `daemon.restart`, `pane.output`. `docs/design/otel/otel-architecture.md`: "Gas Town uses OpenTelemetry (OTel) for structured observability of all agent operations. Telemetry is emitted via standard OTLP HTTP to any compatible backend... any OTLP v1.x+ compatible backend can consume it." Activated via `GT_OTEL_METRICS_URL` and `GT_OTEL_LOGS_URL`.
- Notes: `otel-architecture.md` flags some events (`agent.instantiate`, `mol.*`, `bead.create`) as "Roadmap" / pending PR #2199, but the design-level model and working emission for session, prime, prompt, nudge, sling, done, polecat.spawn/remove, state_change, bd.call, mail, formula.instantiate, convoy.create are shipped on main. Run correlation via `run.id` is ubiquitous.

### Req 2: Classified health states. Workers are classified into states (e.g., working, stalled, GUPP-violation, zombie, idle) based on observable signals (recent activity, progress metrics).

- Verdict: MEETS
- Evidence: `gt feed --help` problems-view legend: "🔥 GUPP violation — Hooked work + 30m no progress (critical); ⚠ STALLED — Hooked work + 15m no progress; ● Working — Actively producing output; ○ Idle — No hooked work; 💀 Zombie — Dead/crashed session." `docs/otel-data-model.md` §`agent.state_change`: "Emitted whenever an agent transitions to a new state (idle → working, etc.)" with `new_state` attribute (`"idle"`, `"working"`, `"done"`, …). `polecat-lifecycle-patrol.md` §8.1–8.4 enumerates the "Stuck-in-Done Zombie", "Orphaned Sandbox", "Split-Brain Merge", "Infinite Cycle". Thresholds: "GUPP violation: 30 minutes with `hook_bead` but no progress; Hung session: 30 minutes of no tmux output; Stuck-in-done: 60 seconds with `done-intent` label."
- Notes: States are both emitted as telemetry and rendered in the TUI.

### Req 3: Continuous fleet supervision. A supervisor process runs continuously, monitors all workers, and triggers recovery (nudge, handoff, restart) automatically.

- Verdict: MEETS
- Evidence: `polecat-lifecycle-patrol.md` §6.1: "Daemon | Town-wide | 3-minute heartbeat | Session liveness, GUPP violations, orphaned work... Witness | Per-rig | Continuous | Polecat health, zombie detection, completion handling." §4.4 Witness patrol cycle: "1. Check inbox; 2. Detect zombie polecats; 3. Detect orphaned beads; 4. Detect stalled polecats; 5. Check for pending spawns; 6. Write patrol receipt." Recovery actions include `gt nudge`, `gt handoff`, session restart via `SessionManager.Start()`, and nuke. `gt witness --help`: "Detects stalled polecats (crashed or stuck mid-work); Nudges unresponsive sessions back to life; Cleans up zombie polecats (finished but failed to exit); Nukes sandboxes when polecats complete via 'gt done'."
- Notes: Three concurrent supervisors (Daemon mechanical, Witness per-rig, Refinery per-rig for merges).

### Req 4: Supervisor-of-supervisors. Supervisors themselves are monitored. Failure modes in the monitoring layer cannot silently disable it.

- Verdict: MEETS
- Evidence: `gt deacon --help`: "The Deacon ('daemon beacon') is the only agent that receives mechanical heartbeats from the daemon. It monitors system health across all rigs: Watches all Witnesses (are they alive? stuck? responsive?); Manages Dogs for cross-rig infrastructure work; Handles lifecycle requests (respawns, restarts); Receives heartbeat pokes and decides what needs attention." `gt boot --help`: "Boot is a special dog that runs fresh on each daemon tick. It observes the system state and decides whether to start/wake/nudge/interrupt the Deacon... This centralizes the 'when to wake' decision in an agent that can reason about it." `polecat-lifecycle-patrol.md` §6.2 "Patrol Overlap as Resilience": "If any single patrol agent fails, the others detect the resulting state degradation and compensate. The daemon detects dead sessions. The deacon detects dead witnesses. The witness detects dead polecats." §5.3: "Witness down | No respawn on crash | Deacon detects, restarts witness." `gt deacon health-check` and `gt deacon health-state` CLI subcommands support health pings across agents.
- Notes: Explicit four-tier redundancy (Daemon → Boot → Deacon → Witness).

### Req 5: Severity-routed escalation. Stuck workers escalate rather than waiting indefinitely. Severity (P0/P1/P2) routes to the appropriate target (human operator, peer agent, logged-only).

- Verdict: MEETS
- Evidence: `docs/design/escalation.md`: "CRITICAL | P0 (urgent) | System-threatening, immediate attention | bead + mail + email + SMS; HIGH | P1 (high) | Important blocker, needs human soon | bead + mail + email; MEDIUM | P2 (normal) | Standard escalation, human at convenience | bead + mail mayor." Config file `~/gt/settings/escalation.json` with `routes` mapping severity to action lists. Tiered flow: "Agent → gt escalate → Deacon → Mayor → Overseer," each tier can resolve or forward. `gt escalate --help` confirms severities `critical|high|medium|low` and flags `--severity`, `--source`, `--to`, `--reason`. Deacon patrol example: "if [ $unresponsive_cycles -ge 5 ]; then gt escalate -s HIGH 'Witness unresponsive: gastown' --source='patrol:deacon:health-scan'."
- Notes: Stale detection via `gt escalate stale` auto-bumps severity (MEDIUM→HIGH→CRITICAL) with `max_reescalations` cap.

### Req 6: Full audit log. Every tool call is logged with session + task + worker attribution. Queryable after the fact.

- Verdict: MEETS
- Evidence: `gt audit --help`: "Query provenance data across git commits, beads, and events. Shows a unified timeline of work performed by an actor including: Git commits authored by the actor; Beads (issues) created/closed by the actor; Town log events (spawn, done, handoff, etc.); Activity feed events." Filters `--actor`, `--since`, `--json`. `otel-data-model.md` §`bd.call` logs every `bd` invocation with `subcommand`, `args`, `duration_ms`, `stdout`, `stderr`, `status`, and `run.id`. §`agent.event` logs each content block (`event_type: text|tool_use|tool_result|thinking`) with `run.id`, `session`, `native_session_id`, `role`; `tool_use` content is `"<tool_name>: <truncated_json_input>"`. Attribution attributes: `run.id`, `session_id`, `role`, `agent_name`, `rig`, `issue_id`.
- Notes: Tool-call body logging via `agent.event` is opt-in (`GT_LOG_AGENT_OUTPUT=true`) and listed as PR #2199 in otel-architecture.md; operation-level `bd.call` attribution is on main.

### Req 7: Crash recovery automation. Handles stale git locks, orphaned worktrees, half-complete task states, zombie processes. No manual `rm -f` required.

- Verdict: MEETS
- Evidence: `gt doctor --help` "Cleanup checks (fixable): orphan-sessions | Detect orphaned tmux sessions; orphan-processes | Detect orphaned Claude processes; session-name-format; wisp-gc | Detect and clean abandoned wisps (>1h); misclassified-wisps; jsonl-bloat; stale-beads-redirect; worktree-gitdir-valid | Verify worktree .git files reference existing paths (fixable); persistent-role-branches; clone-divergence." `gt cleanup --help`: "Clean up orphaned Claude processes that survived session termination." `gt deacon zombie-scan`: "Find and clean zombie Claude processes not in active tmux sessions." `gt deacon cleanup-orphans`, `gt deacon stale-hooks` ("Find and unhook stale hooked beads"). `gt orphans`: "Orphaned commits via 'git fsck --unreachable'; Unmerged polecat branches." `gt checkpoint --help`: "Manage checkpoints for polecat session crash recovery... if a session crashes, the next session can resume from where it left off. Checkpoint data includes: Current molecule and step, Hooked bead, Modified files list, Git branch and last commit, Timestamp. Checkpoints are stored in .polecat-checkpoint.json." `polecat-lifecycle-patrol.md` §3.4: "Nuke fails | Session still running after kill attempt | Next patrol detects zombie, retries nuke." §5.3: "Sandbox corrupted | Branch or worktree broken | `RepairWorktree()` or nuke and respawn." `gt warrant` system files death warrants for stuck agents, executed by Boot.
- Notes: No explicit mention found of stale `.git/index.lock` removal specifically, but `gt doctor --fix` and `RepairWorktree()` cover worktree validity; `CLEANUP.md` line 127 references auto-fix of "orphan sessions, wisp GC, stale redirects, worktree validity."

### Req 8: Human-visible dashboard. Fleet state, convoy progress, stuck agents, escalations, and cost metrics render in a dashboard or TUI. No log spelunking for normal operations.

- Verdict: MEETS
- Evidence: `gt feed --help`: "launches an interactive TUI dashboard with: Agent tree (top): Shows all agents organized by role with latest activity; Convoy panel (middle): Shows in-progress and recently landed convoys; Event stream (bottom): Chronological feed... Problems View (--problems/-p): A problem-first view that surfaces agents needing attention: Detects stuck agents via structured beads data (hook state, timestamps); Shows GUPP violations (hooked work + 30m no progress); Keyboard actions: Enter=attach, n=nudge, h=handoff." `gt dashboard --help`: "Start a web server that displays the convoy tracking dashboard... Convoy list with status indicators; Progress tracking for each convoy; Last activity indicator (green/yellow/red); Auto-refresh every 30 seconds via htmx." Also `gt vitals` ("unified health dashboard"), `gt health` ("comprehensive health report for the Gas Town data plane"), `gt agents menu`, `gt trail`, `gt status`.
- Notes: Escalations viewable via `gt escalate list` and `bd list --tag=escalation`; Mayor startup also displays pending escalations per `escalation.md`: "On `gt prime`, Mayor displays pending escalations grouped by severity."

### Req 9: Cost telemetry. Tokens per worker, cache hit rate, and cost per pipeline run are measured and visible. Anomalies surface quickly.

- Verdict: MEETS
- Evidence: `gt costs --help`: "Costs are calculated from Claude Code transcript files... by summing token usage from assistant messages and applying model-specific pricing... gt costs --today; gt costs --week; gt costs --by-role; gt costs --by-rig; gt costs --json." Subcommands `gt costs record` (Stop hook) and `gt costs digest` (Deacon patrol aggregation into daily digest bead). `otel-data-model.md` §`agent.usage`: "One record per assistant turn... `input_tokens`, `output_tokens`, `cache_read_tokens` (`cache_read_input_tokens`), `cache_creation_tokens` (`cache_creation_input_tokens`)." Correlated by `run.id`, `session`, `native_session_id`.
- Notes: `agent.usage` is listed as PR #2199 in otel-architecture.md; `gt costs` CLI shipped (reads transcripts directly).

### Req 10: Idempotent recovery actions. Repeated recovery attempts (e.g., nudge, handoff) do not amplify damage. Safe to retry.

- Verdict: PARTIAL
- Evidence: `polecat-lifecycle-patrol.md` §5.4 "Liveness vs Safety": "Idempotent operations are preferred. Closing an already-closed bead is a no-op. Pushing an already-pushed branch is safe. Crash recovery may re-execute partial work. A step that crashed mid-way will be re-executed from the start. Git state helps: if commits were made, the new session sees them." §3.4 cleanup-pipeline failure recovery: "Nuke fails | Session still running after kill attempt | Next patrol detects zombie, retries nuke." §8.5 TOCTOU guard: "`DetectZombiePolecats()` (records `detectedAt`, re-verifies before destructive action) prevents racing between detection and action." `gt escalate stale` has `max_reescalations` cap.
- Notes: Idempotency is stated as a design preference with concrete examples (bead close, git push, retry-nuke) and one explicit TOCTOU guard, but the spec does not enumerate per-action idempotency guarantees for nudge/handoff/restart; the design explicitly acknowledges "Crash recovery may re-execute partial work."

### Req 11: Severity-routed notifications. Human notifications are routed by severity through a configured channel. P0 interrupts; lower severity batches.

- Verdict: MEETS
- Evidence: `docs/design/escalation.md` default config:
  ```
  "routes": {
    "medium": ["bead", "mail:mayor"],
    "high": ["bead", "mail:mayor", "email:human"],
    "critical": ["bead", "mail:mayor", "email:human", "sms:human"]
  }
  ```
  with `contacts.human_email`, `human_sms`, `slack_webhook`, SMTP host/port/from/user/pass, `sms_webhook`. Action types: `bead`, `mail:<target>`, `email:human`, `sms:human`, `slack`, `log`. P0 (critical) goes to SMS (interrupts); P2 (medium) stops at bead + mail-to-mayor (logged/peer only). Batching primitives: `gt notify --help` levels `verbose|normal|muted`; `gt dnd on/off` for Do Not Disturb; "DND mode mutes non-critical notifications, allowing you to focus on work without interruption."
- Notes: Per-severity channel selection is explicit and configurable; "batches" is implemented via muted/DND rather than time-window batching.

### Req 12: Predecessor-session discovery. Stuck or restarted workers can discover and query predecessor sessions for context before giving up or starting over.

- Verdict: MEETS
- Evidence: `gt seance --help`: "Seance lets you literally talk to predecessor sessions. 'Where did you put the stuff you left for me?' - The #1 handoff question. Instead of parsing logs, seance spawns a Claude subprocess that resumes a predecessor session with full context. You can ask questions directly: 'Why did you make this decision?'; 'Where were you stuck?'; 'What did you try that didn't work?' ... `gt seance --talk <id> -p 'Where is X?'` ... The --talk flag spawns: `claude --fork-session --resume <id>`. This loads the predecessor's full context without modifying their session. Sessions are discovered from: 1. Events emitted by SessionStart hooks (~/gt/.events.jsonl); 2. The [GAS TOWN] beacon makes sessions searchable in /resume." Filters `--role`, `--rig`, `--recent`. Also `polecat-lifecycle-patrol.md` §2.4 "State Continuity": "the beads state IS the handoff" via `gt prime --hook`, `bd mol current`, `bd show <step-id>`.
- Notes: Full two-channel predecessor discovery: structural (beads/hook) plus conversational (seance fork-resume).

### Req 13: Loop detection. Infinite revision loops, doom loops, and repeated tool-call patterns are detected automatically and break the loop with an escalation.

- Verdict: PARTIAL
- Evidence: `polecat-lifecycle-patrol.md` §5.3 crash-loop row: "Crash loop (3+ crashes) | Same step keeps failing | Witness escalates to mayor; filed as bug." §8.4 "The Infinite Cycle": "A step keeps failing and the session keeps restarting. Detection: Track crash count per polecat (via `ReconcilePool` or ephemeral state). Three crashes on the same step triggers escalation. Recovery: Witness stops respawning, creates a bug bead, mails the mayor. The molecule stays in its current state (recoverable when the bug is fixed)." GUPP-violation threshold (30m no progress) catches no-progress loops. `polecat-lifecycle-patrol.md` §7 Q2 thresholds: "GUPP violation: 30 minutes with `hook_bead` but no progress; Hung session: 30 minutes of no tmux output."
- Notes: Crash-loops and no-progress stalls are detected and escalate; no evidence found in docs/design, otel-data-model.md, or CLI help of detection for "repeated tool-call patterns" or semantic revision-loops (the same tool being invoked with the same args N times, or the same file being re-edited cyclically). The detected primitives are session-level crash counts and no-output timers, not content-level loop signatures.

## Surprises

- Gas Town's recovery hierarchy is explicitly "mechanical vs agent-driven" with agent-driven preferred (`polecat-lifecycle-patrol.md` §7 Q2), and cites a named post-mortem — the "Deacon murder spree" — as the reason thresholds are generous. "Mechanical detection of 'stuck' is fragile because distinguishing 'thinking deeply' from 'hung' requires intelligence. This is why Boot exists (intelligent triage) and why the daemon's thresholds are conservative."
- `gt estop` / `gt thaw` provide emergency-stop (freeze all agent work) and resume — a system-wide circuit breaker not covered by any spec requirement.
- Patrol output is itself a bead ("Write patrol receipt... Machine-readable summary of findings"), making supervisor activity queryable via the same ledger as worker activity.
- `gt warrant` is a two-stage termination protocol (file → Boot executes) rather than direct kill, giving a paper trail for destructive supervisor actions.
- The full OTel schema includes a per-`run.id` UUID propagated via `GT_RUN` env var so that every `bd` subprocess, every mail operation, and every agent turn correlates back to a single agent spawn.
- `otel-architecture.md` explicitly labels several events (`agent.instantiate`, `agent.event`, `agent.usage`, `mol.cook/wisp/squash/burn`, `bead.create`, `run.id`-on-all-events) as "Roadmap / PR #2199" rather than shipped on main, meaning the full data-model doc overstates current runtime coverage.

## Open Questions for Trial

- Does Witness reliably detect a worker that is emitting output but making no semantic progress (e.g., editing the same file in a loop)? The documented signals are `tmux pane output` and `hook_bead` progress, both of which a semantic-loop attacker could defeat.
- Do `gt nudge` and `gt handoff` actually produce safe no-ops under concurrent invocation, or is this aspirational? Only `DetectZombiePolecats()` has a cited TOCTOU guard.
- What is the practical latency from P0 escalation filed to SMS/email actually delivered, and is there evidence of false-positive noise on the P0 channel at fleet scale?
- Are `agent.usage` token events reliably emitted on Main today, or only behind `GT_LOG_AGENT_OUTPUT=true` + PR #2199 pending? (The two docs disagree.)
- Does `gt doctor --fix` actually clean stale `.git/index.lock` specifically, or only worktree `.git`-file validity?
- Does `gt costs` fire a budget-anomaly alert proactively, or does anomaly detection require operator eyeballs on the dashboard?

## Source Index

- `/Users/deuley/code/tools/gastown/docs/design/polecat-lifecycle-patrol.md`
- `/Users/deuley/code/tools/gastown/docs/design/escalation.md`
- `/Users/deuley/code/tools/gastown/docs/design/witness-at-team-lead.md` (read partially; doc is marked "NOT YET IMPLEMENTED — planned architectural change" so weighted accordingly)
- `/Users/deuley/code/tools/gastown/docs/design/otel/otel-architecture.md`
- `/Users/deuley/code/tools/gastown/docs/otel-data-model.md`
- `/Users/deuley/code/tools/gastown/docs/CLEANUP.md` (line 127 reference)
- CLI help: `gt --help`, `gt escalate --help`, `gt seance --help`, `gt feed --help`, `gt dashboard --help`, `gt patrol --help`, `gt audit --help`, `gt costs --help`, `gt agents --help`, `gt witness --help`, `gt deacon --help`, `gt dog --help`, `gt boot --help`, `gt notify --help`, `gt dnd --help`, `gt cleanup --help`, `gt checkpoint --help`, `gt vitals --help`, `gt health --help`, `gt warrant --help`, `gt doctor --help`, `gt orphans --help`

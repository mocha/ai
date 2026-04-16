# Triad — Monitoring and Recovery Conformance Evaluation

## Summary

- Conformance at a glance: 0 MEETS, 8 PARTIAL, 5 MISSING, 0 N/A (out of 13)
- Headline: Triad ships operational skills (`status`, `kick`, `resume`) plus an fswatch/inotify inbox-watcher with systemd/launchd templates and a human-escalation pipeline, but recovery is manual-trigger (no continuous supervisor), telemetry is markdown token fields rather than OTEL, and there is no dashboard, loop detection, crash-lock cleanup, or supervisor-of-supervisors.

## Per-Requirement Findings

### Req 1: Structured telemetry (OTEL-compatible). Every worker emits structured events: session lifecycle, tool calls, status transitions, decision log entries. Compatible with standard OTLP backends.

- Verdict: MISSING
- Evidence: No OTEL/OTLP references anywhere in `triad-source/`. The only "telemetry" is per-task markdown frontmatter: `templates/task.md:18` `actual_tokens:` and `actual_duration_minutes:`, filled in by EM via `/update-task` skill (`agents/engineering-manager/.claude/skills/update-task/SKILL.md:24`). Tool-call and lifecycle events are not emitted as structured events; the only lifecycle trail is inbox message files and tmux pane scrollback.
- Notes: Token/duration fields exist but are hand-recorded per task, not emitted as events.

### Req 2: Classified health states. Workers are classified into states (e.g., working, stalled, GUPP-violation, zombie, idle) based on observable signals (recent activity, progress metrics).

- Verdict: PARTIAL
- Evidence: `skills/status/SKILL.md:79` defines per-agent states inferred from tmux pane output: "PM (pane 0):  [idle | working | waiting | stuck | error] — <brief description>". The classification is done by an LLM reading the last 30 lines of `tmux capture-pane`; `skills/status/SKILL.md:27-30` shows `tmux capture-pane -t '<org/repo>.N' -p -S -50 | tail -30`. Task-level states exist in frontmatter (`todo`, `in-progress`, `done`, `blocked`).
- Notes: Health classification is LLM-judgment over pane text at invocation time, not continuous observable signals. No `GUPP-violation`/`zombie` analogs.

### Req 3: Continuous fleet supervision. A supervisor process runs continuously, monitors all workers, and triggers recovery (nudge, handoff, restart) automatically.

- Verdict: MISSING
- Evidence: The only continuous process is the inbox-watcher (`docs/plans/2026-03-23-agent-triad-implementation.md:787` `fswatch -0 --event Created "$WATCH_DIR"`). It reacts to new inbox files by sending `tmux send-keys -t "$SESSION" "NEW_MESSAGE: $filename" Enter` — it does not monitor worker health or trigger recovery. `/triad:status` and `/triad:resume` are invoked by the human; `skills/resume/SKILL.md:18-23` lists "Checks if all 3 agents are responsive" and "Kicks any unresponsive agents" but the whole skill is user-invoked via `/triad:resume <org/repo>`.
- Notes: `docs/specs/2026-03-22-three-agent-system-design.md:273` explicitly acknowledges: "if the Claude Code process exits (crash, token limit, inactivity), the tmux window shows a bash prompt. Patrick restarts it next time he attaches." A future enhancement is noted but not implemented.

### Req 4: Supervisor-of-supervisors. Supervisors themselves are monitored. Failure modes in the monitoring layer cannot silently disable it.

- Verdict: PARTIAL
- Evidence: The inbox-watcher itself is supervised by the OS: `scripts/inbox-watcher.service:31` `Restart=on-failure` / `RestartSec=5`, and `scripts/com.deuleyville.inbox-watcher.plist:34` `<key>KeepAlive</key><true/>`. `skills/resume/SKILL.md:47-49` checks watcher liveness: `pgrep -f "inbox-watcher.sh.*<project-path>" | wc -l`. `skills/kick/SKILL.md:105-113` restarts dead watchers via `nohup`.
- Notes: Systemd/launchd supervises watcher crashes, but if the watcher is simply not started (e.g., `nohup ... &` form in `skills/start/SKILL.md:85-87`), nothing monitors it until the human runs `/triad:resume`. No supervisor monitors the agents' own "process responsiveness"; only per-session status checks.

### Req 5: Severity-routed escalation. Stuck workers escalate rather than waiting indefinitely. Severity (P0/P1/P2) routes to the appropriate target (human operator, peer agent, logged-only).

- Verdict: PARTIAL
- Evidence: Protocol defines an escalation chain and an urgency field. `docs/specs/2026-03-23-agent-triad-protocol-design.md:321` `urgency: blocking | non-blocking    # for escalations`; `:520` "Escalation chain: Dev → EM → PgM → PM → Human. Each level attempts to resolve before passing up." `:380` "Max 2 revision cycles at each boundary before escalation to human." EM `CLAUDE.md` documents a "30-minute task timeout" with a decision to "kill the worker, split the task... notify the PgM via an info message."
- Notes: Severity is binary (`blocking`/`non-blocking`), not a P0/P1/P2 ladder. Routing is up-the-chain rather than severity-based. Stuck-worker detection relies on EM reasoning about wall-clock time, not an automated signal.

### Req 6: Full audit log. Every tool call is logged with session + task + worker attribution. Queryable after the fact.

- Verdict: PARTIAL
- Evidence: Every protocol message is a file under `docs/inbox/<agent>/{unread,read}/` with filename format `<YYMMDDHHMMSS>-<object-id>-<step>.md` (`agents/engineering-manager/CLAUDE.md` communication section). Task files record per-task token/duration/disposition/completion summary. `agents/program-manager/philosophy/anti-patterns.md:55`: "Every action produces a log entry in Tier 2 memory (SQLite). Significant actions... also produce a Tier 1 narrative memo (markdown)." Watcher logs: `skills/status/SKILL.md:102` `Watcher logs: /tmp/claude/watcher-*-<session>.log`.
- Notes: The inbox-message trail is auditable per-message, but individual tool calls (Read/Edit/Bash etc. inside a Claude session) are not logged with attribution beyond pane scrollback. The "Tier 2 SQLite memory" anti-pattern reference is aspirational philosophy, not implemented substrate in the triad-source.

### Req 7: Crash recovery automation. Handles stale git locks, orphaned worktrees, half-complete task states, zombie processes. No manual `rm -f` required.

- Verdict: MISSING
- Evidence: No references to `.git/index.lock`, stale-lock cleanup, or orphaned-worktree cleanup anywhere in `triad-source/`. `skills/kick/SKILL.md` restarts Claude sessions and watchers but does no git-state hygiene. Worktree creation is in EM `CLAUDE.md`: `git worktree add .worktrees/<task-id> -b <branch>` — no automated removal on crash.
- Notes: The "half-complete task state" is reasoned about by the LLM during `/triad:kick` via a state-aware resume prompt (`skills/kick/SKILL.md:70-101`), which is narrative context, not deterministic cleanup.

### Req 8: Human-visible dashboard. Fleet state, convoy progress, stuck agents, escalations, and cost metrics render in a dashboard or TUI. No log spelunking for normal operations.

- Verdict: PARTIAL
- Evidence: tmux is the TUI: `skills/start/SKILL.md:38-53` creates a 3-pane layout showing all agents. `/triad:status` produces a text summary report (`skills/status/SKILL.md:73-103`) with proposals, projects, tasks (Active/Completed), and inbox unread counts. Cost metrics appear in `agents/engineering-manager/.claude/rules/task-completion.md:73-81` as a per-project markdown table in `project-complete` messages.
- Notes: No live/auto-refreshing dashboard. The "dashboard" is a skill invoked on demand by a human. Escalations surface as files in `docs/inbox/human/unread/`. `docs/operations/session-startup.md:107-109`: "Watch the human inbox for escalations and status updates... `ls ~/inbox/`".

### Req 9: Cost telemetry. Tokens per worker, cache hit rate, and cost per pipeline run are measured and visible. Anomalies surface quickly.

- Verdict: PARTIAL
- Evidence: Per-task: `templates/task.md:18` `actual_tokens:`. EM updates via `/update-task T-042 tokens 42000 3` (`agents/engineering-manager/.claude/skills/update-task/SKILL.md:14`). Aggregation at project completion: `agents/engineering-manager/.claude/rules/task-completion.md:63-83` — "Sum `actual_tokens` across all tasks in the project" rendered as a markdown table per model.
- Notes: No cache-hit-rate measurement. No automated anomaly detection — "anomalies surface" only when a human reads the `project-complete` message. Token numbers are hand-entered by EM from agent result output.

### Req 10: Idempotent recovery actions. Repeated recovery attempts (e.g., nudge, handoff) do not amplify damage. Safe to retry.

- Verdict: PARTIAL
- Evidence: `/triad:kick` is coarse: `skills/kick/SKILL.md:56-68` sends `/exit` then restarts claude. Running it twice will simply exit and restart again. Watcher restart (`skills/kick/SKILL.md:107`) gates on liveness: `pgrep -f "inbox-watcher.sh.*<project-path>.*<agent>" || echo "DEAD"`. Inbox messages are filename-unique by timestamp+object+step, so replays don't collide.
- Notes: No explicit idempotency guarantees. Kicking twice with in-flight work could lose uncommitted state in the Claude session, though there's no persistent workspace damage.

### Req 11: Severity-routed notifications. Human notifications are routed by severity through a configured channel. P0 interrupts; lower severity batches.

- Verdict: PARTIAL
- Evidence: Single channel: file drop into `docs/inbox/human/unread/`, optionally symlinked (`docs/operations/onboarding.md:79-82`: `ln -s /path/to/your-project/docs/inbox/human ~/inbox`). fswatch sends a tmux keystroke on any new file (`docs/plans/2026-03-23-agent-triad-implementation.md:791`: `tmux send-keys -t "$SESSION" "NEW_MESSAGE: $filename" Enter`). `urgency: blocking | non-blocking` field exists on messages but watcher treats all filesystem events identically.
- Notes: No batching. No P0 interrupt distinct from P2. No external channel (Slack/SMS/push) — all via local filesystem + tmux.

### Req 12: Predecessor-session discovery. Stuck or restarted workers can discover and query predecessor sessions for context before giving up or starting over.

- Verdict: PARTIAL
- Evidence: `skills/kick/SKILL.md:28-52` reads inbox state, task statuses, proposal/project statuses to build a "context-aware resume prompt that tells the agent exactly where it left off." `agents/engineering-manager/CLAUDE.md` session-startup step 5: "If resuming after a restart, scan `docs/inbox/engineering-manager/read/` to reconstruct negotiation state — the `round` field and chronological filenames provide the full history." Context files at `agents/<role>/context/<project>.md` persist cross-session learning.
- Notes: Discovery is via filesystem reads (inbox `read/`, task frontmatter, context files). No session-ID linkage; recovery is narrative context reconstruction rather than structured predecessor-session query.

### Req 13: Loop detection. Infinite revision loops, doom loops, and repeated tool-call patterns are detected automatically and break the loop with an escalation.

- Verdict: PARTIAL
- Evidence: Revision-loop cap only at the protocol level: `docs/specs/2026-03-23-agent-triad-protocol-design.md:380` "Max 2 revision cycles at each boundary before escalation to human." Wall-clock task cap: EM `CLAUDE.md` "30-minute task timeout. If any worker has been running for more than 30 minutes wall-clock time, stop and evaluate... Normal tasks complete in 7-15 minutes. 30 minutes is 2x the p95."
- Notes: Revision loops are counted; tool-call doom-loop detection is absent. The 30-min timeout is a prompt-level instruction to the EM agent, not an automated watchdog.

## Surprises

- The "monitoring infrastructure" is largely a set of *skills an agent can invoke* (`/triad:status`, `/triad:kick`, `/triad:resume`) rather than background daemons. Only the inbox-watcher actually runs continuously.
- `skills/kick/SKILL.md:61-64` hardcodes a safehouse macOS sandbox wrapper in the recovery path: `SAFE_CMD="safehouse --workdir=$PROJECT_PATH --add-dirs=$HOME/code --add-dirs-ro=$HOME/vault --"`. Recovery and sandboxing are intertwined.
- Worker dispatch includes a prompt-level 30-minute kill rule in EM `CLAUDE.md`, but there is no watchdog process enforcing it — enforcement is EM self-discipline while it waits for the worker to return.
- Passive "stop-the-line" is an explicit design choice (`docs/specs/2026-03-23-agent-triad-protocol-design.md:526` "Not responding to a message — the downstream chain stalls passively") — stalling is sometimes correct behavior, not a failure mode.
- `/tmp/claude/watcher-*-<session>.log` is the named-but-undocumented audit trail for watcher activity. No rotation or retention policy.
- `docs/specs/2026-03-22-three-agent-system-design.md:273` openly acknowledges the monitoring gap: "NanoClaw can be configured to alert Patrick if the eng-agent tmux session has no running Claude process (future enhancement)."

## Open Questions for Trial

- What happens if an agent Claude session silently hangs (API timeout, no error surfaced in pane)? `/triad:status` would need to notice stale pane output — is the LLM reliable at distinguishing "thinking" from "hung"?
- Does `/triad:kick` actually recover in-flight tool-using sessions, or does it discard uncommitted edits in the Claude session's memory?
- Is the inbox-watcher's `tmux send-keys "NEW_MESSAGE: $filename" Enter` ever lost when Claude is mid-tool-call or mid-compaction?
- Under rapid burst of inbox events, do fswatch notifications coalesce/drop? `fswatch -0 --event Created` with a while-loop reader could race.
- Does the systemd `Restart=on-failure` / launchd `KeepAlive` actually fire if inbox-watcher.sh exits cleanly (no failure) due to a consumed-loop error?
- Does the 30-minute EM-side timeout actually trigger in practice, or does EM forget to check wall-clock while awaiting a worker response?

## Source Index

- `docs/research/triad-source/skills/start/SKILL.md`
- `docs/research/triad-source/skills/status/SKILL.md`
- `docs/research/triad-source/skills/kick/SKILL.md`
- `docs/research/triad-source/skills/resume/SKILL.md`
- `docs/research/triad-source/scripts/inbox-watcher.service`
- `docs/research/triad-source/scripts/com.deuleyville.inbox-watcher.plist`
- `docs/research/triad-source/docs/operations/onboarding.md`
- `docs/research/triad-source/docs/operations/session-startup.md`
- `docs/research/triad-source/docs/plans/2026-03-23-agent-triad-implementation.md` (inbox-watcher.sh source, systemd/launchd templates)
- `docs/research/triad-source/docs/specs/2026-03-22-three-agent-system-design.md`
- `docs/research/triad-source/docs/specs/2026-03-23-agent-triad-protocol-design.md`
- `docs/research/triad-source/docs/ORIGINAL_README.md`
- `docs/research/triad-source/agents/engineering-manager/CLAUDE.md`
- `docs/research/triad-source/agents/engineering-manager/.claude/rules/task-completion.md`
- `docs/research/triad-source/agents/engineering-manager/.claude/skills/update-task/SKILL.md`
- `docs/research/triad-source/agents/engineering-manager/.claude/skills/assign-task/SKILL.md`
- `docs/research/triad-source/agents/program-manager/philosophy/anti-patterns.md`
- `docs/research/triad-source/templates/task.md`

# 08 — Monitoring and Recovery

## Purpose

Defines how the fleet stays healthy without manual babysitting:
telemetry, stuck-agent detection, automated recovery, escalation
routing, and crash recovery. This domain is what lets a pipeline run
unattended long enough to be worth running at all.

## Key forces

- At 20+ agent scale, spotting stuck agents in an activity stream
  becomes difficult. Gas Town's problems-view exists specifically
  because raw event streams don't scale to human attention.
- Gas Town's three-tier Witness/Deacon/Dogs pattern validates a layered
  approach: per-unit health monitor, cross-unit supervisor, dispatched
  maintenance workers.
- The 26-agent ML pipeline post-mortem: "agents would fix a bug at 9:00
  and overwrite the fix at 14:00" because they lacked awareness of
  prior work. Recovery without shared state is worse than no recovery.
- Crash modes are specific and recurring: stale `.git/index.lock`,
  orphaned worktrees (pre-Claude Code v2.1.76), zombie tmux sessions,
  half-applied transitions. These need automated handling, not manual.
- Cost spikes from runaway agents are real. Telemetry must include
  token/cost metrics to catch budget anomalies early.
- Notifications to the human operator should be severity-routed — P0
  interrupts, P2 is batched — or the operator ignores the channel.

## Best-practice requirements

1. **Structured telemetry (OTEL-compatible).** Every worker emits
   structured events: session lifecycle, tool calls, status transitions,
   decision log entries. Compatible with standard OTLP backends.
2. **Classified health states.** Workers are classified into states
   (e.g., working, stalled, GUPP-violation, zombie, idle) based on
   observable signals (recent activity, progress metrics).
3. **Continuous fleet supervision.** A supervisor process runs
   continuously, monitors all workers, and triggers recovery (nudge,
   handoff, restart) automatically.
4. **Supervisor-of-supervisors.** Supervisors themselves are monitored.
   Failure modes in the monitoring layer cannot silently disable it.
5. **Severity-routed escalation.** Stuck workers escalate rather than
   waiting indefinitely. Severity (P0/P1/P2) routes to the appropriate
   target (human operator, peer agent, logged-only).
6. **Full audit log.** Every tool call is logged with session + task +
   worker attribution. Queryable after the fact.
7. **Crash recovery automation.** Handles stale git locks, orphaned
   worktrees, half-complete task states, zombie processes. No manual
   `rm -f` required.
8. **Human-visible dashboard.** Fleet state, convoy progress, stuck
   agents, escalations, and cost metrics render in a dashboard or TUI.
   No log spelunking for normal operations.
9. **Cost telemetry.** Tokens per worker, cache hit rate, and cost per
   pipeline run are measured and visible. Anomalies surface quickly.
10. **Idempotent recovery actions.** Repeated recovery attempts
    (e.g., nudge, handoff) do not amplify damage. Safe to retry.
11. **Severity-routed notifications.** Human notifications are routed by
    severity through a configured channel. P0 interrupts; lower severity
    batches.
12. **Predecessor-session discovery.** Stuck or restarted workers can
    discover and query predecessor sessions for context before giving up
    or starting over.
13. **Loop detection.** Infinite revision loops, doom loops, and
    repeated tool-call patterns are detected automatically and break
    the loop with an escalation.

## Open questions

- Stall-timer tuning — too tight causes false positives (a worker mid-
  thought flagged as stuck), too loose wastes cycles.
- Recovery ladder — nudge → handoff → restart → escalate → kill. At
  what signals does the ladder advance?
- Dashboard fidelity vs update cost — real-time vs 5-second poll vs
  event-driven. What's affordable?
- Supervisor ownership — is the supervisor a dedicated agent, an
  orchestrator responsibility, or a separate daemon?

## Trial considerations

- Simulate a stuck worker (infinite loop, no tool calls for N minutes)
  and verify detection + recovery.
- Crash a worker mid-commit and verify automatic lock cleanup.
- Run a pipeline with a deliberate cost anomaly (runaway context) and
  verify alerting fires before budget damage.
- Kill the supervisor and verify the supervisor-of-supervisors
  restarts it.

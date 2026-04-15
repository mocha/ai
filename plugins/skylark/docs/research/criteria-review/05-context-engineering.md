# 05 — Context Engineering

## Purpose

Defines how context is kept small, focused, and survivable across session
boundaries. Covers working-set management within a session, handoff
protocols between sessions, and discipline around what enters context vs
what stays on disk.

## Key forces

- Output quality degrades at ~60% context utilization — measurably,
  across 50+ sessions. This is well before any hard limit.
- Claude Code's auto-compaction triggers at 75–95%; compaction retains
  only 20–30% of original detail and can fabricate user instructions
  that never existed (issue \#46602).
- After 3–4 compactions in a run, critical context is effectively lost.
- Amp (Sourcegraph) retired compaction entirely in favor of clean thread
  handoffs. Anthropic's own harness research "was designed around the
  assumption of multiple context windows."
- Prompt caching breaks on prefix changes. Static prefix (system prompt,
  tool definitions, CLAUDE.md) must be stable to preserve cache.
- Mode isolation matters: prose quality degrades when mixed with heavy
  code context. Writing, task/decision, and code content behave as
  distinct lanes and should not share a single context window freely.
- Long tool results bloat context without adding reasoning value.
  Microcompaction replaces bulky tool results with placeholders.

## Best-practice requirements

1. **Hard 60% ceiling per worker.** Every worker session has a measurable
   context budget with a hard stop at ≤60% utilization. Exceeding it
   triggers handoff, not compaction.
2. **Disk-canonical state.** Canonical state is on disk (artifacts,
   notes, decision logs). Conversation history is treated as ephemeral
   scaffolding, not source of truth.
3. **Defined handoff protocol.** Handoff artifacts contain at minimum:
   completed work with commit hashes, pending work, key decisions with
   rationale, modified file paths, known blockers, next steps.
4. **Predecessor query.** A new session can query "what did the previous
   session decide/find about X?" without replaying its conversation or
   re-reading every file it touched.
5. **Stable static prefix.** System prompt, tool definitions, and
   long-lived rules are stable across turns to preserve prompt cache.
   Changes to this prefix are recognized as cache-invalidating events.
6. **Append-only where possible.** Context mutations invalidate cache;
   prefer appending new information over rewriting existing.
7. **Deferred tool loading.** Tool schemas and MCP tool definitions load
   on demand, not all-up-front, to keep the static context small.
8. **Mode isolation.** Prose, decision/task, and code contexts are kept
   in distinct sessions or distinct files, not freely mixed.
9. **Phase-boundary splits.** Research/planning/implementation run in
   separate sessions (RPI pattern), not one long session. Each phase
   starts fresh with the prior phase's artifact as input.
10. **Auto-persisted state.** A session's working state is persisted to
    disk automatically at key lifecycle events (pre-compact, stop,
    subagent completion) — not dependent on worker discipline to
    remember.
11. **Compaction as a failure signal.** Compaction events are logged and
    treated as a signal to decompose further — never as a normal
    operating mode.
12. **Three-tier context alerts.** Workers emit warnings at 40%, 60%,
    and 70% utilization to drive decomposition decisions proactively.
13. **Tool-result containment.** Long tool results are stored to disk and
    referenced by path, not dumped verbatim into context.

## Open questions

- The 60% threshold is drawn from mixed workloads — does pure-code work
  tolerate higher utilization (up to claimed 60% in research) vs
  mixed-prose work (degrades at 20–30%)? Implies per-mode budgets.
- Handoff protocol fidelity — what's the minimum viable handoff
  artifact, and how do we verify it's sufficient before running the next
  session?
- Cost of predecessor-query mechanism — does it require parsing a prior
  session's full transcript, or just its artifact?
- Auto-persistence granularity — too frequent creates noise, too
  infrequent loses work. Where's the tuning point?

## Trial considerations

- Run a typical pipeline and measure context utilization per worker;
  identify any worker that hits 60%.
- Force a handoff mid-task and verify the next worker can pick up
  without clarifying questions.
- Inject a prefix change and measure cache-miss impact on cost.
- Compare a compaction-driven run vs a handoff-driven run on the same
  task; measure output quality.

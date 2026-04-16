# 02 — Worker Model

## Purpose

Defines how workers (subagents, polecats, task-scoped agents) are
instantiated, prompted, scoped, and terminated. The worker is the unit
that does substantive reasoning on a single task inside a single context
window.

## Key forces

- Subagent prompt caching is disabled in Claude Code (`enablePromptCaching`
  hardcoded to `false` — GitHub issue \#29966). Every subagent call pays
  full uncached pricing on ~7,000+ tokens of tools/system prompt. Worker
  granularity has real cost implications.
- Quality degrades at ~60% context utilization — well before the hard
  limit. A worker that cannot finish in ≤60% is misconfigured or
  mis-scoped.
- Parallel workers making independent implicit decisions conflict
  (Cognition's Flappy Bird example: one worker builds Mario-style
  background, another builds a non-game bird). Inter-agent misalignment is
  the plurality failure mode in the MAST paper.
- Per-task expertise drives output quality. Generic worker prompts produce
  generic output; vocabulary-routed expert prompts produce targeted work.
- "Never recreate" rule from the 26-agent ML pipeline post-mortem —
  workers without shared awareness overwrite each other's fixes.

## Best-practice requirements

1. **Ephemeral sessions.** Worker session terminates at task completion.
   No long-lived worker accumulates conversation across tasks.
2. **Persistent identity, ephemeral state.** Worker identity (role,
   accumulated telemetry, reputation) persists across sessions, decoupled
   from the conversation state of any one session.
3. **Per-task prompt generation.** Worker prompts are generated at
   dispatch time based on the specific task, not baked into static config
   at orchestrator startup. A dispatch call can pass a full prompt body.
4. **Dynamic context injection.** Prompt generation supports injecting
   domain vocabulary, scoped file paths, relevant prior artifacts, and
   task-specific constraints.
5. **Curated inputs only.** Workers never receive a blanket dump of parent
   context or unrelated artifacts — only the inputs the task requires.
6. **Structured outputs.** Worker returns a typed result (status enum +
   typed fields), not free-form prose.
7. **Typed status outcomes.** At minimum: `DONE`,
   `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, `BLOCKED`.
8. **Per-role tool scoping.** Worker tool access is configurable per-role
   (narrowing, not broadening).
9. **Pluggable runtime.** The same task definition runs under multiple
   runtimes (Claude Code, Codex, Copilot CLI) via a thin adapter — no
   per-task rewrite.
10. **Peer-awareness log.** Workers emit a decision/work log that
    concurrent or subsequent workers can consume to avoid conflicting
    choices. Format must be short enough to inject without context bloat.
11. **Single-session discipline.** Any worker exceeding ~60% of its
    context window must hand off (produce a structured continuation
    artifact) rather than compact.
12. **Bounded lifetime.** Workers have an explicit timeout; exceeding it
    escalates rather than silently hangs.

## Open questions

- Cost vs isolation tradeoff given the subagent-caching gap — is it
  cheaper to run fewer larger workers or many small ones?
- How thick should the runtime adapter be? Is parity across runtimes
  realistic or aspirational?
- Peer work-log format and delivery mechanism — pushed at turn start,
  pulled on demand, or both?
- Identity persistence granularity: per-role, per-specialty, per-repo?

## Trial considerations

- Measure actual worker context utilization across a realistic task set;
  find the distribution.
- Dispatch two workers on adjacent tasks and verify the peer-log
  prevents a conflict scenario.
- Swap the runtime for one task and verify parity of output.
- Inject a `NEEDS_CONTEXT` return and verify the orchestrator routes
  correctly.

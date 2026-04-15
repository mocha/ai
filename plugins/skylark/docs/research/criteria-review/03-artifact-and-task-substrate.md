# 03 — Artifact and Task Substrate

## Purpose

Defines the data layer for work items: how tasks, specs, plans, reviews,
and their relationships are stored, queried, and persisted. The substrate
is the system of record for the pipeline — it outlasts any one session,
any one worker, and any one compaction event.

## Key forces

- Disk artifacts are the only context that reliably survives compaction
  and session boundaries. Anthropic's own "effective harnesses" pattern
  uses `claude-progress.txt` + JSON feature lists + git log as ground
  truth.
- Compaction retains ~20–30% of detail, and the details it drops
  disproportionately include the *why* (rationale, alternatives
  considered, constraints). The substrate must preserve this.
- Markdown files in ad-hoc directory layouts do not scale to queries:
  "what is blocking task X?" or "show me every open spec-stage item at
  elevated risk" requires scanning by LLM, which is slow and lossy.
- The 26-agent ML post-mortem's "never recreate" rule only works if the
  substrate is discoverable by every agent before it starts work.
- Structured issue tracking (Beads) is an emerging standard specifically
  designed for agent-driven work.

## Best-practice requirements

1. **Structured schema.** Work items have a defined schema: at minimum
   `id`, `title`, `type` (task/spec/plan/review/PR/etc.), `status`,
   `blocked_by`, `blocks`, `parent`, `assignee`, `created_at`,
   `updated_at`, `labels`.
2. **Version-controlled storage.** The substrate is git-backed (or
   equivalent) so history is replayable and auditable.
3. **Queryable without LLM.** State can be inspected by dependency graph,
   status, label, or origin using a CLI or simple query — no LLM scan
   required to answer "what's blocking X?"
4. **Atomic writes.** Concurrent worker writes cannot corrupt state via
   interleaved edits. Transitions are all-or-nothing.
5. **Cross-references by ID.** Artifacts link to each other by stable
   ID — task → spec → plan → PR — not by file path or title.
6. **Survives compaction and session boundaries.** The substrate is
   canonical; conversation memory is ephemeral scaffolding around it.
7. **Idempotent re-runs.** Re-running the pipeline skips items already in
   terminal states; the orchestrator inspects the substrate rather than
   replaying.
8. **Human-readable, machine-parseable.** Items can be inspected by a
   human without special tools (plain text fallback) but are structured
   enough for CLI queries and tool automation.
9. **Event emission on transition.** Item status changes emit structured
   events for telemetry and downstream automation (e.g., "item X moved
   to ready" triggers dispatch).
10. **Stable, portable, short IDs.** IDs are short enough for
    conversational reference (agents can say "gt-abc12" or similar),
    stable across the item's lifetime, and portable across workspaces.
11. **Decision capture.** Items store the *why* of decisions — rationale,
    alternatives considered, constraints — not just the *what*.
12. **Specs and plans are first-class.** Specs, plans, and reviews are
    artifact types in the substrate, not ad-hoc files in a docs
    directory.
13. **Migration path.** Existing ad-hoc artifacts (markdown in `docs/`,
    Linear issues) can be imported into or referenced from the substrate
    without rewriting history.

## Open questions

- Is a single substrate schema sufficient, or do different artifact types
  (specs vs tasks vs PRs) need different schemas with common headers?
- Storage format trade-offs: JSON per-item vs database with checkout,
  vs Dolt-style versioned database.
- How does the substrate handle very long artifacts (a 3000-word spec)
  without becoming unreadable as structured data?
- Cross-repo / monorepo semantics — how do IDs stay unique and portable?

## Trial considerations

- Import an existing Skylark spec into the candidate substrate and verify
  query patterns work.
- Test concurrent writes from parallel workers and verify no corruption.
- Simulate compaction and measure what is preserved vs lost.
- Query "what's blocking issue X across the graph" and measure latency.

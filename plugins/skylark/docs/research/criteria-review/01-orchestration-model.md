# 01 — Orchestration Model

## Purpose

Defines how pipeline stages are coordinated, how state transitions are
driven, and how the orchestrator itself stays small enough not to become a
context or compaction bottleneck. The orchestrator is the long-running
component that decides "what runs next"; it is not the component that does
substantive domain reasoning.

## Key forces

- The orchestrator-worker split is the dominant architecture across every
  major agent framework (Claude Code Agent Teams, Codex manager agents,
  Cline). The contested axis is whether the orchestrator itself reasons or
  merely dispatches.
- "No production system has fully achieved the deterministic-orchestrator
  ideal" — even Agent Teams use LLM reasoning for synthesis. But the
  research points strongly toward keeping the orchestrator thin.
- If the orchestrator carries substantive reasoning, it accumulates context,
  which triggers compaction, which loses fidelity. Compaction retains ~20–30%
  of detail and can fabricate instructions that never existed (issue
  \#46602).
- LLM orchestrators are throughput bottlenecks — a 3-second coordination
  call against 20 workers caps the fleet at ~6.7 tasks/second.
- Pure deterministic state machines break on naming drift and minor pattern
  mismatches; pure LLM orchestrators drift in the other direction. The
  useful middle ground is "declarative plan with bounded LLM escape hatch."

## Best-practice requirements

1. **Declarative pipeline definition.** The pipeline is expressed in a
   machine-readable format (YAML/TOML/equivalent) separate from any LLM
   prompt. Stage order, dependencies, and transitions are data, not prose.
2. **Bounded orchestrator context.** The orchestrator's working context has
   a measurable ceiling (target ≤20K tokens) that is invariant to pipeline
   length or run count.
3. **Typed state transitions.** Every pipeline step has a typed status
   (`pending`, `in_progress`, `complete`, `failed`, `needs_review`,
   `blocked`). Transitions are explicit; re-entry from any terminal state
   is supported.
4. **Disk-first state resolution.** The orchestrator determines the current
   pipeline state by reading persisted artifacts, not by recalling
   conversation history.
5. **DAG dependency tracking.** Steps declare `blocked_by` relations.
   Completion of one step automatically unblocks dependents.
6. **Bounded reasoning for edge cases.** The orchestrator follows the
   declarative plan for the happy path but has a constrained reasoning
   affordance for naming/pattern mismatches (e.g., "PR name slightly off
   but carries correct info") without requiring code changes to the state
   machine.
7. **Explicit resume semantics.** Any new orchestrator session can resume
   at the last terminal artifact state, without replaying prior
   conversation.
8. **Parallel fan-out.** Independent DAG branches can run concurrently;
   the orchestrator schedules them without serializing.
9. **No substantive delegation of domain decisions.** The orchestrator
   never decides "is this spec approved?" or "is this code correct?" —
   those are always delegated to specialized workers or to human gates.
10. **Crash-safe transitions.** A mid-transition crash leaves the pipeline
    in a recoverable state; no transition writes are half-applied.

## Open questions

- What is the right balance between strict DAG enforcement and adaptive
  re-planning mid-flight when new scope is discovered?
- Should the orchestrator itself be an LLM following a strict plan
  (cheaper to build) or a deterministic engine with LLM escape hatches
  (cleaner boundaries)?
- How are cross-pipeline signals (e.g., "pause all pipelines touching
  service X") modeled?

## Trial considerations

- Measure orchestrator context size at end of a full pipeline run; verify
  it is bounded.
- Kill the orchestrator mid-stage and resume; confirm state recovery.
- Inject a naming mismatch (e.g., artifact filename drift) and observe
  whether the orchestrator self-corrects or wedges.
- Run concurrent independent pipelines and measure interference.

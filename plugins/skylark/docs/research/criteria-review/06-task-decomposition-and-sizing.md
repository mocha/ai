# 06 — Task Decomposition and Sizing

## Purpose

Defines how larger initiatives (issues, specs, epics) are broken down
until every leaf task is small enough to execute in a single worker
session without compaction. The atomicity layer. This domain is the
structural fix for the ENG-180 failure mode — a 6000+ LOC single PR
produced by 53 commits across five waves.

## Key forces

- ENG-180 shipped as one 6000+ LOC PR that was never exercised against
  production traffic, never mid-flight reviewed, and never
  integration-tested end-to-end outside CI. The largest risk of the
  project.
- "Merges to main as the integration checkpoint, not all tasks complete."
  Wave 1 could have been five reviewable PRs, each small enough for a
  human.
- Compaction frequency is a leading indicator of too much in flight. If
  a plan needs more than 2 compactions, that is the signal to stop and
  decompose further.
- Plan-to-reality drift shows up when plans were not validated against
  current code at dispatch (plan said `buildServer({ verifyToken })`;
  reality was `buildServer({ auth: { verifyToken } })`).
- Cross-task integration surfaces (shared `FastifyInstance.db`
  decoration overlap between T8 and T9) only appeared at merge because
  tasks did not sequentially merge onto shared trunk.
- Waterfall-style deep pre-planning with strong dependency mapping
  minimizes concurrent integration surprises — but only if the
  decomposition is pushed far enough down.

## Best-practice requirements

1. **Single-session fit.** Every leaf task is sized to fit one worker
   session ≤60% context utilization, including its outputs and tool
   calls.
2. **~500 LOC PR cap.** Artifact boundaries (PRs) cap at roughly 500
   lines of code. If a "slice" produces more, the slice was wrong and is
   re-decomposed.
3. **DAG decomposition.** Decomposition produces a DAG with explicit
   dependencies, not a flat list. Each node declares what it blocks and
   what blocks it.
4. **Self-contained DONE contract.** Every task has an explicit
   completion contract — what must be true, including integration-test
   evidence where applicable. No "I think it's done" signals.
5. **Pre-dispatch plan validation.** A task's signatures, file paths, and
   external assumptions are grep-checked against current code *before*
   the task is dispatched to a worker. Drift blocks dispatch.
6. **PR boundary = wave boundary.** Tasks merge individually. There is no
   "multi-task wave" that merges as a single PR. The integration
   checkpoint is each merge to main.
7. **Compaction as decomposition trigger.** Exceeding 2 compactions in a
   plan's execution is a pipeline-level signal to pause and decompose
   further, not to continue.
8. **Iterative planning.** Decomposition happens in phases: coarse plan
   → refined plan → task specs. Re-planning gates are explicit so new
   information can restructure the DAG without silent drift.
9. **Status rollup.** Parent work items track children and roll up
   completion / blocker status without manual bookkeeping.
10. **Risk-dictated gate shape.** A task's risk level determines its
    gate (trivial → no panel; elevated → panel; critical → panel + human).
    Sizing and review cost scale together.
11. **Triage funnel.** Raw ideas and problems enter a triage/intake
    stage before becoming tasks. No direct "implement this" on
    unclassified input.
12. **Coarse-to-fine decomposition cap.** Maximum decomposition depth
    (e.g., project → epic → task → subtask) is bounded; deeper nesting
    is a sign of unclear scope.
13. **Parallelizable by default.** Decomposition produces independent
    leaf tasks wherever possible so the fleet can fan out. Serial chains
    are explicit and justified.
14. **Validated scope before dispatch.** The task spec includes its
    inputs, outputs, affected files, and acceptance criteria. A worker
    receiving it should not have to re-discover scope.

## Open questions

- Who does the decomposition — a dedicated "planner" worker, the
  orchestrator with a planner skill, or the human operator?
- How is decomposition quality measured? Number of PRs, compaction
  count, time-to-merge, review rounds?
- When a task turns out mid-flight to be too large, what's the recovery
  — abort and re-decompose, or split the worker's output into multiple
  PRs?
- How does decomposition interact with architectural uncertainty, where
  the right decomposition is only knowable after some exploratory work?

## Trial considerations

- Take a realistic medium-complexity issue, run decomposition, and
  verify every leaf task actually fits ≤60% utilization.
- Measure PR LOC distribution across a run — how many exceed 500?
- Inject a mid-flight scope expansion and observe whether the
  decomposition layer handles it gracefully.
- Measure dispatch-time validation accuracy: how often does plan-vs-code
  drift get caught pre-dispatch vs at implementation?

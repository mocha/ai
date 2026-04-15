# 07 — Integration and Merge Model

## Purpose

Defines how individual worker outputs integrate into the trunk: branch
strategy, merge queue behavior, CI gating, conflict handling, and
cross-worker collision avoidance. This domain is where the fleet's
output converges into shippable state.

## Key forces

- Direct pushes to `main` with multiple concurrent agents produce chaos
  and race conditions. Branch protection must be real, not advisory.
- Bors-style bisecting merge queues are the state of the art for
  high-throughput integration (GitHub's native merge queue, Gas Town's
  Refinery). CI runs on the *would-be-merged state*, not the PR in
  isolation.
- CI catches ~15% of agent-generated bugs; pre-merge AI review catches
  an additional ~30% that CI misses. Together they gate most defects.
- ENG-180's schema-snapshot / migration desync was not caught for 40
  commits because integration testing was deferred. A 1-second local
  check would have surfaced it at commit time.
- Cross-task integration surfaces (T8/T9 `FastifyInstance.db` overlap,
  T10 redundant resolver call) appear at merge when tasks skip
  sequential trunk integration.
- Agents that crash mid-commit leave stale `.git/index.lock` files that
  block all subsequent operations until manually cleared.

## Best-practice requirements

1. **No direct pushes to trunk.** All worker changes route through a
   merge queue or PR flow. Branch protection is enforced at the remote.
2. **Merge-queue CI runs on merged state.** CI runs on the combination
   of trunk + candidate PR(s), not on the PR branch in isolation.
3. **Bisecting batches.** If a batch fails, the queue bisects to
   isolate the failing change; good changes in the batch still merge.
4. **Automated conflict recovery path.** Conflicts trigger a defined
   recovery (rebase + retry by the authoring worker, escalate to human,
   or discard) rather than silent overwrite.
5. **CI reaction loop.** A failed CI run returns actionable diagnostics
   to the authoring worker, which can attempt a fix without human
   intervention up to a bounded retry limit.
6. **Integration tests are a merge gate.** Integration tests run before
   merge, not as a post-merge observation. Required for elevated+ risk
   changes.
7. **Branch-per-task.** Each worker's output maps to exactly one branch
   and one PR. No shared branches between workers.
8. **Pre-merge review required for elevated+.** AI (or human) review
   happens before merge for elevated and critical risk changes.
9. **Branch protection cannot be bypassed.** `--force`, admin override,
   and config-level bypass are blocked or audited. Workers cannot
   silently escape the queue.
10. **Merge event telemetry.** Merge events emit structured telemetry
    linking merge → PR → task → worker → pipeline run. Post-hoc
    correlation is possible.
11. **Stale-lock recovery.** Crash recovery handles stale
    `.git/index.lock`, orphaned worktrees, and half-applied commits
    automatically — no manual cleanup required.
12. **Trunk integration checkpoint per task.** Each task merges
    independently to trunk; subsequent tasks rebase onto fresh trunk.
    No multi-task stacks that only integrate at end-of-project.
13. **Pre-dispatch drift gate.** Before dispatching a task, validate
    that the planned signatures / paths still match trunk. If trunk has
    drifted, re-plan before dispatching.

## Open questions

- Batch size in the merge queue — small batches are safer but slower;
  large batches amortize CI cost but bisect more often.
- How does the merge queue handle long-running CI (e.g., 20-minute
  integration test) without starving throughput?
- Cross-repo merges (monorepo with multiple deployables) — single queue
  per repo, per deployable, or coordinated across?
- Human-review SLA — how long does a queued PR wait for human review
  before auto-escalating?

## Trial considerations

- Dispatch two workers touching overlapping files; verify the queue
  serializes merges correctly.
- Inject a deliberate CI failure and observe the bisecting behavior.
- Simulate a worker crash mid-commit and verify stale-lock cleanup
  without human intervention.
- Measure end-to-end time from task dispatch to merge across a realistic
  workload.

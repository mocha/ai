---
date: 2026-04-15
issue: ENG-180
topic: retrospective — what to change so we never ship a 6000-LOC PR again
status: draft
---

# ENG-180 Retrospective — risk, recurring patterns, workflow fixes

ENG-180 shipped as a single 53-commit / 6000+ LOC PR over five "waves"
of per-task implementation + panel review. It completed, but with
meaningful risk that we should not repeat. This note captures what
went wrong mechanically, what the 40+ panel reviews kept flagging,
and concrete workflow changes.

## Biggest, highest-risk areas

### 1. Merge-at-end with no intermediate staging

53 commits landed as one stack that was never exercised against
production traffic, never reviewed by another engineer mid-flight, and
never integration-tested end-to-end outside CI until the PR opened.
The single largest risk of the entire project. A race condition or
data-integrity bug in any of the Wave-3 services would not have been
caught until PR merge, and possibly not until production.

### 2. Context window exhaustion

We compacted at least four times. Each reset required reconstructing
state from markdown resumption notes (150–300 lines each). Every
compaction is a correctness risk — details get paraphrased, invariants
get dropped, and the next session acts on a lossy representation of
earlier decisions.

### 3. Deferred integration testing

55 integration tests gate on `DATABASE_URL_ADMIN` and only ran on CI.
Locally, every wave merged without exercising real DB paths. The
schema-drift failure that the PR CI caught is the cheap version of
this risk. The expensive version would have been a race condition in
`createOrganization` that only manifests under real concurrency.

### 4. Cross-task integration surfaces that only appeared at merge

- **T8 / T9 decoration overlap** on `FastifyInstance.db` was caught at
  the T9 rebase — had to unify to optional `db?` / `redis?` with
  explicit runtime guards at every consumer.
- **T10 redundant `getOrganizationForUser` call** was caught at panel
  review round 1; fix was to cache the resolved org row on
  `_orgResolverState`.

Both were avoidable if the tasks had merged sequentially onto a shared
`main` and been exercised before the next task started.

### 5. Plan-to-reality drift

- The plan said `buildServer({ verifyToken })`; the real API was
  `buildServer({ auth: { verifyToken } })`.
- The T15 dispatch prompt described a `/whoami` update; the plan's
  Task 15 was actually the EXPLAIN regression guard, which commit
  `1bc341d` had already landed.

These are signals that the plan was not validated against current code
before being handed to workers.

### 6. Schema snapshot / migration desync

The committed `0002_snapshot.json` disagreed with the migration's SQL
(DROP NOT NULL on two columns) for the entire project lifespan. CI
only caught it when the PR opened. A 1-second local check
(`pnpm --filter @skylark/db db:generate && git diff --exit-code
packages/db/drizzle`) would have surfaced it at T14 merge, 40 commits
earlier.

## Recurring panel complaints

In rough frequency order across the 40+ reviews:

| Pattern | Example tasks | Fix shape |
|---|---|---|
| Missing `return` after `reply.send` | T8, T9 | Handler drops through; second send throws |
| Non-atomic cross-system writes / compensation-in-catch-block | C3 at spec gate, T5, T9 | Outbox, Lua, or explicit pending-state |
| JWT trust without DB cross-check | C2 at spec gate | `preferred` arg + membership validation |
| Fail-open vs fail-closed ambiguity | T9 rate-limit, T10 resolver | Explicit 503 branches |
| Test-only surface leaking into production interface | T13 `_total`/`_reset`, T10 `verifyToken` | Split types or add runtime guards |
| DB role / REVOKE semantics (`PUBLIC` is a no-op against owner) | T1 | Non-owner `skylark_app` role |
| Client messages leaking internal structure | T8 (`(ENG-224)` in 409) | Strip ticket refs from user-facing copy |
| Route re-querying what middleware already resolved | T10 | Cache resolver state on request |
| CI gates asserted in code but not wired | T10 grep gate | Wire to workflow when written |
| Test gaps for the scenarios panels are about to flag | T5 race-loss, T13 labeled counters, T10 multi-org 409 | Write the adversarial test first |

The **same taxonomy repeated across waves**. Atomicity, trust
boundaries, fail-closed, test-only-surface isolation, and "did you
wire the gate you wrote." Per-task panels largely rediscovered the
categories the spec panel had named in general terms at Round 1.

## Suggestions

### On decomposition

1. **Cap PR size at ~500 LOC.** If a "foundational slice" produces
   6000 LOC, it is not a slice. When the plan decomposes into N>3
   tasks, decompose at the *Linear* level too — each wave becomes its
   own sub-issue and its own PR, merged independently.
2. **Treat "merges to main" as the integration checkpoint, not "all
   tasks complete."** Wave 1 (T0/T2/T3/T4/T7) could have shipped as
   one PR, gotten exercised in staging, and exposed any real-world
   issues before Wave 2 touched it. We'd have had ~5 reviewable PRs,
   each small enough for a human.
3. **If a project needs more than 2 compactions, stop and
   decompose.** Compaction frequency is a leading indicator of "too
   much in flight."

### On panel overhead

4. **Invest more in spec/plan gates, less in per-task gates.** The
   spec/plan panels named every recurring category of issue. The
   per-task panels were expensive rediscoveries. For tasks inside an
   approved plan, default to a single-reviewer pass focused on the
   known-recurring patterns (the table above). Invoke a full 3-expert
   panel only when a task introduces a *new* trust boundary or a
   new cross-system write.
5. **Convert recurring panel complaints into lint rules or CI gates.**
   "Missing `return` after `reply.send`" is lintable. "Decoration
   declared in two files" is grep-able. "Schema snapshot matches SQL"
   is already a CI gate pattern. Each panel discovery that repeats
   across tasks is a signal to automate it.

### On worker dispatch

6. **Pre-validate plan signatures against real code before
   dispatching.** A single grep at dispatch time ("does `buildServer`
   accept `verifyToken` at the top level?") would have saved the T15
   dead-end and the T10 adaptation work.
7. **Make the DONE contract require a local integration-test run.**
   `pnpm docker:up && export DATABASE_URL_ADMIN=... && pnpm test` as
   the last step before a worker returns DONE. Especially for
   elevated+ risk work.

### On context management

8. **Stop rewriting the plan in resumption notes.** Our
   `*-resumption.md` files duplicated content already in the plan. A
   "project state ledger" (one line per merged task + current HEAD SHA
   + open decisions) is a fraction of the context footprint.
   Re-derive details from the plan file at the start of each session.
9. **Keep a single "next minimum-viable merge" anchor in the
   session.** A single line that updates as waves complete: *"the
   next thing that should merge is X; when I see it passing Y I merge;
   then I stop."* This is the anchor that survives compaction.

### On this project specifically

10. Before the PR merges, skim the ENG-229 deferred list and decide
    which items are load-bearing for a safe staging rollout vs.
    genuine follow-ups. The list is ~15 items and some of them are
    operationally meaningful, not just nits:
    - **T12 CI Postgres service** — would unskip the 55 integration
      tests in CI, closing the biggest testing gap.
    - **T5 race-loss test via `__beforeTx2Hook`** — the compensation
      branch currently has no automated test that actually triggers
      it under the real race condition.
    - **T9 `trustProxy` + audit-trail client-IP** — currently the
      audit table records the proxy's IP, not the caller's, if the
      deployment sits behind one.

## What worked and should continue

Not everything was a problem — some choices paid off:

- **Panel reviews at spec and plan gates** caught architectural
  issues (Postgres-first vs WorkOS-first, JWT trust model, audit
  table existence) that would have been expensive to fix
  post-implementation. Keep these gates for elevated+ risk work.
- **Option C worktree pattern** (pre-create worktrees in
  `api/.worktrees/eng-180-tN`, dispatch workers without runtime
  isolation) worked cleanly. Document as the canonical shape.
- **Inline fix-after-panel** cadence (apply nits before merge, not
  after) prevented the parking-lot from growing uncontrollably.
- **`isWorkOSTimeoutError` predicate + `__beforeTx2Hook` seam** —
  thinking through test-affordances at design time is worth the
  extra cycles.

## One-line summary

ENG-180 proved the pipeline can execute a 15-task multi-wave project,
but the size of the artifact it produced is the lesson: next time,
decompose at the Linear level so the "wave" boundary is also the
"PR" boundary.

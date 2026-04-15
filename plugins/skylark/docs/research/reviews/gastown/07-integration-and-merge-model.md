# Gas Town — Integration and Merge Model Conformance Evaluation

## Summary

- Conformance at a glance: 5 MEETS, 5 PARTIAL, 3 MISSING, 0 N/A (out of 13)
- Headline: Refinery implements a production-grade Bors-style bisecting batch merge queue with branch-per-task isolation and automated conflict-recovery delegation, but lacks explicit git index.lock recovery, a pre-dispatch drift gate, and does not emit the structured merge-event types that its own telemetry schema defines.

## Per-Requirement Findings

### Req 1: No direct pushes to trunk. All worker changes route through a merge queue or PR flow. Branch protection is enforced at the remote.

- Verdict: PARTIAL
- Evidence:
  - `.githooks/pre-push` (local client hook) restricts pushes: `case "$branch" in "${default_branch}"|beads-sync|polecat/*|integration/*)` — "Allowed branches" — with a fallback that otherwise prints `"ERROR: Invalid branch for Gas Town agents."` and exits 1. The comment at the top states: "Gas Town agents push to main (crew) or polecat/* branches (polecats). PRs are for external contributors only."
  - `docs/design/architecture.md` line 208: "The refinery processes MRs through a batch-then-bisect merge queue (Bors-style)."
  - `docs/concepts/integration-branches.md` line 477: "Requires: `core.hooksPath` must be configured for the hook to be active. New rigs get this automatically. Existing rigs: run `gt doctor --fix`."
  - Polecats push their `polecat/<name>/<issue-id>` branches; `gt done` submits MRs and Refinery merges.
- Notes: Enforcement is a client-side pre-push hook, not a server-side branch protection rule. The pre-push hook explicitly permits direct pushes to the default branch ("Crew workers push here directly" in the hook message and `"${default_branch}"|beads-sync|polecat/*|integration/*)` whitelist). This is partial because (a) crew workers are not routed through the queue, and (b) client hooks can be bypassed by omitting `core.hooksPath` or invoking `git push --no-verify`. No evidence of server-side remote branch protection was found in locations searched (`docs/`, `internal/git/`, `internal/refinery/`).

### Req 2: Merge-queue CI runs on merged state. CI runs on the combination of trunk + candidate PR(s), not on the PR branch in isolation.

- Verdict: MEETS
- Evidence:
  - `internal/refinery/batch.go` `BuildRebaseStack()` builds the merged state before gating: "Each MR is squash-merged sequentially: target ← MR1 ← MR2 ← MR3... On return, the git working directory is on the target branch with all successful MR squash-merges applied (but not pushed)."
  - `ProcessBatch()` comment: "Algorithm: 1. Build the rebase stack (target ← MR1 ← MR2 ← ... ← MRn) 2. Run gates once on the stack tip 3. If green: push (fast-forward all MRs to target)".
  - `runBatchGates()` at `batch.go:309` runs configured gates (`e.config.Gates`) or `runTests()` on the working tree that currently has the squash-merged stack applied.
  - `docs/design/architecture.md:210-229`: "Batch: Rebase A..D as a stack on main → Test tip: Run tests on D (tip of stack) → If PASS: Fast-forward merge all 4".
- Notes: Confirmed in source. The stack is constructed on the target branch head then gates run before push.

### Req 3: Bisecting batches. If a batch fails, the queue bisects to isolate the failing change; good changes in the batch still merge.

- Verdict: MEETS
- Evidence:
  - `internal/refinery/batch.go` functions `bisectBatch()` and `bisectRight()` implement binary search: `"mid := len(batch) / 2"`, `"[Bisect] Testing left half (%d MRs)..."`, recursive bisection.
  - `ProcessBatch()` step 6: `"If we found good MRs, merge them"` — `e.fastForwardBatch(ctx, good, target, result)` after re-verifying the good subset.
  - Design doc `architecture.md:215-224`: "If FAIL: Binary bisect → test B (midpoint) → If B passes: C or D broke it → bisect [C,D] → If B fails: A or B broke it → bisect [A,B]"
  - Flaky-test retry before bisection: `batch.go:261`, `RetryBatchOnFlaky` config defaulting to `true`.
- Notes: Test coverage exists in `batch_test.go` (873 lines). Good MRs are preserved and merged; culprits returned as `result.Culprits`.

### Req 4: Automated conflict recovery path. Conflicts trigger a defined recovery rather than silent overwrite.

- Verdict: MEETS
- Evidence:
  - `internal/refinery/batch.go` `BuildRebaseStack()`: "`Check for conflicts before merging`"; conflicting MRs are removed from the stack, appended to `conflicts`, and the stack rebuilt without them.
  - `internal/refinery/engineer.go:1450-1510` `createConflictResolutionTaskForMR()`: on conflict, Refinery creates a Beads task with templated instructions ("1. Check out the branch: git checkout %s 2. Rebase onto target: git rebase origin/%s 3. Resolve conflicts in your editor ... 5. Force-push the resolved branch: git push -f 6. Close this task: bd close <this-task-id>. The Refinery will automatically retry the merge after you force-push.") and blocks the MR on it.
  - `engineer.go:1336` nudge: `"MERGE_FAILED: branch=%s issue=%s type=%s error=%s — fix and resubmit with 'gt done'"`.
  - Retry counter tracked on MR: `retryCount := mr.RetryCount + 1` (`engineer.go:1453`).
- Notes: The recovery is delegated to a new dispatched task, not the originating polecat (per `gt refinery --help`: "If conflict: spawns FRESH polecat to re-implement (original is gone)"). The MR stays in queue and auto-retries on the next poll after the task closes.

### Req 5: CI reaction loop. A failed CI run returns actionable diagnostics to the authoring worker, which can attempt a fix without human intervention up to a bounded retry limit.

- Verdict: PARTIAL
- Evidence:
  - `engineer.go:1336-1349` nudges polecat directly with failure type (`conflict`/`tests`/`build`) and error body; also nudges mayor.
  - `internal/formula/formulas/mol-refinery-patrol.formula.toml:33-37`: "On failure, Refinery sends FIX_NEEDED directly to the Polecat. The polecat fixes the code in-place and resubmits the MR without losing context."
  - `internal/protocol/messages.go:136` defines `FIX_NEEDED` protocol message.
  - `types.go:166-208` defines `MaxRetryCount int` defaulting to `5` for "conflict resolution retries".
- Notes: Diagnostics are delivered via `gt nudge` (free-form text), not structured machine-parseable reports. The "bounded retry limit" (`MaxRetryCount: 5`) applies specifically to conflict resolution retries; no evidence of a per-MR bounded retry cap for test/build failures — MRs remain in queue and are retried by the polecat submitting again via `gt done`. For `NeedsApproval` the comment is `"MR stays in queue and will be retried on the next poll"` without a cap.

### Req 6: Integration tests are a merge gate. Integration tests run before merge, not as a post-merge observation. Required for elevated+ risk changes.

- Verdict: PARTIAL
- Evidence:
  - `mol-refinery-patrol.formula.toml` vars: `setup_command`, `typecheck_command`, `lint_command`, `test_command`, `build_command`. "Commands run in this order (any can be empty = skip)".
  - `integration-branches.md:490-504` "The 5-Command Pipeline... 4. test — Run test suite (e.g., `go test ./...`)".
  - Gates are run on the stack tip before push (see Req 2).
- Notes: The framework runs whatever the rig configures as its test command as a blocking gate before merge. There is no distinction between unit and integration tests, and no risk-based gating ("required for elevated+"). No evidence of risk-level routing in the merge-queue pipeline.

### Req 7: Branch-per-task. Each worker's output maps to exactly one branch and one PR. No shared branches between workers.

- Verdict: MEETS
- Evidence:
  - `internal/constants/constants.go:218` `BranchPolecatPrefix` — polecat work branches.
  - `internal/polecat/manager.go:948` comment: "git worktree add -b polecat/<name>-<timestamp> <path> <startpoint>"
  - `internal/mq/id.go:19`: "branch: The source branch name (e.g., `polecat/Nux/gt-xyz`)"
  - `docs/design/architecture.md:142` "git worktree add -b polecat/<name>-<timestamp> polecats/<name>"
  - `docs/design/witness-at-team-lead.md:307` "git worktree add /path/to/polecats/<name>/<rig> -b polecat/<name>/<issue-id>"
  - Each polecat has its own worktree and its own `polecat/<name>/<issue-id>` branch; one MR bead per branch.
- Notes: Clean branch-per-worker-per-issue naming scheme. Integration branches are a separate concept layered over this (child MRs target the integration branch, which is owned by the epic, not shared between workers on the same task).

### Req 8: Pre-merge review required for elevated+. AI (or human) review happens before merge for elevated and critical risk changes.

- Verdict: PARTIAL
- Evidence:
  - `mol-refinery-patrol.formula.toml:420-485` step `quality-review`: "**Config: judgment_enabled = {{judgment_enabled}}**... Review the merge diff for quality issues. This step is measurement-only (Phase 1): reviews are recorded but do NOT gate merges."
  - Default: `judgment_enabled = "false"` (`vars.judgment_enabled` default `"false"`).
  - Step explicitly states: "Do NOT block the merge — Phase 1 is measurement-only".
  - `require_review` var (default `"false"`) gates on GitHub PR approval only when `merge_strategy=pr`.
- Notes: An AI review step exists in the Refinery formula but is (a) off by default, (b) not risk-gated, and (c) explicitly non-blocking in its current phase. Human review is only available via `merge_strategy=pr` with `require_review=true`, which requires running the whole queue in PR mode.

### Req 9: Branch protection cannot be bypassed. `--force`, admin override, and config-level bypass are blocked or audited. Workers cannot silently escape the queue.

- Verdict: PARTIAL
- Evidence:
  - `.githooks/pre-push` is a client-side hook. The integration-branch guardrail can be bypassed by setting `GT_INTEGRATION_LAND=1`: "`The gt mq integration land command sets GT_INTEGRATION_LAND=1 to bypass this check.`"
  - `docs/concepts/integration-branches.md:485-495` explicitly states the env var is "policy-based trust boundary, not a capability-based security mechanism" and "Manually setting the env var is possible but is not part of the supported workflow".
  - Three-layer defense table notes (`integration-branches.md:491`): "AI agents can ignore instructions" (Layer 1), "env var is policy-based" (Layer 2).
  - The conflict-resolution task instructions explicitly direct the polecat to run `git push -f` (force push) on the polecat branch (`engineer.go:1473`).
- Notes: No audit-log entry is emitted when `GT_INTEGRATION_LAND` is set or when pre-push is bypassed. Client-side hooks alone cannot prevent workers from silently escaping the queue (e.g., `git push --no-verify`, unconfigured `core.hooksPath`). No evidence of server-side branch protection checks.

### Req 10: Merge event telemetry. Merge events emit structured telemetry linking merge → PR → task → worker → pipeline run. Post-hoc correlation is possible.

- Verdict: MISSING
- Evidence:
  - `internal/events/events.go:67-70` declares event types: `TypeMergeStarted = "merged_started"`, `TypeMerged = "merged"`, `TypeMergeFailed = "merge_failed"`, `TypeMergeSkipped = "merge_skipped"`.
  - Consumers exist: `internal/feed/curator.go:507`, `internal/cmd/audit.go:458`, `internal/cmd/activity.go:136`.
  - `rg` across `internal/` finds no emitter of `events.TypeMerged`, `events.TypeMergeStarted`, `events.TypeMergeFailed`, or `events.TypeMergeSkipped`. The only `events.Log*` call in `internal/refinery/` is `engineer.go:1926`: `events.LogFeed(events.TypeMail, e.rig.Name+"/refinery", events.MailPayload("deacon/", "CONVOY_NEEDS_FEEDING "+mr.ConvoyID))` (mail, not merge).
  - `gt done` emits `events.TypeDone` (`internal/cmd/done.go:1211`) but not merge completion.
  - Notifications on merge are implemented via `gt nudge` free-text strings (e.g., `engineer.go:1267` `nudgeMsg := fmt.Sprintf("MERGED: %s issue=%s branch=%s", mr.ID, mr.SourceIssue, mr.Branch)`) and via the `MERGED` / `MERGE_FAILED` mail-protocol messages in `internal/protocol/messages.go:50-120`, which carry polecat/branch fields.
- Notes: The event-type constants are declared, consumers are wired (feed curator and audit can read them), but I found no call site that writes merge events to the `.events.jsonl` store. Correlation is possible via Beads (MR issue links to source issue, worker, convoy) and mail messages, but not via the structured event log.

### Req 11: Stale-lock recovery. Crash recovery handles stale `.git/index.lock`, orphaned worktrees, and half-applied commits automatically — no manual cleanup required.

- Verdict: MISSING
- Evidence:
  - `rg` on `index\.lock|\.git/index` across `internal/` and `docs/` returns no results (no matches).
  - `internal/lock/lock.go` handles agent identity locks (`<worker>/.runtime/agent.lock`), not git index locks. Stale detection there targets dead PIDs + absent tmux sessions (`lock.go:259 CleanStaleLocks`).
  - Orphan worktree handling: `docs/CLEANUP.md:127` "`gt doctor --fix` | Auto-fixes: orphan sessions, wisp GC, stale redirects, worktree validity"; `internal/polecat/manager.go:1761` "Prune any stale git worktree entries (handles manually deleted directories)"; CHANGELOG mentions "Orphan scan for polecat worktrees with unmerged branches".
  - Half-applied commits / uncommitted work: `gt done` at `internal/cmd/done.go:1240-1247` refuses to sync to main if `ws.HasUncommittedChanges` ("uncommitted changes still present — skipping worktree sync to preserve work"); this is guard, not recovery.
- Notes: Orphan worktree and stale agent-lock recovery exist (`gt doctor --fix`, `gt orphans`, `polecat/manager.go` prune). However, the specific failure mode in the spec — stale `.git/index.lock` from a crashed mid-commit — has no dedicated recovery path in the locations searched.

### Req 12: Trunk integration checkpoint per task. Each task merges independently to trunk; subsequent tasks rebase onto fresh trunk. No multi-task stacks that only integrate at end-of-project.

- Verdict: MEETS
- Evidence:
  - Refinery merges per-MR via squash-merge to `target_branch` (default `main`). `engineer.go` calls `git.MergeSquash(mr.Branch, msg)` and pushes.
  - `gt done` syncs the worktree back to the default branch after submission (`internal/cmd/done.go:1251-1260`): "Syncing worktree to %s... Worktree synced to %s".
  - `internal/polecat/manager.go:948` — new polecat worktrees are created from `startPoint` (default branch HEAD), so each new assignment starts from fresh trunk.
  - `docs/concepts/integration-branches.md` describes integration branches as an opt-in mechanism for epic work; the default behavior is "Each MR lands independently".
- Notes: The per-task model is the default; multi-task stacks only arise when an operator explicitly creates an integration branch for an epic. Polecats that go idle sync to fresh trunk before the next assignment.

### Req 13: Pre-dispatch drift gate. Before dispatching a task, validate that the planned signatures / paths still match trunk. If trunk has drifted, re-plan before dispatching.

- Verdict: MISSING
- Evidence:
  - `rg -n "drift|pre.dispatch|rebase.*stale|stale.worktree|signatures"` across `docs/design/` and `docs/concepts/` returns only unrelated hits: `polecat-lifecycle-patrol.md:655` references Witness state-drift for zombie/orphan checks, not plan drift; `convoy/spec.md` references documentation drift; `crew-specialization-design.md:181` references claim drift.
  - `internal/cmd/sling*.go` and surrounding dispatch code (not fully read) were not found via search to perform any signature/path validation against trunk.
  - Polecat worktrees are created from the current `startPoint` (fresh trunk), which provides physical freshness, but no validation that a pre-planned spec/signatures still match the dispatched-from commit.
- Notes: The framework provides no evidence of a planning-artifact ↔ trunk reconciliation step at dispatch time. Worktree freshness ≠ plan freshness.

## Surprises

- Pre-verification fast path: `gt done --pre-verified` lets polecats run the full gates on their rebased branch and submit a signed claim (`pre_verified_base: <sha>`). Refinery skips gates when the MR's pre-verified base matches the current target HEAD (`engineer.go:607-611`, `1142-1160`). This is an uncommon optimization not captured by any spec requirement.
- Conflict resolution is delegated to a newly-dispatched task, not the authoring polecat: `gt refinery --help` says "If conflict: spawns FRESH polecat to re-implement (original is gone)". The task carries explicit `git rebase + git push -f` instructions, meaning Refinery's recovery loop deliberately requires force-push on polecat branches.
- The pre-push hook fails closed on network errors: `integration_refs=$(git ls-remote ...) || { ... Push to $default_branch blocked. ...; exit 1; }` — offline agents cannot push to default at all during the integration-land window.
- Per-rig Refinery and a global MR bead store: MRs are Beads issues with MR fields (`internal/mq/id.go`, `issueToMRInfo()`), giving durable on-disk queue state outside the Refinery process (`ZFC-compliant: Merge queue is derived from beads merge-request issues.`).
- MergeSlot mutex: `engineer.go acquireMainPushSlot()` serializes default-branch pushes across concurrent Refinery activity ("Acquire merge slot for default branch pushes"), with retry and backoff (`mergeSlotMaxRetries`).
- The `quality-review` step (judgment) is explicitly Phase-1, non-blocking, and off by default, despite Refinery having the scaffolding to gate merges on it.
- Squash merges are the batching strategy, not merge commits: `docs/design/architecture.md` describes "Rebase A..D as a stack" but `BuildRebaseStack()` uses `git merge --squash` (`MergeSquash`) to produce one commit per MR, then fast-forwards. This means the final history has one commit per MR, not per-commit-from-polecat.

## Open Questions for Trial

- What happens when a `polecat/*` branch is force-pushed mid-way through Refinery bisection? The bisection stack is reset-and-rebuilt per probe (`resetAndRebuildStack`), but concurrent force-push during bisection is untested in locations reviewed.
- Does `gt doctor --fix` in fact recover a stuck `.git/index.lock` in a polecat worktree, or only agent-level locks? Not verified from docs alone.
- How does `NeedsApproval` (PR mode) interact with `MaxRetryCount` for per-MR retries? The comments say "no cap" for approval waits but `MaxRetryCount=5` applies to conflicts — behavior mixing the two (conflict resolved → awaiting approval → new conflict) is unclear.
- If an agent sets `core.hooksPath` to an empty value or runs `git push --no-verify`, what server-side protection remains? Not evident from the client-side hook alone.
- What telemetry surface actually receives merge events in practice, given `events.TypeMerged` is declared but seemingly not emitted? Does the audit command render blank on merges?

## Source Index

- `/Users/deuley/code/tools/gastown/docs/design/architecture.md` (lines 30, 44, 55, 78, 122, 137, 195, 200, 208-232)
- `/Users/deuley/code/tools/gastown/docs/concepts/integration-branches.md` (full file)
- `/Users/deuley/code/tools/gastown/docs/design/polecat-lifecycle-patrol.md` (lines 1-120, 655)
- `/Users/deuley/code/tools/gastown/.githooks/pre-push` (full file)
- `/Users/deuley/code/tools/gastown/internal/refinery/types.go` (lines 1-120)
- `/Users/deuley/code/tools/gastown/internal/refinery/batch.go` (lines 1-561)
- `/Users/deuley/code/tools/gastown/internal/refinery/engineer.go` (lines 130-234, 607-865, 904, 1142-1160, 1223-1510, 1866-1926)
- `/Users/deuley/code/tools/gastown/internal/refinery/manager.go` (lines 1-200, 277, 527, 545)
- `/Users/deuley/code/tools/gastown/internal/cmd/done.go` (lines 1-85, 1211, 1219-1280, 1622, 1778)
- `/Users/deuley/code/tools/gastown/internal/formula/formulas/mol-refinery-patrol.formula.toml` (lines 1-200, 420-485)
- `/Users/deuley/code/tools/gastown/internal/events/events.go` (lines 60-130)
- `/Users/deuley/code/tools/gastown/internal/protocol/messages.go` (lines 50-150)
- `/Users/deuley/code/tools/gastown/internal/protocol/types.go` (lines 8-67)
- `/Users/deuley/code/tools/gastown/internal/constants/constants.go` (line 218)
- `/Users/deuley/code/tools/gastown/internal/mq/id.go` (lines 19-36)
- `/Users/deuley/code/tools/gastown/internal/polecat/manager.go` (lines 481-522, 940-980, 1485, 1648, 1761, 1867)
- `/Users/deuley/code/tools/gastown/internal/lock/lock.go` (lines 1-100, 250-420)
- `/Users/deuley/code/tools/gastown/docs/CLEANUP.md` (lines 28, 59, 127, 150-167)
- `/Users/deuley/code/tools/gastown/docs/otel-data-model.md` (line 33)
- CLI: `gt --help`, `gt done --help`, `gt refinery --help`, `gt mq --help`

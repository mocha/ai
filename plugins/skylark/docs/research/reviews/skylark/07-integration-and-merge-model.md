# Skylark — Integration and Merge Model Conformance Evaluation

## Summary

- Conformance at a glance: 0 MEETS, 4 PARTIAL, 9 MISSING, 0 N/A (out of 13)
- Headline: Skylark is a plugin that delegates nearly all merge-queue, CI-gating, branch-protection, and crash-recovery concerns to the host harness and remote repo; its own contribution is a branch-per-task worktree discipline and a local-merge-plus-test-suite cadence that the ENG-180 retrospective shows was violated in practice by a merge-at-end pattern.

## Per-Requirement Findings

### Req 1: No direct pushes to trunk. All worker changes route through a merge queue or PR flow. Branch protection is enforced at the remote.

- Verdict: PARTIAL
- Evidence:
  - `skills/finish/SKILL.md:71-80` presents four options: "1. Merge back to <base-branch> locally / 2. Push and create a Pull Request / 3. Keep the branch as-is / 4. Discard this work." Option 1 is a direct local merge to the base branch, and `skills/finish/SKILL.md:87-101` then runs `git checkout <base-branch>` and `git merge <feature-branch>` with no PR.
  - `skills/implement/SKILL.md:131` similarly merges task branches directly after each task: `git merge <task-branch>`.
  - `skills/dispatch-with-mux/SKILL.md:318` also merges with `git merge task/TASK-NNN-slug --no-ff` locally.
  - No mention of branch protection, merge queue, or required PR flow anywhere in `skills/`.
- Notes: Skylark explicitly offers both PR and direct-local-merge paths as equivalent. It does not route "all worker changes" through a merge queue or PR. Branch protection, if enforced, is the host repo's responsibility and is not referenced by Skylark.

### Req 2: Merge-queue CI runs on merged state. CI runs on the combination of trunk + candidate PR(s), not on the PR branch in isolation.

- Verdict: PARTIAL
- Evidence:
  - `skills/implement/SKILL.md:129-133`: "After each task merge, verify previous work isn't broken: `git merge <task-branch>` / `pnpm test  # full suite, not just task's tests`."
  - `skills/finish/SKILL.md:96-97`: after `git merge`, "Verify tests on merged result: pnpm test".
  - `skills/dispatch-with-mux/SKILL.md:321-328`: "After each merge, run the full test suite. Not just the task's tests — the full suite catches integration issues between independently-developed tasks."
- Notes: Skylark specifies running tests locally on the merged result, which is conceptually analogous to CI-on-merged-state, but it is not a merge queue, is not gating, and only applies to the local merging machine. No evidence of CI coordination on candidate-plus-trunk state. The ENG-180 retrospective confirms "never exercised against production traffic, never reviewed by another engineer mid-flight, and never integration-tested end-to-end outside CI until the PR opened" (`docs/research/2026-04-15-eng-180-retrospective.md:21-25`).

### Req 3: Bisecting batches. If a batch fails, the queue bisects to isolate the failing change; good changes in the batch still merge.

- Verdict: MISSING
- Evidence: No evidence found in `skills/`, `CLAUDE.md`, or the retrospective. No `.github/` workflows exist in the repo. The dispatch-with-mux failure path is: "STOP the wave. Present the failure... Options: investigate and fix, revert last merge, stop execution" (`skills/dispatch-with-mux/SKILL.md:335-337`) — manual triage, no bisecting.

### Req 4: Automated conflict recovery path. Conflicts trigger a defined recovery (rebase + retry by the authoring worker, escalate to human, or discard) rather than silent overwrite.

- Verdict: PARTIAL
- Evidence:
  - `skills/dispatch-with-mux/SKILL.md:330-333`: "If merge conflict: STOP the wave. Present the conflict to the user: Show which tasks conflict and the conflicting files / Options: resolve manually, rebase and retry, stop execution / Do not attempt automatic conflict resolution."
- Notes: Defined escalate-to-human path exists, but no rebase-and-retry automation by the authoring worker. `skills/finish/SKILL.md` and `skills/develop/SKILL.md` do not address merge conflicts.

### Req 5: CI reaction loop. A failed CI run returns actionable diagnostics to the authoring worker, which can attempt a fix without human intervention up to a bounded retry limit.

- Verdict: MISSING
- Evidence: No CI integration is described anywhere in `skills/`. Skylark has a review reaction loop (`skills/develop/SKILL.md:304-317`: "Revise (round < 2) → Fix and re-review... Revise (round 2) or Rethink → Escalate"), but this operates on panel reviewer verdicts, not CI output. No mechanism to consume CI failure signal and dispatch a fix.

### Req 6: Integration tests are a merge gate. Integration tests run before merge, not as a post-merge observation. Required for elevated+ risk changes.

- Verdict: PARTIAL
- Evidence:
  - `skills/finish/SKILL.md:27-47`: "Before anything else, verify tests pass: pnpm test... If tests fail... Cannot proceed with merge/PR until tests pass."
  - However, the retrospective documents the opposite in practice: "55 integration tests gate on `DATABASE_URL_ADMIN` and only ran on CI. Locally, every wave merged without exercising real DB paths" (`docs/research/2026-04-15-eng-180-retrospective.md:37-40`).
  - The retro's suggestion 7 proposes this as a *future* change: "Make the DONE contract require a local integration-test run. `pnpm docker:up && export DATABASE_URL_ADMIN=... && pnpm test` as the last step before a worker returns DONE. Especially for elevated+ risk work." (`docs/research/2026-04-15-eng-180-retrospective.md:135-138`) — indicating it is not yet encoded.
- Notes: A generic `pnpm test` gate exists; a genuine integration-test gate for elevated+ risk does not.

### Req 7: Branch-per-task. Each worker's output maps to exactly one branch and one PR. No shared branches between workers.

- Verdict: PARTIAL
- Evidence:
  - `skills/develop/SKILL.md:68-78`: "Create an isolated worktree for this task: `git worktree add <worktree-path> -b <task-branch-name>`. Branch naming: `task/<task-id>-<slug>`."
  - `skills/develop/SKILL.md:345`: red-flag list includes "Dispatch multiple implementation subagents in parallel (conflicts)."
- Notes: One branch per task is well-enforced. "One PR" is not — `finish` explicitly offers a local-merge option without any PR, and `implement` merges task branches locally between tasks. The ENG-180 reality was 53 commits landing as a single PR rather than one PR per task (`docs/research/2026-04-15-eng-180-retrospective.md:11-14`).

### Req 8: Pre-merge review required for elevated+. AI (or human) review happens before merge for elevated and critical risk changes.

- Verdict: MEETS
- Evidence:
  - `skills/develop/SKILL.md:278-286`: "Panel Review (Code Quality). Only after spec compliance passes. Invoke `/skylark:panel-review` with: Panel size and model per `_shared/risk-matrix.md`: Standard: Sonnet, 2-3 experts, 1 round / Elevated: Sonnet, 3-4 experts, 1 round / Critical: Opus, 3-4 experts, 2 rounds".
  - `skills/develop/SKILL.md:296`: "Ship → Task complete... Return to implement for merge and next task" — review precedes merge.
  - `skills/implement/SKILL.md:186-187` risk matrix confirms panel gates at elevated and critical.
- Notes: Classified MEETS despite the caveat that this is AI-only pre-merge review and the "merge" is a local merge rather than a trunk merge through a queue.

### Req 9: Branch protection cannot be bypassed. `--force`, admin override, and config-level bypass are blocked or audited. Workers cannot silently escape the queue.

- Verdict: MISSING
- Evidence: No references to `--force`, force-push prohibitions, branch protection, admin overrides, or audit mechanisms in any skill. `skills/finish/SKILL.md:285` says "Force-push without explicit user request" is a red flag ("Never: ... Force-push without explicit user request"), which is a guideline, not an enforcement. No queue exists to escape.

### Req 10: Merge event telemetry. Merge events emit structured telemetry linking merge → PR → task → worker → pipeline run. Post-hoc correlation is possible.

- Verdict: PARTIAL
- Evidence:
  - `skills/develop/SKILL.md:298-301`: "Append changelog entry to the task: `- **YYYY-MM-DD HH:MM** — [DEVELOP] Task complete. Tests pass. Branch: task/TASK-NNN-slug.`"
  - `skills/finish/SKILL.md:161-164`: "`- **YYYY-MM-DD HH:MM** — [FINISH] Complete. [Merged locally | PR: #NNN | Kept: branch-name | Discarded].`"
  - `skills/linear/SKILL.md:22`: "At every pipeline event, post a comment on the associated Linear issue using `mcp__claude_ai_Linear__save_comment`."
- Notes: Artifact changelogs and Linear comments provide a human-readable audit trail linking task → branch → PR-or-local-merge, but there is no structured telemetry event emission (OTEL, JSON events, queryable log). Correlation is by convention, not by schema.

### Req 11: Stale-lock recovery. Crash recovery handles stale `.git/index.lock`, orphaned worktrees, and half-applied commits automatically — no manual cleanup required.

- Verdict: MISSING
- Evidence: No references to `.git/index.lock`, stale-lock recovery, or orphaned-worktree cleanup automation in `skills/` or the retrospective. `skills/finish/SKILL.md:216-227` describes manual worktree removal via `git worktree remove <worktree-path>` but offers no crash-recovery path.

### Req 12: Trunk integration checkpoint per task. Each task merges independently to trunk; subsequent tasks rebase onto fresh trunk. No multi-task stacks that only integrate at end-of-project.

- Verdict: PARTIAL
- Evidence:
  - Prescribed: `skills/implement/SKILL.md:126-133`: "One worktree per task, merged as each completes... After each task merge, verify previous work isn't broken: `git merge <task-branch>` / `pnpm test`."
  - Observed failure in practice: "53 commits landed as one stack that was never exercised against production traffic... The single largest risk of the entire project" (`docs/research/2026-04-15-eng-180-retrospective.md:19-25`). "Both were avoidable if the tasks had merged sequentially onto a shared `main` and been exercised before the next task started" (`docs/research/2026-04-15-eng-180-retrospective.md:52-54`).
  - Remediation is in the retrospective's suggestions, not yet in the skills: "Treat 'merges to main' as the integration checkpoint, not 'all tasks complete.'" (`docs/research/2026-04-15-eng-180-retrospective.md:106-111`).
- Notes: The sequential merge-as-each-completes cadence is specified, but the retrospective documents it was not followed for ENG-180, and no enforcement mechanism prevents merge-at-end stacks.

### Req 13: Pre-dispatch drift gate. Before dispatching a task, validate that the planned signatures / paths still match trunk. If trunk has drifted, re-plan before dispatching.

- Verdict: MISSING
- Evidence:
  - No drift validation exists in `skills/develop/SKILL.md`, `skills/implement/SKILL.md`, or `skills/dispatch-with-mux/SKILL.md`.
  - The retrospective documents exactly the failure mode and proposes the fix as future work: "The plan said `buildServer({ verifyToken })`; the real API was `buildServer({ auth: { verifyToken } })`... These are signals that the plan was not validated against current code before being handed to workers" (`docs/research/2026-04-15-eng-180-retrospective.md:56-64`). Suggestion 6: "Pre-validate plan signatures against real code before dispatching. A single grep at dispatch time..." (`docs/research/2026-04-15-eng-180-retrospective.md:130-134`) — not yet in the skills.

## Surprises

- Skylark treats local merge (Option 1 in `finish`) as a first-class equivalent to "Push and create a Pull Request" (Option 2). The framework is ambivalent about whether the trunk is the local main or the remote main, and makes no distinction between a single-developer local merge and a multi-agent trunk.
- The pipeline's "merge gate" semantics live at the review layer (panel review with Ship/Revise/Rethink verdicts) rather than at the VCS layer. There is no VCS-level gate at all.
- There is a `dispatch-with-mux` skill that enables parallel task execution but still requires sequential merges of completed branches into the orchestrator's working tree (`skills/dispatch-with-mux/SKILL.md:310-328`). This is a per-task checkpoint conceptually but is not a merge queue and has no bisecting behavior.
- The ENG-180 retrospective functions as the strongest source of evidence that prescribed behavior (merge-as-each-completes, local test gating) is not enforced; six of its ten suggestions map directly to requirements in this spec that Skylark does not yet encode.
- Skylark has no `.github/` workflows in its own repo; all CI expectations are projected onto the *consuming* project.

## Open Questions for Trial

- When a consuming project has GitHub merge queues configured, does Skylark's `finish` Option 2 (Push and create a PR) interact with the queue cleanly, or does the local-merge-then-push pattern bypass it?
- Does the `implement` step-2 per-task merge cadence actually execute in a realistic multi-task run, or does the orchestrator accumulate merges like ENG-180 did? A trial with ≥5 tasks at elevated risk would clarify.
- What happens if a worker subagent crashes mid-commit inside a worktree? Does `implement` detect the orphaned worktree on resumption, or does the user need to `git worktree prune` manually?
- How does the pipeline behave if the base branch advances between triage and dispatch (e.g., an unrelated PR merges during a long panel-review round)? No rebase-or-re-plan step is specified.

## Source Index

- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/07-integration-and-merge-model.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/evaluation-prompts.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/finish/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/develop/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/implement/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/dispatch-with-mux/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/linear/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/risk-matrix.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/artifact-conventions.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/CLAUDE.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/2026-04-15-eng-180-retrospective.md`
- Directory checks: `/Users/deuley/code/mocha/ai/plugins/skylark/.github/` (does not exist)
- Grep sweeps across `skills/` for: merge queue, bisect, branch protection, force-push, CI, index.lock, stale-lock, pre-dispatch, drift, trunk, rebase

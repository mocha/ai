# Triad — Integration and Merge Model Conformance Evaluation

## Summary

- Conformance at a glance: 0 MEETS, 4 PARTIAL, 9 MISSING, 0 N/A (out of 13)
- Headline: Triad delegates nearly all integration concerns to the host project's git/CI conventions; it defines branch-per-task worktrees and EM-side PR validation against task acceptance criteria, but specifies no merge queue, no bisecting, no CI reaction loop, no stale-lock recovery, no telemetry, no drift gate, and no branch-protection enforcement.

## Per-Requirement Findings

### Req 1: No direct pushes to trunk. All worker changes route through a merge queue or PR flow. Branch protection is enforced at the remote.

- Verdict: PARTIAL
- Evidence:
  - `agents/engineering-manager/.claude/worker-context.md:37-40`: "Commit to your branch, NEVER to main".
  - `agents/engineering-manager/CLAUDE.md:120`: "Create a worktree from main inside the project: `git worktree add .worktrees/<task-id> -b <branch>`. All worktrees live under `<project>/.worktrees/` to keep the parent directory clean."
  - `docs/specs/2026-03-22-three-agent-system-design.md:258`: "**Engineering agent** works on feature branches (`feat/T005-whatever`), not main".
  - Counter: `docs/specs/2026-03-22-three-agent-system-design.md:259`: "**PM agent** commits decision doc answers directly to `main` (small, isolated files in `_decisions/`)".
  - `docs/specs/2026-03-23-agent-triad-protocol-design.md:453`: "Dev executes, produces PR, writes completion summary".
- Notes: Worker-level convention prohibits commits to main, but there is no enforced branch protection at the remote, no merge queue, and the PM agent explicitly bypasses to commit to main. PR flow is mentioned ("produces PR") but not formally specified.

### Req 2: Merge-queue CI runs on merged state. CI runs on the combination of trunk + candidate PR(s), not on the PR branch in isolation.

- Verdict: MISSING
- Evidence: No mention of a merge queue, Bors, GitHub merge queue, or merged-state CI in any file under `triad-source/`. Grep for `merge queue|bors|merged state` returned no matches in specs, operations, EM CLAUDE.md, worker-context.md, or task-completion.md.
- Notes: No evidence found in any searched location.

### Req 3: Bisecting batches. If a batch fails, the queue bisects to isolate the failing change; good changes in the batch still merge.

- Verdict: MISSING
- Evidence: No queue, so no bisecting. No references to batching or bisection logic anywhere in `triad-source/`.
- Notes: No evidence found.

### Req 4: Automated conflict recovery path. Conflicts trigger a defined recovery (rebase + retry by the authoring worker, escalate to human, or discard) rather than silent overwrite.

- Verdict: PARTIAL
- Evidence:
  - `docs/specs/2026-03-22-three-agent-system-design.md:262`: "If a conflict does occur, the engineering agent resolves it (it has the fuller code context)".
  - `docs/specs/2026-03-22-three-agent-system-design.md:272`: "**Requires Patrick**: approval of one-way-door decisions, task prioritization, resolving merge conflicts, restarting after crashes".
- Notes: Two contradictory statements — one says the EM resolves conflicts, the other escalates them to the human. No automated retry path; no worker-level rebase protocol defined.

### Req 5: CI reaction loop. A failed CI run returns actionable diagnostics to the authoring worker, which can attempt a fix without human intervention up to a bounded retry limit.

- Verdict: MISSING
- Evidence: No CI integration is specified. `agents/engineering-manager/CLAUDE.md:141-171` describes EM-driven validation (re-run verification commands, dispatch review, send the worker back with feedback) but this is triggered when the worker reports back, not by CI signals.
- Notes: A review-loop retry exists at the EM level ("If any fail, send the worker back with specific feedback") but it is not tied to CI output.

### Req 6: Integration tests are a merge gate. Integration tests run before merge, not as a post-merge observation. Required for elevated+ risk changes.

- Verdict: PARTIAL
- Evidence:
  - `agents/engineering-manager/.claude/rules/task-completion.md:51-62` defines a "Full-Stack Validation (required before project-complete)" step: "Stand up the application with fixture/example data and verify it actually works … Verify every route returns 200 (not just the status code — check for error pages) … Walk through each End-to-End Validation Flow from the project file … If any flow fails: fix the issue, commit, re-validate. Do NOT send project-complete with broken flows."
- Notes: This gate is at project-complete time (end of project), not per-PR, and runs locally under the EM rather than as a pre-merge CI gate. No distinction by risk level.

### Req 7: Branch-per-task. Each worker's output maps to exactly one branch and one PR. No shared branches between workers.

- Verdict: PARTIAL
- Evidence:
  - `agents/engineering-manager/CLAUDE.md:120`: "`git worktree add .worktrees/<task-id> -b <branch>`".
  - `agents/engineering-manager/.claude/skills/assign-task/SKILL.md:68-72`: "`cd $PROJECT_PATH && git worktree add .worktrees/T-<id> -b task/T-<id>`".
  - `agents/engineering-manager/.claude/worker-dispatch-template.md` example: `BRANCH_NAME | w1/oauth-routes`.
- Notes: Branch-per-task is clearly specified. PR-per-branch is only implied by "produces PR" in the protocol spec; there is no evidence of a framework step that actually opens the PR, and three different branch-naming conventions coexist across EM docs (`<branch>`, `task/T-<id>`, `w1/oauth-routes`).

### Req 8: Pre-merge review required for elevated+. AI (or human) review happens before merge for elevated and critical risk changes.

- Verdict: MISSING
- Evidence: Triad has no risk-tier concept. `agents/engineering-manager/CLAUDE.md:153-163` requires review steps — "Dispatch spec compliance review" and "Dispatch code quality review" — but keys them on "First instance of a new pattern" vs "Repetition of an established pattern", not on a risk level, and not specifically as a pre-merge gate on a PR. No "elevated/critical" classification exists anywhere in `triad-source/`.
- Notes: Review exists; risk-tier pre-merge gating does not.

### Req 9: Branch protection cannot be bypassed. `--force`, admin override, and config-level bypass are blocked or audited.

- Verdict: MISSING
- Evidence: No mention of `--force`, `--force-with-lease`, `push --force`, admin override, or audit logging anywhere in `triad-source/`. Branch protection itself is not specified as a framework concern.
- Notes: No evidence found.

### Req 10: Merge event telemetry. Merge events emit structured telemetry linking merge → PR → task → worker → pipeline run.

- Verdict: PARTIAL
- Evidence:
  - `agents/engineering-manager/.claude/rules/task-completion.md:20-28`: completion updates the task file with `status: done`, `disposition`, `completed`, `actual_tokens`, `actual_duration_minutes`, and a Completion Summary.
  - `agents/engineering-manager/.claude/rules/task-completion.md:64-81` defines an aggregate cost table in the `project-complete` message linking tasks to tokens/duration/model.
  - `scripts/init-project.sh:70-74`: "All messages (both unread and read) are tracked as part of the decision record".
- Notes: Task-file frontmatter and git-tracked inbox messages provide a correlation trail from task → worker → completion, but no merge-event emission, no PR ID captured, and no structured telemetry schema. Correlation is by manual reading of markdown, not structured events.

### Req 11: Stale-lock recovery. Crash recovery handles stale `.git/index.lock`, orphaned worktrees, and half-applied commits automatically — no manual cleanup required.

- Verdict: MISSING
- Evidence: No mention of `.git/index.lock`, `index.lock`, orphaned worktrees, or half-applied commit recovery anywhere in `triad-source/`. `skills/kick/SKILL.md` and `skills/resume/SKILL.md` handle agent-session restart and inbox-watcher restart, not git-lock recovery.
- Notes: `docs/specs/2026-03-22-three-agent-system-design.md:272` places crash recovery on the human ("**Requires Patrick**: … restarting after crashes").

### Req 12: Trunk integration checkpoint per task. Each task merges independently to trunk; subsequent tasks rebase onto fresh trunk.

- Verdict: PARTIAL
- Evidence:
  - `agents/engineering-manager/.claude/skills/assign-task/SKILL.md:24-31` pre-flight: "Worktrees fork from `origin/main`. Pull first to check for updates, then push local work. … `git pull origin main` … `git push origin main` … If push fails, warn the user and stop — agents will work from stale state."
  - EM CLAUDE.md dispatches tasks respecting `depends_on` and validates each before moving on (`agents/engineering-manager/CLAUDE.md:99-100`, lifecycle at 141-187).
- Evidence against: The integration-level validation (`rules/task-completion.md` §7a Full-Stack Validation) happens at project-complete time, implying tasks are validated individually but are integration-tested only at project end. No explicit "merge each task to main, then rebase next" step appears; task branches remain under `.worktrees/` with no framework-level merge-to-main action.
- Notes: Pre-dispatch pull from trunk happens; task-by-task merge to trunk is not specified.

### Req 13: Pre-dispatch drift gate. Before dispatching a task, validate that the planned signatures / paths still match trunk. If trunk has drifted, re-plan before dispatching.

- Verdict: MISSING
- Evidence: `assign-task/SKILL.md:24-31` pulls latest from origin/main but performs no validation that planned scope/signatures still match trunk. No grep hits for "drift", "signature", or planned-vs-actual checks across `triad-source/`.
- Notes: No evidence found.

## Surprises

- The PM agent is explicitly allowed to commit to `main` directly (`docs/specs/2026-03-22-three-agent-system-design.md:259`), creating a documented bypass of the branch-per-task convention for decision-doc writes.
- Contradiction on conflict ownership: one spec says the engineering agent resolves conflicts (ibid:262), another says merge-conflict resolution requires the human (ibid:272).
- Triad has no named CI component. The only pre-merge-like gate is the EM's local "Full-Stack Validation" ritual run before sending `project-complete`, not before merge of any single PR.
- Three inconsistent branch/worktree naming conventions coexist: `.worktrees/<task-id>` with `<branch>` (EM CLAUDE.md:120), `.worktrees/T-<id>` with `task/T-<id>` (assign-task SKILL.md:68-72), and `.worktrees/w1-oauth-routes` with `w1/oauth-routes` (worker-dispatch-template.md example).
- The README's retrospective (`README.md:60-73`) identifies inbox brittleness and state drift as retirement reasons; integration/merge correctness is not listed as a failure mode — consistent with the finding that Triad simply does not own this domain.
- Inbox messages are git-tracked as a decision record (`scripts/init-project.sh:70-74`), providing a durable audit trail adjacent to — but not a substitute for — merge telemetry.

## Open Questions for Trial

- When two workers touch overlapping files in parallel worktrees, does the second `git push` fail at the remote, and is there any automated recovery, or does it silently overwrite? (No queue exists to serialize.)
- Does "produces PR" in `specs/2026-03-23-...:453` mean a real GitHub PR, a local branch, or anything actually opened at the remote? Nothing in the source implements PR creation.
- If an agent crashes mid-commit leaving `.git/index.lock`, do `/triad:kick` or `/triad:resume` detect and clean it? (Source does not mention the file.)
- How is the task-completion "commit landed on the correct worktree branch" check meant to run post-hoc, given no telemetry is emitted and the worktree may have been reaped?

## Source Index

Files read:
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/07-integration-and-merge-model.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/evaluation-prompts.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/README.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/scripts/init-project.sh`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/templates/task.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/CLAUDE.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/worker-context.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/worker-dispatch-template.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/rules/task-completion.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/skills/assign-task/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/skills/validate-project/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/docs/specs/2026-03-22-three-agent-system-design.md` (excerpts)
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/docs/specs/2026-03-23-agent-triad-protocol-design.md` (excerpts)
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/docs/operations/onboarding.md` (excerpts)
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/docs/operations/session-startup.md` (excerpts)

Searches performed (via Grep): `merge|PR|pull request|CI|branch protection|conflict|rebase|.git/index.lock|force push|trunk|integration test|drift|bors` across all of `triad-source/`; narrower searches across `docs/specs/` and `docs/operations/`.

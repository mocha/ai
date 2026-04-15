# Triad — Task Decomposition and Sizing Conformance Evaluation

## Summary

- Conformance at a glance: 6 MEETS, 5 PARTIAL, 3 MISSING, 0 N/A (out of 14)
- Headline: Triad's entire pipeline is a deliberate three-layer decomposition cascade (Proposal → Project → Task) with explicit owners, review gates, and single-context-window task sizing — but it leaves quantitative sizing limits (LOC caps, context %, compaction thresholds) and pre-dispatch plan re-validation to role judgment rather than enforced mechanics.

## Per-Requirement Findings

### Req 1: Single-session fit. Every leaf task is sized to fit one worker session ≤60% context utilization, including its outputs and tool calls.

- Verdict: PARTIAL
- Evidence: `agents/engineering-manager/CLAUDE.md:97` states: "**Completable in a single context window.** If a task requires the worker to hold more context than fits, split it." `agents/engineering-manager/.claude/skills/propose-tasks/SKILL.md:62` under "Task Quality Gates": "**Single context window scope.** If it requires the worker to hold more context than fits, split it." `agents/program-manager/.claude/skills/review-tasks/SKILL.md:70-75` lists sizing red flags: "Task touches more than 3-4 directories", "Task has more than 5 acceptance criteria", "Task description implies multiple distinct units of work", "Task requires holding extensive cross-file context simultaneously." The EM CLAUDE.md also enforces a 30-minute wall-clock timeout (`CLAUDE.md:130-136`): "Normal tasks complete in 7-15 minutes. 30 minutes is 2x the p95. Anything beyond that is a signal the task is scoped wrong."
- Notes: The single-context-window rule is explicit and repeated, but no numeric 60% utilization target is specified. Sizing is behavioral/heuristic (directory count, criterion count, wall-clock time), not a measured context budget.

### Req 2: ~500 LOC PR cap. Artifact boundaries (PRs) cap at roughly 500 lines of code. If a "slice" produces more, the slice was wrong and is re-decomposed.

- Verdict: MISSING
- Evidence: No LOC cap found. Searched `agents/`, `templates/`, `docs/specs/`. The sizing heuristics in `review-tasks/SKILL.md:70-75` count directories and criteria, not lines. Worker context (`.claude/worker-context.md`) and task template (`templates/task.md`) do not mention LOC.
- Notes: Re-decomposition on oversize exists as a concept ("the task is scoped wrong — it's too big… decompose it further or provide more context", `engineering-manager/CLAUDE.md:136-137`) but is triggered by wall-clock time, not PR size.

### Req 3: DAG decomposition. Decomposition produces a DAG with explicit dependencies, not a flat list. Each node declares what it blocks and what blocks it.

- Verdict: MEETS
- Evidence: `templates/task.md:11-12`:
  ```
  depends_on: []               # List of task IDs that must complete before this one starts
  blocks: []                   # List of task IDs that are waiting on this one
  ```
  Identical fields on `templates/project.md:10-11`. `engineering-manager/CLAUDE.md:100-101`: "**Dependencies are declared.** `depends_on` lists task IDs that must be `done` before this task can start. `blocks` lists task IDs waiting on this task." `propose-tasks/SKILL.md:27` directs the EM to "Identify dependencies and sequencing between the units of work. Map out which pieces must be completed before others can start."
- Notes: Bidirectional edges (`depends_on` + `blocks`) are recorded at both project and task layers.

### Req 4: Self-contained DONE contract. Every task has an explicit completion contract — what must be true, including integration-test evidence where applicable. No "I think it's done" signals.

- Verdict: MEETS
- Evidence: `templates/task.md:17`: `acceptance_criteria: []  # Concrete, verifiable conditions that define "done"`. `engineering-manager/CLAUDE.md:98`: "**Acceptance criteria are concrete and runnable.** Every criterion has a command to execute or an observable outcome to verify. If you cannot write a runnable test for a criterion, the task is not ready." Example in protocol spec `docs/specs/2026-03-23-agent-triad-protocol-design.md:217-221`:
  ```
  acceptance_criteria:
    - "`pnpm test -- --grep 'quickbooks oauth'` — all passing"
    - "POST /api/v1/integrations/quickbooks/connect returns redirect URL"
    - "GET /api/v1/integrations/quickbooks/callback stores tokens"
    - "Tokens encrypted at rest in integrations table"
  ```
  Workers report discrete statuses (`worker-context.md:47`): `DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`. EM validation runs "every verification command in the task's acceptance criteria. All must pass" (`engineering-manager/CLAUDE.md:164`). Integration evidence is mandated at project completion via End-to-End Validation Flows (`templates/project.md:34-48`) and the full-stack validation checklist (`.claude/rules/task-completion.md:51-61`).
- Notes: Contract is explicit and verified by re-running commands; worker statuses forbid ambiguous "I think it's done."

### Req 5: Pre-dispatch plan validation. A task's signatures, file paths, and external assumptions are grep-checked against current code *before* the task is dispatched to a worker. Drift blocks dispatch.

- Verdict: MISSING
- Evidence: No pre-dispatch grep/re-validation step found. `engineering-manager/CLAUDE.md:116-128` describes dispatch: create worktree, copy worker-context, fill dispatch template, dispatch. `propose-tasks/SKILL.md` runs once to create tasks; there is no re-check right before dispatch. The worker-context instructs the worker to "Read the pattern files listed in your dispatch prompt" (`worker-context.md:15`), shifting discovery into the worker.
- Notes: "Read architecture references and relevant source code to evaluate feasibility" (`engineering-manager/CLAUDE.md:109`) happens at task creation, not dispatch. No mechanism exists to detect if code drifted between task proposal and dispatch.

### Req 6: PR boundary = wave boundary. Tasks merge individually. There is no "multi-task wave" that merges as a single PR. The integration checkpoint is each merge to main.

- Verdict: PARTIAL
- Evidence: Each task runs in its own worktree and branch (`engineering-manager/CLAUDE.md:120`): "Create a worktree from main inside the project: `git worktree add .worktrees/<task-id> -b <branch>`". Workers commit to their branch only (`worker-context.md:37`): "Commit to your branch, NEVER to main." No explicit requirement about PR merge granularity was found. Full-stack validation in `.claude/rules/task-completion.md:51-61` happens at project-complete, not per-task merge. There is no step titled "merge" or "open PR" in the EM workflow; the EM validates tasks in place and moves files to `docs/tasks/_completed/`.
- Notes: Branch-per-task is enforced, aligning structurally with per-task PRs, but the actual merge/PR cadence and integration-checkpoint semantics are not specified. The EM "validates" project completion without a documented per-task merge-to-main protocol.

### Req 7: Compaction as decomposition trigger. Exceeding 2 compactions in a plan's execution is a pipeline-level signal to pause and decompose further, not to continue.

- Verdict: MISSING
- Evidence: No references to "compaction" in any triad-source file. The only similar signal is the 30-minute wall-clock timeout (`engineering-manager/CLAUDE.md:130-137`) which decides "(a) kill the worker, split the task into smaller pieces, and re-dispatch, (b) kill and re-scope with a smaller target… or (c) let it continue."
- Notes: Wall-clock duration is the Triad proxy for context exhaustion, not compaction count.

### Req 8: Iterative planning. Decomposition happens in phases: coarse plan → refined plan → task specs. Re-planning gates are explicit so new information can restructure the DAG without silent drift.

- Verdict: MEETS
- Evidence: The pipeline is a three-stage coarse-to-fine decomposition with explicit negotiation gates. `docs/specs/2026-03-23-agent-triad-protocol-design.md:30-42`:
  ```
  Product Manager — the "why" and "what"
    ↓ proposals
  Program Manager — the "when" and "in what order"
    ↓ projects + tasks
  Engineering Manager — the "how" and "who does it"
  ```
  Two negotiation boundaries have explicit revision cycles (protocol spec §6.2 PM↔PgM, §6.3 PgM↔EM), each capped at "Max 2 revision cycles" before escalation. Revised plans flow through `project-plan-revised` and `tasks-revised` messages. Mid-flight ad hoc tasks are permitted (`engineering-manager/CLAUDE.md:189-196`): "Create the task file in `docs/tasks/` following the standard template… No approval gate — ad hoc tasks enter the queue immediately."
- Notes: Three decomposition layers with explicit gates; the artifact cascade is literally the coarse→fine refinement.

### Req 9: Status rollup. Parent work items track children and roll up completion / blocker status without manual bookkeeping.

- Verdict: PARTIAL
- Evidence: Bidirectional references link parent-child: task frontmatter (`templates/task.md:7`) has `project: PRJ-000`, project frontmatter (`templates/project.md:7`) has `proposal: PMD-000`. The `validate-project` skill (`engineering-manager/.claude/skills/validate-project/SKILL.md:16-20`) enumerates tasks by scanning "task files in both `docs/tasks/` and `docs/tasks/_completed/` that have `project: PRJ-NNN` in their frontmatter." Active-queue cleanliness is enforced by moving done tasks: `engineering-manager/CLAUDE.md:178-180`: "Move the task file from `docs/tasks/` to `docs/tasks/_completed/`. This keeps the active queue clean — `docs/tasks/` shows only in-flight work." Project status transitions are defined (`protocol-design.md:497-502`).
- Notes: Rollup is computed on demand (the EM/PgM scan directories) rather than auto-aggregated. No dashboard or status-rollup file is emitted automatically; bookkeeping is partially manual via file moves and status field edits. No automatic blocker propagation from a blocked task up to its project beyond an escalation message.

### Req 10: Risk-dictated gate shape. A task's risk level determines its gate (trivial → no panel; elevated → panel; critical → panel + human). Sizing and review cost scale together.

- Verdict: PARTIAL
- Evidence: No risk-tier taxonomy is defined. However, review-level is pattern-novelty-dictated: `engineering-manager/CLAUDE.md:154-162` / `.claude/rules/task-completion.md:13-22`:
  ```
  **First instance of a new pattern** (first schema, first route, first middleware, first test pattern):
  - Dispatch spec compliance review
  - Dispatch code quality review
  - Fix any issues found, re-review until clean

  **Repetition of established pattern:**
  - Dispatch spec compliance review
  - Spot-check implementation (read key files, verify patterns followed)
  ```
  Two-way vs one-way door distinction (`engineering-manager/CLAUDE.md:226-230`): "One-way doors (flag for PgM review): Database migrations, public API changes, new external dependencies, deletion of existing functionality, auth/authorization changes." These flag escalation to PgM.
- Notes: There are graded gates (novel pattern → double review; one-way doors → PgM review; escalation → human), but no explicit trivial/elevated/critical taxonomy and no mapping of risk to panel composition. Risk tiers hinted at in the prompt ("risk tiers, sizing rules") were not found — `docs/specs/` contains only the three-agent design and protocol design documents.

### Req 11: Triage funnel. Raw ideas and problems enter a triage/intake stage before becoming tasks. No direct "implement this" on unclassified input.

- Verdict: MEETS
- Evidence: The PM is the intake layer. `templates/proposal.md:12-14`:
  ```
  customer_need: ""        # One-sentence statement of the customer problem or opportunity
  personas: []             # List of user personas this proposal targets
  success_criteria: []     # Measurable outcomes that define success
  ```
  Proposals go through `status: draft | review | approved` before the PgM creates projects (`protocol-design.md:386-414`). The PgM CLAUDE.md (`agents/program-manager/CLAUDE.md:121-131`) mandates reading the proposal thoroughly before decomposing. The EM is prohibited from fabricating work: `engineering-manager/CLAUDE.md:266-267`: "Do not create project files. The PgM owns projects." The EM only acts on `project-ready` messages from PgM.
- Notes: The triage funnel is literally the PM → PgM → EM cascade. No "implement this" path bypasses proposal → project → task.

### Req 12: Coarse-to-fine decomposition cap. Maximum decomposition depth (e.g., project → epic → task → subtask) is bounded; deeper nesting is a sign of unclear scope.

- Verdict: MEETS
- Evidence: Depth is bounded at exactly three layers — Proposal, Project, Task — with no fourth level. `protocol-design.md:86-88`: "Three canonical artifact types flow through the system." The directory structure (`protocol-design.md:249-265`) shows a flat `docs/tasks/` with no subtask directory. `templates/task.md` has no "subtasks" or "parent_task" field; `task.md:8` only points upward to `project: PRJ-000`.
- Notes: No mechanism exists for recursive subtask decomposition. Depth cap is enforced by schema.

### Req 13: Parallelizable by default. Decomposition produces independent leaf tasks wherever possible so the fleet can fan out. Serial chains are explicit and justified.

- Verdict: PARTIAL
- Evidence: `depends_on: []` defaults to empty (`templates/task.md:11`), meaning the default is no dependency. The EM is told to "**Dispatch immediately after task approval.** When the PgM approves tasks (disposition: approved), begin dispatching workers for tasks with no unresolved dependencies" (`engineering-manager/CLAUDE.md:128`). Projects and tasks both carry `depends_on`/`blocks` fields. Multiple worktrees are supported (`engineering-manager/CLAUDE.md:120`); worker IDs `W1, W2` appear in the dispatch template (`.claude/worker-dispatch-template.md:27`).
- Notes: Parallelism is enabled and implicitly preferred (dispatch unblocked tasks immediately), but no explicit directive says "prefer independent leaves" or requires justification for serial chains. `propose-tasks/SKILL.md:27` says "Identify dependencies and sequencing" without a bias toward parallelism.

### Req 14: Validated scope before dispatch. The task spec includes its inputs, outputs, affected files, and acceptance criteria. A worker receiving it should not have to re-discover scope.

- Verdict: MEETS
- Evidence: `templates/task.md:14-17`:
  ```
  scope:
    boundaries: []             # Explicit scope limits — what this task does and does not cover
    references: []             # Paths to files, docs, or URLs relevant to this task
  acceptance_criteria: []      # Concrete, verifiable conditions that define "done"
  ```
  `engineering-manager/CLAUDE.md:99`: "**Scope boundaries are explicit.** The `scope.boundaries` field lists exactly which directories the worker may modify. The `scope.references` field lists docs and code the worker should read for patterns and context." The dispatch template (`.claude/worker-dispatch-template.md:7-21`) explicitly says "No custom per-task prompts. The task file IS the contract. `TASK_SPECIFIC_NOTES` should almost always be empty."  Worker rule (`worker-context.md:29`): "Work ONLY within directories listed in `scope.boundaries`."
- Notes: Strong match. The task file is contract; `scope.boundaries` + `scope.references` + `acceptance_criteria` cover affected files, inputs, and outputs. Caveat: `boundaries` lists directories, not exact file paths, and inputs/outputs aren't separate fields — they live inside Description and acceptance_criteria prose.

## Surprises

- **Project layer has its own integration gate.** `templates/project.md:34-48` introduces "End-to-End Validation Flows" that the EM walks through against a running stack with fixture data before sending `project-complete` (`.claude/rules/task-completion.md:51-61`: "Start all required services… Walk through each End-to-End Validation Flow from the project file"). This is a stronger integration checkpoint than a typical DoD and is explicitly spec-driven from the proposal's Critical User Flows.
- **Cost aggregation at project completion.** Tasks record `actual_tokens` and `actual_duration_minutes` (`templates/task.md:18-19`), rolled up in the `project-complete` message (`.claude/rules/task-completion.md:63-83`). Cost-per-feature is treated as a first-class rollup.
- **Pattern-novelty, not risk-level, is the review-gate lever.** First instance of a new pattern triggers double-review; repetition triggers single review (`.claude/rules/task-completion.md:13-22`). Risk tier is not the axis.
- **Model pinning as a sizing enforcement.** `engineering-manager/CLAUDE.md:116`: "Always dispatch workers using model 'sonnet.' … If a task seems to need more judgment than Sonnet can provide, the task is scoped wrong."
- **Ad hoc tasks bypass the approval gate.** `engineering-manager/CLAUDE.md:189-196`: "No approval gate — ad hoc tasks enter the queue immediately." Discovered scope expansion flows as `info` to PgM, not through the normal tasks-proposed / feedback cycle.
- **Negotiation-round caps are uniform.** Every decomposition boundary caps at 2 revision cycles before human escalation (`protocol-design.md:379-414`, `415-445`). Hard cap on decomposition iteration at each layer.
- **Summary-level context boundaries.** The EM explicitly does not read the full proposal narrative — only `success_criteria` and `customer_need` from frontmatter (`engineering-manager/CLAUDE.md:71`). Decomposition is strictly a translation exercise at each layer.

## Open Questions for Trial

- What actually happens to PR LOC distribution? No LOC cap exists; in practice, does the single-context-window heuristic keep per-task PRs small, or do workers produce large diffs?
- How well does the single-context-window heuristic hold when a task's acceptance criteria imply multi-file changes (e.g., DB schema + route + middleware)?
- Does the EM reliably catch drift between task-creation-time code assumptions and dispatch-time reality without an explicit re-validation step?
- Do the per-task merges actually happen, or does branch-per-task devolve into long-running feature branches that merge in bulk at `project-complete`? The protocol is silent on merge cadence.
- How many projects exceed the negotiation-cycle cap at the PgM↔EM boundary, and what happens to decomposition quality after human override?
- `task-completion.md` duplicate-numbers Section 7a (Full-Stack Validation and Aggregate Cost Metrics both numbered 7a) — is the full-stack validation still reliably executed?

## Source Index

- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/templates/task.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/templates/project.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/templates/proposal.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/CLAUDE.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/worker-dispatch-template.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/worker-context.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/rules/task-completion.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/skills/propose-tasks/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/skills/create-task/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/skills/validate-project/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/program-manager/CLAUDE.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/program-manager/.claude/skills/create-project-plan/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/program-manager/.claude/skills/review-tasks/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/docs/specs/2026-03-22-three-agent-system-design.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/docs/specs/2026-03-23-agent-triad-protocol-design.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/docs/plans/2026-03-23-agent-triad-implementation.md`

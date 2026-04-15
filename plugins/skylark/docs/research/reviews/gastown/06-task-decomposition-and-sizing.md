# Gas Town — Task Decomposition and Sizing Conformance Evaluation

## Summary

- Conformance at a glance: **1 MEETS, 6 PARTIAL, 7 MISSING, 0 N/A (out of 14)**
- Headline: Gas Town provides strong structural primitives for decomposition
  (epics, beads with parent-child + blocks deps, convoy staging with DAG wave
  computation, formulas that bake iterative plan-review pipelines) but
  delegates all sizing discipline (single-session fit, LOC caps,
  compaction-triggered re-decomposition, drift validation) to the Mayor's
  LLM reasoning or to formula authors. The framework enforces no atomicity
  contract.

## Per-Requirement Findings

### Req 1: Single-session fit. Every leaf task is sized to fit one worker session ≤60% context utilization, including its outputs and tool calls.

- Verdict: **MISSING**
- Evidence:
  - No grep hit for "60%", "single session", "session fit", or any
    context-utilization threshold across `docs/` or
    `internal/formula/formulas/`.
  - `docs/design/polecat-lifecycle-patrol.md:44` acknowledges that
    "Multiple steps may fit in a single session (if steps are [small])"
    but only as a descriptive observation, not a decomposition requirement.
  - The Mayor role template (`internal/templates/roles/mayor.md.tmpl`)
    contains no instruction to size tasks against any session budget.
  - The `mol-idea-to-plan` formula's bead-creation step (step
    `create-beads`) instructs the agent to create a bead "for each
    task/phase in the plan" with no sizing test.
- Notes: Framework provides no size-fit test. Whatever sizing happens is
  whatever the Mayor or a plan-writing polecat chooses.

### Req 2: ~500 LOC PR cap. Artifact boundaries (PRs) cap at roughly 500 lines of code. If a "slice" produces more, the slice was wrong and is re-decomposed.

- Verdict: **MISSING**
- Evidence:
  - No grep hit for "LOC", "500 lines", "PR cap", "PR size", "pull
    request size" in `docs/` or formulas. Every "500" match in the tree
    refers to timings (ms) or unrelated constants.
  - `mol-polecat-work.formula.toml` step `self-review` lists review
    categories (Bugs, Security, Style, Completeness, Cruft) but no size
    check; its exit criterion is "Grade B or better if using /review".
  - No post-hoc slice re-decomposition hook exists in any formula.
- Notes: Polecats run `git diff --stat origin/{{base_branch}}...HEAD` in
  `self-review` but only to confirm "Only files relevant to {{issue}}
  should appear" — there is no size threshold.

### Req 3: DAG decomposition. Decomposition produces a DAG with explicit dependencies, not a flat list. Each node declares what it blocks and what blocks it.

- Verdict: **MEETS**
- Evidence:
  - `bd create --deps strings` takes "Dependencies in format 'type:id'
    or 'id' (e.g., 'discovered-from:bd-20,blocks:bd-15' or 'bd-20')".
  - `bd dep add <blocked> <blocker>` and `bd dep <blocker> --blocks
    <blocked>` create explicit blocking edges.
  - `bd dep cycles` detects dependency cycles; `bd dep tree` renders the
    graph.
  - `gt convoy stage <epic-id>` walks the epic's children, validates
    DAG structure, and computes execution waves via Kahn's algorithm
    (`docs/design/convoy/mountain-eater.md:6` and
    `docs/design/convoy/roadmap.md:167`: "`gt convoy stage <bead-id>` —
    DAG walking, validation, wave computation, tree + wave route plan
    display").
  - `mol-idea-to-plan` step `create-beads` instructs: "After creating
    all beads, wire up the dependencies based on the plan's sequencing:
    `bd dep add <task-x-id> <task-y-id>  # x depends on y (y blocks x)`"
    and `bd blocked  # should show clean topological order`.
- Notes: Both `parent-child` (hierarchy) and `blocks` (ordering) edge
  types are first-class (`convoy/roadmap.md:175`: "`parent-child` is
  organizational only, never blocking").

### Req 4: Self-contained DONE contract. Every task has an explicit completion contract — what must be true, including integration-test evidence where applicable. No "I think it's done" signals.

- Verdict: **PARTIAL**
- Evidence:
  - `bd create` exposes a dedicated `--acceptance string` flag
    ("Acceptance criteria").
  - `mol-idea-to-plan` formula bakes acceptance-criteria enforcement
    into review rounds: step `plan-review-3`/leg A (testability) flags
    "UNTESTABLE: <task> — no clear way to verify completion" and
    "VAGUE-CRITERIA: <task> — acceptance criteria too vague" as
    must-fix/should-fix. The `verify-beads-pass-1` step checks "Are
    acceptance criteria present and specific?"
  - Polecat DONE signal is concrete: `mol-polecat-work` step
    `submit-and-exit` requires `gt done` with a HARD GATE
    (`git log origin/{{base_branch}}..HEAD --oneline` MUST show ≥1
    commit), and the step description states "`gt done` will reject
    zero-commit branches for polecats."
  - Merge-queue fast-path requires `gt done --pre-verified` after the
    polecat runs the full gate suite (build, typecheck, lint, test) on
    a rebased branch (step `pre-verify`).
- Notes: Acceptance criteria are a *recommended* field enforced only by
  the `mol-idea-to-plan` review pass, not by `bd create` itself (no
  schema requirement). An agent using `bd create` directly or another
  formula can omit acceptance criteria entirely. Polecat DONE gate
  checks "has commits" but does not check "integration test evidence"
  — that is delegated to the refinery's merge-queue gate suite.

### Req 5: Pre-dispatch plan validation. A task's signatures, file paths, and external assumptions are grep-checked against current code *before* the task is dispatched to a worker. Drift blocks dispatch.

- Verdict: **MISSING**
- Evidence:
  - `gt sling <bead> <rig>` help text (recorded above) describes hook
    attachment, auto-convoy creation, merge strategy, target resolution,
    and spawning options. No step validates bead content against current
    code.
  - `mol-idea-to-plan` has `verify-beads-pass-1..3` which "find gaps
    between the implementation plan and the beads" — but this compares
    bead coverage to the plan document, not to the live codebase.
  - `mol-polecat-work` step `load-context` is the polecat's *own*
    orientation after dispatch — "**5. Understand the requirements**"
    and "Verify you can proceed" — which happens post-dispatch inside
    the polecat's session, not pre-dispatch.
  - No formula or CLI command grep-checks task signatures, file paths,
    or assumptions against HEAD before `gt sling`.
- Notes: No drift-blocks-dispatch mechanism exists.

### Req 6: PR boundary = wave boundary. Tasks merge individually. There is no "multi-task wave" that merges as a single PR. The integration checkpoint is each merge to main.

- Verdict: **PARTIAL**
- Evidence:
  - Each polecat submits its own MR: `mol-polecat-work`
    `submit-and-exit` describes "MR ID: gt-xxxxx / Source: polecat/<name>
    / Target: {{base_branch}} / Issue: {{issue}}" — one MR per polecat
    per issue.
  - `docs/design/architecture.md` "Merge Queue: Batch-then-Bisect":
    "Batch: Rebase A..D as a stack on main ... If PASS: Fast-forward
    merge all 4 → done". Individual MRs are preserved as stacked
    commits; they are not squashed into a single PR. The refinery
    merges each MR as its own commit.
  - However, `docs/concepts/integration-branches.md:92` states
    "Integration branches batch epic work on a shared branch, then land
    atomically" — epics can land as a single merge.
  - `gt convoy stage <epic-id>` computes **waves**, and `gt convoy
    launch` "transitions its status from staged to open and dispatches
    Wave 1 tasks." Waves dispatch in parallel; individual MRs still
    merge individually through the refinery.
- Notes: At the **MR granularity**, one task = one MR. At the **epic
  granularity**, sub-epics can land atomically via integration branches.
  There is explicit framework support for both "many small PRs to main"
  (default polecat flow + batch-then-bisect refinery) and "epic lands
  atomically" (integration branches). No explicit policy *forbids*
  multi-task single-PR.

### Req 7: Compaction as decomposition trigger. Exceeding 2 compactions in a plan's execution is a pipeline-level signal to pause and decompose further, not to continue.

- Verdict: **MISSING**
- Evidence:
  - Every "compaction" hit in `docs/` refers to either (a) Dolt
    history/wisp storage compaction (`docs/design/dolt-storage.md`,
    wisp TTL compaction in `mol-deacon-patrol.formula.toml`), or (b)
    Claude Code context compaction as a *session-survival* concern
    (e.g., `docs/design/witness-at-team-lead.md:267` pairs "command:
    `gt handoff --reason compaction`" with worker cycling).
  - `docs/concepts/polecat-lifecycle.md:313` describes "Context
    compaction | Automatic | Forced by Claude Code" as a session event
    to handle via `gt handoff`, not as a signal to re-decompose.
  - No formula treats compaction count as a re-plan trigger.
- Notes: Gas Town's compaction response is **handoff/cycle to a fresh
  polecat** (`gt handoff`), not re-decomposition.

### Req 8: Iterative planning. Decomposition happens in phases: coarse plan → refined plan → task specs. Re-planning gates are explicit so new information can restructure the DAG without silent drift.

- Verdict: **MEETS** *(for the Mayor-driven idea-to-plan path)*; partial
  overall.
- Evidence:
  - `mol-idea-to-plan.formula.toml` bakes an explicit phased pipeline:
    "intake → prd-review → human-clarify → generate-plan → prd-align
    1-3 (×2 polecats each) → plan-review 1-3 (×2 polecats each) →
    create-beads → verify-beads 1-3". That is exactly coarse → refined
    → task specs.
  - Each alignment/review round applies fixes to the plan document
    before the next round ("Apply fixes to the plan: Read both reports.
    For each must-fix and should-fix finding: Edit
    `.designs/<design-id>/design-doc.md` directly").
  - `gt convoy stage <convoy-id>` allows "Re-analyze an existing
    convoy's tracked beads", providing an explicit re-planning gate.
- Notes: The iterative-planning pipeline is **one specific formula**
  (`mol-idea-to-plan`). Nothing forces its use — the Mayor template's
  "File It, Sling It" section says the default is "User request → `bd
  create "..."` → `gt sling <bead-id> <rig>`" with no iterative planning
  gate. So the capability exists and is strong *when invoked*, but the
  framework does not mandate a coarse-to-fine sequence for all work.

### Req 9: Status rollup. Parent work items track children and roll up completion / blocker status without manual bookkeeping.

- Verdict: **MEETS**
- Evidence:
  - `docs/why-these-features.md:109-123` documents: "Each level has its
    own chain. Roll-ups are automatic. You always know where you stand."
  - `docs/design/convoy/roadmap.md:89` ("sub-epic status auto-managed
    (open → in_progress → closed)") and lines 192-193: "epic statuses
    update as children progress / convoy closes when root epic closes".
  - Convoy `progress` field (from `gt convoy status` sample output in
    `docs/concepts/convoy.md`): "Progress: 2/4 completed" — automatic
    rollup across cross-rig tracked issues.
  - `bd show --children` flag exists to list children; `bd blocked` and
    `bd ready` derive status from the dependency graph.
- Notes: Three independent rollup surfaces (bead parent-child, convoy
  tracking, epic auto-status) all update without manual bookkeeping.

### Req 10: Risk-dictated gate shape. A task's risk level determines its gate (trivial → no panel; elevated → panel; critical → panel + human). Sizing and review cost scale together.

- Verdict: **MISSING**
- Evidence:
  - No grep hit for "risk level", "trivial / standard / elevated /
    critical", or risk-tier gate routing in `docs/` or formulas.
  - `bd create --priority string` exists (P0-P4) but is a scheduling
    priority, not a review-gate selector.
  - `mol-idea-to-plan` step `plan-review-2`/leg A (risk) classifies
    risks as "HIGH | MEDIUM | LOW" impact × likelihood and calls for
    mitigations, but this grades the *plan*, not the per-task gate.
  - Review formulas (`mol-prd-review`, `mol-plan-review`,
    `mol-polecat-code-review`, `mol-polecat-review-pr`, `code-review.formula.toml`)
    are invoked at the convoy author's discretion — there is no
    risk-tier dispatch that selects among them.
- Notes: The only "risk-like" toggle at dispatch is the `--merge`
  strategy (`direct | mr | local`), which is an integration choice, not
  a review-gate scale.

### Req 11: Triage funnel. Raw ideas and problems enter a triage/intake stage before becoming tasks. No direct "implement this" on unclassified input.

- Verdict: **PARTIAL**
- Evidence:
  - `mol-boot-triage.formula.toml` exists as a triage formula
    (filename; not inspected in depth but present in the formula
    directory).
  - `mol-idea-to-plan` opens with an `intake` step that "Read the
    conversation context and produce a structured PRD draft."
  - The Mayor template (`mayor.md.tmpl`) "Work Philosophy: File It,
    Sling It" section *does* route user requests through `bd create`
    before `gt sling`, giving a minimal triage point. However, the same
    template also permits direct implementation: "Fix things yourself
    ONLY when ALL of these are true: It's a trivial change ... The user
    explicitly asked you to do it directly".
  - `gt sling` accepts any bead ID. Nothing in CLI or formula layer
    blocks an unclassified/unreviewed bead from being slung.
- Notes: Triage is encouraged by role prompts and provided by opt-in
  formulas, but not framework-enforced before dispatch.

### Req 12: Coarse-to-fine decomposition cap. Maximum decomposition depth (e.g., project → epic → task → subtask) is bounded; deeper nesting is a sign of unclear scope.

- Verdict: **PARTIAL**
- Evidence:
  - Bead types are enumerated (`bd create -t`): "bug|feature|task|epic|
    chore|decision". This implicitly caps type granularity.
  - `docs/design/convoy/roadmap.md:259` lists "Hierarchy depth
    validation (opt-in)" as **future work**, not a current cap.
  - `docs/design/convoy/roadmap.md:45-46, 77-79`: "creates: root epic,
    sub-epics, leaf tasks / adds: parent-child deps (organizational
    hierarchy)" — root epic → sub-epic → task is the documented depth,
    but no hard cap prevents deeper `bd dep add --type=parent-child`
    chains.
  - `docs/why-these-features.md:114-122` shows "Epic → Feature → Task"
    as the typical shape, but it is illustrative.
- Notes: Convention exists (root epic → sub-epic → leaf task); hard
  enforcement is explicitly future work.

### Req 13: Parallelizable by default. Decomposition produces independent leaf tasks wherever possible so the fleet can fan out. Serial chains are explicit and justified.

- Verdict: **PARTIAL**
- Evidence:
  - `gt convoy stage` computes *waves* via Kahn's algorithm — tasks
    within a wave run in parallel; only `blocks` deps create serial
    chains. "Tasks dispatch in dependency order"
    (`docs/design/convoy/roadmap.md:37`) and "subsequent waves fed by
    daemon as tasks close" (line 191).
  - `gt sling gt-abc gt-def gt-ghi gastown` batch-slings multiple
    beads; "each bead gets its own polecat. This parallelizes work
    dispatch".
  - ConvoyManager's stranded scan plus event-driven feeding
    (`docs/design/convoy/spec.md`) auto-feeds ready (unblocked) work.
  - `mol-idea-to-plan` dispatches 6 parallel polecats during PRD review
    and design generation (`prd-review` pours `mol-prd-review` which
    spawns "6 polecats in parallel").
- Notes: Parallelism emerges from the dep graph — the framework itself
  does not require that decomposition *maximize* independence. A Mayor
  that writes a fully-serial chain of `blocks` deps produces a fully
  serial execution; nothing flags this. `mol-idea-to-plan`'s
  `plan-review-1`/leg B (sequencing) prompts its reviewers to flag
  "unnecessary serial dependencies (tasks that could be parallelized)",
  which is the only explicit pressure toward parallelism and is
  formula-scoped.

### Req 14: Validated scope before dispatch. The task spec includes its inputs, outputs, affected files, and acceptance criteria. A worker receiving it should not have to re-discover scope.

- Verdict: **PARTIAL**
- Evidence:
  - `bd create` exposes a rich spec field set: `--description`,
    `--context`, `--design`, `--acceptance`, `--notes`, `--estimate`,
    `--skills`, `--labels`, `--spec-id`, `--external-ref`, plus
    `--file` / `--body-file` / `--stdin` for long-form content.
  - `gt sling` threads dispatch-time context: `--args` ("stored in the
    bead and shown via `gt prime`") and `--stdin` for multi-line
    instructions. Polecat reads all of this via `gt prime` in
    `mol-polecat-work` step `load-context`.
  - `mol-idea-to-plan` `create-beads` template includes a structured
    body: "## Context / ## What / ## Acceptance Criteria / ## Notes".
  - However, `mol-polecat-work` step `load-context` explicitly directs
    the polecat to do scope work *in-session*: "Understand the
    requirements: What exactly needs to be done? What files are likely
    involved? Are there dependencies or blockers? What does 'done' look
    like?" — i.e., the polecat re-discovers scope.
- Notes: Framework provides rich fields for a self-contained spec and
  `mol-idea-to-plan` review rounds pressure the plan author to fill
  them, but the default polecat prompt expects the polecat to
  re-discover "what files are likely involved" and "what does 'done'
  look like" — so validated-scope-before-dispatch is not enforced.

## Surprises

- **Convoy staging has real DAG mechanics.** `gt convoy stage` isn't a
  loose grouping — it walks children, validates structure, and computes
  waves using Kahn's algorithm. This is meaningful framework-level
  support for the *graph* half of decomposition, while leaving the
  *sizing* half to the Mayor.
- **The Mountain-Eater design (`docs/design/convoy/mountain-eater.md`)
  adds judgment-layer behavior for stuck epics** (skip-after-3-failures,
  Deacon-Dog audit patrols, escalation to Mayor) — but its response to
  "a task fails 3 times" is **skip and continue**, not "re-decompose".
  The framework assumes the decomposition was correct and the *task*
  was faulty.
- **The `mol-polecat-work` formula has a 7-step polecat execution
  pipeline with a HARD GATE for committed work before `gt done`**
  (step `submit-and-exit`). This is a per-task completion contract,
  stronger than in most requirement 4 competitors — but there is no
  matching *pre-dispatch* drift check (requirement 5).
- **Acceptance criteria is a flag on `bd create`, not a required
  field.** The `mol-idea-to-plan` review-round polecats treat "vague
  acceptance criteria" as must-fix, but only when that formula is in
  play. Ad-hoc `bd create` + `gt sling` bypasses this entirely.
- **Compaction in Gas Town ambiguously refers to three things:** Dolt
  history compaction, wisp TTL compaction, and Claude Code context
  compaction. None of them trigger decomposition review; the
  context-compaction response is worker handoff.

## Open Questions for Trial

- When a polecat hits its context limit mid-task, what happens? The
  `gt handoff` path preserves session state via Seance/PreCompact hook,
  but does any layer *count* compactions per plan and react at 2+?
- Does `gt convoy stage`'s wave computation reject or warn on degenerate
  DAGs (all-serial, 1-task-per-wave) that would indicate weak
  parallelism?
- Is there an implicit LOC threshold inside any of the refinery's gate
  commands (e.g., pre-verify) that would fail a 6000-LOC MR? CI config
  was not inspected.
- How strictly does the Mayor role actually apply "File It, Sling It"
  in practice vs. direct implementation? The template allows both.

## Source Index

### Design docs read
- `/Users/deuley/code/tools/gastown/docs/design/architecture.md`
- `/Users/deuley/code/tools/gastown/docs/concepts/molecules.md`
- `/Users/deuley/code/tools/gastown/docs/concepts/convoy.md`
- `/Users/deuley/code/tools/gastown/docs/design/convoy/spec.md`
- `/Users/deuley/code/tools/gastown/docs/design/convoy/mountain-eater.md` (partial)
- `/Users/deuley/code/tools/gastown/docs/design/convoy/roadmap.md` (grep-scoped)
- `/Users/deuley/code/tools/gastown/docs/why-these-features.md` (partial)
- `/Users/deuley/code/tools/gastown/docs/glossary.md` (grep-scoped)
- `/Users/deuley/code/tools/gastown/docs/design/polecat-lifecycle-patrol.md` (grep-scoped)
- `/Users/deuley/code/tools/gastown/docs/design/witness-at-team-lead.md` (grep-scoped)
- `/Users/deuley/code/tools/gastown/docs/concepts/integration-branches.md` (grep-scoped)

### Templates / formulas read
- `/Users/deuley/code/tools/gastown/internal/templates/roles/mayor.md.tmpl`
- `/Users/deuley/code/tools/gastown/internal/config/roles/mayor.toml`
- `/Users/deuley/code/tools/gastown/internal/formula/formulas/mol-idea-to-plan.formula.toml`
- `/Users/deuley/code/tools/gastown/internal/formula/formulas/mol-polecat-work.formula.toml`
- `/Users/deuley/code/tools/gastown/internal/formula/formulas/mol-plan-review.formula.toml` (partial)
- (directory listing of all 42 formulas in `internal/formula/formulas/`)

### CLI output captured
- `gt mayor --help`
- `gt convoy --help`
- `gt convoy create --help`
- `gt convoy stage --help`
- `gt convoy launch --help`
- `gt sling --help`
- `bd mol --help`
- `bd cook --help`
- `bd create --help`
- `bd ready --help`
- `bd dep --help`
- `bd list --help`
- `bd show --help`

### Search queries used
- grep `"LOC|lines of code|500 lines|60%|too large|atomic|decompos|bite-sized"` across `docs/`
- grep `"compaction"` across `docs/` and `internal/formula/formulas/`
- grep `"acceptance|signatures|validate|grep.check|drift"` across relevant formulas
- grep `"PR cap|PR LOC|500|pull request size|merge per task|one PR per"` across `docs/`
- grep `"parent-child|hierarchy|rollup|children|depth"` across `docs/design/convoy/roadmap.md`

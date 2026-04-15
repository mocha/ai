---
date: 2026-04-15
status: synthesis — first pass
inputs: 27 per-framework / per-domain conformance reports in `reviews/{skylark,gastown,triad}/`
scope: framework-level adoption decision for the Skylark pipeline
deliberately out of scope: Wasteland / federation; the task-atomicity spec work (separate workstream)
---

# Framework Evaluation Synthesis — Skylark × Gas Town × Triad

## 1. Executive summary

This synthesis closes the evaluation round triggered by the ENG-180
retrospective. It does not yet recommend adoption. It does narrow the
decision space, name the pivotal unresolved question, and list the
salvageable ideas each framework contributes.

**Scorecard across all 117 requirements:**

| Domain | Skylark | Gas Town | Triad | Winner |
|---|---:|---:|---:|---|
| 01 Orchestration model | 0 | 7 | 0 | Gas Town |
| 02 Worker model | 4 | 7 | 3 | Gas Town |
| 03 Artifact & task substrate | 3 | 11 | 5 | Gas Town |
| 04 Review & gate model | 8 | 3 | 6 | Skylark |
| 05 Context engineering | 2 | 4 | 0 | Gas Town |
| 06 Task decomposition & sizing | 4 | 1 | 6 | Triad |
| 07 Integration & merge model | 0 | 5 | 0 | Gas Town |
| 08 Monitoring & recovery | 0 | 10 | 0 | Gas Town |
| 09 Environment isolation | 1 | 4 | 2 | Gas Town |
| **MEETS total** | **22** | **52** | **22** | |

Gas Town wins seven of nine domains and leads 52 to 22. Skylark and Triad
tie for second by count, with radically different strength profiles.

**The shape of the win matters more than the count.** Gas Town's dominance
is concentrated in *infrastructure* domains: orchestration, artifact
substrate, merge queue, monitoring, environment isolation. The two
domains Gas Town *loses* — review-and-gates and task-decomposition —
are the two domains ENG-180 blamed for the 6,700 LOC PR. Gas Town gives
you runtime excellence. It does not give you atomicity discipline or
panel review.

**Topline characterization:**

- Gas Town is a *runtime substrate*. Mature, shipped, Go-native, with a
  polymorphic Beads data model, Bors merge queue, OTEL telemetry, and a
  four-tier supervisor chain. It does not know how to size a task or
  generate a per-task expert.
- Skylark is a *process discipline*. Vocabulary-routed experts, bounded
  panel review, risk-tiered gates. Strong at review quality, weak nearly
  everywhere else. Almost everything below the review layer is
  delegated to the host with no explicit contract.
- Triad is a *retired-but-correct decomposition cascade*. The three-phase
  Proposal→Project→Task pipeline with hard schema-depth cap, 2-cycle
  `round` accounting, Sonnet-as-sizing-sentinel, and explicit decision
  capture. The orchestration layer that killed it is irrelevant; the
  discipline it encoded is salvageable.

**Pivotal finding (confirmed):** Gas Town Polecat prompts are
template-driven. `gt sling --args/--message/--var` passes task-specific
*strings*, but there is no first-class channel for a dispatcher to
supply an arbitrary full prompt body. Vocabulary-routed expert
generation — Skylark's flagship capability — cannot ride Gas Town as-is.
Whether opening that channel is a week of PR work or a structural fight
with Gas Town's design is the single biggest unresolved question before
an adoption path can be locked in.

**Recommendation direction** (to be validated by trial): *Option 3 with
a twist.* Gas Town as runtime substrate. Skylark as the domain/discipline
layer that generates per-task expert prompts and runs panel reviews.
Triad mined for three specific patterns: the decomposition cascade with
depth cap, `round`-accounted negotiation, and `## Rationale`-style
decision capture on artifacts. Integration seam is the per-task prompt
channel added to Gas Town (upstream PR or Polecat-role shim).

## 2. Methodology in one paragraph

Nine framework-agnostic domain specs were written from three research
reports (sandbox ergonomics, context/compaction, ENG-180 retro) plus
general best-practice knowledge. Each spec enumerated testable
requirements. Twenty-seven independent Opus agents — one per framework
per domain — evaluated each framework against the relevant spec,
producing conformance reports with MEETS/PARTIAL/MISSING verdicts plus
evidence. Reports live in `reviews/{skylark,gastown,triad}/`. No
agent was told how another framework scored. No recommendations were
produced at the per-report level. This synthesis is the first time
evidence is compared.

## 3. Per-domain analysis

### 3.1 Orchestration model — Gas Town 7, Skylark 0, Triad 0

Gas Town is the only framework with a genuine orchestrator. Declarative
TOML formulas, Dolt-backed state, DAG via `needs` / `bd ready` / convoy
waves, resume via `gt prime` / `gt handoff`, crash-safe transactions.
The observation worth carrying forward: **Gas Town has two coexisting
orchestrators** — a deterministic data plane (Beads + formulas +
scheduler + convoys + refinery) and an LLM Mayor for strategic routing.
The data plane maps cleanly to spec; the Mayor is the flexibility layer.

Skylark's orchestrator is prose in `skills/implement/SKILL.md`
interpreted by an LLM with no context ceiling — the direct cause of
ENG-180's four-plus compactions.

Triad has no centralized orchestrator; it's a peer-to-peer protocol
between three long-running reasoning agents. The "orchestrator" skills
(`start`/`kick`/`status`/`resume`) manage tmux, not the pipeline.

### 3.2 Worker model — Gas Town 7, Skylark 4, Triad 3

This is the pivotal domain for adoption. Gas Town wins on ephemeral
sessions, persistent identity (agent bead + CV chain), pluggable runtime
(seven+ supported agents via 4-tier JSON-preset adapter — the single
strongest runtime story in any framework), and bounded lifetime via
witness patrol.

**But the critical gap holds**: per-task prompt generation is PARTIAL,
not MEETS. Role prompts come from `internal/templates/roles/polecat.md.tmpl`
(Go templates with `{{ .Polecat }}`, `{{ .RigName }}` substitution),
file-based directives at `<townRoot>/directives/<role>.md`, and TOML
formulas. Variable substitution is the only dynamic channel. Skylark's
vocabulary-routed expert generation — where an expert's *entire prompt
body* is constructed per task from domain vocabulary — has no home in
this model without extension.

Skylark's strengths: typed status enum (DONE / DONE_WITH_CONCERNS /
NEEDS_CONTEXT / BLOCKED) is exactly the spec's requirement, per-task
prompt generation is native, curated inputs are well-specified. Missing:
persistent identity, per-role tool scoping (no `tools:` / `permissionMode:`
in any skill's frontmatter), 60% handoff discipline, bounded timeouts.

Triad explicitly *rejects* per-task prompt generation: "The task file
IS the contract." Pluggable runtime is also refused: "Always dispatch
workers using model: sonnet." Design intent, not omission.

### 3.3 Artifact & task substrate — Gas Town 11, Triad 5, Skylark 3

Gas Town's widest lead. Beads is a purpose-built implementation of this
spec: Dolt-backed SQL with git-like versioning, polymorphic `issues`
table carrying tasks/bugs/features/epics/decisions/agents/messages/
molecules/gates/convoys/merge-requests, typed dependency edges, full
query language (`bd query` with compound booleans, `bd graph`,
`bd dep tree`), atomic transactions, events table with `ConvoyManager`
polling every 5s, short prefixed IDs, cross-rig routing via a `routes`
table, JSONL disaster-recovery export every 15 minutes. Three data
planes: Operational (Dolt), Ledger (JSONL→git permanent), Design
(DoltHub commons, planned).

Triad's substrate is markdown+YAML with explicit decision-capture
sections (`## Rationale`, `## Context`, `## Open Questions`) and
preserved negotiation archives. Cost telemetry (`actual_tokens`,
`actual_duration_minutes`) embedded per task and rolled up to
project-complete tables. Missing: query CLI, atomicity (documented race
in `create-task` ID scan).

Skylark is at the opposite end — markdown + YAML frontmatter interpreted
by LLM agents at runtime, no scripts, no CLI, `parent`/`target` links
by relative path while `depends_on` links by ID (dual model), Linear
positioned as competing canonical store at elevated+ risk.

### 3.4 Review & gate model — Skylark 8, Triad 6, Gas Town 3

Skylark's home turf. Dedicated `panel-review` and `solo-review`
composable primitives consumed by `spec-review`, `plan-review`, and
`develop`. Typed verdicts (Ship/Revise/Rethink plus stage-level
approved/rethink/escalate), parallel panels for elevated+ risk,
per-dispatch bespoke expert generation, hard 2-round cap, evidenced
approvals via report frontmatter + changelog, composability (review
primitives consumed by three separate stages). Distinctive
architectural choices: dual-gate `develop` (spec compliance solo
review *then* code-quality panel), explicit "Do Not Trust the Report"
directive, "don't pass round 1 findings to round 2" independence rule,
asymmetric "one Rethink vetoes" consolidation.

Triad's bounded 2-cycle `round`-accounted revision loop with escalation
chain (Dev→EM→PgM→PM→Human) is a clean minimalist gate primitive.
Typed dispositions include a `directive` for human override — an
explicit override semantic neither other framework ships.

Gas Town's gates are formula-level (multi-reviewer convoy formulas
like `code-review.formula.toml`, `mol-plan-review.formula.toml`) but
the retry loop is an *unbounded* Beads dependency graph. Elegant but
no max-round counter. No dedicated panel-review primitive.

All three lack: (1) recurring-findings-to-automation loop — every ENG-180
retro panel complaint that repeated across waves should be convertible
to a lint rule, and no framework does this; (2) plan-vs-reality
pre-dispatch drift gate — the specific failure that cost ENG-180 two
dead-end tasks.

### 3.5 Context engineering — Gas Town 4, Skylark 2, Triad 0

Gas Town's material advantages: predecessor-session query via
`gt seance --talk <id>` that spawns `claude --fork-session --resume
<id>` (elegant — doesn't require parsing a handoff artifact), auto-
persistence hooks on SessionStart/PreCompact/Stop, disk-canonical
Beads+git state. Missing: numeric context budget, utilization alerts,
prompt-cache discipline — a blind spot every framework shares.

Skylark's sole MEETS is disk-canonical state via artifact conventions.
Notably, Skylark's per-task CLAUDE.md regeneration *actively works
against* prompt caching — a design misstep given the research on cache
stability.

Triad's persistent-session architecture is structurally opposed to the
entire domain. The retirement README openly diagnoses several spec
requirements as failure modes: "An agent couldn't cheaply ask 'what
did you already tell PM?' without re-reading the inbox log."

**No framework enforces the 60% context budget.** This is the single
most load-bearing gap across the entire evaluation. ENG-180's four-plus
compactions are direct evidence that unenforced budgets do not hold.

### 3.6 Task decomposition & sizing — Triad 6, Skylark 4, Gas Town 1

Triad's only domain win, and on the domain that ENG-180 made critical.
Three-phase Proposal→Project→Task cascade with 2-cycle negotiation caps
at each boundary, hierarchy hard-capped at three schema layers, runnable
acceptance criteria required, EM cannot create projects (hard triage
funnel: "No work enters the system without a proposal"), workers
policy-pinned to Sonnet as an implicit sizing sentinel (if Sonnet
can't hold the task in one window, the task was mis-sized). End-to-End
Validation Flows executed against running stacks at project-complete.

Skylark's risk-tier routing and pre-dispatch scope validation are
native moves but absent the hard sizing enforcement.

Gas Town is explicitly weak here and the evaluation confirmed the
hypothesis: strong decomposition *structure* (beads with typed deps,
convoy DAG staging via Kahn's algorithm, iterative planning via
`mol-idea-to-plan` 6-round formulas, automatic status rollup) and weak
decomposition *discipline* (no LOC cap, no session-fit test, no
pre-dispatch drift check, no compaction trigger, no risk-tier gate
selection). The Mayor role template's "File It, Sling It" directs
coordination through beads but permits direct implementation and does
not enforce sizing.

**Atomicity is not a problem Gas Town solves.** Under any adoption
path, the sizing workstream remains Skylark's responsibility (or
Triad-derived) riding on top of Gas Town's decomposition substrate.

### 3.7 Integration & merge model — Gas Town 5, Skylark 0, Triad 0

Refinery is the marquee feature: Bors-style batch-then-bisect with
real `bisectBatch()` + `bisectRight()` binary search + flaky-retry, CI
runs on merged state via `BuildRebaseStack()`, automated conflict
recovery via blocking Beads task with templated rebase instructions,
clean `polecat/<name>/<issue-id>` branch-per-task, `gt done` syncs
worktree to fresh trunk.

Gaps worth flagging: branch protection is client-side pre-push hook
only, `TypeMerged`/`TypeMergeStarted`/`TypeMergeFailed` events are
declared but no call site emits them (notifications degrade to
free-text `gt nudge`), AI `quality-review` step exists but defaults
off and is "measurement-only, do NOT block the merge", no
`.git/index.lock` recovery, no plan-drift check at dispatch.

Skylark ships zero — no CI integration, no merge queue, no bisecting,
no drift gate, no stale-lock recovery. Six of ENG-180's ten
retrospective suggestions map directly to unmet requirements here.

Triad delegates almost entirely to host project conventions, with
internal spec drift (PM can push to main while workers cannot;
different specs give different conflict-resolution ownership; three
inconsistent branch-naming conventions coexist).

### 3.8 Monitoring & recovery — Gas Town 10, Skylark 0, Triad 0

Gas Town's largest single delta vs either other framework. OTEL
telemetry with `run.id` correlation, explicit health state taxonomy
(working / stalled / GUPP-violation / zombie / idle) with thresholds,
four-tier supervisor chain (Boot → Deacon → Witness → workers with
Daemon 3-minute heartbeat), severity-routed escalation to
bead/mail/email/SMS, `gt doctor --fix` / `gt cleanup` /
`gt deacon zombie-scan` / `gt checkpoint` for crash recovery,
`gt feed --problems` TUI + web dashboard, `gt costs` + `agent.usage`
events.

Caveats: `otel-architecture.md` flags several events as roadmap
(PR #2199), and `witness-at-team-lead.md` is explicitly "NOT YET
IMPLEMENTED — future architecture."

Skylark provides nothing at the runtime level. Monitoring primitives
are the markdown changelog, self-reported implementer status, and
fiat-capped 2-round review loops. Entire domain delegated to a
nonexistent host-harness contract.

Triad has surprisingly mature human-facing ergonomics
(`/triad:status`, `/triad:kick`, `/triad:resume`, fswatch inbox-watcher
with systemd `Restart=on-failure` and launchd `KeepAlive`) but no
continuous health supervisor.

### 3.9 Environment isolation — Gas Town 4, Triad 2, Skylark 1

Gas Town wins but not decisively. Git-worktree-per-polecat, on-demand
`gt sling` provisioning + `gt done` teardown, PreToolUse
`gt tap guard dangerous-command` covering rm -rf / force-push / drop
table / package-install / SQL drops with exit code 2, mTLS proxy with
hard command allow-list and per-cert rate limiting.

But `--dangerously-skip-permissions` is baked uniformly into every
role TOML with no container coupling, credentials are shell-inherited
and shared across workers, no iptables/network allow-list, no fail-
closed if sandbox wrapper absent, MCP gating absent from hooks
templates. The `sandboxed-polecat-execution.md` proposal (2026-03-02)
has config scaffolding (`internal/config/types.go:751-755`) but
daytona provisioning is unimplemented; shipped `docker-compose.yml`
is a single workspace-wide container, not per-worker.

Triad's two MEETS are actually *cleaner* than anything Skylark ships:
`autoAllowBashIfSandboxed: true` across all managers plus macOS
`safehouse` sandbox wrapping every `claude` session. Weakness is
explicit fallback to plain `claude` when safehouse absent (fail-open
when spec wants fail-closed).

Skylark's single MEETS is on-demand worktree provisioning. Everything
else — no `.claude/settings.json`, no hooks, no Dockerfile — silently
delegated to the host harness with no contract.

## 4. Framework character sketches

### Gas Town

Operating at a level of *system maturity* none of the other two approach.
Go codebase, Dolt database, Bors merge queue, OTEL observability,
docker-compose shipping, three-data-plane model, federated coordination
(Wasteland — out of scope), dashboards, shell completions.

Optimized for **fleet scale** — the design target is 20-50 concurrent
agents coordinating through a shared Beads substrate. The Mayor role
does strategic LLM reasoning; everything else is code.

What it does not do: teach you how to decompose a task, generate a
per-task expert prompt, or run a bounded panel review. Its review
primitives (convoy formulas) are retry-loop-unbounded. Its
decomposition is delegated to the Mayor's reasoning.

### Skylark

A thin skill-layer plugin with zero runtime. Everything is prose in
`skills/*/SKILL.md` files interpreted by a host Claude Code session at
invocation time. No CLI, no database, no hooks, no supervisor, no
telemetry.

Strength is *content*: vocabulary-routed expert generation, bounded
panel review architecture, risk-tiered gate shapes, triage funnel,
composable review primitives. ENG-180 is evidence this content layer
produces high-quality output when the pipeline survives to run.

Weakness is *infrastructure*: the pipeline does not survive to run
reliably. Four-plus compactions, three-hundred-line resumption notes,
plan-to-reality drift, merge-at-end integration, zero observability.

### Triad

Retired but honest about it. The README diagnoses its own failure
modes; the evaluation confirmed every diagnosis. Persistent-session
tmux architecture was the wrong call in 2026; the decomposition
cascade, decision-capture discipline, `round`-accounted gates, and
Sonnet-as-sentinel were the right calls.

Not a merger candidate at the architecture level. A mining ground for
specific discipline patterns that the living frameworks both lack.

## 5. Option space revisited

The original five adoption options, re-assessed against the evidence:

### Option 1: Full adoption of Gas Town

*Skylark becomes a set of Gas Town Formulas + custom Polecat roles. The
`gt` binary is the runtime. Skylark's current skill files become role
prompts and formula steps.*

**Viability: conditional on the prompt-channel question.** Full
adoption means converting Skylark's per-task expert generation to ride
the `gt sling --var/--args` channel. This is probably feasible — the
experts would be emitted as full prompt bodies into a variable, and the
role template would include them — but it is a meaningful redesign of
how vocabulary routing fits into the dispatch path. Until trialed, it
is not a known-good shape.

**Trade-offs given up:** Skylark's direct control over prompt
construction; the `docs/`-markdown-native artifact model (everything
moves to Beads); the Claude-Code-only runtime assumption (Gas Town's
multi-runtime is a gain, not a loss, but it does imply testing under
runtimes Skylark has never run on).

### Option 2: Partial adoption — Beads only

*Keep Skylark's pipeline skills as-is, but switch the artifact/task
layer from markdown files in `docs/` to Beads.*

**Viability: high but undersized.** The 11-MEETS artifact substrate is
the single most valuable Gas Town piece, and importing Beads alone is
operationally tractable (two binaries, Dolt database, one import of
existing markdown artifacts). But this misses the Refinery, OTEL,
supervisor chain, and merge queue — the parts that would actually fix
ENG-180's integration-at-end and unattended-run failures.

Good as a *staging step* toward Option 3. Weak as an endpoint.

### Option 3: Partial adoption — Gas Town as runtime, Skylark as domain layer

*Use Mayor/Polecats/Refinery/Witness for orchestration; Skylark's
pipeline runs inside a Mayor role or as a Formula, with vocabulary-
routed experts staying Skylark's.*

**Viability: highest fit-to-effort, contingent on the prompt-channel
question.** Skylark keeps what it's strongest at (review model, expert
generation, risk routing). Gas Town provides the infrastructure
Skylark ships zero of (orchestration, merge queue, monitoring,
artifact substrate). The Mayor becomes Skylark's entry point.

**The integration seam is the prompt channel.** Either Skylark emits a
full Polecat prompt body into a `gt sling --var EXPERT_PROMPT=...`
variable that the role template interpolates, or Skylark contributes
upstream a first-class prompt-body dispatch parameter. Neither is
catastrophic. Both need validation.

**This is the current recommendation direction.**

### Option 4: Mirror patterns, stay standalone

*Port specific ideas into Skylark's own codebase.*

**Viability: low ROI.** The evaluation quantifies what Skylark would
need to build: an orchestration engine with declarative pipeline
definition, a structured artifact substrate with query CLI, a Bors
merge queue with bisecting, an OTEL telemetry layer, a three-tier
supervisor chain, environment isolation with per-worker containers.
That is not a mirror-patterns project; that is rebuilding Gas Town.

Defensible only if the upstream-risk or design-philosophy gap on Gas
Town turns out to be structurally unworkable.

### Option 5: Skip Gas Town

*Keep Skylark as-is and solve the problems Skylark-native.*

**Viability: ruled out by evidence.** The evaluation's blank columns
on Skylark for orchestration (0), integration & merge (0), and
monitoring & recovery (0) are too wide to close by in-house work at
reasonable speed. Pursuing this path is a choice to accept
ENG-180-class failures indefinitely.

### Option 3b (the "twist")

*Gas Town as runtime, Skylark as domain, Triad mined for three specific
discipline patterns: (1) hard-capped decomposition cascade with
schema-level depth limits, (2) `round`-accounted 2-cycle negotiation
primitive, (3) `## Rationale` / decision-capture artifact sections.*

Each pattern directly addresses a known gap in the Gas Town + Skylark
combination:

- The decomposition cascade addresses **Gas Town's Req 7 MISSING**
  (compaction as decomposition trigger) by replacing it with
  schema-enforced depth caps before any dispatch.
- `round` accounting addresses **Gas Town's Req 5 MISSING** (bounded
  revision loops — Gas Town's gate retry loop is unbounded).
- `## Rationale` sections address **Gas Town's Req 11 PARTIAL**
  (decision capture — fields exist, structure is not enforced).

These are small, additive patterns. They do not require porting Triad
code; they require adding discipline to Skylark's artifact conventions
and Gas Town's formula authoring.

## 6. The pivotal unresolved question

**Can Gas Town's Polecat dispatch accept an arbitrary full prompt
body?**

The evidence says no — not as a first-class channel. The available
channels are:

1. `gt sling --args` — task-specific string arguments
2. `gt sling --message` — a task message
3. `gt sling --stdin` — stdin-piped content
4. `gt sling --var KEY=VALUE` — formula-variable injection
5. Per-role directives in `<townRoot>/directives/<role>.md`
6. Go template substitution in `internal/templates/roles/polecat.md.tmpl`

Skylark's vocabulary-routed expert generation constructs a full prompt
body per task — potentially several thousand tokens of bespoke expert
instructions. Routing that through a template variable is possible in
principle; in practice it depends on:

- Whether the template engine tolerates a large variable without
  truncation or encoding weirdness.
- Whether the resulting Polecat session receives the expanded prompt
  *as its system instruction* or as user content — these are not
  interchangeable for expert behavior.
- Whether Gas Town's cache posture (it pays for prompt caching) remains
  intact under per-task prompt variation.
- Whether the UX of "Skylark generates the expert, pipes it to
  `gt sling`, waits for the Polecat to start" is operationally clean.

**The resolution is a small trial, not a paper eval.** A single task
dispatched this way answers most of the above. This is the first
concrete trial-scope line item.

## 7. Triad salvage list

In rough order of value-to-effort:

1. **`round`-accounted 2-cycle revision cap** (from Triad's review
   model). One field on a review artifact, one assertion at the gate
   handler. Directly addresses Gas Town's unbounded retry loop.
2. **`## Rationale`, `## Context`, `## Open Questions` sections** on
   specs, plans, and decision beads. Enforceable via formula lint or
   gate check.
3. **Hard schema-depth cap on decomposition** (Proposal→Project→Task
   as the maximum hierarchy). Enforceable as a Beads schema constraint
   on the `parent`/`spec_id` graph.
4. **Sonnet-as-sizing-sentinel** convention for worker dispatch. If a
   task cannot complete in one Sonnet window, the task is mis-sized.
   Cleaner than any LOC cap.
5. **Per-task cost telemetry fields** (`actual_tokens`,
   `actual_duration_minutes`) rolled up to project-level tables. Gas
   Town has `agent.usage` events but no rollup artifact.
6. **`directive` human-override disposition** on review verdicts. Both
   Skylark and Gas Town have implicit human override; neither names it.
7. **`/triad:status` report shape** — a single terse human-readable
   pipeline-state summary. `gt feed` is richer but not tuned for the
   "what's going on right now" one-screen glance.
8. **End-to-End Validation Flows** at project-complete (running
   integration tests against a live stack before closing the project).
   Complements Refinery's pre-merge CI.

Patterns *not* to salvage:

- Persistent per-role tmux sessions (the retirement cause).
- Filesystem-inbox message coordination (fragile, hard to debug at
  scale — documented in Triad README).
- Role-pair negotiation semantics (superseded by Gas Town's escalation
  chain).

## 8. Shared blind spots across all three frameworks

Worth flagging as candidate spec revisions or as known-unknown risks
that no framework solves today:

- **No framework enforces a context-utilization budget.** All three
  rely on host-harness defaults. ENG-180 is evidence the defaults do
  not hold.
- **No framework auto-converts recurring review findings into lint
  rules.** This is ENG-180's suggestion #5 and remains an aspirational
  target.
- **No framework does pre-dispatch plan-vs-code drift validation.** A
  grep of planned signatures against current code before worker
  dispatch would have saved ENG-180's two dead-end tasks.
- **No framework has first-class spec/plan/review artifact types.**
  Gas Town has a polymorphic `issues` table; Skylark uses file
  conventions; Triad has type-specific templates but no shared header.

Any of these is a potential differentiator to build on top of whichever
substrate is chosen.

## 9. Trial scope (what the paper eval cannot answer)

Before committing to Option 3 / 3b, the following require hands-on
testing:

1. **Prompt-channel trial.** Dispatch one Polecat from Skylark where
   Skylark generates a full expert prompt body and routes it through
   `gt sling --var`. Confirm the Polecat receives it correctly as
   system instruction, not user content, and that the session starts
   with expected behavior. Measure any token / cache impact.
2. **Panel-review-inside-a-Polecat trial.** Can a Polecat dispatched
   by Skylark internally run Skylark's panel-review flow (multiple
   expert sub-agents) without Gas Town constraining subagent
   dispatch? Investigate whether Polecats can spawn their own
   subagents at all, and how that interacts with Gas Town's
   Refinery/Witness lifecycle assumptions.
3. **Artifact import trial.** Import an existing Skylark spec + plan
   into Beads, verify query-ability (`bd query`, `bd graph`), and
   measure the fidelity of the conversion (do `## Rationale` sections
   survive? Do cross-references resolve?).
4. **Refinery-under-Skylark trial.** Run one Skylark task to completion
   with the output landing via Gas Town's Refinery queue. Confirm
   bisecting behavior, CI-on-merged-state, and that the
   `polecat/<name>/<issue-id>` branch convention is compatible with
   Skylark's expectations.
5. **Witness/escalation under a Skylark-generated expert trial.**
   Verify that stuck-worker detection and escalation still work when
   the worker's role prompt was injected at dispatch rather than
   loaded from a role template.
6. **Cost / context measurement.** Measure a complete pipeline run on
   the combined stack — token spend per stage, compaction count,
   context high-water mark per worker. Compare to Skylark-only baseline
   from the ENG-180 retrospective (four-plus compactions, hand-written
   150-300 line resumption notes).

## 10. Recommended next session shape

1. Read this synthesis in full.
2. Decide: do we pursue Option 3, Option 3b, or a different path?
3. If Option 3/3b: scope the prompt-channel trial first. It answers
   the pivotal question and unblocks everything downstream.
4. Task atomicity spec work remains a separate workstream (per earlier
   scoping decision) but should assume Option 3/3b context when it
   resumes — i.e., atomicity should be expressed as Beads schema
   constraints + Skylark triage logic, not as standalone artifacts.

## 11. Housekeeping

- `docs/research/triad-source/` is a working mirror of the Triad plugin
  used to work around subagent sandbox restrictions. Safe to delete
  after synthesis; kept for now in case further evaluation is needed.
- All 27 per-domain reports are in `docs/research/reviews/` under
  `skylark/`, `gastown/`, `triad/` subdirectories and are the canonical
  evidence base. Quote from them rather than re-deriving.
- Criteria specs in `docs/research/criteria-review/` are the evaluation
  rubric and should be treated as versioned — future evaluations
  (e.g., of a fourth framework) should use the same criteria without
  modification unless explicitly versioned.

## 12. Summary for future-me

Gas Town wins the infrastructure; Skylark owns the review discipline;
Triad taught the decomposition cascade. The combination — Gas Town as
runtime, Skylark as domain layer, Triad-derived discipline patterns
layered on top — is the shape most likely to survive an ENG-180-class
run.

The single question blocking commitment is whether Gas Town's dispatch
path can carry a full per-task expert prompt body. That question is a
small hands-on trial away from being answered.

Everything else is working in favor of the combined shape.

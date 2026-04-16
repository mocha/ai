# Layer 4 — Expert Generation & Review

Skylark's core differentiator. This layer generates vocabulary-routed
expert prompts before worker execution and runs independent review after
worker execution. Nothing else in the ecosystem does this — the
methodology is encoded in Skylark's `_shared/` files and composed by the
`panel-review`, `solo-review`, and `develop` skills.

## 1. Purpose

Layer 4 operates in two distinct phases around Layer 5 (worker execution):

**Pre-dispatch** — Reads the task spec from Taskmaster, generates a
vocabulary-routed expert prompt using the `_shared/` methodology, runs
drift validation against current code, and writes the expert prompt to
`.skylark/experts/TASK-NNN.md`.

**Post-implementation** — Runs spec compliance solo review (verifying the
implementation matches the task spec without trusting the implementer's
report), then runs vocabulary-routed code quality panel review (multiple
expert sub-agents with distinct specializations), and emits a typed
verdict: SHIP, REVISE, or RETHINK. Hard 2-round cap — if issues persist
after round 2, escalate to user.

The two phases are separated by Layer 5. The orchestrator (Layer 2)
calls pre-dispatch before worker execution and post-implementation after
the worker returns.

## 2. Components

### Methodology files (`skills/_shared/`)

| File | Role |
|------|------|
| `expert-prompt-generator.md` | 5-step process for creating vocabulary-routed experts: analyze subject matter, draft identity, extract vocabulary, derive anti-patterns, assemble prompt |
| `vocabulary-guide.md` | Domain term extraction, practitioner-grade upgrade, attribution, clustering, validation (15-year practitioner test, no consultant-speak, no buzzword stacking, no superlatives) |
| `prompt-template.md` | Output skeleton for expert prompts — section order (identity, vocabulary, anti-patterns, context), mandatory review directive, rules |
| `risk-matrix.md` | Panel sizing, model selection, adaptive narrowing by risk level; scope escalation rules |
| `artifact-conventions.md` | Naming, location, frontmatter schema, provenance chain, changelog format for all pipeline artifacts |

### Skills

| Skill | Role in Layer 4 |
|-------|-----------------|
| `panel-review` | Dispatches 2-5 parallel expert sub-agents for code quality review. Synthesizes findings into consensus, unique catches, disagreements, and consolidated verdict. Building block — does not modify code or iterate. |
| `solo-review` | Dispatches a single expert reviewer. Used for spec compliance review ("do not trust the implementer's report"). |
| `develop` | Orchestrates the full per-task flow: expert generation, worktree setup, worker dispatch, spec compliance review, panel review, verdict handling. Calls into Layer 4 components at steps 2, 7, and 8. |

### Pre-dispatch drift validator

A shell or Python script (~50 lines) that greps planned function
signatures, type names, and import paths against the current codebase.
Catches cases where the task spec references code that has changed since
decomposition (e.g., a function was renamed, a file was moved, a type
signature changed).

Runs after expert prompt generation, before worker dispatch. If drift is
detected, the expert prompt is still written (it may be useful after the
drift is resolved), but the event signals `drift_check: fail` so the
orchestrator can escalate rather than dispatch a worker with stale
assumptions.

## 3. Inputs

### Pre-dispatch — from Layer 2 (Orchestrator)

```yaml
GENERATE_EXPERT:
  task_id: number
  task:
    id: number
    title: string
    description: string
    details: string
    acceptanceCriteria: string
    relevantFiles: [string]
    complexity: number
  risk: trivial | standard | elevated | critical
  codebase_context:
    entry_points: [string]        # key files for this task's domain
    recent_changes: [string]      # relevant recent git log entries
    related_tests: [string]       # test files in affected areas
```

`codebase_context` is assembled by Layer 2 before dispatch. It provides
the raw material for vocabulary extraction — Layer 4 reads these files
to identify domain terms, technology stack, key abstractions, and edge
cases specific to this task.

### Post-implementation — from Layer 2 (Orchestrator)

```yaml
RUN_REVIEW:
  task_id: number
  worktree_path: string           # where the implementation lives
  task_spec:                      # original task from Taskmaster
    title: string
    acceptanceCriteria: string
    relevantFiles: [string]
  worker_result:                  # from Layer 5
    status: DONE | DONE_WITH_CONCERNS
    files_changed: [string]
    concerns: string | null
  risk: trivial | standard | elevated | critical
  round: number                   # 1 or 2
```

Only `DONE` and `DONE_WITH_CONCERNS` reach Layer 4 review.
`NEEDS_CONTEXT` and `BLOCKED` are handled by the orchestrator before
review is invoked (re-dispatch with more context, or escalate to user).

## 4. Pre-dispatch Workflow

### Step 4.1: Read task spec and codebase context

Read the full task from the `GENERATE_EXPERT` event. Read every file
listed in `entry_points`, `relevantFiles`, and `related_tests`. Read
`recent_changes` to understand what has shifted since decomposition.

This is the raw material for vocabulary extraction. The goal is to
understand the task's domain deeply enough to generate a prompt that
activates the right knowledge clusters — not the whole project's
knowledge, but precisely the clusters relevant to this task.

### Step 4.2: Extract vocabulary

Follow `vocabulary-guide.md`:

1. **Term extraction** — scan the task spec and codebase context files.
   List every technical term, named concept, algorithm, pattern,
   framework, tool, protocol, library. Include implied-but-unnamed terms.

2. **Practitioner-grade upgrade** — for each term, rewrite as a senior
   with 15+ years would describe it to a peer. "incremental indexing"
   becomes "incremental indexing — mtime-based staleness detection,
   tombstone removal for deleted files."

3. **Attribution** — include originator where known. "circuit breaker
   pattern (Nygard)", "BM25 (Robertson & Zaragoza)."

4. **Clustering** — group into 3-5 clusters mirroring expert discourse
   patterns (terms that co-occur in expert conversation). Each cluster:
   4-8 terms with contextual detail. Never cluster by document sections.

5. **Validation** — cut anything that fails:
   - 15-year practitioner test: would a senior use this exact term with
     a peer?
   - No consultant-speak: ban "leverage", "best practices", "robust",
     "synergy", "cutting-edge", "world-class", "scalable solution"
   - No buzzword stacking: each term activates one specific cluster
   - No superlatives: route to marketing clusters, not engineering

Target: 15-30 terms in 3-5 clusters.

### Step 4.3: Generate expert prompt

Follow `expert-prompt-generator.md` and `prompt-template.md`:

1. **Identity** (<50 tokens) — real job title, primary responsibility,
   authority boundary. No superlatives. Scoped to this task's domain,
   not the whole project. A database migration task gets different
   routing than a CLI formatting task in the same project.

2. **Vocabulary** — the 3-5 clusters from step 4.2.

3. **Anti-patterns** (5-10) — named failure modes specific to this
   task's domain and technology. Each has: name, detection signal,
   resolution. Every vocabulary cluster needs at least one failure mode.
   At least one testing/verification failure mode. Prioritize
   domain-specific risks over generic advice.

4. **Context sections** — development-specific additions:
   - Operational guidance (error philosophy, concurrency model, edge
     case handling)
   - Testing expectations (language-idiomatic patterns, edge case
     fixtures, performance verification)
   - Deliverables (concrete files to create or modify, validated against
     anti-patterns for consistency)

Section order is deliberate and must not be rearranged:
- Identity first (primacy effect — highest attention weight)
- Vocabulary second (routes knowledge activation before task details)
- Anti-patterns third (steers away from failure modes before generation)
- Context sections last (task details benefit from recency effect)

### Step 4.4: Write expert prompt

Write the assembled prompt to `.skylark/experts/TASK-NNN.md`.

This file serves two purposes:
- Layer 5 writes it as `CLAUDE.md` in the worktree root, making it the
  worker's primary instructions
- It persists as an audit artifact — if a review fails, the expert
  prompt can be inspected to understand what knowledge was activated

### Step 4.5: Run drift validation

Execute the pre-dispatch drift validator against the current codebase.
The validator:

1. Extracts planned signatures from the task spec — function names, type
   names, import paths, file paths referenced in `relevantFiles` and
   `acceptanceCriteria`.

2. Greps each signature against the codebase.

3. Reports mismatches:
   - File referenced but does not exist
   - Function/type referenced but not found at expected location
   - Signature found but with different parameters or return type

If all signatures match: `drift_check: pass`.

If any mismatch: `drift_check: fail` with `drift_details` describing
each mismatch (e.g., "buildServer signature mismatch at
src/server.ts:42 — expected (config: ServerConfig) but found
(config: ServerConfig, logger: Logger)").

### Step 4.6: Emit EXPERT_READY

Emit the `EXPERT_READY` event to Layer 2 with the expert prompt path
and drift check result. The orchestrator decides what to do next based
on drift status.

## 5. Post-implementation Workflow

### Step 5.1: Spec compliance solo review

**Gate 1 of 2.** This runs before code quality review. The two gates are
independent — spec compliance checks "did you build what was asked" while
code quality checks "is what you built well-constructed."

Dispatch a solo reviewer sub-agent with a prompt constructed per
`solo-review` skill methodology:

- Identity: a spec compliance reviewer (not a code quality reviewer)
- Focus: requirements coverage, not code style

The reviewer receives:
- Full text of task requirements and acceptance criteria
- The implementer's claimed report (status, files changed, concerns)
- Access to the worktree to read actual implementation code

Critical directive embedded in the prompt:

> "Do not trust the implementer's report. The report may be incomplete,
> inaccurate, or optimistic. You MUST verify everything independently.
> Read the actual code. Compare actual implementation to requirements
> line by line. Check for missing pieces they claimed to implement.
> Look for extra features they did not mention."

The reviewer checks:
- **Missing requirements** — everything in acceptance criteria is
  implemented
- **Extra/unneeded work** — nothing was built that was not requested
  (YAGNI violations)
- **Misunderstandings** — requirements interpreted differently than
  intended
- **Verification is by reading code**, not by trusting the report

If spec compliant: proceed to step 5.2.

If issues found: return findings to orchestrator for worker re-dispatch.
The worker fixes gaps, then spec compliance review runs again. This loop
does not count against the 2-round review cap — the cap applies to code
quality panel rounds only.

### Step 5.2: Code quality panel review

**Gate 2 of 2.** Only runs after spec compliance passes.

Invoke `panel-review` skill with panel configuration determined by
risk level (see section 10). The panel reviews the implementation diff
(changed files in the worktree) for:

- Code quality and maintainability
- Test coverage and test quality
- Architecture fit (does the implementation respect existing patterns)
- File responsibility (each file has one clear responsibility with a
  well-defined interface)
- Unit decomposition (units can be understood and tested independently)
- File size (new files that are already large, or significant growth in
  existing files)

Each expert on the panel is generated using the full `_shared/`
methodology — distinct identity, vocabulary clusters with at least one
cluster unique to their perspective, anti-patterns specific to their
review angle, and the mandatory review directive:

> "You must identify at least one substantive issue or explicitly
> justify clearance with specific evidence."

Experts are dispatched in parallel (all Agent tool calls in the same
message). Sequential dispatch defeats the purpose of a panel.

### Step 5.3: Synthesize findings

The panel-review skill produces a structured synthesis:

- **Panel composition** — one line per expert: role, key vocabulary
  angle, why included
- **Consensus** — issues flagged independently by 2+ experts (highest
  confidence findings)
- **Unique findings** — important issues flagged by only one expert
  (domain-specific catches that justify multiple perspectives)
- **Disagreements** — where experts contradicted each other (present
  both sides, do not resolve artificially)
- **Blocking issues** — all severity:blocking issues, consolidated and
  deduplicated

### Step 5.4: Emit verdict

Synthesize a typed verdict from the panel findings:

| Condition | Verdict |
|-----------|---------|
| All experts say Ship (possibly with nits) | **SHIP** |
| Any expert says Rethink | **RETHINK** (one Rethink vetoes) |
| Otherwise (blocking or major issues, mixed verdicts) | **REVISE** |

Write the verdict to `.skylark/verdicts/TASK-NNN.json`:

```json
{
  "task_id": "TASK-NNN",
  "verdict": "SHIP | REVISE | RETHINK",
  "round": 1,
  "timestamp": "ISO-8601",
  "report_path": "docs/reports/R-YYYYMMDDHHMMSS-panel-synthesis.md",
  "findings_summary": {
    "blocking": 0,
    "major": 0,
    "minor": 0,
    "suggestion": 0
  },
  "panel_size": 3,
  "model": "sonnet | opus"
}
```

Emit `REVIEW_COMPLETE` to Layer 2 with the full verdict payload.

## 6. Outputs

### Pre-dispatch — to Layer 2 (Orchestrator)

```yaml
EXPERT_READY:
  task_id: number
  expert_prompt_path: string      # .skylark/experts/TASK-NNN.md
  drift_check: pass | fail
  drift_details: string | null    # e.g. "buildServer signature mismatch at src/server.ts:42"
```

### Post-implementation — to Layer 2 (Orchestrator)

```yaml
REVIEW_COMPLETE:
  task_id: number
  verdict: SHIP | REVISE | RETHINK
  round: number
  report_path: string             # docs/reports/R-<timestamp>-panel-synthesis.md
  findings:
    - severity: blocking | major | minor | suggestion
      description: string
      file: string
      line: number | null
```

### Persisted artifacts

| Artifact | Location | Purpose |
|----------|----------|---------|
| Expert prompt | `.skylark/experts/TASK-NNN.md` | Worker instructions + audit trail |
| Verdict | `.skylark/verdicts/TASK-NNN.json` | Machine-readable verdict for orchestrator and telemetry |
| Panel report | `docs/reports/R-<timestamp>-panel-synthesis.md` | Human-readable synthesis with full findings |
| Per-expert reports | `docs/reports/R-<timestamp>-panel-<expert-slug>.md` | Individual expert findings (audit trail) |

## 7. Downstream — How the Orchestrator Routes Verdicts

### Pre-dispatch routing

```
EXPERT_READY received by Layer 2:

  drift_check = pass
    → Dispatch to Layer 5 (worker execution) with expert_prompt_path
    → Worker writes expert prompt as CLAUDE.md in worktree root

  drift_check = fail
    → Escalate to user with drift_details
    → User resolves drift (update task spec or update code)
    → Re-run GENERATE_EXPERT after resolution
```

### Post-implementation routing

```
REVIEW_COMPLETE received by Layer 2:

  verdict = SHIP
    → Update task status to complete in Taskmaster (Layer 3)
    → Merge worktree branch
    → Proceed to next task in dependency order

  verdict = REVISE, round < 2
    → Re-dispatch worker (Layer 5) with review findings
    → Worker fixes issues in same worktree
    → Re-run RUN_REVIEW with round = round + 1

  verdict = REVISE, round = 2
    → Escalate to user with unresolved findings
    → User decides: fix manually, rethink approach, or override

  verdict = RETHINK (any round)
    → Escalate to user with fundamental concerns
    → Do not offer to iterate — the implementation needs significant
      rework before another review would be productive
```

The 2-round cap is absolute. The orchestrator must not re-dispatch
beyond round 2 regardless of how close the implementation appears to
passing. This prevents infinite loops and forces human judgment on
persistent issues.

## 8. Vocabulary Routing Methodology

### Why it works

LLMs organize knowledge in clusters within embedding space. Precise
domain terms activate specific deep clusters. Generic language activates
broad shallow clusters. A prompt containing "FTS5 virtual table,
bm25() ranking, column weight boosting" activates fundamentally
different knowledge than "full-text search optimization."

Vocabulary routing exploits this by front-loading precise domain terms
before the task details arrive. The model's attention mechanism gives
highest weight to early tokens (primacy effect) and recent tokens
(recency effect). The prompt structure is designed to exploit both.

### The 4-part prompt structure

1. **Identity** (<50 tokens) — real job title, primary responsibility,
   authority boundary. Primes the role via primacy effect. No
   superlatives (PRISM research shows superlatives degrade accuracy).
   One role per prompt (combined titles fragment knowledge activation).

2. **Vocabulary** (15-30 terms in 3-5 clusters) — precise domain terms
   validated by the 15-year practitioner test. Routes knowledge
   activation before task details arrive. Each term is
   practitioner-grade with contextual detail and attribution where
   known.

3. **Anti-patterns** (5-10 failure modes) — named patterns with
   detection signals and resolution steps. Steers away from failure
   modes before generation begins. Every vocabulary cluster has at
   least one associated failure mode.

4. **Context** — task-specific detail (review focus, operational
   guidance, deliverables). Benefits from recency effect — the model
   attends strongly to these details because they appear last.

This order is load-bearing and must not be rearranged. The cognitive
science rationale (primacy and recency effects on attention) is well
established and validated empirically through PRISM research on
role-playing prompts.

### The 15-year practitioner test

For every vocabulary term, ask: "Would a senior with 15+ years in this
domain use this exact term when speaking to a peer?"

| Passes | Fails |
|--------|-------|
| "Story mapping (Patton)" | "best practices for planning" |
| "connection pooling with PgBouncer" | "optimize performance" |
| "FTS5 virtual table — rank auxiliary function, column weight boosting via bm25()" | "full-text search" |
| "goroutine fan-out with errgroup (x/sync) — bounded concurrency, first-error cancellation" | "parallel processing" |
| "Drizzle Kit generate + migrate — push-based schema sync, migration journal" | "database migrations" |

Terms that fail are either upgraded to practitioner-grade or cut.

### Clustering rules

Clusters mirror expert discourse patterns — terms that co-occur in
expert conversation about a topic.

Good clustering (discourse-based):
- "System Design" cluster: hexagonal architecture, bounded context,
  event-driven, CQRS
- "Data Integrity" cluster: transaction isolation, optimistic locking,
  idempotency keys

Bad clustering (document-based):
- "Section 1 terms", "Section 2 terms" — follows document structure
  instead of knowledge structure

Each cluster: 4-8 terms. 3-5 clusters total. If a term doesn't fit
naturally into any cluster, it may be too generic or too tangential.

### Bespoke generation, never pre-built

Expert prompts are always generated fresh for each task. There are no
pre-built expert profiles or templates to select from. The methodology
files define the process, not the output. Every task gets vocabulary
tuned to its specific domain, even if two tasks in the same project
touch similar areas — the vocabulary clusters will differ based on which
specific aspects of the domain each task requires.

## 9. Review Architecture

### Dual-gate review

Layer 4 review is a two-gate process. Both gates must pass.

**Gate 1 — Spec compliance (solo review):**
- Single reviewer, focused on requirements coverage
- "Did you build what was asked?"
- Does not evaluate code quality, style, or architecture
- Uses the "do not trust the implementer" directive
- Failures loop back to the worker without counting against the
  2-round cap

**Gate 2 — Code quality (panel review):**
- Multiple experts with distinct specializations
- "Is what you built well-constructed?"
- Does not re-check spec compliance (Gate 1 already passed)
- Failures emit REVISE verdict and count against the 2-round cap

This separation prevents conflation. A spec-compliant implementation
can still have quality issues. A high-quality implementation can still
miss requirements. Checking both in one pass leads to ambiguous
findings where "fix this code quality issue" gets tangled with "you
missed a requirement."

### Independence rule

Round 2 panel experts do not receive round 1 findings. Each round is
an independent assessment.

Rationale: passing round 1 findings to round 2 reviewers creates
anchoring bias. They focus on verifying that specific issues were
fixed rather than reviewing the code with fresh eyes. New issues
introduced while fixing round 1 findings may be missed because
reviewers are primed to look for the old issues.

Exception: in adaptive narrowing (critical risk), the orchestrator
selects which 2-3 experts to retain based on round 1 finding strength,
but the retained experts still review independently without seeing
round 1 reports.

Note: the `panel-review` skill's multi-round protocol does provide
round 1 reports to round 2 experts for iterative improvement workflows.
When Layer 4 is the caller, it overrides this by requesting independent
rounds. The skill supports both modes — the caller controls whether
prior findings are passed through.

### "One Rethink vetoes" consolidation

When synthesizing panel verdicts into a single verdict:

- If **any** expert says Rethink, the consolidated verdict is Rethink —
  even if all other experts say Ship. One Rethink indicates a
  fundamental concern that cannot be addressed by minor revisions. It
  must be surfaced to the user.

- If **all** experts say Ship (possibly with minor nits), the
  consolidated verdict is Ship.

- Otherwise, the consolidated verdict is Revise.

This asymmetry is deliberate. A false negative on Rethink (missing a
fundamental problem) is far more costly than a false positive
(unnecessarily escalating to the user). The user can always override
a Rethink and proceed.

### Mandatory review directive

Every expert prompt (solo or panel) includes:

> "You must identify at least one substantive issue or explicitly
> justify clearance with specific evidence."

This prevents rubber-stamp approvals where experts default to "looks
good" without deep engagement. An empty Issues section is not
acceptable unless accompanied by detailed justification in the Verdict.

## 10. Risk-based Configuration

### Gate activation by risk level

```
                      trivial    standard     elevated       critical
                      -------    --------     --------       --------
Expert generation     skip       yes          yes            yes
Spec review (pre)     skip       skip         Opus 3-4       Opus 5->3 adaptive
Plan review (pre)     skip       skip         Opus 3-4       Opus 5->3 adaptive
Drift validation      skip       yes          yes            yes
Spec compliance       skip       Sonnet 1     Opus 1         Opus 1
Code quality panel    skip       Sonnet 2-3   Sonnet 3-4     Opus 3-4, 2 rounds
```

"Opus 5->3 adaptive" means round 1 uses 5 experts, round 2 narrows
to 2-3 (see adaptive narrowing below).

### Model selection rationale

- **Sonnet** for standard implementation review — catches structural
  issues, fast, lower cost. Appropriate when the task is bounded and
  the risk of subtle domain errors is low.

- **Opus** for spec/plan review at elevated+ — catches nuanced domain
  issues, architectural flaws, unstated assumptions. Worth the cost
  at review gates because catching a design error here prevents costly
  rework downstream.

- **Opus** for critical implementation review — load-bearing code
  warrants the strongest available model. The cost of missing a subtle
  bug in critical code far exceeds the model cost difference.

### Panel sizing

| Risk | Panel size | Rationale |
|------|-----------|-----------|
| trivial | skip | No review — trivial changes are self-evident |
| standard | 2-3 experts | Covers primary domain + one adjacent concern |
| elevated | 3-4 experts | Broader coverage — multiple domain angles |
| critical | 3-4 experts (up to 5 in adaptive round 1) | Maximum coverage without diminishing returns |

Beyond 5 experts, findings overlap significantly and synthesis becomes
noisy. The sweet spot is 3-4 for most cases.

### Adaptive narrowing (critical risk only)

At every review gate in the critical path:

- **Round 1:** 5 experts with broad coverage across domains
- **Round 2:** Narrow to the 2-3 experts who had the strongest findings
  and strongest opinions in round 1

Rationale: round 2 exists to verify that blocking issues were addressed,
not to re-review from scratch. Paying for 5 experts to confirm that nits
were fixed is wasteful. The experts who found the most significant
issues in round 1 are the ones best positioned to verify resolution.

Selection criteria for narrowing:
- Experts who raised blocking or major issues (not just minor/suggestion)
- Experts whose unique findings (not consensus duplicates) were most
  domain-specific
- In a tie, prefer experts whose vocabulary clusters are most relevant
  to the areas that required changes

Narrowed experts still receive fresh prompts (per the independence rule)
and review independently.

## 11. Error Handling

### Drift check failure

When `drift_check: fail`:

- The expert prompt is still written to `.skylark/experts/TASK-NNN.md`
  (it may be useful after drift is resolved)
- The `EXPERT_READY` event includes `drift_details` describing each
  mismatch
- The orchestrator escalates to the user with the drift details
- The user resolves the drift (updates the task spec to match current
  code, or reverts the code change that caused the drift)
- After resolution, the orchestrator re-runs `GENERATE_EXPERT` (a new
  expert prompt is generated — the old one is not reused, since the
  task spec or code may have changed)

Drift check failure is not a pipeline error — it is a signal that the
task spec and codebase have diverged. This is expected when tasks are
decomposed ahead of time and the codebase evolves during execution.

### Ambiguous verdicts

When panel findings are ambiguous (experts disagree, or findings are
borderline between REVISE and SHIP):

- If any finding has severity `blocking`, the verdict is REVISE
  regardless of expert-level verdicts
- If experts disagree but no blocking findings exist, surface the
  disagreement to the user with both sides and let the user decide
- Never resolve disagreements artificially — the value of a panel is
  surfacing genuine disagreement, not manufacturing false consensus

### Round cap exceeded

When round 2 completes with verdict REVISE:

- The orchestrator does not dispatch a third round
- All unresolved findings are presented to the user
- The verdict file records `round: 2` and the full findings
- The user decides: fix manually, rethink the approach, or override
  the review and ship anyway

This cap exists to prevent infinite loops. If two rounds of expert
review and worker revision have not resolved the issues, the problem
likely requires human judgment — either the task spec is ambiguous, the
implementation approach is wrong, or the review expectations are
miscalibrated.

### Expert generation failure

If vocabulary extraction produces fewer than 15 terms or fewer than 3
clusters:

- The task may be too narrowly scoped for vocabulary routing to add
  value
- For trivial tasks, this is expected (and trivial tasks skip expert
  generation entirely)
- For standard+ tasks, this signals that the task spec may lack
  sufficient detail — escalate to the user to enrich the spec before
  generating an expert

### Spec compliance loop

The spec compliance solo review (Gate 1) can loop: reviewer finds
issues, worker fixes, reviewer re-checks. This loop does not have an
explicit cap because it does not count against the 2-round review cap.
However, if spec compliance fails 3 times consecutively, the
orchestrator should treat it as a BLOCKED condition and escalate — the
worker is unable to match the spec, and the spec or the worker's
capability may need reassessment.

### Worker returns DONE_WITH_CONCERNS

When the worker reports DONE_WITH_CONCERNS, the orchestrator reads the
concerns before invoking Layer 4 review:

- If concerns are about **correctness or scope** (e.g., "I'm not sure
  this handles the edge case in requirement 3"), address them before
  review — either provide clarification and re-dispatch, or note them
  for the spec compliance reviewer to specifically verify
- If concerns are **observations** (e.g., "this file is getting large,
  might want to split in a future task"), note them and proceed to
  review normally — these are useful signals but do not block review

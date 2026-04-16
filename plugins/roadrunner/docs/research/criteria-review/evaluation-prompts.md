# Evaluation Prompts

Research-request prompts for the 18 independent evaluations (9 domains ×
2 frameworks). Each prompt is self-contained — an independent Opus
worker can be dispatched with the prompt text alone.

Reports land in `docs/research/evaluations/<framework>-<domain>.md`.

## Common method (for all prompts)

1. Read the domain spec in full. Understand every numbered requirement.
2. Investigate the target framework — design docs, source code, CLI
   help, config schemas. Cite specific files, line numbers, and
   command output.
3. For each requirement, classify conformance: **MEETS**, **PARTIAL**,
   **MISSING**, or **N/A** (with rationale for N/A).
4. Provide evidence for each classification: file paths, quoted design
   docs, CLI output, schema excerpts.
5. Note surprises — behaviors or design choices that affect conformance
   judgment but don't map to a specific requirement.
6. Flag open questions that only a hands-on trial could answer.

## Constraints (for all prompts)

- No speculation. If evidence cannot be found, mark **MISSING** with
  "no evidence found in \<locations searched\>".
- Do not compare frameworks. Evaluate only against the spec.
- Quote exact text where possible; do not paraphrase design docs.
- Do not attempt to write recommendations — synthesis is a separate
  round.

## Report format (for all prompts)

```markdown
# <Framework> — <Domain> Conformance Evaluation

## Summary

- Conformance at a glance: X MEETS, Y PARTIAL, Z MISSING, W N/A (out of N)
- Headline: one-sentence characterization of fit

## Per-Requirement Findings

### Req 1: <verbatim requirement text from spec>

- Verdict: MEETS | PARTIAL | MISSING | N/A
- Evidence: <file path, quote, CLI output, schema excerpt>
- Notes: <gap size, workarounds, caveats>

[repeat for every numbered requirement]

## Surprises

<behaviors/choices worth knowing that don't map to a specific requirement>

## Open Questions for Trial

<what only a hands-on trial could confirm>

## Source Index

<all files, docs, and commands consulted>
```

## Framework-specific context

### Skylark

- **Location:** current repo,
  `/Users/deuley/code/mocha/ai/plugins/skylark/`
- **Architecture:** Claude Code plugin. Skills in
  `skills/<name>/SKILL.md` with YAML frontmatter. Orchestrator skill is
  `skills/implement/SKILL.md`. Shared methodology in `skills/_shared/`.
- **Entry points:**
  - `skills/implement/SKILL.md` — pipeline orchestrator
  - `skills/_shared/` — vocabulary routing and expert generation
  - `CLAUDE.md` (project root) — conventions
  - `README.md`
- **Research inputs** (same directory structure):
  - `docs/research/2026-04-15-eng-180-retrospective.md` describes a
    real pipeline run and its failures.

### Gas Town

- **Location:** `~/code/tools/gastown/` (also accessible as
  `/Users/deuley/code/tools/gastown/`)
- **Architecture:** Go binary `gt` + Beads `bd`. TOML formulas in
  `internal/formula/formulas/`. Design docs in `docs/design/`.
- **Entry points:**
  - `README.md`
  - `docs/design/architecture.md`
  - `docs/glossary.md`
  - Domain-specific docs listed below per prompt.
- **CLI exploration:** run `gt --help`, `gt <subcommand> --help`,
  `bd --help`, `bd <subcommand> --help`. Both binaries are installed.
- **Research inputs:**
  - `docs/research/gastown-README.md` (copy of upstream README)

---

## Prompts

### 01-orchestration-model — Skylark

```
Evaluate Skylark against the Orchestration Model spec.

Spec: docs/spec/01-orchestration-model.md (read in full)
Target framework: Skylark
Framework location: /Users/deuley/code/mocha/ai/plugins/skylark/

Primary sources to investigate:
- skills/implement/SKILL.md (pipeline orchestrator entry point)
- skills/triage/, skills/prepare/, skills/brainstorm/, skills/spec-review/,
  skills/write-plan/, skills/plan-review/, skills/develop/, skills/finish/
- skills/_shared/ (shared methodology)
- CLAUDE.md (project conventions)
- docs/research/2026-04-15-eng-180-retrospective.md (real-run evidence)

For each of the 10 requirements in the spec, classify conformance
(MEETS/PARTIAL/MISSING/N/A) with evidence. Use the common method and
report format described in evaluation-prompts.md. Write the report to
docs/research/evaluations/skylark-01-orchestration-model.md.
```

### 01-orchestration-model — Gas Town

```
Evaluate Gas Town against the Orchestration Model spec.

Spec: docs/spec/01-orchestration-model.md (read in full)
Target framework: Gas Town
Framework location: ~/code/tools/gastown/

Primary sources to investigate:
- README.md
- docs/design/architecture.md
- docs/concepts/molecules.md (workflow templates)
- docs/design/scheduler.md
- internal/formula/formulas/*.toml
- CLI: gt --help, gt mayor --help, gt convoy --help, gt scheduler --help,
  bd --help, bd mol --help, bd cook --help

For each of the 10 requirements, classify conformance with evidence.
Follow the common method and report format. Write the report to
docs/research/evaluations/gastown-01-orchestration-model.md.
```

### 02-worker-model — Skylark

```
Evaluate Skylark against the Worker Model spec.

Spec: docs/spec/02-worker-model.md
Framework location: /Users/deuley/code/mocha/ai/plugins/skylark/

Primary sources:
- skills/develop/SKILL.md (how workers are dispatched)
- skills/_shared/ (expert generation, vocabulary routing, prompt
  template, artifact conventions)
- skills/panel-review/, skills/solo-review/ (review workers)
- Any agent-frontmatter examples showing tools / permissionMode / isolation

Write to docs/research/evaluations/skylark-02-worker-model.md.
```

### 02-worker-model — Gas Town

```
Evaluate Gas Town against the Worker Model spec.

Spec: docs/spec/02-worker-model.md
Framework location: ~/code/tools/gastown/

Primary sources:
- docs/design/polecat-lifecycle-patrol.md
- docs/agent-provider-integration.md
- docs/HOOKS.md
- docs/design/plugin-system.md
- Any template / role / identity config (e.g., templates/, .runtime/)
- CLI: gt sling --help, gt agents --help, gt prime --help,
  gt config agent --help, gt mayor start --help

Focus on: how are Polecats instantiated, what controls their prompt at
dispatch time, can role prompts be generated per-task or are they
config-baked, what runtimes are supported and via what adapter layer.

Write to docs/research/evaluations/gastown-02-worker-model.md.
```

### 03-artifact-and-task-substrate — Skylark

```
Evaluate Skylark against the Artifact and Task Substrate spec.

Spec: docs/spec/03-artifact-and-task-substrate.md
Framework location: /Users/deuley/code/mocha/ai/plugins/skylark/

Primary sources:
- skills/_shared/ (artifact conventions)
- skills/linear/ (Linear integration — external artifact reference)
- docs/ layout (how specs, plans, reviews are filed today)
- skills/implement/SKILL.md (how artifacts flow between stages)

Write to docs/research/evaluations/skylark-03-artifact-and-task-substrate.md.
```

### 03-artifact-and-task-substrate — Gas Town

```
Evaluate Gas Town against the Artifact and Task Substrate spec.

Spec: docs/spec/03-artifact-and-task-substrate.md
Framework location: ~/code/tools/gastown/

Primary sources:
- docs/design/convoy/ (convoy lifecycle)
- docs/HOOKS.md (git worktree persistent storage)
- docs/design/architecture.md
- Beads integration: bd --help, bd list --help, bd show --help,
  bd create --help; investigate the Beads repo reference in Gas Town
  README (github.com/steveyegge/beads) via any local copy if present
- CLI: gt convoy --help, gt hooks --help

Focus on: bead schema and ID format, queryability, atomicity, git-backing,
cross-reference model, idempotency, event emission.

Write to docs/research/evaluations/gastown-03-artifact-and-task-substrate.md.
```

### 04-review-and-gate-model — Skylark

```
Evaluate Skylark against the Review and Gate Model spec.

Spec: docs/spec/04-review-and-gate-model.md
Framework location: /Users/deuley/code/mocha/ai/plugins/skylark/

Primary sources:
- skills/panel-review/SKILL.md
- skills/solo-review/SKILL.md
- skills/spec-review/SKILL.md
- skills/plan-review/SKILL.md
- skills/develop/SKILL.md (review steps within develop)
- docs/research/2026-04-15-eng-180-retrospective.md (evidence of gate
  behavior in practice)

Write to docs/research/evaluations/skylark-04-review-and-gate-model.md.
```

### 04-review-and-gate-model — Gas Town

```
Evaluate Gas Town against the Review and Gate Model spec.

Spec: docs/spec/04-review-and-gate-model.md
Framework location: ~/code/tools/gastown/

Primary sources:
- docs/design/escalation.md
- docs/design/witness-at-team-lead.md
- docs/design/polecat-lifecycle-patrol.md (any review/verify steps)
- Formula steps with review-like semantics in internal/formula/formulas/
- CLI: gt escalate --help, gt feed --problems

Note: Gas Town may not have a native panel-review concept. If so,
mark the relevant requirements MISSING with evidence — do not infer
support from adjacent features.

Write to docs/research/evaluations/gastown-04-review-and-gate-model.md.
```

### 05-context-engineering — Skylark

```
Evaluate Skylark against the Context Engineering spec.

Spec: docs/spec/05-context-engineering.md
Framework location: /Users/deuley/code/mocha/ai/plugins/skylark/

Primary sources:
- skills/implement/SKILL.md (phase handoffs)
- skills/_shared/ (artifact conventions, handoff patterns)
- Any compaction / resumption notes in docs/
- docs/research/2026-04-15-eng-180-retrospective.md (compaction events
  and their handling in practice)

Write to docs/research/evaluations/skylark-05-context-engineering.md.
```

### 05-context-engineering — Gas Town

```
Evaluate Gas Town against the Context Engineering spec.

Spec: docs/spec/05-context-engineering.md
Framework location: ~/code/tools/gastown/

Primary sources:
- Seance: docs/glossary.md, gt seance --help
- docs/HOOKS.md (persistent storage across sessions)
- docs/design/convoy/ (state across workers)
- docs/otel-data-model.md (what's persisted via telemetry)
- CLI: gt prime --help, gt seance --help, gt handoff (if present)

Focus on: predecessor-session discovery (Seance), handoff protocol,
compaction handling, disk-canonical state, per-worker context budgets.

Write to docs/research/evaluations/gastown-05-context-engineering.md.
```

### 06-task-decomposition-and-sizing — Skylark

```
Evaluate Skylark against the Task Decomposition and Sizing spec.

Spec: docs/spec/06-task-decomposition-and-sizing.md
Framework location: /Users/deuley/code/mocha/ai/plugins/skylark/

Primary sources:
- skills/write-plan/SKILL.md
- skills/plan-review/SKILL.md
- skills/triage/SKILL.md (intake funnel)
- skills/brainstorm/SKILL.md
- skills/implement/SKILL.md (risk-routing)
- skills/_shared/ (risk matrix)
- docs/research/2026-04-15-eng-180-retrospective.md (decomposition
  failure in practice — the 6000+ LOC PR)

Write to docs/research/evaluations/skylark-06-task-decomposition-and-sizing.md.
```

### 06-task-decomposition-and-sizing — Gas Town

```
Evaluate Gas Town against the Task Decomposition and Sizing spec.

Spec: docs/spec/06-task-decomposition-and-sizing.md
Framework location: ~/code/tools/gastown/

Primary sources:
- docs/design/architecture.md
- docs/concepts/molecules.md (workflow decomposition)
- docs/design/convoy/ (how work is bundled)
- Mayor role / prompt — investigate how it decomposes work
  (templates/, internal/, or similar)
- CLI: gt mayor --help, gt convoy create --help, bd mol --help,
  bd cook --help

Note: Gas Town may not address atomicity directly — that might be the
Mayor's responsibility as an LLM role rather than a framework feature.
Report what the framework provides vs what is delegated to the Mayor's
reasoning.

Write to docs/research/evaluations/gastown-06-task-decomposition-and-sizing.md.
```

### 07-integration-and-merge-model — Skylark

```
Evaluate Skylark against the Integration and Merge Model spec.

Spec: docs/spec/07-integration-and-merge-model.md
Framework location: /Users/deuley/code/mocha/ai/plugins/skylark/

Primary sources:
- skills/finish/SKILL.md (completion and merge flow)
- skills/develop/SKILL.md (branch / commit behavior)
- Any CI integration in skills or docs
- docs/research/2026-04-15-eng-180-retrospective.md (merge-at-end
  failure mode)

Write to docs/research/evaluations/skylark-07-integration-and-merge-model.md.
```

### 07-integration-and-merge-model — Gas Town

```
Evaluate Gas Town against the Integration and Merge Model spec.

Spec: docs/spec/07-integration-and-merge-model.md
Framework location: ~/code/tools/gastown/

Primary sources:
- Refinery: docs/ references, internal/refinery/ if present,
  docs/design/architecture.md section on merge queue
- docs/design/polecat-lifecycle-patrol.md (gt done behavior)
- CLI: gt done --help (if present), gt refinery --help (if present)

Focus on: Bors-style queue, bisecting behavior, CI reaction loop,
branch-per-task, stale-lock recovery, conflict handling.

Write to docs/research/evaluations/gastown-07-integration-and-merge-model.md.
```

### 08-monitoring-and-recovery — Skylark

```
Evaluate Skylark against the Monitoring and Recovery spec.

Spec: docs/spec/08-monitoring-and-recovery.md
Framework location: /Users/deuley/code/mocha/ai/plugins/skylark/

Primary sources:
- Any observability / audit logging in skills/ or docs/
- skills/finish/SKILL.md (post-run state capture)
- docs/research/2026-04-15-eng-180-retrospective.md (stuck / stall
  patterns observed)

Note: Skylark is a plugin; much of this domain likely depends on the
host harness (Claude Code). Distinguish what Skylark provides vs what
it relies on the harness for.

Write to docs/research/evaluations/skylark-08-monitoring-and-recovery.md.
```

### 08-monitoring-and-recovery — Gas Town

```
Evaluate Gas Town against the Monitoring and Recovery spec.

Spec: docs/spec/08-monitoring-and-recovery.md
Framework location: ~/code/tools/gastown/

Primary sources:
- docs/design/witness-at-team-lead.md
- docs/design/polecat-lifecycle-patrol.md
- docs/design/escalation.md
- docs/otel-data-model.md, docs/design/otel/
- Dashboard: gt dashboard, gt feed, gt feed --problems
- CLI: gt patrol --help, gt escalate --help, gt seance --help

Write to docs/research/evaluations/gastown-08-monitoring-and-recovery.md.
```

### 09-environment-isolation — Skylark

```
Evaluate Skylark against the Environment Isolation spec.

Spec: docs/spec/09-environment-isolation.md
Framework location: /Users/deuley/code/mocha/ai/plugins/skylark/

Primary sources:
- Any .claude/settings.json or similar permission / sandbox config
- skills/develop/ (worker dispatch — does it set permissionMode,
  isolation, tools?)
- skills/_shared/ (any provisioning conventions)
- docs/research/claude-code-sandbox-ergonomics-report.md (host-harness
  best practices)

Note: Skylark is a plugin. Much of isolation is host-harness
configuration. Report what Skylark provides, assumes, or delegates.

Write to docs/research/evaluations/skylark-09-environment-isolation.md.
```

### 09-environment-isolation — Gas Town

```
Evaluate Gas Town against the Environment Isolation spec.

Spec: docs/spec/09-environment-isolation.md
Framework location: ~/code/tools/gastown/

Primary sources:
- Dockerfile, docker-compose.yml, docker-entrypoint.sh (provisioning
  shape)
- docs/INSTALLING.md
- docs/HOOKS.md (worktree-based isolation)
- Any sandbox / permission config in templates/, .claude/, or scripts/
- CLI: gt install --help, gt rig --help

Focus on: per-worker isolation units, container provisioning model
(orchestrator-managed vs direct), network + filesystem allow-lists,
credential scoping.

Write to docs/research/evaluations/gastown-09-environment-isolation.md.
```

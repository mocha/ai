# Skylark Pipeline Spec

Framework-agnostic specification of what a multi-agent development pipeline
should do, derived from:

- `docs/research/claude-code-sandbox-ergonomics-report.md`
- `docs/research/context-window-mgmt-and-compaction.md`
- `docs/research/2026-04-15-eng-180-retrospective.md`
- `docs/research/gastown-README.md`

Each domain file below defines **what good looks like**. Skylark and Gas Town
are evaluated against this spec independently — see
`docs/research/evaluations/` for the per-framework reports. The spec itself
does not reference either framework.

## Domains

1. [Orchestration model](01-orchestration-model.md)
2. [Worker model](02-worker-model.md)
3. [Artifact and task substrate](03-artifact-and-task-substrate.md)
4. [Review and gate model](04-review-and-gate-model.md)
5. [Context engineering](05-context-engineering.md)
6. [Task decomposition and sizing](06-task-decomposition-and-sizing.md)
7. [Integration and merge model](07-integration-and-merge-model.md)
8. [Monitoring and recovery](08-monitoring-and-recovery.md)
9. [Environment isolation](09-environment-isolation.md)

## Evaluation method

For each domain, an independent worker reads the spec and evaluates one
framework (Skylark *or* Gas Town) against every numbered requirement. See
[evaluation-prompts.md](evaluation-prompts.md) for the research-request
prompts. Reports land in
`docs/research/evaluations/<framework>-<domain>.md`.

Synthesis — and any adoption recommendation — happens only after all 18
reports are complete. No rubric is locked in advance.

## Out of scope

- **Federated work coordination** (Gas Town's Wasteland). Intentionally
  excluded from this evaluation. Monorepo / multi-repo workspaces cover the
  relevant ground for now.

## File shape

Each domain file contains:

- **Purpose** — one-paragraph scope statement.
- **Key forces** — what makes this hard, cited from the research where
  possible.
- **Best-practice requirements** — numbered, testable criteria. The
  acceptance criteria for evaluation.
- **Open questions** — things the research did not settle.
- **Trial considerations** — what hands-on testing would need to confirm.

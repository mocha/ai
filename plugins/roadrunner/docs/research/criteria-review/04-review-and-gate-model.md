# 04 — Review and Gate Model

## Purpose

Defines how quality gates work between pipeline stages: who reviews,
against what criteria, with what verdicts, and under what bounded revision
loop. Gates are the mechanism that prevents cascading low-quality work
from compounding across stages.

## Key forces

- The ENG-180 retrospective documented that 40+ per-task panels
  rediscovered the same recurring taxonomy (missing `return`,
  non-atomic cross-system writes, JWT-trust-without-DB-cross-check,
  fail-open ambiguity, test-only surface leaking). Recurring findings are
  a signal to automate, not re-review.
- RPI methodology prescribes explicit gates: **FAR** (Factual,
  Actionable, Relevant) after research; **FACTS** (Feasible, Atomic,
  Clear, Testable, Scoped) after planning.
- Single-reviewer passes miss issues that parallel multi-expert panels
  catch. Panels are expensive but valuable for elevated+ risk work.
- Unbounded revision loops waste cycles — ENG-180's per-task panels ran
  multiple rounds when a single human decision would have converged
  faster.
- Plan-to-reality drift (the plan said `buildServer({ verifyToken })`;
  code was `buildServer({ auth: { verifyToken } })`) happens when no
  gate validates the plan against current code before dispatch.

## Best-practice requirements

1. **Stage gates are explicit.** Stage completion does not imply
   stage-passed. Every stage has a gate artifact (verdict + evidence)
   separate from the work artifact.
2. **Typed verdicts.** Gates emit one of `approve`, `revise`, `reject`,
   `escalate`. No ambiguous "looks good" prose-only outcomes.
3. **Multi-reviewer panels for high-risk stages.** Elevated+ risk stages
   support parallel independent review by multiple domain experts,
   followed by synthesis.
4. **Panel reviewers generated per-domain at dispatch time.** Reviewers
   are not a fixed roster — they are generated or selected based on the
   stage's domain, matching the Worker Model requirement for per-task
   prompt generation.
5. **Bounded revision loops.** Max N rounds (default 2) before escalation
   to human or higher-tier review. Loops do not run unbounded.
6. **Gate criteria defined in the spec.** Each stage's gate references a
   checklist or criteria document — reviewers do not invent criteria
   on the fly.
7. **Recurring findings become automation.** Any pattern that surfaces
   across >2 reviews is converted to a lint rule, CI check, or
   pre-dispatch validator. The review layer does not keep rediscovering
   the same class of bug.
8. **Evidenced approvals.** Approval records include reviewer identity,
   timestamp, criteria reference, and findings. Stored in the artifact
   substrate, not ephemeral chat.
9. **Severity-routed escalation.** Escalation from a failed gate routes
   by severity and target audience — peer review, senior reviewer, human
   operator, external approver.
10. **Lightweight and heavyweight variants.** Trivial risk gets a
    single-reviewer conformance check; elevated/critical gets a full
    panel. Gate shape is a function of risk level.
11. **Plan-vs-reality validation.** Before any implementation worker is
    dispatched, a gate checks the plan's signatures/paths/assumptions
    against current code and blocks on drift.
12. **Human override.** A human operator can always override a gate —
    approve a rejected artifact, or reject an approved one — with an
    auditable record of the override.
13. **Gates are composable primitives.** Specific stages (spec review,
    plan review, implementation review) compose a shared gate primitive
    rather than each re-implementing review logic.

## Open questions

- How to calibrate "recurring finding" thresholds — 3 occurrences? Same
  worker-generated pattern? Same root cause?
- Panel-review cost vs value — the ENG-180 retro suggests per-task
  panels were expensive and rediscovered spec-gate issues. How to tune?
- Human-in-loop latency vs pipeline throughput — at what risk level
  does human review become the default?
- Synthesis of multi-reviewer outputs — voting, weighted, LLM-summarized?

## Trial considerations

- Run a full review cycle on a realistic artifact and measure rounds to
  convergence.
- Submit an artifact with a known recurring-pattern defect and verify
  automation catches it without invoking a panel.
- Force a panel disagreement and verify synthesis resolves cleanly.
- Verify human override writes an auditable record that survives the
  pipeline's next run.

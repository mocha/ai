# Risk Matrix

Risk levels and which pipeline gates are active at each level. Referenced by `/skylark:triage` and `/skylark:implement`.

## Risk Level Classification

| Signal | Risk Level |
|--------|-----------|
| Single file, clear fix, no architectural impact | **trivial** |
| Few files, one bounded context, clear ACs | **standard** |
| Multiple contexts, schema changes, auth/billing | **elevated** |
| Architectural change, new integration, breaking change, load-bearing system | **critical** |

Risk can be:
- **Declared** by the user ("this is load-bearing")
- **Inferred** from issue labels, blocking relations, domain clusters touched
- **Escalated** mid-pipeline if scope grows

## Gate Activation Matrix

```
                      trivial    standard     elevated       critical
                      ───────    ────────     ────────       ────────
PREPARE                skip       yes          yes            yes
BRAINSTORM             skip       skip         if no spec     if no spec
SPEC-REVIEW            skip       skip         Opus 3-4       Opus 5→3 adaptive
PLAN                   skip       skip         yes            yes
PLAN-REVIEW            skip       skip         Opus 3-4       Opus 5→3 adaptive
DEVELOP worktree       no         yes          yes            yes
DEVELOP vocab expert   no         yes          yes            yes
DEVELOP panel          no         Sonnet 2-3   Sonnet 3-4     Opus 3-4, 2 rounds
FINISH session notes   skip       yes          yes            yes
FINISH arch docs       skip       if needed    yes            mandatory
User confirm gates     no         no           on escalation  every gate
```

## Model Selection Rationale

- **Sonnet** for standard implementation review — catches structural issues, fast, lower cost
- **Opus** for spec/plan review at elevated+ — catches nuanced domain issues, architecture flaws
- **Opus** for critical implementation review — load-bearing code warrants extra scrutiny

## Adaptive Panel Narrowing (Critical Only)

At every review gate in the critical path:
- **Round 1:** 5 experts, broad coverage
- **Round 2:** Narrow to 2-3 experts who had the strongest findings and strongest opinions from round 1
- Rationale: don't pay for 5 experts to confirm nits are fixed

## Size Guardrails

Hard limits on what gets dispatched to workers. These exist to prevent tasks that exhaust a Sonnet context window and leave no room for the actual implementation work.

**The constraint is at the task level, not the spec/plan level.** Specs and plans are consumed by reviewers and planners who can handle larger documents. Tasks are the unit that hits the hard limit — they get dispatched to Sonnet workers with finite context.

| Artifact | Guardrail | Rationale |
|----------|-----------|-----------|
| Individual task spec | ~2 000 tokens | Small, focused, self-contained — one clear job for the worker |
| Total dispatch payload (task + parent context + expert prompt) | ≤ 40 000 tokens (20 % of Sonnet's 200k context) | Leaves 80 % of context for the worker to read code, write code, run tests, and self-review |
| Spec document | No token cap — decompose by **scope** (3+ bounded contexts) | Dense in abstractions; size comes from complexity, not sprawl |
| Plan document | No token cap — decompose by **scope** (8+ tasks or dense cross-deps) | Plans are large because they contain many tasks; decompose the tasks, not the plan |

**When to check task size:**
- When writing the plan (write-plan self-review)
- When extracting task specs (plan-review)
- After revising task specs post-review (plan-review)
- Before dispatching a task to an implementer (develop, dispatch-with-mux)

**Token estimation:** ~4 characters per token. A 2 000-token task spec is roughly 8 000 characters / ~1 200 words of technical prose. Err on the side of splitting tasks smaller.

## Scope Escalation

When mid-implementation discovery reveals higher complexity:

| Escalation | Action |
|-----------|--------|
| trivial → standard | Pause. Create worktree. Continue with panel validation added. |
| standard → elevated | Pause. Notify user: "This touches [X, Y, Z]. Recommend spec + plan review." User decides. |
| elevated → critical | Pause. Notify user: "This is load-bearing. Recommend full pipeline." User decides. |

Escalation is always **pause + notify**, never automatic pipeline restart.

# Risk Matrix

Risk levels and which pipeline gates are active at each level. Referenced by `/skylark:triage` and `/skylark:implement`.

## Risk Level Classification

| Signal | Risk Level |
|--------|-----------|
| Single file, clear fix, no architectural impact | **trivial** |
| Few files, one bounded context, clear ACs, including single-context schema migrations and self-contained auth/billing tweaks | **standard** |
| Cross-context changes (3+ bounded contexts), or auth/billing/schema changes that touch multiple consumers | **elevated** |
| Architectural change, new integration, breaking change, load-bearing system | **critical** |

Calibration note: `standard` is the default tier for most focused work. `elevated` is reserved for changes that genuinely cross boundaries — single-context schema migrations and isolated auth tweaks do **not** escalate on their own. This keeps expensive review gates off work that a competent implementer handles in-process.

Risk can be:
- **Declared** by the user ("this is load-bearing")
- **Inferred** from issue labels, blocking relations, domain clusters touched
- **Escalated** mid-pipeline if scope grows

## Gate Activation Matrix

```
                      trivial    standard        elevated          critical
                      ───────    ────────        ────────          ────────
PREPARE                skip       yes             yes               yes
BRAINSTORM             skip       skip            if no spec        if no spec
SPEC-REVIEW            skip       skip            Opus 2, 1 round   Opus 5→3 adaptive, 2 rounds
PLAN                   skip       skip            yes               yes
PLAN-REVIEW            skip       skip            Opus 2/task, 1    Opus 3→2 adaptive, 2 rounds
DEVELOP worktree       no         yes             yes               yes
DEVELOP vocab expert   no         yes             yes               yes
DEVELOP panel          no         Sonnet 2, 1     Sonnet 2-3, 1     Opus 3, 2 rounds
FINISH session notes   skip       yes             yes               yes
FINISH arch docs       skip       if needed       yes               mandatory
User confirm gates     no         no              on escalation     every gate
```

Calibration note: panel sizes and round counts at `elevated` were reduced for Opus 4.7+ implementers. The implementer itself catches most of what a second reviewer round would flag. `critical` keeps the full multi-round safety net unchanged.

## Model Selection Rationale

- **Sonnet** for standard and elevated implementation review — catches structural issues, fast, lower cost
- **Opus** for spec/plan review at elevated+ — catches nuanced domain issues, architecture flaws
- **Opus** for critical implementation review — load-bearing code warrants extra scrutiny

## Adaptive Panel Narrowing (Critical Only)

At every review gate in the critical path:
- **Round 1:** 3-5 experts, broad coverage
- **Round 2:** Narrow to 2-3 experts who had the strongest findings and strongest opinions from round 1
- Rationale: don't pay for the full panel to confirm nits are fixed

Elevated runs a single round with a 2-expert panel and does not narrow — one pass, then proceed.

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

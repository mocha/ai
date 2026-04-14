---
name: triage
description: Internal classification stage for the implement pipeline. Determines input type (issue, spec, plan, task, raw idea, raw problem), detects current state from artifacts, assesses risk level, and returns the pipeline path. Searches Linear for prior art before proceeding. Called by implement — not user-invocable.
---

# Triage

Classify input, detect state, assess risk, determine pipeline path. This is the routing brain of the pipeline.

## When Called

Called by `/skylark:implement` as the first pipeline stage. Receives the user's input (issue ID, file path, description, or raw idea).

## Process

### Step 1: Search for Prior Art

Before classifying anything, search Linear and local artifacts for existing work:
- Search Linear issues by keywords from the input (see `linear/SKILL.md` conventions)
- Glob `docs/specs/`, `docs/plans/`, `docs/superpowers/specs/`, `docs/superpowers/plans/` for matching slugs
- If related work exists, surface it to the user: "Found ENG-XXX which looks related. Should we continue with that, or is this separate?"

### Step 2: Classify Input Type

| Input | Type | Detection |
|-------|------|-----------|
| `ENG-XXX` or Linear issue reference | `issue` | Matches issue ID pattern |
| File path to `docs/specs/*.md` | `spec` | Path contains `/specs/` |
| File path to `docs/plans/*.md` | `plan` | Path contains `/plans/` |
| File path to `docs/tasks/*.md` | `task` | Path contains `/tasks/` |
| Bug report, error message, failing test | `raw-problem` | Describes a malfunction |
| Feature idea, "I want...", "we should..." | `raw-idea` | Describes desired behavior |

If ambiguous, ask the user.

### Step 3: Detect Current State

State is determined from **artifacts**, not from memory or conversation history.

**For issues:**
- `new` — no execution plan section, no linked spec/plan
- `prepared` — has vocabulary payload or linked spec in docs/specs/
- `in-progress` — has worktree branch or task specs with `status: in-progress`
- `blocked` — Linear status is blocked, or has unresolved "rethink" verdicts

**For specs:**
- `draft` — file exists, no panel report references it
- `reviewed` — panel report exists in `docs/reports/` with `target` pointing to this spec
- `approved` — panel report exists with `verdict: ship`

**For plans:**
- `draft` — file exists, no panel reports reference it
- `reviewed` — panel reports exist for the plan
- `approved` — all panel reports show `verdict: ship`
- `decomposed` — task spec files exist in `docs/tasks/` with `parent` pointing to this plan

**For tasks:**
- `pending` — file exists, `status: pending` or no worktree
- `in-progress` — worktree exists for this task
- `complete` — `status: complete` in frontmatter
- `blocked` — `status: blocked` or panel report with `verdict: rethink`

### Step 4: Assess Risk Level

Read `_shared/risk-matrix.md` for the full classification table. Apply in order:

1. **User declaration** takes precedence ("this is load-bearing" → critical)
2. **Issue labels/metadata** in Linear (priority, project labels)
3. **Domain analysis:**
   - Single file, clear fix → trivial
   - Few files, one bounded context → standard
   - Multiple contexts, schema changes, auth/billing → elevated
   - Architectural change, new integration, breaking change → critical
4. **Blocking relation density** — issues that block many others trend toward elevated+

### Step 5: Determine Pipeline Path

Based on type, state, and risk, determine which pipeline stages to run. Reference the paths from the unified toolchain sketch:

| Input | State | Risk | Path |
|-------|-------|------|------|
| issue | new | trivial | DEVELOP → FINISH |
| issue | new | standard | PREPARE → DEVELOP → FINISH |
| issue | new | elevated | PREPARE → SPEC-REVIEW → PLAN → PLAN-REVIEW → DEVELOP → FINISH |
| issue | new | critical | Same as elevated, with larger panels and user confirmation at each gate |
| issue | prepared | any | Enter at DEVELOP (or SPEC-REVIEW if elevated+ and spec not yet reviewed) |
| spec | draft | any | SPEC-REVIEW → PLAN → PLAN-REVIEW → DEVELOP → FINISH |
| spec | approved | any | PLAN → PLAN-REVIEW → DEVELOP → FINISH |
| plan | draft | any | PLAN-REVIEW → DEVELOP → FINISH |
| plan | approved | any | PLAN-REVIEW (decompose only) → DEVELOP → FINISH |
| plan | decomposed | any | DEVELOP → FINISH |
| task | pending | any | DEVELOP → FINISH |
| task | in-progress | any | DEVELOP (resume) → FINISH |
| raw-idea | — | small | PREPARE → route by risk |
| raw-idea | — | feature-scale | BRAINSTORM → SPEC-REVIEW → continues |
| raw-problem | — | any | PREPARE (investigate) → re-triage by risk |

**Decomposition check:** If a spec touches 3+ bounded contexts or a plan would produce 8+ tasks, flag for decomposition before entering expensive review gates.

### Step 6: Return Classification

Return to the caller (`/skylark:implement`):

```
type: issue | spec | plan | task | raw-idea | raw-problem
state: new | draft | reviewed | approved | decomposed | in-progress | ...
risk: trivial | standard | elevated | critical
path: [ordered list of pipeline stages to run]
issue_id: ENG-XXX (if applicable)
artifact_path: docs/specs/... (if applicable)
decompose: true | false (if oversized)
```

This classification is ephemeral — not persisted. Triage is cheap to re-run.

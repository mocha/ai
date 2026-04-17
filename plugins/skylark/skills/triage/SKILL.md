---
name: triage
description: Internal classification stage for the implement pipeline. Determines input type (spec, plan, task, raw idea, raw problem, or external reference), detects current state from artifacts, assesses risk level, and returns the pipeline path. Searches existing docs/ artifacts for prior art before proceeding. Called by implement — not user-invocable.
---

# Triage

Classify input, detect state, assess risk, determine pipeline path. This is the routing brain of the pipeline.

## When Called

Called by `/skylark:implement` as the first pipeline stage. Receives the user's input — a file path, a description, or an external tracker reference.

## Process

### Step 1: Search for Prior Art

Before classifying anything, search local artifacts for existing work:
- Grep `docs/specs/`, `docs/plans/` for matching keywords from the input
- Grep `docs/strategy/` and `docs/architecture/` for relevant design principles and prior architectural decisions
- Search beads for related tasks: `bd search "<keywords>" --json` or `bd list --json`
- Also check `docs/superpowers/specs/` and `docs/superpowers/plans/` for legacy artifacts
- Search `git log` for related commit messages
- If related work exists, surface it to the user: "Found SPEC-003 which looks related. Should we continue with that, or is this separate?"

### Step 2: Classify Input Type

| Input | Type | Detection |
|-------|------|-----------|
| File path to `docs/specs/*.md` | `spec` | Path contains `/specs/` and has spec frontmatter |
| File path to `docs/plans/*.md` | `plan` | Path contains `/plans/` and has plan frontmatter |
| Bead ID (e.g., `bd-a1b2`) | `task` | Matches `bd-` prefix; verify via `bd show <id> --json` |
| File path to any other file | `raw-input` | Read it, evaluate content maturity (see below) |
| External tracker reference (e.g., `#42`, `ENG-142`) | `external-ref` | Matches common tracker patterns |
| Bug report, error message, failing test | `raw-problem` | Describes a malfunction |
| Feature idea, "I want...", "we should..." | `raw-idea` | Describes desired behavior |

**Evaluating raw input files:** The user may point at a file they've scribbled notes into. Read it and assess maturity:
- Has clear ACs, architecture, data flow? → Treat as a `spec`
- Has ordered tasks with file paths and code? → Treat as a `plan`
- Has a single bounded task description? → Treat as a `task`
- Rough notes, half-formed ideas? → Treat as a `raw-idea`
- Describes something broken? → Treat as a `raw-problem`

If ambiguous, ask the user.

### Step 3: Detect Current State

State is determined from **artifacts**, not from memory or conversation history.

**For specs:**
- `draft` — file exists, no panel report references it
- `reviewed` — panel report exists in `docs/reports/` with `target` pointing to this spec
- `approved` — panel report exists with `verdict: ship`

**For plans:**
- `draft` — file exists, no panel reports reference it
- `reviewed` — panel reports exist for the plan
- `approved` — all panel reports show `verdict: ship`
- `decomposed` — beads exist with `spec_id` pointing to this plan (`bd list --json` and filter)

**For tasks (managed via beads):**
- `pending` — `bd show <id> --json` shows `status: open`
- `in-progress` — `bd show <id> --json` shows `status: in_progress`
- `complete` — `bd show <id> --json` shows `status: closed`
- `blocked` — `bd show <id> --json` shows `status: blocked`

**For external references:**
- Check if any existing artifact has `external_ref` matching the reference
- If found, detect state from that artifact
- If not found, treat as `new`

### Step 4: Assess Risk Level

Read `_shared/risk-matrix.md` for the full classification table. Apply in order:

1. **User declaration** takes precedence ("this is load-bearing" → critical)
2. **Domain analysis:**
   - Single file, clear fix → trivial
   - Few files, one bounded context (including single-context schema migrations and self-contained auth/billing tweaks) → standard
   - Cross-context changes touching 3+ bounded contexts, or auth/billing/schema changes that affect multiple consumers → elevated
   - Architectural change, new integration, breaking change → critical
3. **Dependency density** — artifacts that many other tasks depend on trend toward elevated+

Calibration note: `standard` is the default tier for most focused work. Do not escalate to `elevated` on the basis of schema or auth keywords alone — the keyword matters less than whether the change crosses bounded contexts.

### Step 5: Determine Pipeline Path

Based on type, state, and risk, determine which pipeline stages to run:

| Input | State | Risk | Path |
|-------|-------|------|------|
| raw-idea/raw-input | new | trivial | DEVELOP → FINISH |
| raw-idea/raw-input | new | standard | PREPARE → DEVELOP → FINISH |
| raw-idea/raw-input | new | elevated | PREPARE → SPEC-REVIEW → PLAN → PLAN-REVIEW → DEVELOP → FINISH |
| raw-idea/raw-input | new | critical | Same as elevated, with larger panels and user confirmation at each gate |
| raw-idea | — | feature-scale | BRAINSTORM → SPEC-REVIEW → continues by risk |
| raw-problem | — | any | PREPARE (investigate) → re-triage by risk |
| spec | draft | any | SPEC-REVIEW → PLAN → PLAN-REVIEW → DEVELOP → FINISH |
| spec | approved | any | PLAN → PLAN-REVIEW → DEVELOP → FINISH |
| plan | draft | any | PLAN-REVIEW → DEVELOP → FINISH |
| plan | approved | any | PLAN-REVIEW (decompose only) → DEVELOP → FINISH |
| plan | decomposed | any | DEVELOP → FINISH |
| task | pending | any | DEVELOP → FINISH |
| task | in-progress | any | DEVELOP (resume) → FINISH |
| external-ref | new | any | PREPARE → route by risk |
| external-ref | has artifact | any | Enter at detected state |

**Decomposition check:** If a spec touches 3+ bounded contexts or a plan would produce 8+ tasks, flag for decomposition before entering expensive review gates.

### Step 6: Return Classification

Return to the caller (`/skylark:implement`):

```
type: spec | plan | task | raw-idea | raw-problem | raw-input | external-ref
state: new | draft | reviewed | approved | decomposed | in-progress | ...
risk: trivial | standard | elevated | critical
path: [ordered list of pipeline stages to run]
artifact_id: SPEC-001 (if existing artifact found)
artifact_path: docs/specs/... (if applicable)
external_ref: ENG-142 (if applicable)
decompose: true | false (if oversized)
```

This classification is ephemeral — not persisted. Triage is cheap to re-run.

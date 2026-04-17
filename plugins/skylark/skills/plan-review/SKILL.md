---
name: plan-review
description: Internal pipeline stage that decomposes an implementation plan into discrete tasks via beads (bd), then panel-reviews each task individually. Tasks are created as beads with dependency tracking and atomic claiming. Max 2 review rounds per task before escalation. Called by implement — not user-invocable.
---

# Plan Review

Decompose a plan into individual tasks via beads, then panel-review each task. This is where the plan becomes executable units of work.

## When Called

Called by `/skylark:implement` after write-plan produces a plan. Receives the plan path.

## Communication Style

Follows `_shared/communication-style.md`. Per-task review output lists blocking + major issues as actionable items; minor nits get fixed directly in the bead description via the autonomous-fix rule (typos, dead references, obvious contradictions) rather than round-tripping through review.

## Checklist

Follow these steps in order. Do not skip steps.

### 1. Read the Plan

Read the plan fully. Identify all tasks, their dependencies, domains, and scope.

### 2: Create Tasks as Beads

For each task in the plan, create a bead via `bd create`. Task content maps to bead fields per `_shared/artifact-conventions.md`:

```bash
# Create each task as a bead
bd create "Task title" \
  -t task \
  -p 2 \
  --description="Scope: what this task builds/changes. Files: exact paths to create, modify, and test. Key considerations: domain concerns, edge cases." \
  --design="Steps: the ordered steps from the plan, with code and verification commands." \
  --acceptance="Concrete, testable acceptance criteria traced from plan steps." \
  --spec-id "docs/plans/PLAN-NNN-slug.md" \
  --json
```

For task content that contains special characters (backticks, quotes), use stdin:

```bash
echo 'Description with `code` and "quotes"' | bd create "Task title" -t task --description=- --json
```

**After creating all tasks, wire dependencies:**

```bash
# Task B depends on Task A (A must complete before B can start)
bd dep add <task-b-id> <task-a-id> --type blocks
```

Each task must be:
- **Self-contained** — can be implemented and tested independently
- **Scoped** — clear boundaries, acceptance criteria, single domain
- **Ordered** — explicit blocking dependencies between tasks
- **Right-sized** — each task spec should target **~800-1,000 tokens** (prose-first, interface shapes only, per `write-plan/SKILL.md`). The total dispatch payload (task spec + parent context + expert prompt) must fit within **40,000 tokens** (20% of Sonnet's context window) per `_shared/risk-matrix.md`. If a task spec is trending over ~1,200 tokens, strip pseudocode before splitting — most oversizing comes from pseudocode rather than genuine scope.

**Present the full decomposition to the user for approval before review.** Show the dependency tree with `bd dep tree <first-task-id>`. Adjust if requested.

### 3: Check for Oversized Plans

If decomposition produces 8+ tasks or tasks have dense cross-dependencies:
- Flag to the user: "This plan decomposes into [N] tasks with [M] cross-dependencies. Consider splitting into sub-plans."
- If user agrees, split the plan and return each sub-plan to `/skylark:implement` at the plan-review stage independently
- If user wants to proceed, continue with review

### 4: Panel Review Each Task

For each task bead, invoke `/skylark:panel-review` with:
- Target: the task content (retrieve via `bd show <id> --json` — pass the description, design, and acceptance criteria to the panel)
- Panel size: per `_shared/risk-matrix.md` — **2 experts at elevated, 5→3 adaptive at critical**
- Rounds: **1 at elevated, up to 2 at critical**
- Model: Opus per risk matrix
- Panel composition tailored to the task's domain (a database task gets different experts than a CLI task)
- Pass the risk tier to `panel-review` so it selects the correct review directive (critical uses the mandatory-finding directive; elevated uses the softer focus-on-blocking directive per `_shared/prompt-template.md`)

**Parallelization rules:**
- Tasks with no review-outcome dependencies MAY be reviewed in parallel
- Tasks whose scope was shaped by another task's findings MUST review sequentially

### 5: Handle Verdicts Per Task

**Ship** → Task approved. Add a label: `bd label add <id> approved --json`. Move on.

**Revise** → Update the task bead with fixes (`bd update <id> --description="..." --design="..." --json`).
- **Minor issues:** apply the autonomous-fix rule from `_shared/communication-style.md` — fix inline without round-tripping through another review. Typos, dead references, wrong file paths, stale type names.
- **Blocking + major issues:** apply the proposed fixes from the panel.
- **Post-revision size check:** estimate the revised task's combined size (spec + parent context + expert prompt). If it exceeds 40,000 tokens per `_shared/risk-matrix.md`, split it into child beads.
- **At elevated:** one round only. Apply fixes and mark approved. Do not re-invoke panel-review.
- **At critical:** re-invoke `/skylark:panel-review` (max 2 rounds per task). If still failing after round 2, flag to user but continue reviewing other tasks.

**Rethink** → Flag to user immediately. Mark the task blocked: `bd update <id> --status blocked --json`. This task may require plan restructuring. Do NOT review dependent tasks until the rethink is resolved.

### 6: Report Results

Append changelog entry to the plan:
```
- **YYYY-MM-DD HH:MM** — [PLAN-REVIEW] Decomposed into N tasks via beads. Approved: N. Needs revision: N. Blocked: N. Beads: bd-XXXX through bd-YYYY.
```

### 7: Return to Implement

Return:
```
tasks:
  - id: bd-XXXX
    status: approved | needs-revision | blocked
    domain: database
  - id: bd-YYYY
    status: approved
    domain: api
    depends_on: [bd-XXXX]
  ...
blocked_tasks: [list, if any]
```

Implement uses `bd ready --json` to determine execution order — beads handles dependency resolution. Only approved, unblocked tasks are dispatched to `/skylark:develop`.

## What This Skill Does NOT Do

- Review the plan as a single document — decomposes into tasks first
- Implement tasks — use `/skylark:develop` for that
- Rewrite the plan — fixes individual task beads based on review findings
- Skip decomposition — tasks ARE the review unit

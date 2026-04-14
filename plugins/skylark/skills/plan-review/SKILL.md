---
name: plan-review
description: Internal pipeline stage that decomposes an implementation plan into discrete task specs, then panel-reviews each task individually. Tasks are written as individual files in docs/tasks/ with frontmatter for status tracking. Max 2 review rounds per task before escalation. Called by implement — not user-invocable.
---

# Plan Review

Decompose a plan into individual task specs, then panel-review each task. This is where the plan becomes executable units of work.

## When Called

Called by `/skylark:implement` after write-plan produces a plan. Receives the plan path.

## Checklist

Follow these steps in order. Do not skip steps.

### 1. Read the Plan

Read the plan fully. Identify all tasks, their dependencies, domains, and scope.

### 2: Extract Task Specs

For each task in the plan, create an individual task spec file at `docs/tasks/YYYY-MM-DD-<slug>-task-NN.md`:

```yaml
---
title: [Task Title]
type: task
status: pending
issue: ENG-XXX
parent: docs/plans/YYYY-MM-DD-slug.md
task_number: N
depends_on: []
domain: [primary domain cluster]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

Body includes:
- **Scope** — what this task builds/changes (from the plan)
- **Files** — exact paths to create, modify, and test
- **Acceptance criteria** — concrete, testable (traced from plan steps)
- **Key considerations** — domain concerns, edge cases, testing approach
- **Steps** — the ordered steps from the plan, with code and verification

Each task must be:
- **Self-contained** — can be implemented and tested independently
- **Scoped** — clear boundaries, acceptance criteria, single domain
- **Ordered** — explicit dependencies on other tasks

**Present the full decomposition to the user for approval before review.** Adjust if requested.

### 3: Check for Oversized Plans

If decomposition produces 8+ tasks or tasks have dense cross-dependencies:
- Flag to the user: "This plan decomposes into [N] tasks with [M] cross-dependencies. Consider splitting into sub-plans."
- If user agrees, split the plan and return each sub-plan to `/skylark:implement` at the plan-review stage independently
- If user wants to proceed, continue with review

### 4: Panel Review Each Task

For each task spec, invoke `/skylark:panel-review` with:
- Target: the task spec file
- Panel size: per `_shared/risk-matrix.md` (typically 3 experts for elevated, 5→3 adaptive for critical)
- Model: per risk matrix
- Panel composition tailored to the task's domain (a database task gets different experts than a CLI task)

**Parallelization rules:**
- Tasks with no review-outcome dependencies MAY be reviewed in parallel
- Tasks whose scope was shaped by another task's findings MUST review sequentially

### 5: Handle Verdicts Per Task

**Ship** → Task spec approved. Update frontmatter: `status: approved`. Move on.

**Revise** → Apply fixes to the task spec, re-invoke `/skylark:panel-review` (max 2 rounds per task). If still failing after round 2, flag to user but continue reviewing other tasks.

**Rethink** → Flag to user immediately. This task may require plan restructuring. Do NOT review dependent tasks until the rethink is resolved.

### 6: Report Results

Post Linear comment:
```
[PLAN-REVIEW] Decomposed into [N] tasks.
Approved: [count] | Needs revision: [count] | Blocked: [count]
Tasks: docs/tasks/YYYY-MM-DD-slug-task-01.md ... task-NN.md
Next: develop (sequential execution of approved tasks)
```

### 7: Return to Implement

Return:
```
tasks:
  - path: docs/tasks/...-task-01.md
    status: approved | needs-revision | blocked
    domain: database
    depends_on: []
  - path: docs/tasks/...-task-02.md
    status: approved
    domain: api
    depends_on: [task-01]
  ...
recommended_order: [task-01, task-02, ...]
blocked_tasks: [list, if any]
```

Implement will only dispatch approved tasks to `/skylark:develop`. Blocked tasks and their dependents are skipped.

## What This Skill Does NOT Do

- Review the plan as a single document — decomposes into tasks first
- Implement tasks — use `/skylark:develop` for that
- Rewrite the plan — fixes individual task specs based on review findings
- Skip decomposition — task specs ARE the review unit

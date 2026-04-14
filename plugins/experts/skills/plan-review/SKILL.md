---
name: plan-review
description: >-
  Decompose an implementation plan into major tasks and panel-review each
  task spec individually. Use when the user says "review this plan",
  "plan review", "break down this plan", "decompose this plan", or wants
  an implementation plan validated before execution.
---

# Plan Review

Decomposes an implementation plan into discrete task specs, then runs
panel review on each task individually. Tasks that fail review iterate
through fixes and re-review (max 2 rounds per task).

## Checklist

Follow these steps in order. Do not skip steps.

### 1. Identify the plan

Determine what the user wants reviewed. Read the plan fully.

### 2. Decompose into tasks

Analyze the plan and extract major tasks. Each task must be:

- **Self-contained** — can be implemented and tested independently
- **Scoped** — has clear boundaries, acceptance criteria, and domain
- **Ordered** — dependencies on other tasks are explicit

For each task, produce a task spec:

```
## Task [N]: [Title]

**Domain:** [primary domain/technology]
**Dependencies:** [tasks that must complete first, or "none"]
**Scope:** [what this task builds/changes]

**Acceptance criteria:**
- [Concrete, testable criteria]
- [...]

**Key considerations:**
- [Domain-specific concerns]
- [Edge cases to handle]
- [Testing approach]
```

Present the full task decomposition to the user for approval.
Adjust if the user wants to split, merge, or reorder tasks.

### 3. Panel review each task

For each approved task spec, invoke `/expert:panel-review`.

Panel composition should be tailored to each task's domain — a database
schema task needs different experts than a CLI formatting task. Let the
panel skill determine the right composition based on the task's domain.

Tasks with no review-outcome dependencies on each other MAY be reviewed
in parallel. Tasks whose scope was shaped by another task's review
findings MUST be reviewed sequentially.

### 4. Handle verdicts per task

For each task:

**If "ship":** Task spec is approved. Move on.

**If "revise":**
- Apply fixes to the task spec
- Re-invoke `/expert:panel-review` on the revised task spec (max 2 rounds)
- If still failing after round 2: flag to user, continue with other tasks

**If "rethink":**
- Flag to user immediately
- This task may require plan restructuring — do not proceed with
  dependent tasks until resolved

### 5. Output

When all tasks are reviewed, present:

**Approved tasks:** [list with brief scope]
**Tasks needing revision:** [list with outstanding issues]
**Blocked tasks:** [any that can't proceed due to "rethink" verdicts]
**Recommended execution order:** [based on dependencies and review status]

The output is a set of approved task specs ready for `/expert:develop`.

## What this skill does NOT do

- Does not review the plan as a single document — decomposes into tasks first
- Does not implement tasks — use `/expert:develop` for that
- Does not rewrite the plan — fixes individual task specs based on review findings
- Does not skip decomposition — the task specs ARE the review unit

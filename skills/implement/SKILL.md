---
name: implement
description: >-
  End-to-end implementation from a spec, plan, or task. Orchestrates the
  full pipeline: spec review, planning, plan decomposition, and per-task
  development with fresh experts. Entry point adapts to input type — specs
  start at review, plans start at decomposition, tasks start at development.
  Use when the user says "implement this", "build this spec", "execute this
  plan", or wants end-to-end development from a document.
---

# Implement

Orchestrates the full implementation pipeline. Detects the input type
and enters at the appropriate stage:

- **Spec** → spec-review → plan → plan-review → develop each task
- **Plan** → plan-review → develop each task
- **Task** → develop

This skill is a thin orchestrator. The intelligence lives in the flow
skills it invokes. It manages sequencing and artifact handoff between
stages.

## Checklist

Follow these steps in order. Enter at the step matching the input type.

### 1. Identify input and entry point

Read the input document fully. Determine its type:

**Spec or proposal** — describes WHAT to build (requirements, goals,
constraints, behavior) but not HOW. Contains language like "the system
should", "users can", "requirements". Enter at step 2.

**Implementation plan** — describes HOW to build (phases, tasks, build
order, dependencies). Contains language like "phase 1", "task", "depends
on", "build order". Enter at step 3.

**Task spec** — describes a single discrete unit of work with acceptance
criteria. Scoped to one component or feature. Enter at step 5.

If ambiguous, ask the user.

### 2. Spec Review (entry point for specs)

Invoke `/expert:spec-review` on the spec.

Wait for the result:
- **Approved** → proceed to step 3
- **Needs revision/rethink** → present issues to user and stop.
  Do not proceed to planning with an unapproved spec.

### 3. Write Implementation Plan

Invoke the `writing-plans` skill to produce an implementation plan from
the approved spec (or from the plan the user provided if entering here).

The plan should address:
- Build order with dependencies between components
- Which components can be built in parallel
- What to test at each phase
- What "done" looks like for each phase

### 4. Plan Review (entry point for plans)

Invoke `/expert:plan-review` on the implementation plan.

This decomposes the plan into task specs and panel-reviews each one.
Wait for all task reviews to complete.

If any tasks are blocked ("rethink" verdict):
- Present to the user
- Decide whether to proceed with approved tasks or revise the plan
- Do not develop blocked tasks or their dependents

### 5. Develop (entry point for tasks)

Execute each approved task spec in dependency order.

For each task, invoke `/expert:develop` with the task spec.

**Each task gets a fresh vocabulary-routed expert.** Do not reuse expert
context across tasks — the whole point is per-task vocabulary routing.

**Sequential execution:** Tasks run one at a time. After each task
completes, verify it doesn't break previous work before proceeding.

**Progress reporting:** After each task, report to the user:

```
## Progress: [N/total] tasks complete

completed Task 1: [title] — [status]
completed Task 2: [title] — [status]
active    Task 3: [title] — in progress
pending   Task 4: [title] — pending
```

**If a task fails** (blocked after max review rounds):
- Stop and present options to the user:
  - Skip this task and continue with non-dependent tasks
  - Revise the task spec and retry
  - Stop execution entirely

### 6. Completion

When all tasks are complete:

1. Verify all tests pass across the full implementation
2. Create a PR via `commit-commands:commit-push-pr`
3. Present the PR to the user for review
4. STOP — do not merge without user approval

If some tasks were skipped, note them in the PR description with their
outstanding issues.

## What this skill does NOT do

- Does not contain review or execution logic — delegates to flow skills
- Does not skip spec review (unless entering with a plan or task)
- Does not skip plan review (unless entering with a task)
- Does not execute in the main working tree — tasks use worktrees
- Does not merge without user approval
- Does not reuse expert context across tasks

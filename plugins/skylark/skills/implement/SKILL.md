---
name: implement
description: Use when starting any development work — issues, specs, plans, tasks, ideas, or bug reports. Single entry point that classifies input, determines risk level, and routes through the appropriate pipeline stages. Handles everything from trivial bugfixes (direct to develop) to critical architectural changes (full spec-review, plan, panel gates). Tracks progress across tasks and manages worktree lifecycle.
---

# Implement

The single orchestrator for all development work. Classifies input, routes to the correct pipeline stage, and walks the pipeline to completion.

## When to Use

- User says "implement this", "build this", "work on ENG-xxx", "fix this bug"
- User provides a spec, plan, task spec, or idea to execute
- Anytime development work needs to start, regardless of scope

## The Pipeline

```
TRIAGE → PREPARE → BRAINSTORM → SPEC-REVIEW → WRITE-PLAN → PLAN-REVIEW → DEVELOP → FINISH
```

Most work skips most stages. Triage determines where to enter and which gates are active.

## Process

### Step 1: Triage

Invoke the `triage` skill (read `triage/SKILL.md`). It returns:

```
type: issue | spec | plan | task | raw-idea | raw-problem
state: new | draft | reviewed | approved | decomposed | in-progress
risk: trivial | standard | elevated | critical
path: [ordered list of pipeline stages to run]
issue_id: ENG-XXX (if applicable)
artifact_path: docs/specs/... (if applicable)
decompose: true | false
```

If `decompose` is true, handle decomposition before proceeding:
- For specs: split into child specs, each enters the pipeline independently
- For plans: split into sub-plans, each enters at plan-review independently
- Create Linear sub-issues with blocking relations for each child

### Step 2: Walk the Pipeline

Execute each stage in the path returned by triage, in order. Skip stages not in the path.

**For each stage, read the corresponding skill file and follow its process.**

The stages and what they return:

#### PREPARE (standard+ risk)
Read and invoke `prepare/SKILL.md`.
- Receives: triage classification, raw input
- Returns: spec path (if created), references, vocabulary payload, risk confirmation
- If risk escalated during prepare, re-triage and adjust the pipeline path

#### BRAINSTORM (feature-scale raw ideas only)
Read and invoke `brainstorm/SKILL.md`.
- Receives: raw idea, project context
- Returns: spec path (written and user-approved)
- Hard gate: cannot proceed without user approval of the spec

#### SPEC-REVIEW (elevated+ risk)
Read and invoke `spec-review/SKILL.md`.
- Receives: spec path, risk level
- Returns: status (approved | rethink | escalate), report paths
- If `rethink`: STOP. Surface concerns to user. Do not proceed.
- If `escalate`: STOP. Present remaining issues. User decides.
- If `approved`: proceed to WRITE-PLAN.

#### WRITE-PLAN (elevated+ risk)
Read and invoke `write-plan/SKILL.md`.
- Receives: approved spec path
- Returns: plan path, task count, domains

#### PLAN-REVIEW (elevated+ risk)
Read and invoke `plan-review/SKILL.md`.
- Receives: plan path, risk level
- Returns: task list with statuses, recommended execution order, blocked tasks
- If tasks are blocked: skip them and their dependents, proceed with approved tasks

#### DEVELOP (always — the core execution stage)
Read and invoke `develop/SKILL.md` for each task in dependency order.

**For trivial risk (no task specs):**
- Implement directly in the main working tree
- No worktree, no vocabulary-routed expert, no panel review
- Run tests, commit, proceed to FINISH

**For standard risk (single task from prepared issue):**
- Create one worktree
- Generate vocabulary-routed expert developer
- Implement, test, panel review (Sonnet, 1 round)
- Merge worktree branch

**For elevated+ risk (multiple tasks from plan):**
- Execute tasks sequentially in dependency order
- One worktree per task, merged as each completes
- Fresh vocabulary-routed expert per task
- Panel review per task (model and rounds per risk matrix)
- After each task merge, verify previous work isn't broken:
  ```bash
  git merge <task-branch>
  pnpm test  # full suite, not just task's tests
  ```

**Progress reporting after each task:**
```
## Progress: [N/total] tasks complete

completed  Task 1: [title] — complete
completed  Task 2: [title] — complete
active     Task 3: [title] — in progress
pending    Task 4: [title] — pending (depends on Task 3)
skipped    Task 5: [title] — blocked (rethink verdict)
```

**If a task fails (blocked after max review rounds):**
Stop and present options:
1. Skip this task and continue with non-dependent tasks
2. Revise the task spec and retry
3. Stop execution entirely

User decides. Do not auto-skip.

#### FINISH (always)
Read and invoke `finish/SKILL.md`.
- Receives: completed work, branch state, issue context
- Handles: test verification, branch options, Linear updates, session notes, cleanup

### Step 3: Handle Scope Escalation

If during any stage the agent discovers scope is larger than triage classified:

| Escalation | Action |
|-----------|--------|
| trivial → standard | Pause. Create worktree. Add panel validation. Continue. |
| standard → elevated | Pause. Notify user with evidence. Recommend spec + plan review. User decides. |
| elevated → critical | Pause. Notify user with evidence. Recommend full pipeline. User decides. |

Never automatically restart the pipeline. Pause, explain, let the user decide.

### Step 4: Handle Interruptions

If the session ends mid-pipeline:
- All state is in artifacts (specs, plans, tasks, reports with frontmatter)
- All events are in Linear comments
- Next session: user runs `/skylark:implement` again with the same input
- Triage detects state from artifacts and resumes at the correct stage

This is why artifact discipline matters — every stage must leave a recoverable artifact trail.

## Quick Reference: Risk × Pipeline Path

| Risk | Stages | Panel Model | Panel Size | User Confirms |
|------|--------|-------------|-----------|---------------|
| trivial | DEVELOP → FINISH | none | none | no |
| standard | PREPARE → DEVELOP → FINISH | Sonnet | 2-3 | no |
| elevated | PREPARE → SPEC-REVIEW → PLAN → PLAN-REVIEW → DEVELOP → FINISH | Opus (review), Sonnet (impl) | 3-4 | on escalation |
| critical | PREPARE → SPEC-REVIEW → PLAN → PLAN-REVIEW → DEVELOP → FINISH | Opus (all) | 5→3 adaptive | every gate |

## What This Skill Does NOT Do

- Contain review or execution logic itself — delegates to stage skills
- Skip gates based on its own judgment — follows the risk matrix
- Merge without user decision — finish presents options
- Auto-restart on scope escalation — pauses for user
- Guess when ambiguous — asks the user

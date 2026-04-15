---
name: develop
description: Internal pipeline stage that executes a single task with a fresh vocabulary-routed expert developer in an isolated worktree. Generates a bespoke expert prompt scoped to the task's domain, dispatches a subagent with structured instructions, handles implementer status (DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED), validates with spec compliance review then panel review. Max 2 review rounds before escalation. Called by implement — not user-invocable.
---

# Develop

Execute a single task with a fresh vocabulary-routed expert developer in an isolated worktree.

**Why subagents:** You delegate tasks to specialized agents with isolated context. By precisely crafting their instructions and context, you ensure they stay focused and succeed at their task. They should never inherit your session's context or history — you construct exactly what they need. This also preserves your own context for coordination work.

**Core principles:**
- Fresh vocabulary-routed expert per task (never reuse expert context across tasks)
- Structured dispatch with question-asking and escalation built in
- Two-stage review: spec compliance first, then code quality via panel
- Use the cheapest model that can handle each role

## When Called

Called by `/skylark:implement` for each approved task in dependency order. Receives the task spec path and risk level.

## Process

### Step 1: Read the Task Spec

Read the task spec fully. Also read:
- Referenced files (existing code, architecture specs)
- Parent plan (for broader context)
- Parent spec (for design intent)
- Project CLAUDE.md (for conventions and stack)

**Extract the full task text now.** The subagent receives the full text inline — do NOT make the subagent read the plan or task file. You curate exactly what context is needed.

### Step 2: Generate Expert Developer Prompt

Follow `_shared/expert-prompt-generator.md`, **scoped to THIS TASK's domain** (not the whole project):

A database migration task gets different routing than a CLI formatting task in the same project.

**a. Analyze** — domain, stack, abstractions, edge cases specific to this task.

**b. Draft identity** — development-oriented, task-specific:
- "You are a senior PostgreSQL engineer implementing a tenant-scoped migration. You write defensive DDL and test rollback scenarios."
- "You are a staff API engineer building Hono route handlers. You prioritize input validation and structured error responses."

**c. Extract vocabulary** — 3-5 clusters, 15-30 terms, tuned to this task's specific domain. Pull from the vocabulary payload built during prepare, but filter to what's relevant for this task.

**d. Derive anti-patterns** — 5-10 failure modes specific to this task's implementation domain. Include at least one for testing/verification.

**e. Add development-specific sections:**

**Operational Guidance:**
- Error philosophy appropriate to the task domain
- Concurrency model if the task involves parallel work
- Edge case handling for cases the spec implies but doesn't fully specify

**Testing Expectations:**
- Language-idiomatic test patterns (for this project: Vitest)
- Edge cases needing fixture coverage
- Performance verification if the task defines targets

**Deliverables:**
- Concrete files to create or modify (from the task spec)
- Validate: every package in anti-patterns appears in deliverables
- Validate: no contradictions between anti-patterns and deliverables

### Step 3: Create Worktree

Create an isolated worktree for this task:

```bash
git worktree add <worktree-path> -b <task-branch-name>
```

Branch naming: `task/<task-id>-<slug>` (e.g., `task/TASK-012-schema-migration`)

If the task has an `external_ref`, include it: `task/TASK-012-eng-142-schema-migration`

### Step 4: Select Model

Use the least powerful model that can handle the task to conserve cost and increase speed:

| Task complexity signals | Model |
|------------------------|-------|
| Touches 1-2 files with complete spec, mechanical implementation | Sonnet (fast, cheap) |
| Touches multiple files with integration concerns | Default session model |
| Requires design judgment or broad codebase understanding | Opus |

Reviewers always use the model specified by the risk matrix (`_shared/risk-matrix.md`).

### Step 5: Dispatch Implementer Subagent

Write the expert developer prompt as **CLAUDE.md in the worktree root.** This ensures the subagent receives the full vocabulary-routed context as its primary instructions.

Dispatch using the `Agent` tool with `isolation: "worktree"` or into the created worktree. Description: `"Develop: [task title]"`

The dispatch prompt (in addition to the CLAUDE.md) should include:

```
## Task Description

[FULL TEXT of task from plan — paste it here, don't make subagent read file]

## Context

[Scene-setting: where this fits in the broader plan, what tasks came before,
what this enables, architectural context from the spec]

## Before You Begin

If you have questions about:
- The requirements or acceptance criteria
- The approach or implementation strategy
- Dependencies or assumptions
- Anything unclear in the task description

**Ask them now.** Raise any concerns before starting work.

## Your Job

Once you're clear on requirements:
1. Implement exactly what the task specifies
2. Write tests (following TDD — write failing test first)
3. Verify implementation works
4. Commit your work with a message referencing the task ID
5. Self-review (see below)
6. Report back

**While you work:** If you encounter something unexpected or unclear, **ask
questions.** It's always OK to pause and clarify. Don't guess or make
assumptions.

## Code Organization

- Follow the file structure defined in the plan
- Each file should have one clear responsibility with a well-defined interface
- If a file you're creating is growing beyond the plan's intent, stop and
  report it as DONE_WITH_CONCERNS — don't split files on your own
- In existing codebases, follow established patterns. Improve code you're
  touching the way a good developer would, but don't restructure things
  outside your task.

## When You're in Over Your Head

It is always OK to stop and say "this is too hard for me." Bad work is worse
than no work. You will not be penalized for escalating.

**STOP and escalate when:**
- The task requires architectural decisions with multiple valid approaches
- You need to understand code beyond what was provided and can't find clarity
- You feel uncertain about whether your approach is correct
- The task involves restructuring existing code in ways the plan didn't anticipate
- You've been reading file after file trying to understand without progress

**How to escalate:** Report back with status BLOCKED or NEEDS_CONTEXT. Describe
specifically what you're stuck on, what you've tried, and what kind of help
you need.

## Before Reporting Back: Self-Review

Review your work with fresh eyes:

**Completeness:**
- Did I fully implement everything in the spec?
- Did I miss any requirements?
- Are there edge cases I didn't handle?

**Quality:**
- Is this my best work?
- Are names clear and accurate?
- Is the code clean and maintainable?

**Discipline:**
- Did I avoid overbuilding (YAGNI)?
- Did I only build what was requested?
- Did I follow existing patterns in the codebase?

**Testing:**
- Do tests actually verify behavior (not just mock behavior)?
- Did I follow TDD?
- Are tests comprehensive?

If you find issues during self-review, fix them now before reporting.

## Report Format

When done, report:
- **Status:** DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
- What you implemented (or what you attempted, if blocked)
- What you tested and test results
- Files changed
- Self-review findings (if any)
- Any issues or concerns

Use DONE_WITH_CONCERNS if you completed the work but have doubts.
Use BLOCKED if you cannot complete the task.
Use NEEDS_CONTEXT if you need information that wasn't provided.
Never silently produce work you're unsure about.
```

### Step 6: Handle Implementer Status

**DONE:** Proceed to spec compliance review (Step 7).

**DONE_WITH_CONCERNS:** Read the concerns before proceeding. If concerns are about correctness or scope, address them before review. If they're observations (e.g., "this file is getting large"), note them and proceed to review.

**NEEDS_CONTEXT:** Provide the missing context and re-dispatch. This does NOT count as a review round — the implementer hasn't completed yet.

**BLOCKED:** Assess the blocker:
1. If it's a context problem, provide more context and re-dispatch
2. If the task requires more reasoning, re-dispatch with a more capable model
3. If the task is too large, break it into smaller pieces
4. If the plan itself is wrong, escalate to the user

**Never** ignore an escalation or force the same model to retry without changes. If the implementer said it's stuck, something needs to change.

### Step 7: Spec Compliance Review

Before code quality review, verify the implementation matches the spec.

Dispatch a spec compliance reviewer subagent:

```
You are reviewing whether an implementation matches its specification.

## What Was Requested

[FULL TEXT of task requirements and acceptance criteria]

## What Implementer Claims They Built

[From implementer's report]

## CRITICAL: Do Not Trust the Report

The implementer's report may be incomplete, inaccurate, or optimistic.
You MUST verify everything independently.

**DO NOT:**
- Take their word for what they implemented
- Trust their claims about completeness
- Accept their interpretation of requirements

**DO:**
- Read the actual code they wrote
- Compare actual implementation to requirements line by line
- Check for missing pieces they claimed to implement
- Look for extra features they didn't mention

## Your Job

Read the implementation code and verify:

**Missing requirements:**
- Did they implement everything requested?
- Are there requirements they skipped or missed?

**Extra/unneeded work:**
- Did they build things that weren't requested?
- Did they over-engineer or add unnecessary features?

**Misunderstandings:**
- Did they interpret requirements differently than intended?
- Did they solve the wrong problem?

**Verify by reading code, not by trusting the report.**

Report:
- Spec compliant (if everything matches after code inspection)
- Issues found: [list specifically what's missing or extra, with
  file:line references]
```

**If spec compliant:** Proceed to panel review (Step 8).

**If issues found:** Dispatch the implementer subagent back to fix the gaps. Re-run spec compliance review. Repeat until compliant.

### Step 8: Panel Review (Code Quality)

**Only after spec compliance passes.** Invoke `/skylark:panel-review` with:
- Target: the implementation diff (changed files in worktree)
- Panel size and model per `_shared/risk-matrix.md`:
  - Standard: Sonnet, 2-3 experts, 1 round
  - Elevated: Sonnet, 3-4 experts, 1 round
  - Critical: Opus, 3-4 experts, 2 rounds
- Review focus: code quality, maintainability, test coverage, architecture fit

In addition to standard code quality concerns, the panel should check:
- Does each file have one clear responsibility with a well-defined interface?
- Are units decomposed so they can be understood and tested independently?
- Is the implementation following the file structure from the plan?
- Did this change create new files that are already large, or significantly grow existing files?

### Step 9: Handle Review Verdict

**Ship** → Task complete.
- Update task frontmatter: `status: complete`
- Append changelog entry to the task:
  ```
  - **YYYY-MM-DD HH:MM** — [DEVELOP] Task complete. Tests pass. Branch: task/TASK-NNN-slug.
  ```
- Return to implement for merge and next task.

**Revise (round < 2)** → Fix and re-review.
- Dispatch implementer subagent back into the worktree with the review findings
- Re-run tests
- Re-run spec compliance review
- Re-invoke `/skylark:panel-review` (increment round)
- Re-evaluate verdict

**Revise (round 2) or Rethink** → Escalate.
- Present unresolved findings to user
- Append changelog entry to the task:
  ```
  - **YYYY-MM-DD HH:MM** — [DEVELOP] Escalated after review round 2. N issues remain.
  ```
- Return to implement with `escalate` status

### Step 10: Return to Implement

Return:
```
status: complete | escalate | blocked
task_id: TASK-NNN
task_path: docs/tasks/...-task-NN.md
worktree_path: <path>
branch: <branch-name>
changes: [summary of files created/modified]
test_results: pass | fail
review_rounds: N
outstanding_issues: [list, empty if complete]
```

Implement merges the worktree branch and proceeds to the next task.

## Red Flags

**Never:**
- Reuse expert context from other tasks — always generates fresh
- Execute in the main working tree — always uses a worktree
- Iterate beyond 2 review rounds — escalates to user
- Merge branches or create PRs — implement handles that
- Skip tests — tests must pass before review
- Start code quality review before spec compliance passes (wrong order)
- Dispatch multiple implementation subagents in parallel (conflicts)
- Make subagent read plan file (provide full text instead)
- Ignore subagent questions (answer before letting them proceed)
- Accept "close enough" on spec compliance (issues found = not done)
- Skip review loops (reviewer found issues = implementer fixes = review again)
- Let implementer self-review replace actual review (both are needed)
- Force the same model to retry without changes on BLOCKED status

**If subagent asks questions:**
- Answer clearly and completely
- Provide additional context if needed
- Don't rush them into implementation

**If reviewer finds issues:**
- Implementer fixes them (same subagent in same worktree)
- Reviewer reviews again
- Repeat until approved
- Don't skip the re-review

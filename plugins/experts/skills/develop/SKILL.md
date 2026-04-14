---
name: develop
description: >-
  Execute a single task with a fresh vocabulary-routed expert developer.
  Generates a task-specific expert persona, builds the implementation in an
  isolated worktree, and validates with panel review (max 2 rounds). Use when
  the user says "develop this", "build this task", "implement this task", or
  has an approved task spec ready for development.
---

# Develop

Generates a fresh vocabulary-routed expert developer tailored to a single
task, executes the implementation in an isolated worktree, and validates
the result with panel review (max 2 rounds).

The expert is generated specifically for THIS task's domain — not the
whole project. A "database schema migration" task gets different vocabulary
routing than a "CLI output formatting" task, even in the same project.

## Checklist

Follow these steps in order. Do not skip steps.

### 1. Identify the task

Determine the task spec to implement. This may be:
- A task spec output from `/expert:plan-review`
- A standalone task description from the user
- A GitHub issue or similar

Read the task spec fully. If the task references other files (existing
code, specs, plans), read those too to understand context.

### 2. Generate the expert developer prompt

Read the shared methodology files:
- `${CLAUDE_PLUGIN_ROOT}/skills/_shared/expert-prompt-generator.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/_shared/vocabulary-guide.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/_shared/prompt-template.md`

Follow the expert-prompt-generator steps, scoped to THIS TASK's domain:

**a. Analyze** — domain, stack, abstractions, and edge cases specific to
this task (not the whole project).

**b. Draft identity** — development-oriented, task-specific. Examples:
- "You are a senior SQLite engineer implementing a FTS5 indexing pipeline. You write defensive SQL and test edge cases around tokenization."
- "You are a staff CLI engineer building a command parser. You prioritize ergonomics and clear error messages."

**c. Extract vocabulary** — 3-5 clusters, 15-30 terms, tuned to the
task's specific domain.

**d. Derive anti-patterns** — 5-10 failure modes specific to this task's
implementation domain. Include at least one for testing/verification.

**e. Add development-specific sections:**

**Operational Guidance:**
- Error philosophy appropriate to the task domain
- Concurrency model if the task involves parallel work
- Edge case handling for cases the spec implies but doesn't fully specify

**Testing Expectations:**
- Language-idiomatic test patterns
- Edge cases that need fixture coverage
- Performance verification approach if the task defines targets

**Deliverables:**
- Concrete files to create or modify
- Validate: every package mentioned in anti-patterns appears in deliverables
- Validate: no contradictions between anti-patterns and deliverables

### 3. Execute in worktree

Create an isolated worktree for this task.

**Write the expert developer prompt as CLAUDE.md in the worktree root.**
This ensures the executing subagent has the full vocabulary-routed context
as its primary context. Include:
- The complete expert prompt (identity, vocabulary, anti-patterns,
  operational guidance, testing expectations, deliverables)
- Reference to the task spec
- The directive: "Implement this task per the spec. Run tests after each
  component. Do not deviate from the spec without documenting why."

Dispatch a subagent into the worktree to execute the implementation.

### 4. Validate

When the subagent completes:

**If tests pass:**
- Invoke `/expert:panel-review` on the implementation (diff or changed files)
- Panel composition should match the task's domain

**If tests fail:**
- Present failures to the user
- Offer to dispatch the expert subagent to fix within the worktree
- Do not proceed to review with failing tests

### 5. Handle review verdict

**If "ship":**
- Implementation is approved
- Commit with a clear message referencing the task spec
- Report completion

**If "revise":**
- Dispatch the expert subagent to address review findings in the worktree
- Re-run tests
- Re-invoke `/expert:panel-review` (max 2 rounds total)
- If still failing after round 2: flag to user

**If "rethink":**
- Flag to user immediately
- The task spec may need revision before re-attempting

### 6. Output

Report:
- **Status:** complete | needs-revision | blocked
- **Worktree:** path and branch
- **Changes:** summary of files created/modified
- **Test results:** pass/fail summary
- **Outstanding issues:** any unresolved review findings

## What this skill does NOT do

- Does not reuse expert context from other tasks — always generates fresh
- Does not execute in the main working tree — always uses a worktree
- Does not iterate beyond 2 review rounds — escalates to the user
- Does not merge or create PRs — use `/expert:implement` for orchestration

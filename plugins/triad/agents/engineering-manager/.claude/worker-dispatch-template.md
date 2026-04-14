# Worker Dispatch Template

Copy this, fill in the blanks, dispatch.

**IMPORTANT: Always dispatch workers using model: "sonnet".** Workers are given atomic tasks with curated context — they do not need Opus-level reasoning. If a task requires more judgment than Sonnet can provide, the task needs to be decomposed further or given more context, not given a bigger model.

```
You are {WORKER_ID} implementing {TASK_ID}: {TASK_TITLE}

Project: {PROJECT_PATH}
Worktree: {WORKTREE_PATH}
Branch: {BRANCH_NAME}

Read your briefing: {WORKTREE_PATH}/.claude/worker-context.md
Read your task: {WORKTREE_PATH}/docs/tasks/{TASK_ID}-{slug}.md
Read for patterns: {LIST_OF_FILES}

{TASK_SPECIFIC_NOTES — only if the task file doesn't cover it}

Build what the task describes. Follow the patterns in the files you read.
```

## Variables

| Variable | Example |
|----------|---------|
| WORKER_ID | W1, W2 |
| TASK_ID | T008 |
| TASK_TITLE | Role assignment routes |
| PROJECT_PATH | /Users/deuley/code/myproject |
| WORKTREE_PATH | /Users/deuley/code/myproject/.worktrees/w1-oauth-routes |
| BRANCH_NAME | w1/oauth-routes |
| LIST_OF_FILES | src/routes/organizations.ts, src/middleware/auth.ts |
| TASK_SPECIFIC_NOTES | Usually empty — only add if the task file is missing critical context |

## Notes

- The worker-context.md has: branch verification, TDD cycle, scope discipline, commit rules, report format
- The task file has: acceptance criteria, scope, warnings, dependencies
- The pattern files have: existing code to match
- If all three are good, TASK_SPECIFIC_NOTES should be empty

## Level of Detail Guide

| Information type | Where it lives | Prompt includes? |
|-----------------|----------------|-----------------|
| Conventions, TDD, report format | worker-context.md | No — just a path |
| Acceptance criteria, scope, warnings | docs/tasks/TXXX.md | No — just a path |
| Code patterns to follow | Existing source files | No — just paths |
| Task-specific gotchas | Prompt TASK_SPECIFIC_NOTES | Only if task file is insufficient |

---
name: assign-task
description: Dispatches an agent to execute a task from docs/tasks/. Reads the task file, verifies dependencies, ensures local commits are pushed, and launches an isolated worktree agent with standardized context. Use when starting work on a task or assigning a task to a worker agent.
---

# Assign Task

Dispatches a worker agent to execute a task in an isolated git worktree.

## Usage

`/assign-task T-042` or `/assign-task T-042 T-043 T-044` for parallel dispatch.

## Configuration

Set `PROJECT_PATH` to the absolute path of the target project repository. This is the repo where workers will create worktrees and do their work.

```
PROJECT_PATH=/path/to/target/project
```

## Workflow

1. **Pre-flight: sync with remote**
   Worktrees fork from `origin/main`. Pull first to check for updates, then push local work.
   ```bash
   cd $PROJECT_PATH
   git pull origin main
   git push origin main
   ```
   If push fails, warn the user and stop — agents will work from stale state.

2. **Read the task file** at `docs/tasks/T-<id>-*.md`
   - If the file does not exist, stop and report.
   - If `status` is `done`, stop — already complete.
   - If `status` is `blocked`, check `depends_on`:
     - Read each dependency task. If all are `done` (in `docs/tasks/_completed/`), update this task to `todo` and proceed.
     - If any dependency is not `done`, stop — task is still blocked.

3. **Check dependencies**
   Read each task in `depends_on`. If any has `status` other than `done`, stop — task is blocked.

4. **Dispatch agent** to a worktree using **model: "sonnet"** with this prompt (and ONLY this prompt).

   Workers ALWAYS use Sonnet. If a task seems to need a more capable model, it needs to be decomposed further or given more context — not given a bigger model.

   ```
   You are a worker agent executing a task.

   Read these files in order before doing anything else:
   1. docs/context.md — what this project is
   2. docs/tasks/CLAUDE.md — how to execute tasks
   3. docs/tasks/T-<id>-<slug>.md — your assigned task

   Follow the task lifecycle in docs/tasks/CLAUDE.md exactly.
   Read all documents listed in the task's `references` field.
   Read docs/conventions/ for coding patterns and standards.
   Discover files to create/modify by reading existing code within your scope boundaries.

   When complete, update the task file with your completion summary and commit all changes.
   ```

5. **After agent returns**, capture token usage and duration from the agent result. Report the outcome to the user.

## Worktree Setup

Workers execute in the target project repository, not in this agent's repo:

```bash
cd $PROJECT_PATH
git worktree add .worktrees/T-<id> -b task/T-<id>
```

Copy `.claude/worker-context.md` into the worktree if not already present. The worker operates entirely within the worktree.

## Parallel Dispatch

When multiple task IDs are provided, dispatch all agents simultaneously using separate worktree isolations. Each agent gets the same standardized prompt — only the task ID changes. Verify no dependency conflicts between the parallel tasks.

## What This Skill Does NOT Do

- Does not write custom prompts per task — the task file IS the prompt
- Does not pass schema fields, route specs, or pattern details — agents discover these from docs and code
- Does not modify task files before dispatch — the agent updates its own task file on completion

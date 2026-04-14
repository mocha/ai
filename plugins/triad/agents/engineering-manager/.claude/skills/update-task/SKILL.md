---
name: update-task
description: Updates a task file's frontmatter and status in docs/tasks/. Use when marking tasks as done, blocked, or in-progress, recording token usage, or writing completion summaries after agent work completes.
---

# Update Task

Updates task file metadata after work is completed or status changes.

## Usage

`/update-task T-042 done` — marks task as done and moves to _completed/.
`/update-task T-042 blocked "Waiting on T-041"` — marks as blocked with reason.
`/update-task T-042 tokens 42000 3` — records 42000 tokens and 3 minutes duration.

## Workflow

1. **Find the task file.** Search `docs/tasks/T-<id>-*.md` first. If not found, check `docs/tasks/_completed/T-<id>-*.md`.

2. **Apply updates** to frontmatter:
   - `done`: Set `status: done`, `completed: "<today>"`, update disposition if provided
   - `blocked`: Set `status: blocked`, note the reason in the description or depends_on
   - `in-progress`: Set `status: in-progress`
   - `tokens <count> <minutes>`: Set `actual_tokens` and `actual_duration_minutes`

3. **If status changed to `done`:**
   - Move the task file from `docs/tasks/` to `docs/tasks/_completed/`:
     ```bash
     mv docs/tasks/T-<id>-<slug>.md docs/tasks/_completed/
     ```
   - This keeps the active queue clean — `docs/tasks/` shows only in-flight work.

4. **Write back** the updated file, preserving all other content.

5. **Report** what changed.

## After Agent Dispatch

When an agent returns from `/assign-task`, use this skill to record:
- Token count from the agent result
- Duration in minutes
- Status change (done or blocked)
- Completion summary written by the worker

## After Marking Done

Once a task is moved to `_completed/`, check whether all tasks for the parent project are now done. If so, trigger `/validate-project` to run the full project validation sequence.

## This Ensures

- The task file is the system of record for all work performed
- The active queue (`docs/tasks/`) reflects only in-flight work
- Project completion is detected automatically

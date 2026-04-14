---
name: validate-project
description: Validates that all tasks for a project are complete and that both task-level and project-level acceptance criteria pass. Sends project-complete to PgM on success, or determines corrective action on failure.
---

# Validate Project

Runs the full validation sequence when all tasks for a project reach done status.

## Usage

`/validate-project PRJ-001` — validates the named project.

## Workflow

1. **Identify all tasks for the project.**
   Read task files in both `docs/tasks/` and `docs/tasks/_completed/` that have `project: PRJ-NNN` in their frontmatter. Build the complete task list.

2. **Verify all tasks are completed.**
   Every task for this project must be in `docs/tasks/_completed/` with `status: done`. If any tasks remain in `docs/tasks/` (active queue), stop — the project is not yet complete.

3. **Run task-level acceptance criteria.**
   For each completed task, re-run every verification command in its `acceptance_criteria`. All must still pass. Record any failures.

4. **Read the project file's acceptance criteria.**
   Open the project file and extract its acceptance criteria section.

5. **Verify project-level acceptance criteria.**
   Run each project-level criterion. These are the integration-level checks that confirm the tasks compose into the intended outcome.

6. **If all pass:** Send `project-complete` to PgM using `/send-message`:
   - `type`: project-complete
   - `to`: program-manager
   - `disposition`: approved
   - `project`: PRJ-NNN
   - `references`: Path to the project file
   - `reason`: "All tasks complete, acceptance criteria verified"
   - Include a summary of task count, total tokens consumed, and any notable decisions made during execution

7. **If failures occur:** Determine corrective action:
   - **Task acceptance criteria regression:** Create new corrective tasks targeting the regression, add to queue, dispatch workers
   - **Project acceptance criteria not met:** Analyze which tasks contributed to the gap, create additional tasks to close it
   - **Systemic issue:** Escalate to PgM with `reason: process-concern` describing what went wrong

## Notes

- Do not skip any acceptance criteria check, even if the task was validated at completion time. Code changes from later tasks may have introduced regressions.
- If corrective tasks are needed, they follow the normal task lifecycle — create, propose (as info to PgM), dispatch, validate.

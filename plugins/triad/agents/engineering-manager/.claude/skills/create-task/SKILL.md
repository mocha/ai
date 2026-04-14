---
name: create-task
description: Creates a new task file in docs/tasks/ with proper frontmatter, scope boundaries, and acceptance criteria. Use when planning new work, breaking down features into tasks, or creating ad hoc tasks during execution.
---

# Create Task

Creates a task file following the project's task template format.

## Usage

`/create-task` — interactive creation with prompts for each field.
`/create-task "Emergency contact entity"` — starts with a title, asks for remaining fields.

## Workflow

1. **Determine next task ID**
   Scan both `docs/tasks/T-*.md` and `docs/tasks/_completed/T-*.md` for the highest existing T-NNN ID number. Increment by 1.

2. **Gather required fields** (ask the user if not provided):
   - **title**: What to build (noun phrase)
   - **description**: Why it matters — the user outcome, not the implementation detail
   - **project**: Parent project ID (PRJ-NNN) this task belongs to
   - **depends_on**: Task IDs (T-NNN) that must be done first
   - **scope.boundaries**: Directory paths the agent may work in
   - **scope.references**: Docs, architecture files, and code to read for patterns
   - **acceptance_criteria**: Runnable verification commands or observable outcomes

3. **Generate the slug** from the title: lowercase, hyphens, no special chars. Example: "Emergency contact entity" -> `emergency-contact-entity`

4. **Copy `templates/task.md`** and fill in all fields:

   ```yaml
   ---
   id: T-<id>
   title: "<title>"
   status: todo
   project: PRJ-<nnn>
   author: engineering-manager
   depends_on: [T-001, T-002]
   blocks: []
   created: "<today's date>"
   completed:
   scope:
     boundaries:
       - <directory paths>
     references:
       - <doc links>
   acceptance_criteria:
     - "<criterion with runnable command>"
   actual_tokens:
   actual_duration_minutes:
   ---

   ## Description

   <What needs to be done and why>

   ## Acceptance Criteria Detail

   <Expanded detail if needed>
   ```

5. **Write the file** to `docs/tasks/T-<id>-<slug>.md`.

6. **Report** the created file path and task ID.

## For blocked tasks

When creating a task that is blocked on another task or an unresolved question:
- Set `status: blocked`
- Add the blocking task IDs to `depends_on`
- Note the reason in the Description section

## Defaults

- `status`: todo (or blocked if dependencies are not met)
- `author`: engineering-manager
- `acceptance_criteria`: Must always have at least one runnable criterion

## Ad Hoc Tasks

When creating tasks during execution (not part of the initial project decomposition):
1. Create the task file following this workflow
2. Send an `info` message to PgM via `/send-message`: "Added T-NNN for [reason], spawned from T-YYY"
3. No approval gate needed — ad hoc tasks enter the queue immediately

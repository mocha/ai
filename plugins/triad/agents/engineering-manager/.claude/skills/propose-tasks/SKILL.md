---
name: propose-tasks
description: Decomposes a project into atomic tasks after receiving a project-ready message from the Program Manager. Reads the project file, evaluates feasibility, creates task files, and sends a tasks-proposed message back to PgM for review.
---

# Propose Tasks

Receives a project-ready message from PgM and decomposes the referenced project into atomic, dispatchable tasks.

## Usage

`/propose-tasks` — reads the triggering message from the inbox (called by /check-inbox).
`/propose-tasks docs/inbox/engineering-manager/unread/<message-file>.md` — processes a specific message.

## Workflow

1. **Read the inbox message** to extract the project ID and project file path from the `project` and `references` fields.

2. **Read the project file** thoroughly:
   - Scope and approach
   - Acceptance criteria
   - Dependencies and risks
   - Referenced architecture docs

3. **Read architecture references and source code** listed in the project file to evaluate feasibility. Identify patterns the workers will need to follow.

4. **Identify dependencies and sequencing** between the units of work. Map out which pieces must be completed before others can start.

5. **Decompose into atomic tasks**, each completable in a single context window:

   a. **Determine next T-NNN ID:** Scan both `docs/tasks/T-*.md` and `docs/tasks/_completed/T-*.md` for the highest existing ID number. Increment by 1 for the first new task.

   b. **For each task**, copy `templates/task.md` and fill in:
      - `id`: T-NNN
      - `title`: Short, descriptive noun phrase
      - `status`: todo
      - `project`: The PRJ-NNN ID from the project file
      - `depends_on`: Task IDs that must complete first (use the new IDs being created)
      - `blocks`: Task IDs waiting on this one
      - `scope.boundaries`: Specific directories the worker may modify
      - `scope.references`: Docs, architecture files, and existing code to read for patterns
      - `acceptance_criteria`: Concrete, runnable verification commands or observable outcomes
      - `created`: Today's date

   c. **Write the Description** section with enough context for a dev agent to begin work without asking clarifying questions.

6. **Write all task files** to `docs/tasks/T-NNN-<slug>.md`.

7. **Send tasks-proposed message** to `docs/inbox/program-manager/unread/` using `/send-message`:
   - `type`: tasks-proposed
   - `to`: program-manager
   - `project`: The PRJ-NNN ID
   - `references`: Paths to all created task files
   - `reason`: "Task decomposition complete for PRJ-NNN"
   - Include a summary listing each task ID, title, and dependency chain

8. **Move the original message** from `docs/inbox/engineering-manager/unread/` to `docs/inbox/engineering-manager/read/`.

## Task Quality Gates

Every task must satisfy these constraints before creation:

- **Single context window scope.** If it requires the worker to hold more context than fits, split it.
- **Runnable acceptance criteria.** Every criterion has a command to execute or an observable outcome. If you cannot write a runnable test, the task is not ready.
- **Explicit scope boundaries.** The worker knows exactly which directories to modify.
- **Declared dependencies.** No task should require work from an unfinished predecessor without declaring it.

## Handling Revised Tasks

When PgM sends feedback with disposition `revise`, update the task files per the feedback, then send a `tasks-revised` message (same structure as tasks-proposed) back to PgM. This counts as a negotiation round. Max 2 revision cycles before escalating to human.

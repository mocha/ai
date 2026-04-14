---
name: review-tasks
description: Reviews task proposals from the engineering manager against project acceptance criteria. Evaluates coverage, refines criteria where PgM has additional context, checks sizing, and sends feedback (approved or revise) back to the EM.
---

# Review Tasks

Reviews EM-proposed tasks for a project, ensuring they cover all project acceptance criteria and are properly sized for single context windows.

## Usage

`/review-tasks` — triggered by a `tasks-proposed` or `tasks-revised` message in the inbox.

## Workflow

### 1. Read the inbox message

Read the `tasks-proposed` or `tasks-revised` message to extract:
- The project ID (PRJ-NNN)
- Paths to the proposed task files
- The current negotiation round number
- Any notes or concerns from the EM

### 2. Read the parent project file

Read the project file from `docs/projects/` to get:
- Project acceptance criteria (the standard each task must contribute toward)
- Scope boundaries
- Dependencies and risks
- The parent proposal ID (for business context if needed)

### 3. Read each proposed task file

For every task file referenced in the message, read the full content. Note:
- Task acceptance criteria
- Scope boundaries
- Dependencies between tasks
- Estimated size/complexity

### 4. Evaluate coverage

For each **project** acceptance criterion, verify that at least one task's acceptance criteria addresses it. Build a coverage map:

```
Project criterion 1 → covered by T-001, T-003
Project criterion 2 → covered by T-002
Project criterion 3 → NOT COVERED
```

### 5. Look for gaps

The EM decomposes based on technical structure. You have context they do not — customer intent from the proposal, business constraints, cross-project dependencies. Check for:

- **Missing coverage:** Project criteria that no task addresses
- **Insufficient depth:** Task criteria that technically touch a project criterion but miss its intent (e.g., project says "under 5 minutes" but task only says "completes successfully")
- **Cross-project implications:** Tasks that may affect other projects in the same proposal
- **Sequencing issues:** Task dependencies that conflict with project-level dependency ordering

### 6. Refine acceptance criteria

Where you have context the EM does not, add specificity to task acceptance criteria. Examples:
- Add performance constraints from the proposal's success criteria
- Add business rule constraints the EM would not know from code alone
- Clarify edge cases that matter for customer experience

Do not rewrite the EM's technical criteria. Add to them where business context demands it.

### 7. Check task sizing

Each task must be completable in a single context window. Red flags:
- Task touches more than 3-4 directories
- Task has more than 5 acceptance criteria
- Task description implies multiple distinct units of work
- Task requires holding extensive cross-file context simultaneously

Flag oversized tasks for splitting.

### 8. Challenge check (required before approving)

Before deciding on `approved`, identify at least one assumption, risk, or tradeoff you are uncertain about and state it explicitly in the Detail section of your feedback. This is required — not optional. The goal is to demonstrate active evaluation, not rubber-stamping.

Examples:
- "Approving, but T-004's acceptance criteria don't mention empty states — what happens when a company has no articles? Worth verifying."
- "Coverage looks complete, but I notice no task addresses what happens if Meilisearch is temporarily unavailable. The app should degrade gracefully."
- "Task sizing looks right, but T-003 touches the ingest pipeline AND the indexer — if either piece gets complicated, consider splitting."

If you cannot identify even one uncertainty, re-read the tasks. You're not reading critically enough.

### 9. Decide disposition

- **approved**: All project acceptance criteria are covered, task sizing is reasonable, no significant gaps.
- **revise**: One or more of the following: gaps in coverage, criteria that need refinement, tasks that need splitting or merging, sequencing problems.

### 9. Write feedback

If disposition is `revise`, write specific, actionable feedback:
- Which project criteria are not covered and which tasks should address them
- Which task criteria need refinement and what the refined version should say
- Which tasks are over- or under-scoped and how to fix them
- Any sequencing changes needed

Do not send vague feedback. Every issue must have a concrete path to resolution.

### 10. Send feedback message to EM

Place message in `docs/inbox/engineering-manager/unread/`:
- `type`: feedback
- `from`: program-manager
- `to`: engineering-manager
- `disposition`: approved | revise
- `project`: PRJ-NNN
- `round`: Increment from the incoming message's round number
- `references`: Paths to the task files reviewed
- `urgency`: normal
- `reason`: Task review for PRJ-NNN — approved | revise with N issues

**Summary:** One paragraph — approved or revise, with the key issues if revise.
**Detail:** If revise, the full list of issues with specific remediation guidance. If approved, a brief note on any criteria you refined (so the EM knows what changed).

### 11. If approved, tasks enter the work queue

No further action required from PgM. The EM dispatches workers against approved tasks.

### 12. Move original message to read/

Move the `tasks-proposed` or `tasks-revised` message from `docs/inbox/program-manager/unread/` to `docs/inbox/program-manager/read/`.

### 13. Commit

```
git add docs/inbox/
git commit -m "feedback: <disposition> tasks for PRJ-NNN (round <N>)"
```

## Negotiation limits

Maximum 2 revision cycles before escalation to human. A revision cycle is: PgM sends `revise` then EM sends `tasks-revised` then PgM evaluates. If the second revision still has unresolved issues, escalate to human with both positions clearly stated.

## What this skill does NOT do

- Does not create or modify task files — that is the EM's responsibility
- Does not dispatch workers — the EM handles execution
- Does not evaluate implementation quality — only coverage and criteria correctness

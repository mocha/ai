---
paths:
  - "docs/tasks/**"
---
# Post-Task Completion Checklist

When a subagent completes a task, run through this checklist BEFORE moving to the next task. Do not skip steps. Do not batch multiple tasks before running the checklist.

## 1. Verify Commit Integrity
- [ ] Commit landed on the correct worktree branch (not main)
- [ ] `git log --oneline -1` on the worktree matches expected commit message

## 2. Review (select appropriate level)
**First instance of a new pattern** (first schema, first route, first middleware, first test pattern):
- [ ] Dispatch spec compliance review
- [ ] Dispatch code quality review
- [ ] Fix any issues found, re-review until approved

**Repetition of established pattern:**
- [ ] Dispatch spec compliance review
- [ ] Spot-check implementation (read key files, verify patterns followed)

## 3. Update Task File
- [ ] Set `status: done` in frontmatter
- [ ] Set `disposition:` with one-line summary
- [ ] Set `completed:`, `actual_tokens:`, `actual_duration_minutes:`
- [ ] Check acceptance criteria boxes
- [ ] Write Completion Summary (Changes Made, Decisions Made, Verification Results, Concerns)

## 4. Check Subagent Report
- [ ] Did the subagent report any decisions? → Document in task file
- [ ] Did the subagent report any deviations? → Investigate and document
- [ ] Did the subagent report any concerns? → Address or escalate

## 5. Move to Completed
- [ ] Move the task file from `docs/tasks/` to `docs/tasks/_completed/`
- [ ] Verify the active queue (`docs/tasks/`) no longer contains the completed task
- [ ] This keeps the active queue clean — a listing of `docs/tasks/` shows only in-flight work

## 6. Blocked Task Workflow
When setting a task to `status: blocked`:
- [ ] Set `disposition` to describe the blocker clearly
- [ ] Send an escalation message to PgM via `docs/inbox/program-manager/unread/`
- [ ] Do NOT wait for answers — move to the next unblocked task

## 7. Check Project Completion
- [ ] Are all tasks for this project now in `docs/tasks/_completed/`?
- [ ] If yes: run the full-stack validation (see 7a) BEFORE sending project-complete
- [ ] If not all tasks done: move to next task in queue

## 7a. Full-Stack Validation (required before project-complete)
Stand up the application with fixture/example data and verify it actually works:
- [ ] Start all required services (database, search engine, etc.)
- [ ] Ingest fixture or example data
- [ ] Start the application
- [ ] Verify every route returns 200 (not just the status code — check for error pages)
- [ ] Walk through each End-to-End Validation Flow from the project file
- [ ] If any flow fails: fix the issue, commit, re-validate. Do NOT send project-complete with broken flows.
- [ ] Record which flows passed/failed in the project-complete message

This catches bugs that unit and integration tests miss. 407 passing tests does not mean the app works.

## 7b. Aggregate Cost Metrics

## 7a. Aggregate Cost Metrics at Project Completion
When sending `project-complete`, include a cost summary in the message Detail section:
- [ ] Sum `actual_tokens` across all tasks in the project
- [ ] Sum `actual_duration_minutes` across all tasks
- [ ] Count total tasks completed
- [ ] Note which tasks used which model (should all be Sonnet for workers)

Format in the message:
```
### Cost Summary
| Task | Tokens | Duration | Model |
|------|--------|----------|-------|
| T-001 | 45,000 | 8 min | sonnet |
| T-002 | 62,000 | 12 min | sonnet |
| ...  | ...    | ...     | ...   |
| **Total** | **107,000** | **20 min** | |
```

This gives the PgM and human visibility into execution cost per project, enabling cost-per-feature analysis across experiment runs.

## 8. Confirm Done
- [ ] All applicable checklist items above completed
- [ ] Move to next task

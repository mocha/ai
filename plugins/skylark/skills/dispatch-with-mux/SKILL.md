---
name: dispatch-with-mux
description: >-
  Parallel task execution via Mux server. Replaces the sequential develop loop
  for elevated+ risk work when a Mux server is available. Dispatches independent
  tasks to isolated worktrees in parallel, monitors completion, runs reviews,
  and merges results back in dependency order. Called by implement when the user
  chooses parallel execution at the hard gate. Not user-invocable.
---

# Dispatch with Mux

Execute multiple tasks in parallel via a running Mux server. Each task runs in
an isolated git worktree with a vocabulary-routed expert, just like the
sequential develop path — but independent tasks execute concurrently.

## When Called

Called by `/skylark:implement` at the DEVELOP stage when:
1. Risk is elevated+ with multiple approved tasks
2. `.muxrc` exists in the project root
3. The user chose "Parallel via Mux" at the hard gate

Receives: the full task list with dependency graph and risk level from
plan-review.

## Prerequisites

A running Mux server. This skill does NOT start the server — it connects to
one that's already running. If the server is unreachable, report the failure
to implement and recommend falling back to sequential develop.

## Process

### Step 1: Read Configuration

Read `.muxrc` from the project root. Parse YAML fields:

```yaml
host: localhost
port: 3000
auth_token_env: MUX_SERVER_AUTH_TOKEN

max_parallel_tasks: 4
runtime: worktree

models:
  sonnet: "anthropic:claude-sonnet-4-20250514"
  opus: "anthropic:claude-opus-4-1"
  haiku: "anthropic:claude-haiku-4-5-20251001"
```

Resolve the auth token from the environment variable named by `auth_token_env`.

Verify the Mux server is reachable:

```bash
curl -sf -H "Authorization: Bearer $token" http://$host:$port/api/health
```

If unreachable, STOP. Return to implement with:
```
status: fallback
reason: "Mux server at $host:$port is not reachable. Falling back to sequential."
```

### Step 2: Build Dependency DAG

Retrieve all tasks from beads:

```bash
# Get all tasks linked to this plan
bd list --json
# Filter for tasks with spec_id pointing to the plan, status open or approved label
```

Build the dependency graph from beads' blocking dependencies:
1. Use `bd dep tree <task-id> --json` to retrieve the full dependency structure
2. Validate: no circular dependencies (`bd dep cycles`)
3. Only include tasks with the `approved` label
4. If blocked tasks exist (from plan-review), exclude them and their dependents

### Step 3: Compute Execution Waves

Topological sort tasks into waves:
- **Wave 0:** Tasks with no dependencies (all `depends_on` empty or already complete)
- **Wave N:** Tasks whose dependencies are all in waves < N

```
Example:
  TASK-001 (depends_on: [])           → Wave 0
  TASK-002 (depends_on: [])           → Wave 0
  TASK-003 (depends_on: [TASK-001])   → Wave 1
  TASK-004 (depends_on: [TASK-001, TASK-002]) → Wave 1
  TASK-005 (depends_on: [TASK-004])   → Wave 2
```

Report the wave plan to the user before starting:

```
## Execution Plan

Wave 0 (parallel): TASK-001 [schema migration], TASK-002 [seed data]
Wave 1 (parallel): TASK-003 [API routes], TASK-004 [query layer]
Wave 2:            TASK-005 [integration wiring]

Total: 5 tasks across 3 waves. Max parallel: 2 (wave 0).
Mux server: localhost:3000, max_parallel_tasks: 4
```

### Step 4: Execute Waves

For each wave, in order:

#### 4a. Pre-Flight Size Check and Expert Prompts

For each task in the wave, estimate the total context: task spec + parent context + expert prompt. If any task exceeds **40,000 tokens** (20% of Sonnet's context window) per `_shared/risk-matrix.md`, do not dispatch it — return it to implement with a recommendation to decompose further.

For tasks that pass the size check, follow `_shared/expert-prompt-generator.md` to
generate a vocabulary-routed expert prompt scoped to that task's domain.

This is the same process as `develop/SKILL.md` Step 2. Each task gets a
fresh expert — a database task gets different routing than an API task in
the same wave.

#### 4b. Create Mux Workspaces

For each task in the wave, create a Mux workspace:

```bash
# Create workspace via Mux ORPC API
curl -X POST http://$host:$port/api/workspace.create \
  -H "Authorization: Bearer $token" \
  -H "Content-Type: application/json" \
  -d '{
    "projectPath": "<project-root>",
    "branchName": "task/<task-id>-<slug>",
    "title": "<task-title>",
    "runtimeConfig": { "type": "worktree" }
  }'
```

Record the workspace ID returned for each task.

#### 4c. Write Expert Agent Definitions

For each task, write the vocabulary-routed expert prompt as a Mux agent
definition. Write it into the worktree's `.mux/agents/` directory so it
is scoped to that workspace:

```
<worktree-path>/.mux/agents/task-<NNN>-expert.md
```

Agent definition format:

```markdown
---
name: "<bead-id> Expert"
base: exec
subagent:
  runnable: true
prompt:
  append: false
---

## Identity
[Generated identity statement — <50 tokens, real job title, authority boundary]

## Domain Vocabulary
[Generated vocabulary — 3-5 clusters, 15-30 terms, practitioner-grade]

## Anti-Patterns
[Generated anti-patterns — 5-10 failure modes with detection + resolution]

## Resources

- **Project docs:** Explore `docs/` for additional context — `docs/strategy/` has design principles and user stories, `docs/architecture/` has architectural decision records. Read anything relevant to your task.
- **Expert consultation:** If you need a second opinion on a design question, domain concern, or tricky trade-off, invoke `/skylark:solo-review` to get a vocabulary-routed expert review on any document or question. You are always welcome to stop and ask an expert.

## Operational Guidance
[Task-specific: error philosophy, concurrency model, edge case handling]

## Testing Expectations
[Task-specific: language-idiomatic patterns, edge cases, verification]

## Deliverables
[Concrete files to create or modify from the task spec]
```

This places the expert prompt in Mux's `<agent-instructions>` slot (position
4 in the system prompt assembly) — the first domain-specific content the
model sees. The Mux prelude (position 1) is operational plumbing that does
not compete with the expert identity.

#### 4d. Dispatch Tasks

For each task in the wave, send the task prompt to its Mux workspace:

```bash
curl -X POST http://$host:$port/api/workspace.sendMessage \
  -H "Authorization: Bearer $token" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "<workspace-id>",
    "message": "<task-dispatch-prompt>",
    "options": {
      "model": "<model-from-muxrc>",
      "agentId": "task-<NNN>-expert",
      "additionalSystemInstructions": "<task-details-and-context>"
    }
  }'
```

The **message** contains the full dispatch prompt from `develop/SKILL.md`
Step 5 — task description, context, self-review instructions, report format.
Pass the full task text inline (never make the subagent read the task file).

The **additionalSystemInstructions** contains task-specific context: where
this fits in the broader plan, what tasks came before, what this enables.
This lands in position 7 (last) for recency.

**Model selection** follows `develop/SKILL.md` Step 4:
- 1-2 files, mechanical: use the `sonnet` model from `.muxrc`
- Multiple files, integration: use the default model
- Design judgment needed: use the `opus` model from `.muxrc`

Map the skylark shorthand to Mux model identifiers via `.muxrc`'s `models`
section.

Dispatch ALL tasks in the wave before monitoring any of them. Do not wait
for one task to complete before dispatching the next.

Respect `max_parallel_tasks` from `.muxrc`. If the wave has more tasks than
the limit, dispatch up to the limit and queue the rest. As tasks complete,
dispatch queued tasks from the same wave.

#### 4e. Monitor Progress

Poll each workspace for completion. Use Mux's streaming chat API or poll
the workspace status endpoint.

Report progress to the user as tasks complete:

```
## Wave 0 Progress

completed  TASK-001: schema migration — DONE (47s)
running    TASK-002: seed data — in progress
```

#### 4f. Handle Task Statuses

Parse `reportMarkdown` from each completed workspace for the skylark
status format:

**DONE:** Queue task for review (Step 5).

**DONE_WITH_CONCERNS:** Read concerns from the report. If concerns are
about correctness or scope, send a follow-up message to the same workspace
to address them before review. If they're observations, note them and
queue for review.

**NEEDS_CONTEXT:** Send a follow-up message to the same Mux workspace
providing the missing context. The workspace persists — no need to create
a new one. This does not count as a review round. Continue monitoring.

**BLOCKED:** Pull the task back to the orchestrator.
- Present the blocker to the user with options:
  1. Provide additional context (you'll relay it to the workspace)
  2. Re-dispatch with a more capable model
  3. Skip this task and its dependents
  4. Stop all execution
- User decides. Do not auto-skip.
- If the user provides context, send it to the workspace and continue monitoring.
- Blocked tasks do NOT block other tasks in the same wave.

### Step 5: Review Wave Results

After all tasks in a wave complete implementation (or are blocked/skipped),
run reviews for completed tasks.

#### 5a. Spec Compliance Review

For each completed task, run spec compliance review per `develop/SKILL.md`
Step 7. Dispatch the spec compliance reviewer as a subagent (in the main
Claude Code session, not via Mux).

The reviewer reads the implementation from the Mux worktree path.

**If spec compliant:** Queue for panel review.

**If issues found:** Send the implementer back into the same Mux workspace
with the compliance findings. Monitor for completion. Re-run spec compliance
review. Repeat until compliant.

#### 5b. Panel Review (Code Quality)

Only after spec compliance passes. For each compliant task, invoke
`/skylark:panel-review` per `develop/SKILL.md` Step 8.

Panel size and model per `_shared/risk-matrix.md`:
- Elevated: Sonnet, 3-4 experts, 1 round
- Critical: Opus, 3-4 experts, 2 rounds (adaptive narrowing)

Review target: implementation diff in the worktree.

#### 5c. Handle Verdicts

**Ship:** Close the task bead: `bd close <task-id> --reason "Implemented via Mux. Tests pass. Branch: task/<bead-id>-slug." --json`. Append changelog to parent plan:
```
- **YYYY-MM-DD HH:MM** — [DEVELOP] Task <bead-id> complete via Mux dispatch. Tests pass. Branch: task/<bead-id>-slug.
```

**Revise (round < max):** Send implementer back into the Mux workspace with
findings. Re-review after fixes. Increment round.

**Revise (round = max) or Rethink:** Escalate to user. Other tasks in the
wave are unaffected.

### Step 6: Merge Wave Results

After all tasks in a wave pass review (or are skipped/escalated):

1. **Merge sequentially in dependency order.** Even within a wave (where tasks
   are independent), merge one at a time to maintain a clean HEAD:

   ```bash
   git merge task/<bead-id>-slug --no-ff
   ```

2. **After each merge, run the full test suite.** Not just the task's tests —
   the full suite catches integration issues between independently-developed
   tasks:

   ```bash
   # Use the project's test command from CLAUDE.md or package.json
   pnpm test  # or npm test, make test, etc.
   ```

3. **If merge conflict:** STOP the wave. Present the conflict to the user:
   - Show which tasks conflict and the conflicting files
   - Options: resolve manually, rebase and retry, stop execution
   - Do not attempt automatic conflict resolution

4. **If tests fail post-merge:** STOP the wave. Present the failure:
   - Show which test(s) failed and which merge introduced the failure
   - Options: investigate and fix, revert last merge, stop execution

5. **After all merges in the wave succeed:** Clean up worktrees for
   completed tasks:

   ```bash
   git worktree remove <worktree-path>
   ```

6. **Update progress report:**

   ```
   ## Wave 0 Complete

   completed  TASK-001: schema migration — merged, tests pass
   completed  TASK-002: seed data — merged, tests pass
   skipped    TASK-003: auth layer — blocked (escalated to user)

   Proceeding to Wave 1...
   ```

### Step 7: Next Wave

After a wave completes:
1. Check which tasks are now unblocked (all `depends_on` satisfied)
2. If unblocked tasks exist, return to Step 4 with the next wave
3. If no more tasks, proceed to Step 8

### Step 8: Return to Implement

Return the aggregated result:

```
status: complete | partial | blocked
tasks_completed: [list of bead IDs]
tasks_skipped: [list of bead IDs with reasons]
tasks_blocked: [list of bead IDs with blockers]
waves_executed: N
total_review_rounds: N
outstanding_issues: [list, empty if all complete]
```

Implement's FINISH stage handles final test verification, branch options
(merge/PR/keep/discard), session notes, and architecture doc updates.

## Failure Modes

| Failure | Response |
|---------|----------|
| Mux server unreachable at dispatch time | Return `status: fallback` to implement. Recommend sequential develop |
| Mux server drops mid-wave | Report which tasks were in flight. Offer: retry failed tasks, switch to sequential for remaining, stop |
| Workspace creation fails | Report the error. Offer: retry, skip task, stop |
| Task times out (no completion after extended period) | Report to user. Offer: check workspace status manually, terminate and retry, skip |
| All tasks in a wave fail | Report to user. Do not proceed to next wave. Offer: investigate, stop |

## Progress Reporting

Keep the user informed throughout. After each significant event, update the
progress display:

```
## Dispatch Progress

Wave 0/2
  completed  TASK-001: schema migration — DONE, reviewed (Ship), merged
  running    TASK-002: seed data — implementation complete, reviewing...

Wave 1/2 (pending)
  pending    TASK-003: API routes — waiting for TASK-001
  pending    TASK-004: query layer — waiting for TASK-001, TASK-002

Wave 2/2 (pending)
  pending    TASK-005: integration wiring — waiting for TASK-004
```

## What This Skill Does NOT Do

- Start or manage the Mux server — assumes it's already running
- Replace the sequential develop path — offers an alternative that the user
  explicitly chooses
- Skip reviews — every task gets spec compliance + panel review, same as
  sequential
- Auto-resolve merge conflicts — always escalates to user
- Dispatch tasks from different waves in parallel — wave ordering is strict
- Retry indefinitely — blocked tasks escalate, review rounds are capped
- Modify develop, finish, or any other existing skill — this is additive only

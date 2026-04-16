---
name: implement
description: >-
  Use when starting any development work — file paths, specs, plans, tasks,
  ideas, or bug reports. Entry point that starts the Roadrunner orchestrator,
  bridges its commands to Claude Code actions, and feeds results back as events.
  The orchestrator (XState v5) handles all routing, guards, and state — this
  skill just translates between the machine and your tools.
---

# Implement (Roadrunner Bridge)

Start the Roadrunner orchestrator and act as the bridge between its typed
commands and Claude Code's tools. The orchestrator is a deterministic state
machine — it decides what happens next. You execute its commands and report
results.

**Your role is execution, not decision-making.** The machine handles routing,
guard evaluation, stage skipping, review rounds, escalation, and persistence.
You translate commands into actions and events into JSON.

## Checklist

Follow these steps in order.

### 1. Build the Orchestrator (if needed)

Check if the compiled CLI exists:

```bash
ls plugins/roadrunner/dist/orchestrator/cli.js 2>/dev/null || \
  (cd plugins/roadrunner && npm run build)
```

### 2. Classify the Input

Determine the input type from what the user provided:

| User gives you... | `type` value |
|---|---|
| File path to `docs/specs/*.md` | `spec` |
| File path to `docs/plans/*.md` | `plan` |
| Bead ID (`bd-XXXX`) | `task` |
| Bug report, error message, failing test | `raw-problem` |
| Feature idea, "I want...", "we should..." | `raw-idea` |
| External tracker ref (`#42`, `ENG-142`) | `external-ref` |
| Anything else | `raw-input` |

If the user declared a risk level ("this is load-bearing", "just a quick fix"),
note it as `user_risk_override`. Otherwise `null`.

### 3. Start the Orchestrator

Start the roadrunner CLI as a background process reading from stdin:

```bash
cd plugins/roadrunner && node dist/orchestrator/cli.js
```

Use the Monitor tool or a background Bash process so you can write events to
its stdin and read commands from its stdout.

### 4. Send the START Event

Write the START event as a single JSON line to the orchestrator's stdin:

```json
{"type":"START","input":{"type":"<input-type>","content":"<user-input-or-file-path>","user_risk_override":null}}
```

The orchestrator transitions from `idle` → `triage` and emits its first
command.

### 5. Enter the Command Loop

The orchestrator logs commands to stdout in this format:

```
[orchestrator] command: <TYPE> { ...json... }
```

For each command, execute the corresponding action below, then send the
result event back as a JSON line to stdin.

**Continue until you see `[state] done` or `[state] failed` in the output.**

---

## Command Handlers

### Layer 1: Triage & Routing

#### `RUN_TRIAGE`

Classify the input, detect existing artifacts, assess risk. Follow the same
logic as `/skylark:triage` — search `docs/specs/`, `docs/plans/`, beads
(`bd search`), `docs/strategy/`, `docs/architecture/`, and `git log`.

**Return event:**
```json
{
  "type": "TRIAGE_COMPLETE",
  "input_type": "raw-idea|spec|plan|task|raw-problem|raw-input|external-ref",
  "risk": "trivial|standard|elevated|critical",
  "path": ["triage","prepare","brainstorm","spec_review","write_plan","plan_review","develop","finish"],
  "existing_artifact": null,
  "external_ref": null,
  "decompose": false,
  "domain_clusters": ["database", "api"]
}
```

Populate `path` based on risk level per the Skylark risk matrix:
- **trivial**: `["develop","finish"]`
- **standard**: `["prepare","develop","finish"]`
- **elevated**: `["prepare","spec_review","write_plan","plan_review","develop","finish"]`
- **critical**: same as elevated (machine handles larger panels and approval gates)

If the input is a feature-scale raw idea, include `"brainstorm"` after `"prepare"`.

---

### Layer 3: Task Substrate

#### `DECOMPOSE`

Decompose a spec into a task DAG. Use beads:

```bash
# Read the spec
# For each task identified, create a bead
bd create "Task title" -t task -p 2 \
  --description="..." --design="..." --acceptance="..." \
  --spec-id "<spec-path>" --json

# Wire blocking dependencies
bd dep add <task-b-id> <task-a-id> --type blocks
```

**Return event:**
```json
{
  "type": "DECOMPOSITION_COMPLETE",
  "task_count": 4,
  "task_ids": [1, 2, 3, 4],
  "domains": ["database", "api"]
}
```

#### `QUERY_NEXT_TASK`

Find the next unblocked task:

```bash
bd ready --json
```

**Return event (task available):**
```json
{
  "type": "QUERY_RESULT",
  "outcome": "task_ready",
  "task": {
    "id": 1,
    "title": "Schema migration",
    "dependencies": [],
    "status": "pending",
    "details": "...",
    "acceptanceCriteria": ["..."],
    "relevantFiles": ["src/db/schema.ts"]
  }
}
```

**Return event (all done):**
```json
{"type": "QUERY_RESULT", "outcome": "all_complete"}
```

**Return event (stuck):**
```json
{"type": "QUERY_RESULT", "outcome": "all_blocked", "blocked_task_ids": [3,4], "blocked_reasons": ["depends on task 2 which failed review"]}
```

#### `UPDATE_TASK_STATUS`

```bash
bd update <task-id> --status <status> --json
# Or for completion:
bd close <task-id> --reason "Done" --json
```

No return event needed (fire-and-forget).

---

### Layer 4: Expert Generation & Review

#### `GENERATE_EXPERT`

Generate a vocabulary-routed expert prompt for the task. Follow
`/skylark:develop` Step 2 — read `_shared/expert-prompt-generator.md`,
`_shared/vocabulary-guide.md`, `_shared/prompt-template.md`.

Scope the expert to THIS TASK's domain. Write the prompt to
`.roadrunner/experts/TASK-<id>.md`.

Before returning, run a **drift check** — grep the codebase to verify that
key files, functions, and types referenced in the task spec still exist:

```bash
# For each file in task.relevantFiles
ls <file> 2>/dev/null || echo "DRIFT: <file> missing"
```

**Return event:**
```json
{
  "type": "EXPERT_READY",
  "task_id": 1,
  "expert_prompt_path": ".roadrunner/experts/TASK-1.md",
  "drift_check": "pass",
  "drift_details": null
}
```

If drift detected: `"drift_check": "fail"` and describe what's missing in
`drift_details`. The machine will escalate to the user.

#### `RUN_REVIEW`

Two-stage review. The command includes `worker_result` with changed files.

**Stage 1 — Spec compliance:** Dispatch a subagent to verify the
implementation matches the task spec (same as `/skylark:develop` Step 7).

**Stage 2 — Code quality panel:** If spec-compliant, invoke
`/skylark:panel-review` with panel size and model from the command's `risk`
field per the risk matrix.

**Return event:**
```json
{
  "type": "REVIEW_COMPLETE",
  "task_id": 1,
  "verdict": "SHIP|REVISE|RETHINK",
  "round": 1,
  "report_path": "docs/reports/R-20260415-panel-synthesis.md",
  "findings": [],
  "gate": "code_quality"
}
```

---

### Layer 5: Worker Execution

#### `DISPATCH_WORKER`

Create a worktree and dispatch an implementer subagent. This is the same as
`/skylark:develop` Steps 3-5:

1. **Create worktree:**
   ```bash
   git worktree add .worktrees/task-<id> -b task/bd-<id>-<slug>
   ```

2. **Write expert prompt** as CLAUDE.md in the worktree root (from
   `expert_prompt_path` in the command).

3. **Dispatch subagent** via the Agent tool:
   - `description`: `"Develop: <task-title>"`
   - `model`: from command (`sonnet` or `opus`)
   - `isolation`: `"worktree"`
   - `prompt`: Full task description + context + self-review instructions
     (same dispatch prompt as `/skylark:develop` Step 5)

4. **Parse the subagent's report** for status (DONE / DONE_WITH_CONCERNS /
   NEEDS_CONTEXT / BLOCKED).

**Return event:**
```json
{
  "type": "WORKER_COMPLETE",
  "task_id": 1,
  "status": "DONE",
  "result_path": ".roadrunner/results/TASK-1.json",
  "cost_usd": 0.0,
  "duration_ms": 45000,
  "files_changed": ["src/db/schema.ts", "tests/db/schema.test.ts"],
  "concerns": null
}
```

---

### User-Facing Commands

#### `REQUEST_APPROVAL`

The machine wants user confirmation (critical risk gates). Present the
summary from the command and ask:

```
## Approval Required: <stage>

<summary>

Risk level: <risk>

1. **Proceed** — continue the pipeline
2. **Abort** — stop the pipeline entirely

Which option?
```

**Return event:**
```json
{"type": "USER_APPROVE", "stage": "<stage>", "decision": "proceed|abort"}
```

#### `ESCALATE`

The machine hit a problem (blocked worker, failed review after max rounds,
drift detected, all tasks blocked). Present the reason and options:

```
## Escalation: <reason>

Task: <task-id>
Options: <options from command>

1. **Retry** — try again
2. **Skip** — skip this task and continue with others
3. **Abort** — stop the pipeline entirely

Which option?
```

**Return event:**
```json
{"type": "USER_ESCALATION_RESPONSE", "task_id": 1, "action": "retry|skip|abort"}
```

---

### Stages Handled by Skylark Skills

These commands map directly to existing Skylark skills. Read and follow the
skill, then return the appropriate completion event.

#### `dispatchPrepare` → `/skylark:prepare` logic

**Return:** `{"type": "PREPARE_COMPLETE", "spec_path": "docs/specs/...", "decomposition_recommended": false, "decomposition_rationale": null}`

#### `dispatchBrainstorm` → `/skylark:brainstorm` logic

**Return:** `{"type": "BRAINSTORM_COMPLETE", "spec_path": "docs/specs/...", "decomposition_recommended": false, "decomposition_rationale": null}`

#### `dispatchSpecReview` → `/skylark:spec-review` logic (single round)

**Return:** `REVIEW_COMPLETE` event (see above)

#### `dispatchWritePlan` → `/skylark:write-plan` logic

**Return:** `{"type": "PLAN_COMPLETE", "plan_path": "docs/plans/...", "decomposition_recommended": false, "decomposition_rationale": null}`

#### `dispatchPlanReview` → `/skylark:plan-review` logic (single round)

**Return:** `REVIEW_COMPLETE` event (see above)

#### `dispatchFinish` → `/skylark:finish` logic

**Return:** `{"type": "FINISH_COMPLETE", "summary": "..."}`

---

## Progress Reporting

After each state transition, the orchestrator logs `[state] <value>`. Report
progress to the user after key transitions:

```
## Pipeline Progress

State: develop.await_worker
Risk: elevated
Tasks: 2/5 complete

completed  bd-a1b2: Schema migration — SHIP
completed  bd-c3d4: Seed data — SHIP
active     bd-e5f6: API routes — worker running
pending    bd-g7h8: Query layer (depends on bd-e5f6)
pending    bd-i9j0: Integration wiring (depends on bd-g7h8)
```

## Resumption

If the session ends mid-pipeline, the orchestrator state is persisted in
`.roadrunner/state.json`. Next session:

1. Start the orchestrator again — it auto-restores from the snapshot
2. It resumes in exactly the state it was in (e.g., `develop.await_worker`)
3. Re-send the last event that was in flight (check `.roadrunner/results/`
   for incomplete tasks)

Artifacts in `docs/` and beads provide the full context for resumption.

## Resources

- **Orchestrator source:** `plugins/roadrunner/src/orchestrator/`
- **Machine definition:** `plugins/roadrunner/src/orchestrator/machine.ts`
- **Event types:** `plugins/roadrunner/src/orchestrator/events.ts`
- **Command types:** `plugins/roadrunner/src/orchestrator/commands.ts`
- **Skylark skills:** `plugins/skylark/skills/` (triage, prepare, brainstorm,
  spec-review, write-plan, plan-review, develop, finish, panel-review,
  solo-review)
- **Shared methodology:** `plugins/skylark/skills/_shared/`

## What This Skill Does NOT Do

- Make routing decisions — the XState machine handles all guards and transitions
- Skip stages on its own judgment — the machine's risk-based guards do this
- Persist state — the orchestrator handles its own persistence
- Iterate review rounds — the machine tracks rounds and caps at max
- Resolve escalations — always presents options to the user

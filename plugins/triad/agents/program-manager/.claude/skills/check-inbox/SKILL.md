---
name: check-inbox
description: Reads and routes all unread messages in the program manager's inbox. Processes messages in timestamp order, identifies the type and sender, and dispatches to the appropriate skill or handling procedure. This is the primary entry point at session start.
---

# Check Inbox

Reads all unread messages and routes each to the appropriate handler based on type and sender.

## Usage

`/check-inbox` — run at session start, or when notified of a new message.

## Workflow

### 1. List unread messages

List all files in `docs/inbox/program-manager/unread/`.

If the directory is empty, report "No unread messages" and stop.

### 2. Sort by filename

Filenames follow the convention `<YYMMDDHHMMSS>-<objectid>-<step>.md`, so lexicographic sorting gives timestamp ordering. Process in this order — oldest first.

### 3. Process each message

For each message file:

a. **Read the message** — parse the YAML frontmatter to extract `type`, `from`, `disposition`, `proposal`, `project`, `task`, `round`, and `references`.

b. **Identify message category** from the combination of `type` and `from`.

c. **Route to the appropriate handler:**

| Type | From | Action |
|---|---|---|
| `proposal-review` | product-manager | Use `/create-project-plan` to decompose the proposal into projects |
| `feedback` (disposition: revise) | product-manager | Revise the project plan per PM feedback, re-send as `project-plan-revised` |
| `feedback` (disposition: approved) | product-manager | Update project statuses to `approved`, send `project-ready` to EM for each approved project |
| `tasks-proposed` | engineering-manager | Use `/review-tasks` to evaluate proposed tasks |
| `tasks-revised` | engineering-manager | Use `/review-tasks` to re-evaluate revised tasks |
| `project-complete` | engineering-manager | Use `/validate-project` to validate the completed project |
| `info` | engineering-manager | Acknowledge; check if ad hoc task additions affect project scope or sequencing |
| `escalation` | engineering-manager | Provide sequencing, dependency, or architecture clarity; respond with `info` or `feedback` |
| `feedback` | human | Incorporate direction into current work, resume processing |
| `directive` | human | Assess impact on in-flight work, pause affected negotiations, incorporate direction, send `info` acknowledgment to `docs/inbox/human/unread/` |

d. **Move processed message** from `unread/` to `read/`.

### Routing details

#### proposal-review from PM

Invoke `/create-project-plan`. That skill handles the full workflow including sending the response and committing.

#### feedback (revise) from PM

1. Read the PM's feedback — identify which projects need changes and what the concerns are.
2. Read the referenced project files.
3. Revise the project files to address the PM's feedback. Update the `updated` date in frontmatter.
4. Send a `project-plan-revised` message to `docs/inbox/product-manager/unread/`:
   - `round`: Increment from the PM's message
   - `references`: Updated project file paths
   - **Summary:** What changed and why
   - **Detail:** Per-project changes with rationale
5. Check negotiation round count. If this is round 3+ (2 revision cycles exhausted), escalate to human instead of continuing revision.
6. Commit changes.

#### feedback (approved) from PM

1. Read which projects were approved (from the message references).
2. Update each approved project's status to `approved` in its frontmatter.
3. For each approved project, send a `project-ready` message to `docs/inbox/engineering-manager/unread/`:
   - `type`: project-ready (use as the step in the filename)
   - `project`: PRJ-NNN
   - `references`: Path to the project file
   - `reason`: Project approved — ready for task decomposition
4. Commit status changes and outgoing messages.

#### tasks-proposed / tasks-revised from EM

Invoke `/review-tasks`. That skill handles the full workflow.

#### project-complete from EM

Invoke `/validate-project`. That skill handles the full workflow.

#### info from EM

1. Read the info message — typically an ad hoc task notification.
2. Evaluate whether the ad hoc task affects project scope, sequencing, or acceptance criteria.
3. If no impact: acknowledge and move to read/.
4. If scope impact: update the project file if needed and send an `info` message back to EM noting any adjustments.

#### escalation from EM

1. Read the escalation — understand what the EM needs clarity on.
2. If you can resolve it (sequencing, dependency ordering, architecture guidance): send an `info` or `feedback` response to EM with the answer.
3. If you cannot resolve it (business decision, product question, external dependency): escalate to PM or human as appropriate.

#### feedback from human

1. Read the feedback and identify what direction is being provided.
2. Determine which in-flight work is affected.
3. Incorporate the direction — this may mean revising project plans, adjusting acceptance criteria, or re-prioritizing.
4. Resume normal processing.

#### directive from human

1. Read the directive and assess its impact on all current work.
2. If it affects an in-flight negotiation, pause that negotiation.
3. Incorporate the directive into current planning.
4. Send an `info` acknowledgment to `docs/inbox/human/unread/`:
   - `type`: info
   - `from`: program-manager
   - `to`: human
   - `reason`: Acknowledging directive — [brief description of impacts]
5. If the directive conflicts with existing approved documents, escalate back to the human — do not silently override the approved plan.
6. Directives do not consume negotiation rounds.

### 4. Multi-message processing

When multiple messages arrive simultaneously:
- Process in timestamp order (filename sort).
- Messages for different proposals or projects are independent — handle them separately.
- Messages for the same proposal/project in the same batch: process in order, as earlier messages may change context for later ones.

## What this skill does NOT do

- Does not generate messages unprompted — only responds to incoming messages
- Does not poll continuously — runs once when invoked, processes all unread messages, then stops
- Does not process messages from `read/` — those are historical record only (useful for reconstructing negotiation state at session start)

---
name: check-inbox
description: Reads and routes all unread messages in the Product Manager's inbox. Use at session start or when notified of a new message.
---

# Check Inbox

Processes all pending messages in the Product Manager's inbox, routing each to the appropriate skill or action.

## Usage

`/check-inbox` — scans and processes all unread messages.

## Workflow

### 1. List unread messages

List all files in `docs/inbox/product-manager/unread/`.

If the directory is empty or does not exist, report "No unread messages" and stop.

### 2. Sort by filename

Filenames are timestamp-prefixed (`YYMMDDHHMMSS-...`), so alphabetical sort gives chronological order. Process oldest messages first.

### 3. Process each message

For each message file, read it and identify the `type` and `disposition` fields from the frontmatter. Route based on type:

#### `project-plan` or `project-plan-revised` (from Program Manager)

The PgM has sent a project plan for your review. Invoke `/review-project-plan` with the message file path.

This skill handles:
- Reading the referenced projects
- Evaluating against proposal success criteria
- Sending approved/revise feedback
- Moving the message to read/

#### `project-validated` (from Program Manager)

A project has been completed and validated by the PgM. Invoke `/validate-proposal` with the message file path.

This skill handles:
- Checking if all projects for the proposal are done
- Evaluating success criteria if all are done
- Sending proposal-complete or revise
- Moving the message to read/

#### `escalation` (from Program Manager)

The PgM needs product or customer clarity to proceed.

1. Read the escalation detail thoroughly
2. Identify the specific question or decision needed
3. Assess whether you have the product/customer context to answer
4. If you can answer: create a feedback message with disposition `resolved`, place in `docs/inbox/program-manager/unread/`, and include the answer in the Detail section
5. If you cannot answer: escalate to the human by creating a message in `docs/inbox/human/unread/` with the original context plus your assessment of what is needed
6. Move the escalation message to `docs/inbox/product-manager/read/`

Use `/send-message` to create response messages.

#### `feedback` (from Human)

The human is providing direction on something you escalated or asked about.

1. Read the feedback carefully
2. Identify which proposal or negotiation it affects
3. Incorporate the direction into your current thinking
4. Resume the affected work (re-review a plan, update a proposal, etc.)
5. Move the message to `docs/inbox/product-manager/read/`

#### `directive` (from Human)

A new priority or course correction from the human.

1. Read the directive and understand its implications
2. Assess impact on active proposals and in-flight negotiations
3. If the directive affects an active negotiation, pause that negotiation
4. Incorporate the directive into your thinking and active proposals
5. Send an `info` acknowledgment to `docs/inbox/human/unread/`:
   - Confirm receipt of the directive
   - Describe any impacts on current work
   - Note any paused negotiations
6. If the directive conflicts with an existing approved proposal, escalate back to the human rather than silently overriding the approved plan
7. Move the message to `docs/inbox/product-manager/read/`

Use `/send-message` to create the acknowledgment message.

#### Unknown or unrecognized type

Log a warning and move the message to `docs/inbox/product-manager/read/` without processing. Do not fail — other messages in the queue may still be valid.

### 4. Commit processed messages

After all messages are processed:

```bash
git add docs/inbox/
git commit -m "inbox: processed <N> messages"
```

### 5. Report

Summarize what was processed:
- Number of messages handled
- For each: type, disposition taken, and any follow-up actions pending

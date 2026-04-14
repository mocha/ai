---
name: check-inbox
description: Checks the Engineering Manager inbox for unread messages and dispatches appropriate actions for each message type. Run at session start or when notified of a new message.
---

# Check Inbox

Processes all pending messages in the EM inbox, dispatching the appropriate skill for each message type.

## Usage

`/check-inbox` — processes all unread messages in order.

## Workflow

1. **List files** in `docs/inbox/engineering-manager/unread/`.

2. **Sort by filename** (filenames are timestamped as `<YYMMDDHHMMSS>-<objectid>-<step>.md`, so alphabetical sort is chronological order).

3. **For each message**, read it and dispatch based on type and content:

   | Message Type | From | Action |
   |---|---|---|
   | `project-ready` | PgM | Use `/propose-tasks` to decompose the project into tasks |
   | `feedback` (disposition: revise) | PgM | Revise task files per feedback, send `tasks-revised` to PgM |
   | `feedback` (disposition: approved) | PgM | Tasks enter the work queue — begin dispatching with `/assign-task` |
   | `info` | PgM | Read and acknowledge; no action required unless it affects active work |
   | `feedback` | Human | Incorporate the feedback into current work, resume processing |
   | `directive` | Human | Assess impact on in-flight work, pause affected tasks, incorporate the directive, send `info` acknowledgment to `docs/inbox/human/unread/` |

4. **Move each processed message** from `unread/` to `read/` after handling:
   ```bash
   mv docs/inbox/engineering-manager/unread/<filename> docs/inbox/engineering-manager/read/
   ```

## Message Processing Rules

- Process messages in strict chronological order (by filename).
- A `directive` from the human always takes priority — if encountered, process it before continuing with remaining messages even if others are older (they will have earlier timestamps, so this only applies if directives arrive mid-processing).
- If a message references a project or task that does not exist, send an `escalation` to PgM requesting clarification.
- If the inbox is empty, report "No pending messages" and proceed with normal session startup (review task queue, check for dispatchable work).

## Resuming After Restart

When resuming a session, scan `docs/inbox/engineering-manager/read/` to reconstruct the current negotiation state. The `round` field and chronological filenames provide the full conversation history for any in-progress negotiation.

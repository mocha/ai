---
name: send-message
description: Sends a protocol message to another agent or to the human by writing a markdown file to the recipient's inbox. Handles filename generation, template filling, and file placement.
---

# Send Message

Creates and delivers a protocol message to the specified recipient's inbox.

## Usage

`/send-message program-manager tasks-proposed PRJ-001` — sends a tasks-proposed message to PgM.
`/send-message human info` — sends an informational message to the human.

## Filename Convention

All message filenames follow this pattern:

```
<YYMMDDHHMMSS>-<objectid>-<step>.md
```

- **YYMMDDHHMMSS**: Timestamp at message creation (e.g., `260323143022` for 2026-03-23 14:30:22)
- **objectid**: The related object ID with hyphens removed (e.g., `PRJ001`, `T042`). If no object, use the sender ID (`engineeringmanager`)
- **step**: The message type/step (e.g., `tasksproposed`, `projectcomplete`, `escalation`, `info`)

Examples:
- `260323143022-PRJ001-tasksproposed.md`
- `260323150500-T042-escalation.md`
- `260323160000-engineeringmanager-info.md`

## Workflow

1. **Generate the filename** using the convention above. Use the current timestamp.

2. **Copy `templates/message.md`** as the base.

3. **Fill in the frontmatter fields:**
   - `type`: The message type (tasks-proposed, tasks-revised, project-complete, escalation, info, etc.)
   - `from`: engineering-manager
   - `to`: The recipient agent name
   - `disposition`: Set appropriately (pending for requests, approved for completions, etc.)
   - `references`: List of file paths relevant to this message
   - `project`: PRJ-NNN if applicable
   - `task`: T-NNN if applicable
   - `round`: Negotiation round number (increment from previous message in the exchange, or 1 for new exchanges)
   - `timestamp`: ISO 8601 timestamp
   - `urgency`: normal (unless escalation, then high)
   - `reason`: One-line summary of why the message was sent

4. **Write the Summary section** — a single paragraph the recipient can use to decide whether to act immediately or defer.

5. **Write the Detail section** — full context, specific questions, data, or decisions as appropriate for the message type.

6. **Place the file** in the recipient's inbox:
   ```
   docs/inbox/<recipient>/unread/<filename>
   ```

   Valid recipient directories:
   - `docs/inbox/program-manager/unread/`
   - `docs/inbox/product-manager/unread/`
   - `docs/inbox/human/unread/`

7. **Report** the sent message path and a one-line summary of what was sent.

## Notes

- Always use `templates/message.md` as the base — do not create messages from scratch.
- The `round` field is critical for tracking negotiation state. For a new exchange, start at 1. For a reply, increment from the message being replied to.
- Ensure the `references` field contains actual file paths, not descriptions.

---
name: send-message
description: Creates and delivers a structured message to another agent or human via the inbox system. Use whenever the Product Manager needs to communicate through the protocol.
---

# Send Message

Creates a structured message file and places it in the recipient's inbox for asynchronous delivery.

## Usage

`/send-message` — interactive creation with prompts for each field.
`/send-message --to program-manager --type feedback --proposal PMD-003 --disposition approved` — creates with provided fields, asks for remaining.

## Message Filename Convention

**Format:** `<YYMMDDHHMMSS>-<objectid>-<step>.md`

Rules:
- **Timestamp**: `YYMMDDHHMMSS` from current time (e.g., `260323140000` for 2026-03-23 at 14:00:00)
- **Object ID**: The most relevant object ID with hyphens removed:
  - `PMD-001` becomes `PMD001`
  - `PRJ-003` becomes `PRJ003`
  - `T-042` becomes `T042`
- **Step**: The message type (e.g., `proposal-review`, `feedback`, `project-validated`, `escalation`, `info`, `proposal-complete`)

Examples:
- `260323140000-PMD003-proposal-review.md`
- `260323153022-PMD001-feedback.md`
- `260323170000-PRJ005-escalation.md`
- `260323180000-PMD003-proposal-complete.md`

## Workflow

### 1. Gather message fields

Determine or ask for:

| Field | Required | Description |
|---|---|---|
| `type` | Yes | Message type: `proposal-review`, `feedback`, `proposal-complete`, `escalation`, `info` |
| `to` | Yes | Recipient: `program-manager`, `engineering-manager`, or `human` |
| `disposition` | Depends | `approved`, `revise`, `resolved`, `pending`, etc. Leave empty for submissions like `proposal-review` |
| `references` | Yes | List of related document paths |
| `proposal` | If applicable | Related proposal ID (e.g., `PMD-003`) |
| `project` | If applicable | Related project ID (e.g., `PRJ-003`) |
| `task` | If applicable | Related task ID (e.g., `T-042`) |
| `round` | If applicable | Communication round number for multi-turn exchanges |
| `urgency` | Yes | `low`, `normal`, `high`, or `critical` (default: `normal`) |
| `reason` | Yes | One-line reason the message is being sent |

### 2. Generate the filename

Use the current time to generate the timestamp portion. Select the most relevant object ID:
- For proposal-related messages: use the PMD ID
- For project-related messages: use the PRJ ID
- For task-related messages: use the T ID
- If multiple apply, prefer the highest-level object (proposal > project > task)

Remove hyphens from the object ID for the filename.

### 3. Create the message file

Use the template at `templates/message.md`. Fill in all frontmatter fields:

```yaml
---
type: <type>
from: product-manager
to: <recipient>
disposition: <disposition or empty>
references:
  - <path1>
  - <path2>
proposal: <PMD-NNN or empty>
project: <PRJ-NNN or empty>
task: <T-NNN or empty>
round: <number or empty>
timestamp: <ISO 8601>
urgency: <urgency>
reason: "<one-line reason>"
---
```

### 4. Write Summary and Detail sections

**Summary**: One paragraph. The recipient should be able to decide whether to act immediately or defer based on this section alone. Be concise but complete.

**Detail**: Full context, data, or rationale. Include:
- Specific questions if asking for input
- Options under consideration if presenting a decision
- Decisions made and reasoning if reporting an outcome
- References to specific documents, criteria, or evidence

### 5. Place the file

Write the file to: `docs/inbox/<recipient>/unread/`

Where `<recipient>` is one of:
- `program-manager`
- `engineering-manager`
- `human`

Ensure the directory exists (create it if not).

### 6. Stage the file

```bash
git add docs/inbox/<recipient>/unread/<filename>
```

Do NOT commit automatically. The calling skill or the user decides when to commit. This allows multiple messages or related file changes to be batched into a single commit.

### 7. Report

Confirm:
- Message filename and path
- Recipient
- Type and disposition
- The file has been staged but not committed

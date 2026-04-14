---
name: send-message
description: Constructs and delivers an inter-agent message following the protocol format. Generates the correct filename, fills frontmatter and body sections, places the file in the recipient's inbox, and stages it for commit.
---

# Send Message

Constructs a protocol-compliant message file and places it in the recipient's inbox.

## Usage

`/send-message` — used by other skills or invoked directly when the PgM needs to communicate with another agent or human.

## Filename Convention

Messages use the format: `<YYMMDDHHMMSS>-<objectid>-<step>.md`

- **YYMMDDHHMMSS:** Timestamp at message creation (e.g., `260323143022` for 2026-03-23 at 14:30:22)
- **objectid:** The primary object ID with hyphens dropped (e.g., PMD-001 becomes `PMD001`, PRJ-007 becomes `PRJ007`, T-042 becomes `T042`)
- **step:** The message type/step (e.g., `project-plan`, `feedback`, `project-validated`, `project-ready`, `info`, `escalation`)

Examples:
- `260323143022-PMD003-project-plan.md`
- `260323150100-PRJ007-feedback.md`
- `260323161500-PRJ007-project-validated.md`
- `260323170000-PMD003-project-ready.md`
- `260323180000-PRJ007-info.md`

## Workflow

### 1. Gather required fields

Collect from the calling context or determine:
- **type:** The message type (project-plan, project-plan-revised, project-ready, feedback, project-validated, escalation, info)
- **to:** Recipient agent (product-manager, engineering-manager, human)
- **disposition:** pending, approved, revise, acknowledged, resolved (depends on message type)
- **references:** List of related document paths
- **proposal:** PMD-NNN if applicable
- **project:** PRJ-NNN if applicable
- **task:** T-NNN if applicable
- **round:** Communication round number (increment from the message being responded to; 1 for initial messages)
- **urgency:** low, normal, high, or critical
- **reason:** One-line reason the message is being sent

### 2. Generate the filename

```
<YYMMDDHHMMSS>-<objectid>-<step>.md
```

Use the current timestamp. Choose the primary object ID:
- If the message concerns a proposal: use the PMD ID
- If the message concerns a project: use the PRJ ID
- If the message concerns a task: use the T ID
- Use the most specific applicable ID

The step is the message type.

### 3. Create the message file

Use `templates/message.md` as the base structure. Fill in all frontmatter fields:

```yaml
---
type: <type>
from: program-manager
to: <recipient>
disposition: <disposition>
references:
  - <path1>
  - <path2>
proposal: <PMD-NNN or empty>
project: <PRJ-NNN or empty>
task: <T-NNN or empty>
round: <N>
timestamp: <ISO 8601 timestamp>
urgency: <urgency>
reason: <one-line reason>
---
```

### 4. Write Summary and Detail sections

- **Summary:** One paragraph. The receiving agent should be able to decide whether to act immediately or defer based on this section alone. Be concise but complete.
- **Detail:** Full context, data, or rationale supporting the message. Include specific questions, options under consideration, or decisions made. Structure with sub-headings or lists for readability.

### 5. Place in recipient's inbox

Write the file to: `docs/inbox/<recipient>/unread/<filename>`

Where `<recipient>` is one of: `product-manager`, `engineering-manager`, `human`.

### 6. Stage for commit

```
git add docs/inbox/<recipient>/unread/<filename>
```

The calling skill or workflow handles the actual commit. This skill only stages.

## Message type reference

| Type | Typical Recipient | Typical Disposition | When |
|---|---|---|---|
| `project-plan` | product-manager | pending | Initial project decomposition from a proposal |
| `project-plan-revised` | product-manager | pending | Revised plan after PM feedback |
| `project-ready` | engineering-manager | pending | Approved project ready for task decomposition |
| `feedback` | engineering-manager | approved or revise | Response to task proposals |
| `project-validated` | product-manager | approved | Completed project passes all criteria |
| `escalation` | product-manager or human | pending | Cannot resolve at current level |
| `info` | any | acknowledged | FYI, directive acknowledgment, ad hoc task acknowledgment |

## What this skill does NOT do

- Does not decide what message to send — the calling skill or workflow determines the content
- Does not commit — only stages the file. The calling context commits with an appropriate message
- Does not move inbox messages — message lifecycle (unread to read) is handled by the processing skill

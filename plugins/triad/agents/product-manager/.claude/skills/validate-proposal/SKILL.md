---
name: validate-proposal
description: Validates that completed projects fulfill a proposal's success criteria when all projects are done. Sends proposal-complete to human or revise back to PgM. Use when you receive a project-validated message and need to check if the proposal is fully delivered.
---

# Validate Proposal

Checks whether completed project work fulfills the parent proposal's success criteria. When all projects for a proposal are validated, performs the final quality gate before reporting completion to the human.

## Usage

`/validate-proposal` — processes the next project-validated message from your inbox.
`/validate-proposal docs/inbox/product-manager/unread/260323170000-PRJ003-project-validated.md` — validates a specific message.

## Workflow

### 1. Read the project-validated message

Read the message file from `docs/inbox/product-manager/unread/`. Extract:
- The `proposal` ID (e.g., `PMD-003`)
- The `project` ID (e.g., `PRJ-003`)
- The `references` list (paths to the completed project file)

### 2. Identify the parent proposal

Load `docs/proposals/<PMD-id>-<slug>/proposal.md`. Read the full proposal, focusing on `success_criteria`.

### 3. Check if ALL projects for this proposal are validated

Scan `docs/projects/<PMD-id>-<slug>/` for all project files. Check the status of each:
- Look at project file frontmatter for status fields
- Check `docs/inbox/product-manager/read/` for prior `project-validated` messages for this proposal

### 4. If NOT all projects are validated yet

- Move this message from `docs/inbox/product-manager/unread/` to `docs/inbox/product-manager/read/`
- Note which projects are still outstanding
- No further action — wait for the remaining project-validated messages

```bash
mv docs/inbox/product-manager/unread/<message> docs/inbox/product-manager/read/
git add -A docs/inbox/product-manager/
git commit -m "acknowledged: project-validated for <project-id>, awaiting remaining projects"
```

### 5. If ALL projects are validated — evaluate success criteria

Walk through each success criterion from the proposal:

For each criterion:
1. Identify which project(s) were responsible for delivering it
2. Read the project file's acceptance criteria and completion status
3. Determine: Is this success criterion met by the completed work?

This is the final quality gate. Do not rubber-stamp. The question is not "did the projects pass their acceptance criteria?" (the PgM already verified that). The question is: **"Does the customer actually get the value we promised?"**

### 6. All success criteria met — send proposal-complete

Create a message file using the template at `templates/message.md`.

**Filename format:** `<YYMMDDHHMMSS>-<objectid>-proposal-complete.md`
- Object IDs drop hyphens: `PMD-003` becomes `PMD003`
- Example: `260323180000-PMD003-proposal-complete.md`

Fill in frontmatter:
- `type`: `proposal-complete`
- `from`: `product-manager`
- `to`: `human`
- `disposition`: `resolved`
- `references`: paths to the proposal and all project files
- `proposal`: the PMD ID
- `round`: (leave empty — this is a terminal message)
- `timestamp`: current ISO 8601 timestamp
- `urgency`: `normal`
- `reason`: "All projects validated, proposal success criteria met"

Write Summary and Detail sections:
- **Summary**: The proposal is complete. State what customer value has been delivered.
- **Detail**: Walk through each success criterion and explain how it was satisfied by the completed work. Include any noteworthy decisions or deviations that occurred during execution.

Place the file in: `docs/inbox/human/unread/`

Update the proposal file:
- Set `status` to `completed`
- Set `updated` to today's date

### 7. Success criteria NOT met — send revise to PgM

If any success criterion is not met by the completed work, send a revise message back to the Program Manager.

**Filename format:** `<YYMMDDHHMMSS>-<objectid>-feedback.md`

Fill in frontmatter:
- `type`: `feedback`
- `from`: `product-manager`
- `to`: `program-manager`
- `disposition`: `revise`
- `references`: paths to the proposal and the projects that fell short
- `proposal`: the PMD ID
- `timestamp`: current ISO 8601 timestamp
- `urgency`: `high`
- `reason`: "Proposal success criteria not fully met"

Write Summary and Detail sections:
- **Summary**: Which success criteria are not met and why.
- **Detail**: For each unmet criterion, explain what is missing from a customer perspective. This is not a negotiation round — it is a quality gate. Be specific about what the customer experience is missing.

Place the file in: `docs/inbox/program-manager/unread/`

### 8. Move messages and commit

Move all processed messages from `unread/` to `read/`.

```bash
mv docs/inbox/product-manager/unread/<message> docs/inbox/product-manager/read/
git add docs/inbox/
git add docs/proposals/<PMD-id>-<slug>/proposal.md
git commit -m "validate: <PMD-id> <completed|revise>"
```

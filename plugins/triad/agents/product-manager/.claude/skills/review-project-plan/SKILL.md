---
name: review-project-plan
description: Reviews a project plan from the Program Manager against the original proposal's success criteria and customer need. Sends approved or revise feedback. Use when you receive a project-plan or project-plan-revised message.
---

# Review Project Plan

Reviews project plans sent by the Program Manager and provides feedback based on customer value alignment with the original proposal.

## Usage

`/review-project-plan` — processes the next project-plan message from your inbox.
`/review-project-plan docs/inbox/product-manager/unread/260323150000-PMD003-project-plan.md` — reviews a specific message.

## Workflow

### 1. Read the inbox message

Read the message file from `docs/inbox/product-manager/unread/`. Extract:
- The `proposal` ID (e.g., `PMD-003`)
- The `references` list (paths to project files)
- The `round` number
- The `type` (either `project-plan` or `project-plan-revised`)

### 2. Read the original proposal

Load `docs/proposals/<PMD-id>-<slug>/proposal.md`. Refresh on:
- `customer_need` — What problem are we solving?
- `success_criteria` — What measurable outcomes define success?
- `personas` — Who are we building for?
- The Suggested Projects section — What did you originally envision?

### 3. Read all referenced project files

Read every file listed in the message's `references` field. These live in `docs/projects/<PMD-id>-<slug>/`. For each project, understand:
- Scope and approach
- Acceptance criteria
- Sequencing and dependencies
- How it maps to the proposal's success criteria

### 4. Evaluate: Coverage

Do the projects, taken together, fully cover the proposal's success criteria? Walk through each success criterion and identify which project(s) address it. Flag any criterion that is not covered or only partially covered.

### 5. Evaluate: Sequencing

Is the sequencing optimal from a customer value perspective? The first project to ship should deliver something a customer would notice and value. Ask: "If we shipped only Project 1, would a customer get value?" If the answer is no, the sequencing may need adjustment.

### 6. Evaluate: Deviations

Did the PgM restructure your suggested project decomposition? If so, does the restructuring make sense from a customer perspective? The PgM has authority to restructure — your job is to verify the customer value is preserved, not to insist on your original breakdown.

### 7. Challenge check (required before approving)

Before deciding on `approved`, identify at least one assumption, risk, or tradeoff you are uncertain about and state it explicitly in the Detail section of your feedback. This can be a note — it does not need to trigger a `revise` cycle. The goal is to demonstrate you are actively evaluating, not rubber-stamping.

Examples of good challenge notes:
- "I'm approving, but I'm uncertain whether the 5-minute content freshness target is achievable — worth validating early."
- "The sequencing is sound, but if the scraper team's tag quality is low, PRJ-003's topic pages will be weak. We should have a fallback."
- "No concerns on the decomposition itself, but I notice there's no project-level criterion for mobile usability."

If you cannot identify even one uncertainty, that itself is a red flag — you may not be reading critically enough.

### 8. Decide disposition

- **approved**: The projects achieve the proposal's success criteria, the sequencing delivers customer value incrementally, and any deviations are well-reasoned.
- **revise**: Something needs to change. Be specific about what and why, framed in terms of customer value.

Good feedback: "Project 2 should ship before Project 1 because customers need onboarding before they can use the dashboard — without onboarding, the dashboard has no users."

Bad feedback: "I don't like the sequencing."

### 8. Check round count

If this is round 2 (your second `revise`) and you still cannot agree, **escalate to the human** instead of sending a third revise. Send an escalation message to `docs/inbox/human/unread/` with full context from both sides. Do not enter a third negotiation cycle.

### 9. Create and send feedback message

Create a message file using the template at `templates/message.md`.

**Filename format:** `<YYMMDDHHMMSS>-<objectid>-feedback.md`
- Object IDs drop hyphens: `PMD-003` becomes `PMD003`
- Example: `260323160000-PMD003-feedback.md`

Fill in frontmatter:
- `type`: `feedback`
- `from`: `product-manager`
- `to`: `program-manager`
- `disposition`: `approved` or `revise`
- `references`: paths to the project files you reviewed
- `proposal`: the PMD ID
- `round`: increment from the incoming message's round
- `timestamp`: current ISO 8601 timestamp
- `urgency`: `normal`
- `reason`: "Project plan approved" or "Project plan needs revision — [brief reason]"

Write Summary and Detail sections:
- **Summary**: Your disposition and the key reason.
- **Detail**: If approved, state which success criteria each project addresses. If revise, provide specific feedback about what needs to change and why (customer value rationale).

Place the file in: `docs/inbox/program-manager/unread/`

### 10. Update proposal status (if approved)

If disposition is `approved`, update the proposal file's `status` field to `approved` and set `updated` to today's date.

### 11. Move the original message

Move the incoming message from `docs/inbox/product-manager/unread/` to `docs/inbox/product-manager/read/`.

### 12. Commit

```bash
git add docs/inbox/program-manager/unread/<message-filename>
git add docs/inbox/product-manager/read/<original-message-filename>
# If approved, also add the updated proposal
git add docs/proposals/<PMD-id>-<slug>/proposal.md
git commit -m "feedback: <disposition> project plan for <PMD-id>"
```

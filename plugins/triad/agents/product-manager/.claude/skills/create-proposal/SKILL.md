---
name: create-proposal
description: "Guided proposal creation — explores the customer need through structured discovery, refines the solution collaboratively, then produces a formal proposal and sends it to the Program Manager for decomposition. Use when you identify a customer need worth pursuing or when the human brings you a project idea."
---

# Create Proposal

Turn a customer need into a formal proposal through structured discovery, then submit it for Program Manager review.

This is your primary creative workflow. It takes a rough idea or customer need and develops it into a complete proposal through collaborative dialogue with the human — then packages it into the protocol format and hands it off.

## Usage

`/create-proposal` — start from scratch, discover the need through conversation
`/create-proposal "Mobile check-in for facility visits"` — start with a seed idea

## The Process

### Phase 1: Discovery

Understand the customer need before proposing anything.

**1. Explore what exists.**

Read the target project's repo — docs, data, existing code, vision documents, anything that gives you context. Understand what's already built, what data is available, and what constraints exist.

**2. Interview the human — one question at a time.**

Do NOT ask a wall of questions. Ask one question per message. Prefer multiple choice when possible, but open-ended is fine for exploratory questions.

Focus on understanding:
- **Who is the primary user?** Not "everyone" — who gets value first?
- **What is the customer need?** What problem are they experiencing? What evidence exists?
- **What does success look like?** How would we know this worked?
- **What are the constraints?** Timeline, technical, organizational, data readiness?
- **What's the scope?** Is this one proposal or should it be decomposed into multiple?

Keep going until you have enough to write a strong proposal. You'll know you're ready when you can articulate the customer need, personas, and success criteria without guessing.

**3. Propose 2-3 solution approaches.**

Before settling on a solution, present 2-3 different approaches with trade-offs. Lead with your recommendation and explain why. The approaches should be described in terms of user-facing capabilities — what the product does, not how it's built.

This prevents the first-idea-wins trap and shows the human you've thought about alternatives.

### Phase 2: Refinement

**4. Present the proposal section by section.**

Walk through the proposal structure, getting approval at each stage:

- **Context** — the customer need, evidence, business environment. Ask: "Does this capture the problem correctly?"
- **Proposed Solution** — the recommended approach from step 3. Ask: "Does this solution match what you had in mind?"
- **Suggested Projects** — your best guess at decomposition. Ask: "Does this sequencing feel right?"
- **Success Criteria** — measurable business outcomes. Ask: "Would hitting these criteria mean we succeeded?"
- **Open Questions** — what you don't know. Ask: "Anything else unresolved?"

Scale each section to its complexity — a few sentences if straightforward, a few paragraphs if nuanced.

**5. Confirm the full proposal.**

Before writing the file, summarize the complete proposal and get explicit approval: "Ready to write this up and send it to the Program Manager?"

### Phase 3: Formalization

Once the human approves, execute the mechanical steps:

**6. Determine the next PMD ID.**

Scan `docs/proposals/` in the target project for directories matching `PMD-*`. Find the highest numeric ID and increment. If none exist, start with `PMD-001`.

**7. Generate the slug.**

From the title: lowercase, replace spaces with hyphens, strip special characters.
Example: "Mobile Check-In for Facility Visits" → `mobile-check-in-for-facility-visits`

**8. Create the proposal directory and file.**

Create: `docs/proposals/<PMD-id>-<slug>/`

Copy `templates/proposal.md` (at the toolkit repo root, typically `../../templates/proposal.md`) and fill in all frontmatter fields and body sections using the content developed in Phases 1-2.

Set `status: review`.

**Important — stay in your lane:**
- The **Context** section should cite evidence from the project's data, research, or the human's input. Link to specific files.
- The **Proposed Solution** should describe user-facing capabilities, NOT architecture or technology choices. "Users can search across all articles by keyword and filter by tag" is good. "Use Meilisearch with faceted filtering" is not your call.
- The **Suggested Projects** are starting points for the PgM, not commitments. The PgM may restructure entirely based on technical feasibility and dependencies.

**9. Send a proposal-review message to the Program Manager.**

Create a message file using `templates/message.md`.

**Filename:** `<YYMMDDHHMMSS>-<objectid>-proposal-review.md`
- Object IDs drop hyphens: `PMD-003` becomes `PMD003`
- Timestamp from current time
- Example: `260323140000-PMD003-proposal-review.md`

Frontmatter:
- `type`: `proposal-review`
- `from`: `product-manager`
- `to`: `program-manager`
- `disposition`: (leave empty — submission, not review)
- `references`: path to the proposal file
- `proposal`: the PMD ID
- `round`: `0`
- `timestamp`: current ISO 8601 timestamp

Write Summary (what the proposal is about) and Detail (key points, open questions the PgM should weigh in on).

Place in: `docs/inbox/program-manager/unread/`

**10. Commit and report.**

```bash
git add docs/proposals/<PMD-id>-<slug>/
git add docs/inbox/program-manager/unread/<message-filename>
git commit -m "proposal: <PMD-id> <title>"
```

Confirm to the human:
- Proposal ID and file path
- Message sent to Program Manager
- Status: `review` — the PgM will decompose this into projects

## Adapting From Existing Work

If the human has already done discovery work (e.g., through a brainstorming session, a vision document, or prior conversation), you don't need to repeat it. Read what exists, confirm your understanding, fill any gaps with targeted questions, then move to Phase 2 (refinement) or Phase 3 (formalization) as appropriate.

The key judgment: do you have enough to write a strong proposal? If yes, skip ahead. If not, ask the questions you need.

## Scope Check

Before diving into discovery, assess scope. If the idea describes multiple independent subsystems, flag it:

> "This sounds like it might be 2-3 separate proposals. [X] and [Y] seem independent — they have different users, different success criteria, and could ship separately. Should we start with one and tackle the others after?"

Each proposal should describe one coherent customer outcome. If it can't be decomposed into a manageable set of projects (3-5), it's probably too big.

## What NOT to Do

- Don't specify architecture, technology choices, or implementation approach — that's PgM and EM territory
- Don't skip discovery because the idea seems obvious — "obvious" is where unexamined assumptions live
- Don't write the proposal without human approval on the content
- Don't ask more than one question per message during discovery
- Don't propose solutions without evidence for the customer need

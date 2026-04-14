---
name: create-project-plan
description: Decomposes a PM proposal into sequenced, dependency-ordered project files. Triggered when a proposal-review message arrives from the product manager. Creates project files in docs/projects/, sends a project-plan message back to PM, and moves the original message to read/.
---

# Create Project Plan

Decomposes a product manager proposal into executable project files with sequencing, dependencies, and acceptance criteria.

## Usage

`/create-project-plan` — triggered by a `proposal-review` message in the inbox.

## Workflow

### 1. Read the inbox message

Read the `proposal-review` message file to extract:
- The proposal ID (PMD-NNN)
- The reference path to the proposal document
- Any specific questions or constraints the PM flagged

### 2. Read the proposal document thoroughly

Read the full proposal. Understand:
- Customer need and problem statement
- Success criteria (these become the basis for project acceptance criteria)
- PM's suggested project decomposition (if any)
- Open questions that may affect project design

Do not skim. The quality of the project plan depends on understanding the proposal deeply enough to bridge business intent to engineering outcomes.

### 3. Evaluate feasibility

Consult project context files (`context/<project>.md`) and architecture references to assess:
- Is the proposed approach technically viable?
- Are there architectural constraints the PM may not know about?
- Are there existing capabilities that overlap with the proposal?
- What are the major technical risks?

Note concerns — these go into the Dependencies & Risks section of each project file.

### 4. Decompose into projects

Break the proposal into sized, sequenced, dependency-ordered projects. You may modify the PM's suggested decomposition if your architecture knowledge reveals a better ordering or grouping. For each project:

a. **Determine next PRJ-NNN ID.** Scan `docs/projects/` for the highest existing ID within this proposal's directory. Increment by 1.

b. **Copy `templates/project.md`** as the base structure.

c. **Fill in frontmatter:**
   - `id`: PRJ-NNN (next available)
   - `title`: Short, descriptive title
   - `status`: draft
   - `proposal`: The PMD-NNN ID
   - `author`: program-manager
   - `sequence`: Execution order among sibling projects (1, 2, 3...)
   - `depends_on`: List of PRJ IDs that must complete first
   - `blocks`: List of PRJ IDs waiting on this one
   - `created`: Today's date
   - `updated`: Today's date
   - `acceptance_criteria`: Concrete, verifiable conditions bridged from the proposal's success criteria
   - `estimated_complexity`: low | medium | high

d. **Write body sections:**
   - **Scope:** What is included and what is explicitly excluded
   - **Approach:** How the work will be carried out, key technical decisions, phasing
   - **Rationale:** Why this approach was chosen. If deviating from PM's suggested decomposition, explain why here — the PM suggested those projects for a reason, so respect that by explaining your reasoning
   - **Dependencies & Risks:** External dependencies, known risks with likelihood/impact/mitigation

### 5. Create project files

Write project files to `docs/projects/<PMD-id>-<slug>/` where `<slug>` is a lowercase-hyphenated short name derived from the proposal title.

Example: `docs/projects/PMD-003-pet-scheduling/PRJ-007-calendar-integration.md`

### 6. Send project-plan message to PM

Use `/send-message` or construct the message directly:
- Place in `docs/inbox/product-manager/unread/`
- Frontmatter:
  - `type`: project-plan (use as the step in the filename)
  - `from`: program-manager
  - `to`: product-manager
  - `disposition`: pending
  - `references`: Paths to all project files created
  - `proposal`: The PMD-NNN ID
  - `round`: 1
  - `urgency`: normal
  - `reason`: Project plan ready for review

- **Summary:** One paragraph covering the decomposition — how many projects, key sequencing decisions, any deviations from the PM's suggested breakdown.
- **Detail:** Per-project overview with sequence, dependencies, estimated complexity, and any concerns or open questions for the PM.

### 7. Move original message to read/

Move the `proposal-review` message from `docs/inbox/program-manager/unread/` to `docs/inbox/program-manager/read/`.

### 8. Commit

Stage and commit the project files and the outgoing message:
```
git add docs/projects/<PMD-id>-<slug>/ docs/inbox/
git commit -m "project-plan: decompose <PMD-id> into <N> projects"
```

## Sizing guidance

Each project should be:
- **Small enough** to validate independently against concrete acceptance criteria
- **Large enough** to deliver a coherent capability (not a single task)
- **Ordered** to deliver customer value as early as possible — front-load learning, defer risk

## Acceptance criteria bridging

Proposal success criteria are business-level outcomes. Project acceptance criteria must be specific enough for the EM to design tasks against, but still outcome-oriented — not implementation tests. Bridge them:

- Proposal: "Users can schedule recurring appointments"
- Project: "Scheduling API supports create/read/update/delete of recurring appointment patterns with configurable frequency (daily, weekly, monthly)"

## What this skill does NOT do

- Does not create task files — that is the EM's responsibility after the project is approved
- Does not modify the proposal document — that belongs to the PM
- Does not approve projects — the PM reviews the project plan and provides feedback or approval

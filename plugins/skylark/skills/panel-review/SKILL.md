---
name: panel-review
description: >-
  Generate multiple domain-specific expert reviewers with different
  specializations and dispatch them in parallel to review a document from
  multiple angles. Use when the user says "panel review", "panel-review",
  "multiple opinions", "review from multiple angles", "what do different
  experts think", or wants broader coverage than a single expert review.
  Building block composed by spec-review, plan-review, and develop stages.
---

# Panel Review

Generates 2-5 bespoke domain experts with distinct specializations and
dispatches them in parallel. Each expert gets vocabulary routing tuned to
their angle. Findings are synthesized into a consolidated recommendation
that highlights consensus, unique catches, and disagreements.

This is a **building block** — it does one thing (multi-expert review) and
is composed by other skills. It does NOT modify documents or iterate.
Callers handle iteration.

## Checklist

Follow these steps in order. Do not skip steps.

### 1. Identify the review target

Determine what the user wants reviewed. Read the target fully.

### 2. Identify expert perspectives

Analyze the document and determine 2-5 distinct expert perspectives.
Default to 3 experts. Only use 4-5 for documents that genuinely span
multiple domains.

Each perspective must:
- Cover a genuinely different aspect of the document
- Have enough domain specificity to generate distinct vocabulary clusters
- Catch things the other perspectives would miss

Examples by document type:

**System design spec:**
- Systems architect — structure, scalability, component boundaries
- Domain specialist — correctness of domain-specific logic
- DevEx / CLI engineer — ergonomics, composability, error handling

**Implementation plan:**
- Lead engineer — build order, dependency analysis, parallelism opportunities
- QA engineer — test coverage, edge cases, verification strategy
- Security engineer — threat surface, input validation, secrets handling

**Database schema:**
- Database engineer — normalization, indexing, query patterns
- Backend architect — data access patterns, migration safety
- Security reviewer — access control, PII handling, audit requirements

**Frontend feature:**
- Frontend architect — component boundaries, rendering, state management
- Accessibility reviewer — WCAG conformance, keyboard nav, screen readers
- UX engineer — user flow, error states, edge case UI

The caller may specify panel size and model. If not specified, default to
3 experts on Opus (reviews are leverage points — Opus catches operational
gaps that save costly rework downstream).

Log the panel composition (role + why included) in the synthesis output
so the user can see who reviewed. Do NOT ask for confirmation before
dispatching — proceed directly to prompt generation. If the user wants
to adjust the panel, they can request changes after seeing the report.

### 3. Generate expert prompts

For EACH expert, read the shared methodology files:
- `_shared/expert-prompt-generator.md`
- `_shared/vocabulary-guide.md`
- `_shared/prompt-template.md`

Follow the expert-prompt-generator steps for each expert:
- Distinct identity matching their perspective
- Vocabulary clusters tuned to their specialization
- Anti-patterns specific to their review angle
- The same structured output format (Strengths / Issues / Missing / Verdict)

Each expert's vocabulary MUST have at least one cluster unique to their
perspective. Shared domain terms across experts are fine, but identical
vocabulary sets defeat the purpose of multiple perspectives.

Add this directive to each expert's prompt:
"You are one member of a review panel. Focus on your area of expertise.
Other panelists are covering other angles — go deep on yours rather than
trying to cover everything. You must identify at least one substantive
issue or explicitly justify clearance with specific evidence. An empty
Issues section is not acceptable unless accompanied by a detailed
justification in the Verdict.

Resources available to you: explore `docs/` for additional context —
`docs/strategy/` has design principles and user stories, `docs/architecture/`
has architectural decision records. If you need a deeper expert opinion on
a specific concern, you can invoke `/skylark:solo-review`."

### 4. Dispatch all experts in parallel

Call the Agent tool once per expert, **ALL IN THE SAME MESSAGE.** This is
critical — Claude Code runs parallel Agent calls concurrently. Sequential
dispatch defeats the purpose of a panel.

Each agent call gets:
- `description`: `"Panel review ([expert role]): [short topic]"`
- `model`: as specified by caller, or `"opus"` by default
- `prompt`: That expert's full generated prompt, followed by:
  `"Review the following document at this path: [absolute file path]"`
  Do NOT inline the document content. Pass the file path and instruct
  each agent to read it. This enables prompt caching (all agents read
  the same file) and reduces token waste.

### 5. Synthesize findings

When all experts return, produce a structured synthesis:

**Panel Composition** — one line per expert: role, key vocabulary angle, why included

**Consensus** — issues flagged independently by 2+ experts (highest confidence findings, list each with the experts who flagged it)

**Unique Findings** — important issues flagged by only one expert (domain-specific catches that justify having multiple perspectives)

**Disagreements** — where experts contradicted each other (present both sides with reasoning, do NOT resolve artificially — surface for the user)

**Blocking Issues** — all severity:blocking issues across all experts, consolidated and deduped

**Consolidated Verdict** — Ship | Revise | Rethink
- If any expert says "Rethink," that must be surfaced even if others say "Ship"
- If all say "Ship" (possibly with nits), the consolidated verdict is "Ship"
- Otherwise "Revise"

### 6. Save report and offer next steps

Save the synthesis report to `docs/reports/` following `_shared/artifact-conventions.md`.

Append a changelog entry to the reviewed artifact:
```
- **YYYY-MM-DD HH:MM** — [PANEL-REVIEW] Round N: [verdict]. Panel: [expert roles]. Blocking: [count]. Report: docs/reports/R-YYYYMMDD-synthesis.md.
```

Based on the verdict:

**If "ship":** Note any minor issues worth addressing. Offer to proceed
with the next pipeline stage if applicable.

**If "revise":** Summarize what needs to change. Offer to run a second
round after revisions are made.

**If "rethink":** Surface the fundamental concerns. Do not offer to
iterate — the document needs significant rework before another review
would be productive.

## Multi-Round Panels

If running a second round (requested by caller or user):
- Use the same expert perspectives (unless changes requested)
- Each expert receives: original document, their own round-1 report,
  and the revised document
- Their prompt adds: "This is round 2. Compare the revision against your
  round-1 findings. Verify that blocking issues were addressed. Identify
  any new issues introduced by the changes."
- Synthesis notes which round-1 issues were resolved vs. persist

**Adaptive narrowing (when caller requests it):**
For round 2, the caller may specify a subset of experts — typically the
2-3 who had the strongest findings in round 1. Generate fresh prompts
for only those experts.

Maximum 2 rounds. If blocking issues persist after round 2, escalate to
the user rather than continuing to loop.

## What This Skill Does NOT Do

- Pick from pre-built expert profiles — always generates bespoke experts
- Dispatch experts sequentially — parallelism is the point
- Modify the reviewed document — review only
- Iterate automatically (run round 2 without being asked) — callers handle iteration
- Resolve disagreements between experts — surfaces them for the user

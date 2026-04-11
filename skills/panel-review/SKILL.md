---
name: panel-review
description: >-
  Generate multiple domain-specific expert reviewers with different
  specializations and dispatch them in parallel to review a document from
  multiple angles. Use when the user says "panel review", "panel-review",
  "multiple opinions", "review from multiple angles", "what do different
  experts think", or wants broader coverage than a single expert review.
---

# Review Panel

Generates 2-5 bespoke domain experts with distinct specializations and
dispatches them in parallel. Each expert gets vocabulary routing tuned to
their angle. Findings are synthesized into a consolidated recommendation
that highlights consensus, unique catches, and disagreements.

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
- Domain specialist — correctness of domain-specific logic (IR, crypto, ML, etc.)
- DevEx / CLI engineer — ergonomics, composability, error handling

**Implementation plan:**
- Lead engineer — build order, dependency analysis, parallelism opportunities
- QA engineer — test coverage, edge cases, verification strategy
- Security engineer — threat surface, input validation, secrets handling

**Product proposal:**
- Product strategist — market fit, user value, competitive positioning
- Engineering lead — feasibility, effort, technical risk
- UX researcher — user needs, workflow gaps, adoption barriers

Present the proposed panel composition to the user and get confirmation
before dispatching. If the user suggests changes, adjust.

### 3. Generate expert prompts

For EACH expert, read the shared methodology files:
- `${CLAUDE_PLUGIN_ROOT}/skills/_shared/expert-prompt-generator.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/_shared/vocabulary-guide.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/_shared/prompt-template.md`

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
issue or explicitly justify clearance with specific evidence."

### 4. Dispatch all experts in parallel

Call the Agent tool once per expert, ALL IN THE SAME MESSAGE. This is
critical — Claude Code runs parallel Agent calls concurrently. Sequential
dispatch defeats the purpose of a panel.

Each agent call gets:
- `description`: "Panel review ([expert role]): [short topic]"
- `model`: "opus" (reviews are leverage points — Opus catches operational gaps that save costly rework downstream)
- `prompt`: That expert's full generated prompt, followed by:
  "Review the following document at this path: [absolute file path]"
  Do NOT inline the document content. Pass the file path and instruct
  each agent to read it. This enables prompt caching (all agents read
  the same file) and reduces token waste.

### 5. Synthesize findings

When all experts return, produce a structured synthesis:

**Panel Composition**
[One line per expert: role, key vocabulary angle, why included]

**Consensus**
[Issues flagged independently by 2+ experts — highest confidence findings.
List each with the experts who flagged it.]

**Unique Findings**
[Important issues flagged by only one expert — domain-specific catches
that justify having multiple perspectives.]

**Disagreements**
[Where experts contradicted each other. Present both sides with reasoning.
Do NOT resolve disagreements artificially — surface them for the user.]

**Blocking Issues**
[All severity:blocking issues across all experts, consolidated and deduped]

**Consolidated Verdict**
[Ship / revise / rethink — based on blocking issue count and severity.
If any expert says "rethink," that must be surfaced even if others say "ship."]

### 6. Offer next steps

Based on the verdict:

**If "ship":** Note any minor issues worth addressing. Offer to proceed
with implementation if applicable.

**If "revise":** Summarize what needs to change. Offer to run a second
round after revisions are made. Second-round experts receive the original
document, first-round findings, and the revisions.

**If "rethink":** Surface the fundamental concerns. Do not offer to
iterate — the document needs significant rework before another review
would be productive.

## Multi-round panels

If running a second round:
- Use the same expert perspectives (unless the user requests changes)
- Each expert receives: original document, their own round-1 report,
  and the revised document
- Their prompt adds: "This is round 2. Compare the revision against your
  round-1 findings. Verify that blocking issues were addressed. Identify
  any new issues introduced by the changes."
- Synthesis notes which round-1 issues were resolved vs. persist

Maximum 2 rounds. If blocking issues persist after round 2, escalate to
the user rather than continuing to loop.

## What this skill does NOT do

- Does not pick from pre-built expert profiles — generates bespoke experts
- Does not dispatch experts sequentially — parallelism is the point
- Does not modify the reviewed document — review only
- Does not resolve disagreements between experts — surfaces them for the user

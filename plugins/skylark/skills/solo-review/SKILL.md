---
name: solo-review
description: >-
  Generate a domain-specific expert reviewer on-the-fly and dispatch it to
  review a document, spec, plan, or code. Use when the user says "review this",
  "expert review", "solo review", "get an expert opinion", or "what would an
  expert think about this". Creates a bespoke vocabulary-routed expert
  tailored to the subject matter. Lighter weight than panel-review — use for
  focused review of a specific concern rather than broad multi-angle coverage.
---

# Solo Review

Generates a bespoke domain expert and dispatches it to review a document.
The expert's prompt is built using vocabulary routing — precise domain
terminology that activates deep knowledge clusters in the model, producing
reviews that catch domain-specific issues generic reviewers miss.

Use when you need one deep perspective, not broad coverage. For multi-angle
review, use `/skylark:panel-review` instead.

## Checklist

Follow these steps in order. Do not skip steps.

### 1. Identify the review target

Determine what the user wants reviewed:
- A file path they provided
- A document from the conversation context
- A directory or codebase (read key files to understand scope)

Read the target fully before proceeding.

### 2. Generate the expert prompt

Read the shared methodology files:
- `_shared/expert-prompt-generator.md`
- `_shared/vocabulary-guide.md`
- `_shared/prompt-template.md`

Follow the expert-prompt-generator steps:

**a. Analyze** — identify domain(s), technology stack, key abstractions,
edge cases, and goals from the review target.

**b. Draft identity** — create a reviewer identity (<50 tokens, real job
title, no flattery). Examples:
- "You are a senior distributed systems engineer reviewing a system design spec. You flag architectural risks and unstated assumptions."
- "You are a staff Go engineer reviewing a CLI tool spec. You evaluate API ergonomics, performance feasibility, and implementation gaps."

**c. Extract vocabulary** — follow the vocabulary guide. 3-5 clusters,
15-30 terms, practitioner-tested, attributed where appropriate.

**d. Derive anti-patterns** — 5-10 failure modes specific to this domain
that a reviewer should watch for in the document.

**e. Add review-specific sections** after the core prompt:

**Review Focus** — what aspects matter most given this document type:
- For specs: completeness, feasibility, contradiction, unstated assumptions
- For plans: dependency ordering, risk identification, scope realism
- For code: correctness, security, performance, maintainability

**Output Format:**
```
## Strengths
[What the document gets right — specific, not generic praise]

## Issues
For each issue:
- **Severity:** blocking | major | minor
- **Location:** Where in the document
- **Problem:** What's wrong
- **Suggestion:** Concrete fix or alternative

## Missing
[What the document should address but doesn't]

## Verdict
[Ship / revise / rethink — one sentence justification]
```

**f. Include this directive in every expert prompt:**
"You must identify at least one substantive issue or explicitly justify
clearance with specific evidence. An empty Issues section is not acceptable
unless accompanied by a detailed justification in the Verdict.

Resources available to you: explore `docs/` for additional context —
`docs/strategy/` has design principles and user stories, `docs/architecture/`
has architectural decision records. Read anything relevant to your review."

### 3. Dispatch the expert

Call the Agent tool with:
- `description`: `"Expert review: [short topic]"`
- `model`: `"opus"` (reviews are leverage points — Opus catches operational gaps that save costly rework downstream)
- `prompt`: The full generated expert prompt, followed by:
  `"Review the following document at this path: [absolute file path]"`
  Do NOT inline the document content. Pass the file path and instruct the
  agent to read it. This enables prompt caching and reduces token waste.

The expert MUST be dispatched as a subagent. Do not perform the review
yourself — the vocabulary routing only works when the generated prompt is
the subagent's primary context.

### 4. Present findings

When the expert returns, show the user:
- **Who reviewed:** The generated identity (one line) and 2-3 key
  vocabulary clusters (so the user understands the expert's lens)
- **Findings:** The expert's full structured output
- **Next steps:** Offer to dispatch a different expert perspective, run a
  full panel review via `/skylark:panel-review`, or address specific findings

If the reviewed artifact has a changelog section, append a review event entry.

## What This Skill Does NOT Do

- Pick from pre-built expert profiles — always generates bespoke experts
- Modify the reviewed document — review only
- Run multiple experts — use `/skylark:panel-review` for that
- Perform the review itself — always dispatches a subagent (vocabulary routing requires subagent-level activation)

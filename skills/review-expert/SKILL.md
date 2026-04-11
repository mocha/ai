---
name: review-expert
description: >-
  Generate a domain-specific expert reviewer on-the-fly and dispatch it to
  review a document, spec, plan, or code. Use when the user says "review this",
  "expert review", "review-expert", "get an expert opinion", or "what would an
  expert think about this". Unlike /consult which picks from pre-built expert
  profiles, this skill creates a bespoke vocabulary-routed expert tailored to
  the subject matter.
---

# Review Expert

Generates a bespoke domain expert and dispatches it to review a document.
The expert's prompt is built using vocabulary routing — precise domain
terminology that activates deep knowledge clusters in the model, producing
reviews that catch domain-specific issues generic reviewers miss.

## Checklist

Follow these steps in order. Do not skip steps.

### 1. Identify the review target

Determine what the user wants reviewed:
- A file path they provided
- A document from the conversation context
- A directory or codebase (read key files to understand scope)

Read the target fully before proceeding.

### 2. Generate the expert prompt

Find and read the shared methodology file `_shared_expert/expert-prompt-generator.md`
located in the same parent directory as this skill (i.e., `../_shared_expert/`
relative to this SKILL.md). Also read `vocabulary-guide.md` and
`prompt-template.md` from that same `_shared_expert/` directory.

Follow the expert-prompt-generator steps:

**a. Analyze** — identify domain(s), technology stack, key abstractions,
edge cases, and goals from the review target.

**b. Draft identity** — create a reviewer identity. Examples:
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
unless accompanied by a detailed justification in the Verdict."

### 3. Dispatch the expert

Call the Agent tool with:
- `description`: "Expert review: [short topic]"
- `model`: "opus" (reviews are leverage points — Opus catches operational gaps that save costly rework downstream)
- `prompt`: The full generated expert prompt, followed by:
  "Review the following document at this path: [absolute file path]"
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
  full panel review via `/review-panel`, or address specific findings

## What this skill does NOT do

- Does not pick from pre-built expert profiles — generates bespoke experts
- Does not modify the reviewed document — review only
- Does not run multiple experts — use `/review-panel` for that
- Does not perform the review itself — always dispatches a subagent

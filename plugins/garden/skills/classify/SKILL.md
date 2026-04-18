---
name: classify
description: >-
  Scan the vault for uncategorized markdown files and apply categorization
  frontmatter — categorized_as, source_origin, source_trust, domains, entities,
  categorization_confidence. Routes each file to the appropriate decomposition
  pipeline. Use when the user says "classify", "categorize", "run the
  classifier", or "what needs categorizing". Also invoked as step 1 of the
  garden pipeline.
---

# Classify

This skill dispatches the classify subagent, which runs on Haiku 4.5 and
carries its own full context. The agent definition lives at
`agents/classify.md`.

## How to invoke

Use the Agent tool with `subagent_type: "classify"`. Pass a short prompt
describing the intent of this run — e.g. "Run classification on the current
backlog" or "Re-categorize files modified after last pass."

Example:

```
Agent({
  description: "Classify uncategorized vault files",
  subagent_type: "classify",
  prompt: "Scan the library/ tree for uncategorized markdown files and apply categorization frontmatter per your checklist. Report the per-type breakdown and any low-confidence flags when done."
})
```

After the agent completes, relay its summary to the user.

## Why a subagent

- Pinned model (Haiku 4.5) — classification is triage-weight work
- Isolated context — keeps the parent conversation light
- Full checklist and identity defined once in the agent file

## What this skill does NOT do

- Does not duplicate the classification checklist. The authoritative guidance
  lives in the agent definition at `agents/classify.md`.

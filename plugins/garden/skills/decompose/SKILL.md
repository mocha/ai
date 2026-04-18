---
name: decompose
description: >-
  Extract atomic claims from categorized markdown files and store them as
  JSON in shed/claims/. Routes to type-specific decomposer variants based on
  the file's categorized_as field. Supports personal-notes, internal-doc,
  article, docs-content, and structured-content variants — each calibrating
  epistemic stance, extraction priorities, and skepticism filters to the
  source type. Use when the user says "decompose", "extract claims", "run
  the decomposer", or "what needs decomposing". Also invoked as step 2 of
  the garden pipeline.
---

# Decompose

This skill dispatches the decompose subagent, which runs on Opus 4.7 and
loads variant-specific prompts on demand. The agent definition lives at
`agents/decompose.md`; variant prompts are project-specific and live in
`shed/decompose-variants/`.

## How to invoke

Use the Agent tool with `subagent_type: "decompose"`. Pass a short prompt
describing the intent of this run.

Example:

```
Agent({
  description: "Decompose categorized files into claims",
  subagent_type: "decompose",
  prompt: "Find categorized-but-undecomposed files in library/ and extract claims per your checklist. Route each file to the appropriate variant prompt. Write claims to shed/claims/ and stamp source files when done."
})
```

After the agent completes, relay its summary to the user.

## Why a subagent

- Pinned model (Opus 4.7) — heaviest semantic work in the pipeline
- Variant prompts loaded on demand rather than all held in context at once
- Isolated context — keeps the parent conversation light
- Full checklist and shared mechanics defined once in the agent file

## What this skill does NOT do

- Does not duplicate the decomposition checklist or variant guidance.
  The shared mechanics live in `agents/decompose.md`; variant-specific
  guidance lives in `shed/decompose-variants/`.

---
name: spec-review
description: >-
  Iterative spec review flow. Runs panel review on a spec, applies fixes,
  and re-reviews until the spec passes or hits max rounds (2). Use when the
  user says "review this spec", "spec review", "harden this spec", "validate
  this spec", or wants a spec approved before implementation.
---

# Spec Review

Iterative panel review loop for specs and proposals. Runs panel review,
applies fixes from findings, and re-reviews until the spec passes or
reaches the maximum of 2 rounds.

## Checklist

Follow these steps in order. Do not skip steps.

### 1. Identify the spec

Determine what the user wants reviewed:
- A file path they provided
- A document in the conversation context
- A URL to fetch

Read the spec fully before proceeding.

### 2. Round 1: Panel Review

Invoke `/expert:panel-review` on the spec.

Wait for the panel to return its verdict.

### 3. Handle Round 1 verdict

**If "ship":**
- Present the panel findings to the user
- The spec is approved. Report the approved spec path and stop.

**If "revise":**
- Present the blocking and major issues to the user
- Propose specific fixes for each issue
- Get user approval on the fixes
- Apply approved fixes to the spec
- Proceed to Round 2

**If "rethink":**
- Present the fundamental concerns to the user
- The spec needs significant rework. Do not iterate — stop and let the
  user rework the spec before re-invoking this skill.

### 4. Round 2: Re-review

Invoke `/expert:panel-review` on the revised spec.

The panel reviews the revised spec fresh — do not pass round 1 findings,
as that biases the review toward confirming fixes rather than finding
new issues.

### 5. Handle Round 2 verdict

**If "ship":**
- The spec is approved. Report the approved spec path.

**If "revise" or "rethink":**
- Present remaining issues to the user
- Maximum rounds reached. Stop and let the user decide how to proceed.
- Do not automatically iterate further.

## Output

When complete, clearly state:
- **Status:** approved | needs-revision | needs-rethink
- **Rounds completed:** 1 or 2
- **Spec path:** path to the (possibly revised) spec
- **Outstanding issues:** any unresolved findings (empty if approved)

## What this skill does NOT do

- Does not write or rewrite the spec — only reviews and applies targeted fixes
- Does not proceed to planning — use `/expert:implement` for the full pipeline
- Does not iterate beyond 2 rounds — escalates to the user instead

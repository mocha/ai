---
name: execution-expert
description: >-
  End-to-end development from a spec or proposal. Generates a domain-specific
  expert context, reviews and improves the spec, builds an implementation plan,
  validates with an expert panel, and executes in an isolated worktree. Use when
  the user says "execution-expert", "build this spec", "implement this",
  "develop from spec", "execute against this", or has a spec/proposal they want
  turned into working code.
---

# Execution Expert

Full development pipeline: analyze a spec, generate vocabulary-routed expert
context, review and improve the spec, plan implementation, validate the plan
with a panel, execute in a worktree, and open a PR.

The expert context generated in step 2 persists through the entire pipeline —
every agent dispatched receives it, ensuring vocabulary routing shapes all
downstream work.

## Checklist

Follow these steps in order. Do not skip steps.

### 1. Identify the spec

Determine which spec or proposal to execute against. This may be:
- A file path the user provided
- A document in the conversation context
- A URL to fetch and convert

Read the spec fully before proceeding.

### 2. Generate the expert prompt

Read the shared methodology files:
- `${CLAUDE_PLUGIN_ROOT}/skills/_shared/expert-prompt-generator.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/_shared/vocabulary-guide.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/_shared/prompt-template.md`

Follow the expert-prompt-generator steps:

**a. Analyze** — domain, stack, abstractions, edge cases, goals.

**b. Draft identity** — development-oriented. Examples:
- "You are a senior Go systems engineer building a CLI tool backed by SQLite. You implement per spec and escalate when the spec is ambiguous."
- "You are a staff Python engineer building a data pipeline. You ask before making architectural choices the spec doesn't address."

**c. Extract vocabulary** — 3-5 clusters, 15-30 terms.

**d. Derive anti-patterns** — 5-10 failure modes, including at least one
for testing/verification.

**e. Add development-specific sections:**

**Operational Guidance:**
- Error philosophy appropriate to the domain (fail-fast for CLI tools,
  tolerant for parsers processing user content, etc.)
- Concurrency model if the spec involves parallel work
- Edge case handling for cases the spec mentions or implies but doesn't
  fully specify

**Testing Expectations:**
- Language-idiomatic patterns (table-driven for Go, pytest for Python, etc.)
- Edge cases that need fixture coverage
- Performance verification approach if the spec defines targets

**Deliverables:**
- Concrete file/directory tree derived from the spec's architecture
- Validate: every package mentioned in anti-patterns appears in the tree
- Validate: no contradictions between anti-patterns and deliverables

Save the generated expert prompt — it will be injected into every
subsequent agent dispatch.

### 3. Follow the development flow

Read `references/flow-development.md` and follow its steps. The flow
manages the remaining pipeline stages: spec review, planning, panel
validation, execution, and PR creation.

At every step where an agent is dispatched, the generated expert prompt
from step 2 MUST be included in that agent's context. This is how
vocabulary routing persists through the pipeline.

## What this skill does NOT do

- Does not skip spec review — even good specs have gaps
- Does not skip panel review — plans must be validated before execution
  (unless the user explicitly opts out)
- Does not execute in the main working tree — always uses a worktree
- Does not push or merge without user review — creates a PR and stops

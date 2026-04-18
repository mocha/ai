---
name: graph
description: >-
  Reconcile claims from shed/claims/ against the knowledge graph — create
  new entity files from schemas, enrich existing entities with new facts,
  apply three-tier edge weighting, and write footnote citations linking
  every fact back to its source. Use when the user says "graph", "run the
  grapher", "process claims", or "reconcile claims". Also invoked as the
  final step of the garden pipeline.
---

# Graph

This skill dispatches the graph subagent, which runs on Sonnet 4.6 and
carries its own full context. The agent definition lives at
`agents/graph.md`.

## How to invoke

Use the Agent tool with `subagent_type: "graph"`. Pass a short prompt
describing the intent of this run.

Example:

```
Agent({
  description: "Reconcile claims against the knowledge graph",
  subagent_type: "graph",
  prompt: "Read unprocessed claim files under shed/claims/ and reconcile them against graph/ per your checklist. Create new entities where the second-datapoint check passes, enrich existing entities otherwise, and write footnote citations for every fact. Mark each claim as graphed when done."
})
```

After the agent completes, relay its summary to the user.

## Why a subagent

- Pinned model (Sonnet 4.6) — schema-bound reconciliation
- Isolated context — keeps the parent conversation light
- Full checklist and schema lookup defined once in the agent file

## What this skill does NOT do

- Does not duplicate the graphing checklist or entity-resolution rules.
  The authoritative guidance lives in the agent definition at
  `agents/graph.md`.

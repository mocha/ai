---
name: garden
description: >-
  Run the full knowledge graph pipeline: classify uncategorized files,
  decompose categorized files into claims, and graph claims against the
  knowledge graph. Executes each stage as a pinned-model subagent in
  sequence, respecting batch limits. Use when the user says "garden", "run
  the pipeline", "run all gardeners", or "process the backlog".
---

# Garden

Orchestrates the full knowledge graph pipeline in sequence:
**classify** → **decompose** → **graph**

Each stage is a subagent with its own pinned model (Haiku / Opus / Sonnet).
The orchestrator scans the backlog, dispatches each agent in turn, and
reports results between stages. A single garden run moves content as far
through the pipeline as it can in one pass.

## Checklist

Follow these steps in order. Do not skip steps.

### 1. Report pipeline status

Before dispatching anything, scan all three stages to show what's pending:

```bash
# Classifier backlog
vq find --in "library" --no categorized_at --exclude "shed" --exclude "docs" --exclude "skills" --exclude "graph" --exclude "testing_workspace" --format count

# Decomposer backlog (all implemented types)
vq find --in "library" --has categorized_at --no decomposed_at --no needs_review --no skip_processing --format count

# Grapher backlog
ls shed/claims/*.json 2>/dev/null | wc -l

# Review warnings pending
grep -c "^- \[ \]" needs-review.md 2>/dev/null || echo 0
```

Report the backlog at each stage. If all stages are empty, report
"Garden is clean — nothing to process" and stop.

### 2. Dispatch classify

Invoke the classify subagent via the Agent tool:

```
Agent({
  description: "Classify uncategorized vault files",
  subagent_type: "classify",
  prompt: "Run the classify checklist against the current backlog. Process up to 50 files. Report the per-type breakdown and any low-confidence flags."
})
```

Relay the agent's summary. Newly categorized files feed into the decompose
stage.

### 3. Dispatch decompose

Invoke the decompose subagent via the Agent tool:

```
Agent({
  description: "Decompose categorized files into claims",
  subagent_type: "decompose",
  prompt: "Run the decompose checklist. Process up to 20 files across all implemented variants. Write claims to shed/claims/ and stamp source files. Report the per-variant breakdown and any needs_review flags."
})
```

Relay the agent's summary. New claim files feed into the graph stage.

### 4. Dispatch graph

Invoke the graph subagent via the Agent tool:

```
Agent({
  description: "Reconcile claims against the knowledge graph",
  subagent_type: "graph",
  prompt: "Run the graph checklist. Process up to 10 claim files from shed/claims/. Report entity creates vs updates and any files touched."
})
```

Relay the agent's summary.

### 5. Pipeline summary

After all three agents have reported, summarize the full run:
- **Classified:** N files (breakdown by type)
- **Decomposed:** N files → M claims
- **Graphed:** N claims → K entities created, J entities updated
- **Remaining backlog:** counts at each stage
- **Flagged for review:** N items in needs-review.md

If there are pending review warnings, note: "Run `/garden:triage-review-warnings`
to work through flagged items."

If the backlog still has work after this run (batch limits hit), note
that another run will pick up the remainder.

## Partial Runs

The pipeline handles partial state gracefully:
- If classify finds nothing, decompose and graph still run (processing
  previously classified files)
- If decompose finds nothing, graph still runs (processing previously
  created claims)
- Each stage is independently idempotent

## What this skill does NOT do

- Does not bypass batch limits — each agent respects its own limit
- Does not run stages in parallel — they execute sequentially because
  each stage's output feeds the next
- Does not run maintenance gardeners (connector, splitter, etc.) — those
  are separate skills
- Does not auto-merge anything — all changes are reported for review
- Does not duplicate stage logic — each stage's authoritative checklist
  lives in its agent file under `agents/`

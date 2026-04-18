---
name: check-queue
description: >-
  Show the current state of the garden pipeline — how many files await
  classification, decomposition, and graphing, plus pending review items.
  Deterministic output from a script, no LLM interpretation. Use when the
  user says "check queue", "pipeline status", "what needs processing", or
  "what's pending".
---

# Check Queue

Runs `shed/scripts/check-queue.py` and relays the output verbatim. The
script produces deterministic, consistently formatted output — do not
reformat, summarize, or interpret the results.

## How to invoke

Run the script and display its output exactly as printed:

```bash
python3 shed/scripts/check-queue.py
```

For detailed breakdowns by directory and per-file claim status:

```bash
python3 shed/scripts/check-queue.py --detail
```

For machine-readable output:

```bash
python3 shed/scripts/check-queue.py --json
```

Display the script's stdout to the user **verbatim** — no rewording, no
commentary, no additional formatting. If the user asks follow-up questions
about the results, answer those normally.

## What this skill does NOT do

- Does not dispatch any pipeline agents — use `/garden:garden` for that
- Does not modify any files — purely read-only
- Does not interpret or reformat the script output — the script handles
  all formatting

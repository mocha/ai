---
# Task — owned by engineering-manager
# Copy this template and fill in all fields before changing status.

id: T-000                    # Unique task ID (T-NNN). Assign next available number.
title: ""                    # Short, descriptive title of the task
status: todo                 # todo | in-progress | blocked | done | cancelled
project: PRJ-000             # Parent project ID this task belongs to
author: engineering-manager  # Agent or person who created this task
depends_on: []               # List of task IDs that must complete before this one starts
blocks: []                   # List of task IDs that are waiting on this one
created: YYYY-MM-DD          # Date task was created
completed:                   # Date task was completed (filled in on completion)
scope:
  boundaries: []             # Explicit scope limits — what this task does and does not cover
  references: []             # Paths to files, docs, or URLs relevant to this task
acceptance_criteria: []      # Concrete, verifiable conditions that define "done"
actual_tokens:               # Token count consumed during execution (filled in on completion)
actual_duration_minutes:     # Wall-clock minutes spent (filled in on completion)
---

## Description

<!-- What needs to be done and why. Provide enough context for the executing agent
     to begin work without asking clarifying questions. -->

## Acceptance Criteria Detail

<!-- Expand on the frontmatter acceptance_criteria with examples, edge cases,
     or specific test scenarios if needed. -->

---
<!-- Completion summary written by executing agent below this line -->

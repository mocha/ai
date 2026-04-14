---
# Project — owned by program-manager
# Copy this template and fill in all fields before changing status.

id: PRJ-000                  # Unique project ID (PRJ-NNN). Assign next available number.
title: ""                    # Short, descriptive title of the project
status: draft                # draft | planned | active | blocked | done | cancelled
proposal: PMD-000            # Parent proposal ID this project implements
author: program-manager      # Agent or person who authored this project
sequence: 1                  # Execution order among sibling projects in the same proposal
depends_on: []               # List of project IDs that must complete before this one starts
blocks: []                   # List of project IDs that are waiting on this one
created: YYYY-MM-DD          # Date project was created
updated: YYYY-MM-DD          # Date of most recent edit
acceptance_criteria: []      # Concrete, verifiable conditions that define "done"
estimated_complexity: medium  # low | medium | high — rough sizing for planning
---

## Scope

<!-- What is included in this project and, equally important, what is NOT included.
     Be explicit about boundaries to prevent scope creep. -->

## Approach

<!-- How the work will be carried out. Key technical or process decisions, phasing,
     and any constraints the engineering manager should know about. -->

## Rationale

<!-- Why this approach was chosen over alternatives. Link to any decision documents
     or tradeoff analyses if they exist. -->

## End-to-End Validation Flows

<!-- User flows that must work against a running instance with real/fixture data
     before this project can be considered complete. Derived from the proposal's
     Critical User Flows, scoped to what this project delivers.

     These are verified by the EM during project completion validation: stand up
     the full stack, ingest fixture data, and walk through each flow.

     Example:
     1. Navigate to /companies → see alphabetical list → click a company → see
        fact card and linked articles
     2. Navigate to /news → see chronological feed → apply tag filter → results
        narrow correctly
-->

-

## Dependencies & Risks

<!-- External dependencies (APIs, teams, infrastructure) and known risks.
     For each risk, note likelihood, impact, and any mitigation strategy. -->

-

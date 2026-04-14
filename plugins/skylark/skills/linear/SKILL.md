---
name: linear
description: Internal conventions for Linear interaction across the pipeline. Covers searching for prior art, posting event comments, managing status transitions, and maintaining blocking relations. Referenced by all pipeline stages — not user-invocable.
---

# Linear Conventions

Standard patterns for interacting with Linear throughout the pipeline. All stages reference these conventions.

## Searching for Prior Art

Before creating any new artifact (spec, plan, issue), search Linear:

1. **Search by keywords** from the topic — use `mcp__claude_ai_Linear__list_issues` with relevant filters
2. **Search by project/team** — check the ENG team for related issues
3. **Check blocking/blocked relations** on related issues for hidden dependencies

If related work is found, surface it to the user before proceeding. Don't silently create duplicates.

## Event Comments

At every pipeline event, post a comment on the associated Linear issue using `mcp__claude_ai_Linear__save_comment`. Every comment follows this format:

```
[STAGE_NAME] Brief description of what happened

Details:
- artifact: docs/path/to/artifact.md
- verdict: ship|revise|rethink (if applicable)
- next: what the pipeline does next
```

### Standard Event Comments

| Stage | Comment |
|-------|---------|
| TRIAGE | `[TRIAGE] Classified as [risk]. Pipeline: [stages that will run].` |
| PREPARE | `[PREPARE] Enriched with [N] references, [N] vocabulary terms. Spec: [path]` |
| SPEC-REVIEW | `[SPEC-REVIEW] Round [N]: [verdict]. Blocking: [count]. Report: [path]` |
| WRITE-PLAN | `[PLAN] Plan written with [N] phases. Plan: [path]` |
| PLAN-REVIEW | `[PLAN-REVIEW] Decomposed into [N] tasks. [M] approved, [K] need revision.` |
| DEVELOP | `[DEVELOP] Task [N/total] complete. Tests: [pass/fail]. Branch: [name]` |
| FINISH | `[FINISH] Closed. PR: [link]. Notes: [path]` |

### Related Issue Comments

When completing work that affects other issues (blocked-by, related), post a brief comment on those issues:

```
[CONTEXT] ENG-XXX (which blocked this) is now complete.
Relevant for this issue: [brief note about what changed or gotchas]
```

## Status Transitions

Standard status flow for Linear issues:

```
Backlog → In Progress (when DEVELOP starts)
       → Done (when FINISH completes)
       → Blocked (if pipeline encounters blocker)
```

Only transition status at meaningful pipeline boundaries, not at every stage.

## Blocking Relations

During PREPARE, verify and update blocking relations:
- If the issue references code/features from another issue, add a blocking relation
- If the issue would be blocked by incomplete work, add a blocked-by relation
- Surface any circular dependencies to the user

## Issue-to-Spec Graduation

When an issue needs more than Linear ACs can express:
- **Standard risk:** ACs in Linear are the spec. No separate file needed.
- **Elevated+ risk:** Create a spec file in `docs/specs/` and add a Linear comment linking to it.

The Linear issue remains the source of truth for status. The spec file holds the detailed design.

---
name: write-plan
description: Use when you have an approved spec or requirements for a multi-step task, before touching code. Produces a comprehensive implementation plan with bite-sized tasks, complete code, exact file paths, and verification commands. No placeholders — every step is actionable.
---

# Writing Plans

Write implementation plans for a capable vocabulary-routed implementer. Specify **interface shape and intent**, not function bodies — the implementer writes the implementation. DRY. YAGNI. TDD. Frequent commits.

Assume a skilled developer working with a fresh expert persona scoped to the task's domain. They know the toolset, they know test design, they know the patterns in this codebase. What they need from you is the boundary of the task, the interfaces it must produce or consume, the acceptance criteria, and the edge cases.

They do **not** need pseudocode restating the obvious. Pseudocode in plans has become the primary source of reviewer nits — cut it.

**Communication Style:** Plans follow `_shared/communication-style.md`. Tasks are tight, prose-first, scoped. Show code only when it disambiguates a non-obvious contract (a specific type signature, a particular data shape, a non-obvious API call order). Default to prose.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Save plans to:** `docs/plans/PLAN-NNN-<slug>.md`

## Scope and Size Check

If the spec covers multiple independent subsystems, it should have been broken into sub-project specs during brainstorming. If it wasn't, suggest breaking this into separate plans — one per subsystem. Each plan should produce working, testable software on its own.

**Plan decomposition:** Plans have no hard token cap — they decompose by scope (8+ tasks or dense cross-dependencies → split into sub-plans). A plan is large because it contains many tasks; the right response is to decompose tasks, not to shrink the plan.

**Task size target:** Each individual task spec should target **~800-1,000 tokens** — small, focused, prose-first. The total dispatch payload (task spec + parent context + expert prompt) must fit within **40,000 tokens** (20% of Sonnet's context window) per `_shared/risk-matrix.md`.

If a task spec is trending over ~1,200 tokens, that's a signal you're writing implementation instead of specification. Cut pseudocode first, then consider splitting the task.

**Architecture docs:** If the plan makes significant architectural decisions (technology choices, data model design, integration patterns), document them as ADRs in `docs/architecture/` — same format as brainstorm produces. Plans should reference architectural decisions, not embed lengthy justifications.

## File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code you can hold in context at once, and your edits are more reliable when files are focused. Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If the codebase uses large files, don't unilaterally restructure — but if a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each task should produce self-contained changes that make sense independently.

## Task Granularity

A task is one coherent unit of work the implementer can execute end-to-end: write tests, implement, verify, commit. You do not need to decompose that loop into five steps — the implementer knows the TDD cycle.

A task is appropriately scoped when it:
- Produces one testable capability or interface
- Touches a bounded set of files (typically 1-4)
- Has acceptance criteria that can be checked independently
- Can be understood without reading other tasks first

If a task needs the implementer to follow a non-obvious sequence across files, lay out the sequence as prose bullets. Don't pre-write the code they should produce.

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
---
id: PLAN-NNN
title: [Feature Name] Implementation Plan
type: plan
status: draft
external_ref: ""
parent: docs/specs/SPEC-NNN-slug.md
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# [Feature Name] Implementation Plan

> **For agentic workers:** This plan is executed task-by-task via `/skylark:develop`, which dispatches a fresh vocabulary-routed expert per task in an isolated worktree. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
```

## Task Structure

````markdown
### Task N: [Component Name]

**Domain:** [primary domain cluster — database, api, auth, events, ui, infra]
**Dependencies:** [tasks that must complete first, or "none"]
**Scope:** [1-2 sentences — what this task builds and why]

**Files:**
- Create: `exact/path/to/file.ts`
- Modify: `exact/path/to/existing.ts` (what changes, in one line)
- Test: `tests/exact/path/to/test.ts`

**Interface Shape:**

Declare the public surface this task produces or consumes. Types, function signatures, config keys, API routes — whatever applies. No function bodies.

```typescript
export type SessionToken = { userId: string; issuedAt: number; scopes: string[] };
export function issueSession(userId: string, scopes: string[]): SessionToken;
export function revokeSession(token: SessionToken): void;
```

**Acceptance Criteria:**
- [Concrete, testable — traced from spec ACs]
- [Second AC]

**Edge cases to handle:**
- [Edge case 1 — e.g., expired tokens, empty scopes, concurrent revocations]
- [Edge case 2]

**Notes (optional):**
- Patterns to follow — e.g., "Follow the repository/service split used in `src/billing/`"
- Non-obvious sequencing — e.g., "Run migration before wiring the route handler"
- Gotchas — e.g., "The existing `validate()` helper is case-sensitive"

**Verification:** `pnpm test path/to/test.ts` passes; run full suite afterward.
````

Commit instructions, TDD step-by-step choreography, and pseudocode implementations are not included by default. The implementer executes TDD via their own vocabulary-routed expert prompt and the `develop` skill. Your job is to specify the destination, not narrate the walk.

Include a code snippet only when one of these is true:
- The exact interface is non-obvious and naming it matters (type signatures, API contract)
- A data shape needs to match an external contract (e.g., webhook payload, JSON schema)
- A specific line in existing code needs to be located precisely (paste the 2-3 line neighborhood)

## No Placeholders

Every element must be concrete and actionable. These are **plan failures** — never write them:

- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" — name the error cases the spec requires
- "Handle edge cases" — list the edge cases in the Edge cases section
- "Write tests for the above" — name the behaviors tests must cover in ACs
- Types, functions, or methods referenced in later tasks but defined nowhere
- "Configure as needed" — specify the configuration keys and their purpose

Pseudocode function bodies are **not** required. If you find yourself writing one, ask whether it adds information the implementer couldn't derive from the interface shape and ACs. If not, delete it.

## Remember

- Exact file paths — absolute from repo root
- Interface shapes, not function bodies
- DRY, YAGNI, TDD, frequent commits (the implementer handles these — you state the goal)

## Self-Review

After writing the complete plan, look at the spec with fresh eyes and check the plan against it. This is a checklist you run yourself — not a subagent dispatch.

**1. Spec coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? List any gaps. If you find a spec requirement with no task, add the task.

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Placeholders" section above. Fix them.

**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.

**4. Dependency ordering:** Can each task be implemented after its dependencies without forward references?

**5. File paths:** Every path is exact and absolute from repo root. No "somewhere in src/".

**6. Verification steps:** Every task has at least one "Run: ... Expected: ..." step.

**7. Task sizes:** Each task spec should target ~800-1,000 tokens. For each task, estimate the combined dispatch payload (spec + parent context + expert prompt). If any task would exceed 40,000 tokens per `_shared/risk-matrix.md`, break it into smaller tasks. A task that needs that much context is trying to do too much.

**8. Pseudocode sweep:** Scan every task for function bodies, full SQL statements, or step-by-step code narration. If a code block doesn't disambiguate a non-obvious interface or data shape, delete it. Pseudocode in task specs drives reviewer nits without helping the implementer.

If you find issues, fix them inline. No need to re-review — just fix and move on.

## Save and Report

Allocate the next `PLAN-NNN` ID per `_shared/artifact-conventions.md`. Save the plan to `docs/plans/PLAN-NNN-<slug>.md` with frontmatter. Commit to git.

Include a Changelog section at the bottom of the plan:
```
## Changelog

- **YYYY-MM-DD HH:MM** — [PLAN] Created with N tasks. Domains: [list]. Next: plan-review.
```

## Hand Off

After saving the plan:
- If called by `/skylark:implement`, return control — implement routes to `/skylark:plan-review` next
- If called standalone, suggest: "Plan complete. Run `/skylark:implement [plan path]` to start the review and execution pipeline."

Return:
```
plan_id: PLAN-NNN
plan_path: docs/plans/PLAN-NNN-slug.md
task_count: N
domains: [list of domain clusters across tasks]
```

## What This Skill Does NOT Do

- Review the plan — use `/skylark:plan-review` for that
- Execute the plan — use `/skylark:develop` for that
- Modify the spec — the spec is the source of truth, not the plan
- Skip scope check — if the spec is too broad, break it up first

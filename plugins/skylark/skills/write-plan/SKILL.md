---
name: write-plan
description: Use when you have an approved spec or requirements for a multi-step task, before touching code. Produces a comprehensive implementation plan with bite-sized tasks, complete code, exact file paths, and verification commands. No placeholders — every step is actionable.
---

# Writing Plans

Write comprehensive implementation plans assuming the engineer has zero context for the codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about the toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Save plans to:** `docs/plans/PLAN-NNN-<slug>.md`

## Scope and Size Check

If the spec covers multiple independent subsystems, it should have been broken into sub-project specs during brainstorming. If it wasn't, suggest breaking this into separate plans — one per subsystem. Each plan should produce working, testable software on its own.

**Plan decomposition:** Plans have no hard token cap — they decompose by scope (8+ tasks or dense cross-dependencies → split into sub-plans). A plan is large because it contains many tasks; the right response is to decompose tasks, not to shrink the plan.

**Task size limit:** Each individual task spec should target **~2,000 tokens** — small, focused, self-contained. The total dispatch payload (task spec + parent context + expert prompt) must fit within **40,000 tokens** (20% of Sonnet's context window) per `_shared/risk-matrix.md`. The implementer needs 80% of the context window for reading code, writing code, running tests, and self-review.

**Architecture docs:** If the plan makes significant architectural decisions (technology choices, data model design, integration patterns), document them as ADRs in `docs/architecture/` — same format as brainstorm produces. Plans should reference architectural decisions, not embed lengthy justifications.

## File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code you can hold in context at once, and your edits are more reliable when files are focused. Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If the codebase uses large files, don't unilaterally restructure — but if a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each task should produce self-contained changes that make sense independently.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" — step
- "Run it to make sure it fails" — step
- "Implement the minimal code to make the test pass" — step
- "Run the tests and make sure they pass" — step
- "Commit" — step

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
**Scope:** [what this task builds/changes]

**Files:**
- Create: `exact/path/to/file.ts`
- Modify: `exact/path/to/existing.ts:123-145`
- Test: `tests/exact/path/to/test.ts`

**Acceptance Criteria:**
- [Concrete, testable — traced from spec ACs]

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { specificFunction } from '../path/to/module';

describe('specificFunction', () => {
  it('should handle specific behavior', () => {
    const result = specificFunction(input);
    expect(result).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --filter=specific-test`
Expected: FAIL with "specificFunction is not defined"

- [ ] **Step 3: Write minimal implementation**

```typescript
export function specificFunction(input: InputType): OutputType {
  return expected;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --filter=specific-test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/path/test.ts src/path/file.ts
git commit -m "feat(bd-XXXX): add specific feature"
```
````

## No Placeholders

Every step must contain the actual content an engineer needs. These are **plan failures** — never write them:

- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" (without actual test code)
- "Similar to Task N" (repeat the code — the engineer may be reading tasks out of order)
- Steps that describe what to do without showing how (code blocks required for code steps)
- References to types, functions, or methods not defined in any task
- "Configure as needed" / "adjust as appropriate" (show the exact configuration)

## Remember

- Exact file paths always — absolute from repo root
- Complete code in every step — if a step changes code, show the code
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits

## Self-Review

After writing the complete plan, look at the spec with fresh eyes and check the plan against it. This is a checklist you run yourself — not a subagent dispatch.

**1. Spec coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? List any gaps. If you find a spec requirement with no task, add the task.

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Placeholders" section above. Fix them.

**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.

**4. Dependency ordering:** Can each task be implemented after its dependencies without forward references?

**5. File paths:** Every path is exact and absolute from repo root. No "somewhere in src/".

**6. Verification steps:** Every task has at least one "Run: ... Expected: ..." step.

**7. Task sizes:** Each task spec should be ~2,000 tokens. For each task, estimate the combined dispatch payload (spec + parent context + expert prompt). If any task would exceed 40,000 tokens per `_shared/risk-matrix.md`, break it into smaller tasks. A task that needs that much context is trying to do too much.

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

---
name: brainstorm
description: "You MUST use this before any creative work — creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements, and design before implementation. Produces a written spec that must be approved before proceeding."
---

# Brainstorming Ideas Into Designs

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get user approval.

<HARD-GATE>
Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it. This applies to EVERY project regardless of perceived simplicity.
</HARD-GATE>

## Anti-Pattern: "This Is Too Simple To Need A Design"

Every project goes through this process. A todo list, a single-function utility, a config change — all of them. "Simple" projects are where unexamined assumptions cause the most wasted work. The design can be short (a few sentences for truly simple projects), but you MUST present it and get approval.

## Checklist

You MUST create a task for each of these items and complete them in order:

1. **Explore project context** — check files, docs, recent commits, search existing artifacts for prior art
2. **Assess scope** — is this too large for a single spec? If it spans multiple independent subsystems or 3+ bounded contexts, decompose before asking detailed questions.
3. **Ask clarifying questions** — one at a time, understand purpose/constraints/success criteria
4. **Propose 2-3 approaches** — with trade-offs and your recommendation
5. **Present design** — in sections scaled to complexity, get user approval after each section
6. **Capture strategy and architecture** — document design principles, jobs to be done, and user stories in `docs/strategy/`. Document major architectural decisions in `docs/architecture/`. These are separate from the spec — they persist as reference material for future work. (See below.)
7. **Write design doc** — save to `docs/specs/SPEC-NNN-<slug>.md` with frontmatter per `_shared/artifact-conventions.md`, commit to git
8. **Spec self-review** — quick inline check for placeholders, contradictions, ambiguity, scope, **and size** (see below)
9. **User reviews written spec** — ask user to review the spec file before proceeding
10. **Hand off** — return to `/skylark:implement` pipeline (next stage: spec-review) or suggest the user invoke it

## Process Flow

```dot
digraph brainstorming {
    "Explore project context" [shape=box];
    "Search existing artifacts" [shape=box];
    "Scope too large?" [shape=diamond];
    "Decompose into sub-projects" [shape=box];
    "Ask clarifying questions" [shape=box];
    "Propose 2-3 approaches" [shape=box];
    "Present design sections" [shape=box];
    "User approves design?" [shape=diamond];
    "Write design doc + commit" [shape=box];
    "Spec self-review\n(fix inline)" [shape=box];
    "User reviews spec?" [shape=diamond];
    "Hand off to pipeline" [shape=doublecircle];

    "Explore project context" -> "Search existing artifacts";
    "Search existing artifacts" -> "Scope too large?";
    "Scope too large?" -> "Decompose into sub-projects" [label="yes"];
    "Decompose into sub-projects" -> "Ask clarifying questions" [label="brainstorm first sub-project"];
    "Scope too large?" -> "Ask clarifying questions" [label="no"];
    "Ask clarifying questions" -> "Propose 2-3 approaches";
    "Propose 2-3 approaches" -> "Present design sections";
    "Present design sections" -> "User approves design?";
    "User approves design?" -> "Present design sections" [label="no, revise"];
    "User approves design?" -> "Write design doc + commit" [label="yes"];
    "Write design doc + commit" -> "Spec self-review\n(fix inline)";
    "Spec self-review\n(fix inline)" -> "User reviews spec?";
    "User reviews spec?" -> "Write design doc + commit" [label="changes requested"];
    "User reviews spec?" -> "Hand off to pipeline" [label="approved"];
}
```

**The terminal state is handing off to the pipeline.** When called by `/skylark:implement`, return control — implement routes to `/skylark:spec-review` next. When called standalone, suggest the user invoke `/skylark:implement` with the spec path. Do NOT invoke any other skill. The ONLY next step after brainstorming is spec-review (via implement).

## The Process

**Understanding the idea:**

- Check out the current project state first (files, docs, recent commits)
- Search `docs/specs/`, `docs/plans/` for existing work in this area — also check beads (`bd search "<keywords>" --json`) for related tasks — don't create duplicate work
- Before asking detailed questions, assess scope: if the request describes multiple independent subsystems (e.g., "build a platform with chat, file storage, billing, and analytics"), flag this immediately. Don't spend questions refining details of a project that needs to be decomposed first.
- If the project is too large for a single spec, help the user decompose into sub-projects: what are the independent pieces, how do they relate, what order should they be built? Then brainstorm the first sub-project through the normal design flow. Each sub-project gets its own spec → plan → implementation cycle.
- For appropriately-scoped projects, ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible, but open-ended is fine too
- Only one question per message — if a topic needs more exploration, break it into multiple questions
- Focus on understanding: purpose, constraints, success criteria

**Exploring approaches:**

- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why

**Presenting the design:**

- Once you believe you understand what you're building, present the design
- Scale each section to its complexity: a few sentences if straightforward, up to 200-300 words if nuanced
- Ask after each section whether it looks right so far
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify if something doesn't make sense

**Design for isolation and clarity:**

- Break the system into smaller units that each have one clear purpose, communicate through well-defined interfaces, and can be understood and tested independently
- For each unit, you should be able to answer: what does it do, how do you use it, and what does it depend on?
- Can someone understand what a unit does without reading its internals? Can you change the internals without breaking consumers? If not, the boundaries need work.
- Smaller, well-bounded units are also easier for you to work with — you reason better about code you can hold in context at once, and your edits are more reliable when files are focused. When a file grows large, that's often a signal that it's doing too much.

**Working in existing codebases:**

- Explore the current structure before proposing changes. Follow existing patterns.
- Where existing code has problems that affect the work (e.g., a file that's grown too large, unclear boundaries, tangled responsibilities), include targeted improvements as part of the design — the way a good developer improves code they're working in.
- Don't propose unrelated refactoring. Stay focused on what serves the current goal.

## After the Design

**Strategy and Architecture Docs:**

During design, separate the *reasoning behind the design* from the *spec itself*. The spec describes what to build; these documents capture why.

- **`docs/strategy/`** — Design principles, jobs to be done (JTBD), user stories, success metrics, and constraints that shaped the design. Write a file per concern (e.g., `docs/strategy/multi-tenancy-principles.md`). These inform future specs in the same domain.
- **`docs/architecture/`** — Architectural decision records (ADRs) for significant technical choices made during design. Use a simple format: Context, Decision, Consequences. Write a file per decision (e.g., `docs/architecture/adr-postgres-first-tenant-model.md`). These inform future plans and prevent re-litigating settled decisions.

Not every spec needs these. Write them when the design discussion surfaces principles, trade-offs, or decisions that would be valuable to future work — especially when multiple approaches were considered and one was chosen for non-obvious reasons.

Commit these alongside the spec.

**Documentation:**

- Allocate the next `SPEC-NNN` ID per `_shared/artifact-conventions.md`
- Write the validated design (spec) to `docs/specs/SPEC-NNN-<slug>.md`
  - Use frontmatter per `_shared/artifact-conventions.md`:
    ```yaml
    ---
    id: SPEC-NNN
    title: [Feature Name] Design Spec
    type: spec
    status: draft
    external_ref: ""
    parent: null
    created: YYYY-MM-DD
    updated: YYYY-MM-DD
    ---
    ```
  - Body structure: Context, Solution, Detailed Design, Acceptance Criteria, Out of Scope, Open Questions
  - Include a Changelog section at the bottom with the creation event
- Commit the design document to git

**Spec Self-Review:**

After writing the spec document, look at it with fresh eyes:

1. **Placeholder scan:** Any "TBD", "TODO", incomplete sections, or vague requirements? Fix them.
2. **Internal consistency:** Do any sections contradict each other? Does the data model support the API surface described? Does the architecture match the feature descriptions?
3. **Scope check:** Is this focused enough for a single implementation plan, or does it need decomposition?
4. **Ambiguity check:** Could any requirement be interpreted two different ways? If so, pick one and make it explicit.
5. **Decomposition check:** Does this spec span 3+ bounded contexts or describe multiple independent subsystems? If so, decompose into sub-spec documents — each sub-spec gets its own file, frontmatter, and pipeline cycle. Link sub-specs to a parent spec via `parent` frontmatter. The parent spec becomes a thin overview pointing to its children. (Specs have no hard token cap — they decompose by scope, not size. See `_shared/risk-matrix.md`.)

Fix any issues inline. No need to re-review — just fix and move on.

**User Review Gate:**

After the spec self-review passes, ask the user to review the written spec before proceeding:

> "Spec written and committed to `<path>`. Please review it and let me know if you want to make any changes before we send it to panel review."

Wait for the user's response. If they request changes, make them and re-run the spec self-review. Only proceed once the user approves.

**Hand Off:**

- If called by `/skylark:implement`, return control — implement routes to `/skylark:spec-review` next
- If called standalone, suggest: "Spec approved. Run `/skylark:implement [spec path]` to start the review and implementation pipeline."
- Append changelog entry to the spec:
  ```
  - **YYYY-MM-DD HH:MM** — [BRAINSTORM] Design spec written and approved. Next: spec-review.
  ```

## Key Principles

- **One question at a time** — don't overwhelm with multiple questions
- **Multiple choice preferred** — easier to answer than open-ended when possible
- **YAGNI ruthlessly** — remove unnecessary features from all designs
- **Explore alternatives** — always propose 2-3 approaches before settling
- **Incremental validation** — present design sections, get approval before moving on
- **Be flexible** — go back and clarify when something doesn't make sense
- **Follow existing patterns** — explore the codebase before inventing new conventions

## What This Skill Does NOT Do

- Produce implementation plans — next step is spec-review, then write-plan
- Review specs via panel — use `/skylark:spec-review` or `/skylark:panel-review`
- Implement anything — design only
- Skip user approval — the hard gate is non-negotiable
- Jump to implementation skills — the ONLY next step is the pipeline (spec-review)

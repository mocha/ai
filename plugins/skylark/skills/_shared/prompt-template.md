# Expert Prompt Template

Output skeleton for generated expert prompts. Section order matters — it controls knowledge activation sequence.

## Core Structure (Always Present)

```markdown
## Identity
You are a [real job title] [primary responsibility]. [Authority boundary].

## Communication Style
[Contents of `_shared/communication-style.md`, inlined verbatim. Plain language,
concise, actionable output, autonomous small-fix rule. This sits between Identity
and Vocabulary so it primes the role before knowledge activation.]

## Domain Vocabulary

**Cluster 1 — [Cluster Name]**
- [term] — [contextual detail, attribution if applicable]
- ...

**Cluster 2 — [Cluster Name]**
- ...

[3-5 clusters, 15-30 terms total]

## Anti-Patterns

| ID | Failure Mode | Detection Signal | Resolution |
|---|---|---|---|
| AP-1 | **[Named pattern]** — [what goes wrong] | [How to spot it] | [What to do instead] |
| AP-2 | ... | ... | ... |

[5-10 anti-patterns, all three columns filled]
```

## Resources Section (Always Present After Anti-Patterns)

```markdown
## Resources

- **Project docs:** Explore `docs/` for specs, plans, strategy notes, architecture decisions, and prior art. Read anything that looks relevant to your task — `docs/strategy/` has design principles and user stories, `docs/architecture/` has architectural decision records.
- **Expert consultation:** If you need a second opinion on a design question, domain concern, or tricky trade-off, invoke `/skylark:solo-review` to get a vocabulary-routed expert review on any document or question. You are always welcome to stop and ask an expert.
```

## Context-Specific Sections (Added by Calling Skill)

### For Review Context (panel-review, solo-review, spec-review, plan-review)

```markdown
## Review Focus
- [Aspect 1 to prioritize given document type/domain]
- [Aspect 2]

## Output Format

### Strengths
[What the document gets right — specific, not generic]

### Issues
For each issue:
- **Severity:** blocking | major | minor
- **Location:** [where in document or code]
- **Problem:** [what's wrong]
- **Suggestion:** [concrete fix or alternative]

### Missing
[What the document should address but doesn't]

### Verdict
Ship | Revise | Rethink — one sentence justification.
```

### For Development Context (develop)

```markdown
## Operational Guidance
- Error philosophy: [fail-fast | tolerant parsing | mixed — with rationale]
- Concurrency model: [if applicable]
- Edge cases: [how to handle malformed input, missing data, unexpected state]

## Testing Expectations
- [Language-idiomatic test patterns]
- [What edge cases need fixture coverage]
- [How to verify performance targets]

## Deliverables
[Concrete file/directory tree with one-line descriptions per entry]
```

## Section Order Rationale

1. **Identity first** — primacy effect gives highest attention weight, primes the role
2. **Vocabulary second** — routes knowledge activation before task details arrive
3. **Anti-patterns third** — steers away from failure modes before generation begins
4. **Resources fourth** — makes docs/ and solo-review available before task details
5. **Context sections last** — task-specific detail benefits from recency effect

## Rules

- Identity < 50 tokens
- No flattery or superlatives anywhere
- Every anti-pattern has all three columns filled
- Vocabulary terms pass the 15-year practitioner test
- No meta-commentary ("this prompt is designed to...") — output is instructions, not a document about instructions

## Review Directive (Risk-Tiered)

Review prompts include one of two directives based on the risk tier the caller passes in:

**Critical risk** — include the strong mandate:

> "You must identify at least one substantive issue or explicitly justify clearance with specific evidence."

This prevents rubber-stamp approvals on load-bearing work where experts might default to "looks good" without deep engagement.

**Elevated and below** — include the softer directive:

> "Focus on blocking issues. Minor issues may be noted or omitted; if the document is sound, say so without forcing a finding. Nits you would fix yourself should be fixed, not flagged."

The softer directive combines with the Autonomous Minor Fixes rule in `communication-style.md` — reviewers at non-critical tiers don't need to manufacture findings to justify the review.

## User Preferences (Conditional)

If `.claude/skylark-prompt-mods.md` exists at the project root, append its contents verbatim as a final section at the end of every generated expert prompt:

```markdown
## User Preferences

[Contents of .claude/skylark-prompt-mods.md, verbatim]
```

If the file is absent, skip this section entirely. See `expert-prompt-generator.md` Step 6 for the assembly contract.

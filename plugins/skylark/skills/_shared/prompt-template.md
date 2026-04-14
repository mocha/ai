# Expert Prompt Template

Output skeleton for generated expert prompts. Section order matters — it controls knowledge activation sequence.

## Core Structure (Always Present)

```markdown
## Identity
You are a [real job title] [primary responsibility]. [Authority boundary].

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
4. **Context sections last** — task-specific detail benefits from recency effect

## Rules

- Identity < 50 tokens
- No flattery or superlatives anywhere
- Every anti-pattern has all three columns filled
- Vocabulary terms pass the 15-year practitioner test
- No meta-commentary ("this prompt is designed to...") — output is instructions, not a document about instructions

## Mandatory Review Directive

All review prompts must include this directive (adapt wording to context):

> "You must identify at least one substantive issue or explicitly justify clearance with specific evidence."

This prevents rubber-stamp approvals where experts default to "looks good" without deep engagement.

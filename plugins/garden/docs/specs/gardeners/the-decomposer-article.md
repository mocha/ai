# The Decomposer: article

**Type:** Pipeline gardener (Layer 3 — Decomposition)
**Schedule:** Every 30 minutes
**Priority:** Phase 3, Step 6

## Outcome

Articles (news, blog posts, press releases) decomposed into claims focused on: competitive intelligence signals, company announcements, technology developments, partnership and funding events, and market trend observations.

## Watch Condition

Files with `categorized_as: article` and no `decomposed_at` field.

## Draft Prompt

```
You are a competitive intelligence analyst responsible for decomposing articles into atomic claims.

Follow the same claim format and process as the personal-notes decomposer, with these additional priorities:

ARTICLE-SPECIFIC EXTRACTION:
- Company announcements: funding, partnerships, product launches, leadership changes → `claim_type: event`, `target_type: company`
- Technology claims: capabilities announced, benchmarks cited, roadmap signals → `claim_type: entity-update` or `signal`
- Competitive positioning: how companies position against each other → `claim_type: relationship`
- Market signals: trends, analyst opinions, adoption indicators → `claim_type: signal`
- People: executives quoted, researchers cited, with titles and affiliations → `claim_type: entity-update`, `target_type: person`

Every article should produce at least one company-level claim. If the article is a press release, the announcing company is always the primary target entity.

CALIBRATION: A typical news article produces 3-6 claims. A dense press release about a partnership or funding round might produce 8-10. A fluffy marketing blog post might produce 1-2.
```

## Failure Modes

- **Marketing echo** — treating press release claims at face value without marking them as `signal`
- **Missing the competitive angle** — extracting facts without noting what they imply about the competitive landscape

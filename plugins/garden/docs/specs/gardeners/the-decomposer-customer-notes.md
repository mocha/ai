# The Decomposer: customer-notes

**Type:** Pipeline gardener (Layer 3 — Decomposition)
**Schedule:** Every 30 minutes
**Priority:** Phase 3, Step 5

## Outcome

Customer meeting notes decomposed into claims with particular attention to: customer profile enrichment (people, org structure, priorities), requirements and constraints, competitive mentions, timeline commitments, and relationship signals. Produces the same claim format as all decomposers but with a customer-aware lens.

## Watch Condition

Files with `categorized_as: customer-notes` and no `decomposed_at` field.

## Draft Prompt

```
You are a customer intelligence analyst responsible for decomposing customer meeting notes into atomic claims.

Follow the same claim format and process as the personal-notes decomposer, with these additional priorities:

CUSTOMER-SPECIFIC EXTRACTION:
- People mentioned: names, titles, roles, reporting relationships → `claim_type: entity-update`, `target_type: person`
- Customer requirements: explicit needs, deadlines, constraints → `claim_type: requirement`
- Competitive mentions: other vendors mentioned, comparisons made → `claim_type: signal`
- Timeline commitments: dates, milestones, deadlines from either side → `claim_type: event`
- Relationship signals: satisfaction, frustration, expansion interest, churn risk → `claim_type: signal`
- Technical environment: what systems they use, what they're evaluating → `claim_type: entity-update`

Always create at least one claim targeting the customer organization as a company entity, capturing the overall state of the relationship as observed in this meeting.

CALIBRATION: A typical customer meeting note produces 8-15 claims. Err toward capturing more — customer intelligence compounds.
```

## Failure Modes

- **Missing the customer entity** — decomposing facts without linking back to the customer organization
- **Signal blindness** — capturing explicit statements but missing implicit relationship signals

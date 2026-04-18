# The Decomposer: internal-document

**Type:** Pipeline gardener (Layer 3 — Decomposition)
**Schedule:** Every 30 minutes
**Priority:** Phase 3, Step 7

## Outcome

Internal documents (memos, reports, design docs, strategy documents) decomposed into claims focused on: decisions made, strategic signals, priority shifts, architectural constraints, and organizational context.

## Watch Condition

Files with `categorized_as: internal-document` and no `decomposed_at` field.

## Draft Prompt

```
You are an organizational intelligence analyst responsible for decomposing internal documents into atomic claims.

Follow the same claim format and process as the personal-notes decomposer, with these additional priorities:

INTERNAL DOCUMENT EXTRACTION:
- Decisions: what was decided, by whom, with what rationale → `claim_type: event`
- Strategic signals: priority shifts, resource allocation changes, new directions → `claim_type: signal`
- Architectural constraints: technical decisions that constrain future work → `claim_type: requirement`
- Organizational context: team changes, responsibility shifts, reporting changes → `claim_type: entity-update`
- Data points: metrics, projections, status facts → `claim_type: entity-update`
- Dependencies: "X blocks Y" or "X requires Y" → `claim_type: relationship`

Internal documents are high-trust sources. Claims from internal docs should have more specificity and confidence than claims from external articles.

CALIBRATION: Varies widely. A short memo might produce 2-3 claims. A design doc might produce 10-15. A strategy document could produce 20+. Follow the content.
```

## Failure Modes

- **Decision amnesia** — capturing facts but missing the decisions that produced them
- **Org-blindness** — ignoring who said what and what authority they had to say it

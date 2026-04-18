# The Staleness Monitor

**Type:** Maintenance gardener
**Schedule:** Weekly
**Priority:** Phase 4, Step 12

## Outcome

Graphed objects in active domains that haven't been reinforced by new claims in a long time get flagged for review. Produces a staleness report ranking objects by how out-of-date they're likely to be given their domain's activity level.

## Watch Condition

Graphed objects where:
- `last_updated` is older than a domain-relative threshold (e.g., a company profile untouched for 6 months in a domain with weekly new claims)
- The object is in an actively-maintained domain (inactive domains are left alone — principle 3)

## Draft Prompt

```
You are responsible for identifying stale knowledge in active areas of the graph.

Your job: find graphed objects that are likely out of date — not because all old content is bad, but because they sit in domains where new information is flowing and they haven't been touched.

PRODUCE A REPORT with:
1. **Stale objects ranked by staleness-to-activity ratio** — objects in busy domains that haven't been updated are higher priority than objects in quiet domains
2. **Recommended actions** — for each, suggest: refresh research, flag for human review, or leave alone
3. **Domain health summary** — which domains are well-maintained vs. which have pockets of staleness

This gardener DOES NOT modify files. It produces a report for human prioritization.

IMPORTANT: Do not flag objects in quiet domains. Graceful decay is a feature (principle 3). Only flag staleness where it matters — in domains with active claims flowing.
```

## Failure Modes

- **Gardening guilt** — flagging everything old, creating a maintenance burden that violates principle 7
- **Domain blindness** — applying the same staleness threshold to active and inactive domains

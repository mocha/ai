# The Gap Detector

**Type:** Maintenance gardener
**Schedule:** Weekly
**Priority:** Phase 4, Step 11

## Outcome

Missing knowledge surfaced as research targets. Dangling wiki-links (referenced but never created) get counted and ranked. Domains with thin coverage relative to their activity get flagged. Frequently-referenced entities that have no graphed object get proposed for creation.

## Watch Condition

The graph as a whole. Specifically:
- Wiki-links that point to non-existent files (dangling links)
- Domains with few graphed objects relative to how often they appear in claims
- Entities mentioned in 3+ claims but with no dedicated graphed object

## Draft Prompt

```
You are responsible for identifying gaps in the knowledge graph.

Your job: scan the vault for missing knowledge — entities that are referenced but don't exist, domains that are thin, and topics that keep coming up but have no home.

PRODUCE A REPORT with:
1. **Dangling links ranked by frequency** — which missing entities are referenced most often?
2. **Thin domains** — which domains have active claims but few graphed objects?
3. **Ungraphed frequent entities** — which entities appear in 3+ claims but have no file?
4. **Proposed research targets** — based on the above, what should be investigated next?

This gardener DOES NOT create files. It produces a report that a human uses to prioritize research and content creation.
```

## Failure Modes

- **Noise** — surfacing hundreds of low-value dangling links instead of ranking by impact
- **False gaps** — flagging domains as thin when they're intentionally minimal

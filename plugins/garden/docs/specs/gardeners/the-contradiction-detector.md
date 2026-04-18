# The Contradiction Detector

**Type:** Maintenance gardener
**Schedule:** Weekly
**Priority:** Phase 4, Step 13

## Outcome

Conflicting claims or graphed objects surfaced with evidence from both sides. Produces a contradictions report that a human uses to resolve disagreements in the graph.

## Watch Condition

- Claims that target the same entity with conflicting `content`
- Graphed objects with frontmatter values that disagree with recent claims
- Graphed objects that make assertions contradicted by other graphed objects

## Draft Prompt

```
You are responsible for detecting contradictions in the knowledge graph.

Your job: find places where the graph disagrees with itself — claims that conflict, objects that contradict each other, or facts that have changed but the old version persists somewhere.

PRODUCE A REPORT with:
1. **Contradictions ranked by severity** — fundamental disagreements first, stale-value conflicts last
2. **Evidence from both sides** — for each contradiction, cite the specific claims or objects that disagree, with timestamps
3. **Recommended resolution** — newer-wins, needs human judgment, or needs research

This gardener DOES NOT resolve contradictions. It surfaces them. The Grapher handles soft conflicts during pipeline processing. This gardener catches the ones that slipped through or emerged over time.

SEVERITY LEVELS:
- **Hard** — two sources fundamentally disagree on a fact (company X is a partner vs. competitor)
- **Medium** — a value has changed but the old value persists in related objects (funding round updated on company but not on related event)
- **Soft** — minor inconsistencies that probably reflect natural evolution, not errors
```

## Failure Modes

- **False contradictions** — flagging things that evolved naturally as conflicts
- **Noise** — surfacing dozens of soft inconsistencies instead of focusing on hard conflicts

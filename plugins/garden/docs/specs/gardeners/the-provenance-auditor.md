# The Provenance Auditor

**Type:** Maintenance gardener
**Schedule:** Monthly
**Priority:** Phase 4, Step 16

## Outcome

Graphed objects with no claim trail get flagged — these are objects whose origin can't be traced, which degrades trust in the graph over time. Claims whose source files have been deleted also get flagged.

## Watch Condition

- Graphed objects with no inbound links from any claim file
- Claim files whose `source_file` wiki-link points to a deleted file

## Draft Prompt

```
You are responsible for auditing the provenance chain of the knowledge graph.

Your job: ensure that graphed objects can be traced back to their sources, and that claims can be traced back to their original content.

PRODUCE A REPORT with:
1. **Unprovenanced objects** — graphed objects with no claim trail. These were likely created before the pipeline existed (pre-existing vault content). Not an error, but worth noting. For high-value objects in active domains, consider flagging for re-processing through the pipeline.
2. **Orphaned claims** — claims whose source file has been deleted. The claim still has value (it records what was asserted) but the original evidence is gone. Flag for awareness.
3. **Provenance health by domain** — what percentage of objects in each domain have a claim trail?

This gardener DOES NOT delete or modify objects. It produces a trust audit.

NOTE: The vault predates the pipeline. Most existing objects will have no claim trail initially. This is expected and not an error. The provenance percentage will improve naturally as new content flows through the pipeline.
```

## Failure Modes

- **False alarm on legacy content** — treating pre-pipeline objects as trust failures
- **Noise** — reporting provenance gaps in inactive domains where nobody cares

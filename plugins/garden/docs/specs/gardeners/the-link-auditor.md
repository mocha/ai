# The Link Auditor

**Type:** Maintenance gardener
**Schedule:** Weekly
**Priority:** Phase 4, Step 14

## Outcome

Broken wiki-links identified and proposed for fix or removal. Orphaned objects (no inbound links) flagged. Disconnected clusters (groups of objects that link to each other but not to the broader graph) surfaced.

## Watch Condition

The graph's link structure as a whole.

## Draft Prompt

```
You are responsible for auditing the structural health of wiki-links in the knowledge graph.

Your job: find broken connections, orphaned nodes, and isolated clusters.

PRODUCE A REPORT AND FIXES:
1. **Broken links** — wiki-links pointing to files that don't exist. For each, propose: create the target, fix the link text, or remove the link.
2. **Orphaned objects** — graphed objects with no inbound wiki-links from other files. These are islands. Propose connections.
3. **Disconnected clusters** — groups of files that link to each other but have no connections to the rest of the graph. Propose bridge links.

For broken links where the fix is obvious (typo in the link text, file was renamed), fix directly in the PR. For ambiguous cases, list in the PR description.
```

## Failure Modes

- **Overzealous cleanup** — removing dangling links that are intentional (pre-connecting the graph)
- **Missing renames** — not detecting that a broken link is just a file that was renamed

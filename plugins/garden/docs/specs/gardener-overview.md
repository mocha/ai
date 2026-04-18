# Gardening

Autonomous agents that maintain the vault's knowledge graph. Some run the intake pipeline (processing new inputs into the graph). Others maintain graph health over time. All share the same operational model.

**Spec:** [Knowledge Graph Pipeline](../docs/superpowers/specs/2026-04-11-knowledge-graph-pipeline-design.md)

---

## How Gardeners Work

Every gardener follows the same pattern:

1. **Scheduled run** — triggered on a cron schedule (frequency varies by gardener)
2. **Worktree** — creates a git worktree for isolation
3. **Scan** — finds files matching its watch condition
4. **Act** — processes files according to its rules
5. **PR** — creates a pull request with batched changes from the run

Gardeners never edit the vault directly. All changes come through PRs. Low-risk gardeners can graduate to auto-merge over time.

### State tracking

Gardeners track what's been processed through frontmatter fields on the files themselves:

- `categorized_at` — set by The Classifier, signals "this file has been categorized"
- `decomposed_at` — set by a Decomposer, signals "this file has been decomposed into claims"
- `graphed_at` — set on claims by The Grapher, signals "this claim has been reconciled against the graph"

No external state database. The files ARE the state.

---

## Implementation Sequence

Build in this order. Each step is independently valuable.

### Phase 1: Pipeline

| Step | Gardener | Outcome | Prompt |
|---|---|---|---|
| 1 | [The Classifier](the-classifier.md) | Uncategorized files get frontmatter applied; routed to the right decomposer | Draft |
| 2 | [The Decomposer: personal-notes](the-decomposer-personal-notes.md) | Personal notes broken into claims with entities, action items, decisions | Draft |
| 3 | [The Grapher](the-grapher.md) | Claims reconciled against the graph — objects created, updated, or flagged | Draft |

After Phase 1: a single end-to-end pipeline from raw note to graphed object.

### Phase 2: First maintenance gardener

| Step | Gardener | Outcome | Prompt |
|---|---|---|---|
| 4 | [The Connector](the-connector.md) | Implicit relationships in prose made explicit as wiki-links and tags | Draft |

### Phase 3: Additional decomposers (as content demands)

| Step | Gardener | Outcome | Prompt |
|---|---|---|---|
| 5 | [The Decomposer: customer-notes](the-decomposer-customer-notes.md) | Customer meeting notes decomposed with customer profile enrichment | Draft |
| 6 | [The Decomposer: article](the-decomposer-article.md) | Articles decomposed into competitive signals, events, entity updates | Draft |
| 7 | [The Decomposer: internal-document](the-decomposer-internal-document.md) | Internal docs decomposed into decisions, strategic signals, facts | Draft |

### Phase 4: Additional maintenance gardeners (as graph health demands)

| Step | Gardener | Outcome | Prompt |
|---|---|---|---|
| 8 | [The Organizer](the-organizer.md) | Misplaced files moved to correct locations | Draft |
| 9 | [The Splitter](the-splitter.md) | Oversized files proposed for decomposition | Draft |
| 10 | [The Change Monitor](the-change-monitor.md) | Human-edited files evaluated for re-processing | Draft |
| 11 | [The Gap Detector](the-gap-detector.md) | Missing entities and thin domains surfaced as research targets | Draft |
| 12 | [The Staleness Monitor](the-staleness-monitor.md) | Stale objects in active domains flagged for refresh | Draft |
| 13 | [The Contradiction Detector](the-contradiction-detector.md) | Conflicting claims or objects surfaced with evidence | Draft |
| 14 | [The Link Auditor](the-link-auditor.md) | Broken links, orphans, and disconnected clusters identified | Draft |
| 15 | [The Conformance Auditor](the-conformance-auditor.md) | Template-drifted objects proposed for update when it affects queries | Draft |
| 16 | [The Provenance Auditor](the-provenance-auditor.md) | Objects with no claim trail or deleted sources flagged | Draft |

### Phase 5: KB merge

When the pipeline is stable, merge `research-kb` into the unified graph.

---

## Backlog: Patterns to Adopt

**From get-shit-done (vault-tooling/get-shit-done):**

1. **Per-phase file manifests** — Each gardener task type should declare exactly which files it needs loaded into context, rather than loading entire documents. See `sdk/src/context-engine.ts` → `PHASE_FILE_MANIFEST`. Prevents context bloat.
2. **Markdown-aware truncation** — When gardeners load large files for context, truncate by keeping YAML frontmatter + all headings + first paragraph per section, collapsing the rest with `[... N lines omitted]`. See `sdk/src/context-truncation.ts` → `truncateMarkdown`. Preserves structure while cutting tokens.

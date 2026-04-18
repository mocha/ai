# vq Feature Requests from Gardener Design

Requests discovered while designing the Grapher, Classifier, and Decomposer gardeners against live vq output. Updated 2026-04-12 after testing current binary.

---

## Resolved

| # | Feature | Status |
|---|---|---|
| 1 | Path glob (`--path`) | On `feat/gardener-features`, not yet merged. Filename in FTS5 still TBD. |
| 2 | Search paths-only mode | ✅ `vq search --format list` outputs paths only. Already works. |
| 3 | Dangling links limit/ranking | On `feat/gardener-features`, not yet merged. |
| 5 | Type normalization | ✅ Already live in current binary. `Company` + `[[Company]]` → 699 merged. |
| 6 | Batch search (`--stdin`) | On `feat/gardener-features`, not yet merged. |
| 9 | Modified-after-field | ✅ `vq find --modified-after-field categorized_at` works. |
| 10 | Field inequality (`!=`) | ✅ `vq find --field "key!=value"` works (with caveat, see bug below). |

**Bonus features discovered (not requested):**
- `--min-tokens N` / `--max-tokens N` — token count filtering. Directly useful for The Splitter (files over ~1000 tokens).
- `--sort tokens` — sort by token count.

---

## Open

### 4. Multi-field find with OR logic
**Need:** Entity resolution sometimes needs "find files where name=X OR filename contains X." Current `--field` flags are AND-only.

**Request:** OR logic for field filters, or a dedicated entity resolution command. Lower priority now that `vq search` handles fuzzy entity lookup well.

### 7. Link frequency in dangling output
**Need:** Gap Detector wants to rank missing entities by how often they're referenced. May be resolved by #3 (dangling refactor on feat/gardener-features).

### 8. Cluster analysis with size info
**Need:** Link Auditor wants disconnected cluster sizes, not just cluster membership.

### Filename in FTS5 index (part of #1)
**Need:** `vq search "Tom Harty"` should rank `Tom Harty.md` higher than files that merely mention Tom Harty. Indexing the filename (without extension, dashes/underscores → spaces) as a high-weight FTS5 field would make entity resolution via search much more reliable.

**Current behavior:** Filenames appear in search results but aren't weighted differently from body mentions. A file NAMED "Tom Harty" and a file that MENTIONS Tom Harty once get similar scores.

---

## Bugs

### `--has` + `--field "key!=value"` interaction
**Observed:** `vq find --has type --field "type!=Article"` returns 0 results. Expected: 2576 (8418 files with type - 5842 Articles).

**Without `--has`:** `vq find --field "type!=Article"` returns 10018 (all files, including those without a type field — vacuous truth).

**Workaround:** Use a positive field filter instead of `--has` when combining with `!=`. For example, `vq find --field "categorized_as=personal-notes" --field "categorization_confidence!=low"` works because the positive filter on `categorized_as` already implies the file has frontmatter.

---

## On feat/gardener-features (not yet merged)

These features are implemented and tested on the branch but not available in the current binary:

1. **`vq find --path "<glob>"`** — path/filename glob matching
3. **`vq links dangling --limit N --format list`** — ranked dangling links with limit
6. **`vq search --stdin`** — batch entity resolution, reads queries from stdin

---

## Verified Working Commands (as of 2026-04-12)

Reference for gardener authors — tested against the live index (10,018 files).

```bash
# Structural queries
vq find --no <field>                          # files missing a field
vq find --has <field>                         # files with a field
vq find --field "key=value"                   # exact field match
vq find --field "key!=value"                  # negation (see bug note above)
vq find --contains "key=value"               # array field contains value
vq find --exclude "<dir>"                    # exclude directory (repeat for multiple)
vq find --in "<dir>"                         # restrict to subtree
vq find --sort mtime|path|size|rank|tokens   # sort order
vq find --limit N                            # cap results
vq find --format list|json|count             # output format
vq find --min-tokens N                       # minimum body token count
vq find --max-tokens N                       # maximum body token count
vq find --modified-after-field <field>       # files where mtime > frontmatter date field

# Full-text search
vq search "<query>" --limit N                # ranked BM25 + PageRank + recency
vq search "<query>" --format list            # paths only (pipe-friendly)
vq search "<query>" --format json            # JSON with path, score, snippet

# File reading
vq read --frontmatter <path>                 # YAML frontmatter only
vq read --body <path>                        # body content only
vq read --links <path>                       # all links (wikilinks + frontmatter refs)
vq read --field "<key>" <path>               # single field value

# Graph operations
vq links to <path>                           # backlinks to a file
vq links from <path>                         # outgoing links from a file
vq links hubs --limit N                      # most-connected nodes
vq links dangling                            # links to non-existent files
vq links orphans                             # files with no links
vq links clusters                            # connected components
vq links walk <path>                         # BFS traversal

# Ranking
vq rank --limit N                            # PageRank sorted

# Stats
vq stats health                              # file/link/orphan counts
vq stats count --by <field>                  # group-by aggregation
vq stats tokens                              # token counts

# Index management
vq index                                     # incremental refresh
vq index --force                             # full rebuild (delete .vq/index.db first if schema mismatch)
```

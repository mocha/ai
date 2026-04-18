# vq Command Reference

`vq` is a Go CLI for indexed vault queries. It provides PageRank + BM25 +
recency-weighted search over an Obsidian vault's markdown files and their
frontmatter. SQLite-backed index at `.vq/index.db`.

## Structural Queries

```bash
vq find --no <field>                          # files missing a field
vq find --has <field>                         # files with a field
vq find --field "key=value"                   # exact field match
vq find --field "key!=value"                  # negation (see caveat below)
vq find --contains "key=value"               # array field contains value
vq find --exclude "<dir>"                    # exclude directory (repeatable)
vq find --in "<dir>"                         # restrict to subtree
vq find --sort mtime|path|size|rank|tokens   # sort order
vq find --limit N                            # cap results
vq find --format list|json|count             # output format
vq find --min-tokens N                       # minimum body token count
vq find --max-tokens N                       # maximum body token count
vq find --modified-after-field <field>       # files where mtime > field date
```

**Caveat:** `--has` + `--field "key!=value"` returns 0 results (known bug).
Workaround: use a positive field filter instead of `--has` when combining
with `!=`. Example: `--field "categorized_as=personal-notes" --field "categorization_confidence!=low"`.

## Full-Text Search

```bash
vq search "<query>" --limit N      # ranked BM25 + PageRank + recency
vq search "<query>" --format list  # paths only (pipe-friendly)
vq search "<query>" --format json  # JSON with path, score, snippet
```

## File Reading

```bash
vq read --frontmatter <path>   # YAML frontmatter only
vq read --body <path>          # body content only
vq read --links <path>         # all links (wikilinks + frontmatter refs)
vq read --field "<key>" <path> # single field value
```

## Graph Operations

```bash
vq links to <path>        # backlinks to a file
vq links from <path>      # outgoing links from a file
vq links hubs --limit N   # most-connected nodes
vq links dangling          # links to non-existent files
vq links orphans           # files with no links
vq links clusters          # connected components
vq links walk <path>       # BFS traversal
```

## Ranking and Stats

```bash
vq rank --limit N                # PageRank sorted
vq stats health                  # file/link/orphan counts
vq stats count --by <field>      # group-by aggregation
vq stats tokens                  # token counts
```

## Index Management

```bash
vq index          # incremental refresh
vq index --force  # full rebuild
```

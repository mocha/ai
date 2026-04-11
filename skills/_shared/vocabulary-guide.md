# Vocabulary Extraction Guide

How to extract and organize domain vocabulary for expert prompts. Based on Forge Methodology, Principle 1: Vocabulary Routing.

## Why This Matters

Large language models organize knowledge in clusters within their embedding space. Precise domain terms activate specific, deep knowledge clusters. Generic language activates broad, shallow clusters. The vocabulary IS the routing signal — a single precise term can replace paragraphs of explanation.

## The Process

### Step 1: Term Extraction

Read the input document and list every technical term, named concept, algorithm, pattern, framework, tool, and protocol mentioned. Include terms that are implied but not explicitly named.

### Step 2: Upgrade to Practitioner Grade

For each term, ask: how would a senior practitioner with 15+ years describe this to a peer?

| Document says | Practitioner says |
|---|---|
| "incremental indexing" | "incremental indexing — mtime-based staleness detection, tombstone removal for deleted files" |
| "full-text search" | "FTS5 virtual table — `rank` auxiliary function, column weight boosting via `bm25()`" |
| "handle errors" | "fail-fast with structured error types (sentinel errors, `errors.Is/As` unwrapping)" |
| "parallel processing" | "goroutine fan-out with `errgroup` (x/sync) — bounded concurrency, first-error cancellation" |

The upgrade adds precision that routes to deeper knowledge clusters.

### Step 3: Add Attribution

Where a concept has a known originator, include it. Attribution activates more specific knowledge than the term alone.

- "PageRank" → "PageRank (Page & Brin, 1998)"
- "BM25" → "BM25 (Robertson & Zaragoza)"
- "circuit breaker" → "circuit breaker pattern (Nygard)"
- "bounded context" → "bounded context (Evans, DDD)"

Don't force attribution where it's not natural. Common programming concepts (goroutines, SQL joins) don't need it.

### Step 4: Cluster Organization

Group terms into 3-5 clusters that mirror how experts discuss these topics together. Terms in a cluster should co-occur in expert conversation.

Good clustering (by discourse):
- "System Design" cluster: hexagonal architecture, bounded context, event-driven architecture, CQRS
- "Data Storage" cluster: WAL journal mode, prepared statement cache, composite index design

Bad clustering (by document section):
- "Section 1 terms": [whatever appeared in section 1]
- "Section 2 terms": [whatever appeared in section 2]

### Step 5: Validation

For each term, apply these tests:
1. **15-year practitioner test:** Would a senior practitioner use this exact term with a peer? "Story mapping (Patton)" passes. "Best practices for planning" fails.
2. **No consultant-speak:** Ban "leverage," "best practices," "robust," "synergy," "cutting-edge," "world-class."
3. **No buzzword stacking:** "AI-driven blockchain microservices" creates scatter-shot activation. Each term should point at one knowledge cluster.
4. **No superlatives:** "The most advanced," "state-of-the-art" route to marketing clusters.

Cut anything that fails any test.

## Target Output

3-5 clusters, 15-30 terms total. Each cluster has a name and 4-8 terms with contextual detail.

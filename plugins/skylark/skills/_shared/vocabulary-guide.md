# Vocabulary Guide

How to extract and organize domain vocabulary for expert prompts.

## 5-Step Process

### Step 1: Term Extraction

Read the document or codebase. List every:
- Technical term, named concept, algorithm, pattern
- Framework, tool, protocol, library
- Implied but not explicitly named terms (infer from context)

Cast a wide net — you'll filter in later steps.

### Step 2: Upgrade to Practitioner Grade

For each term, ask: **how would a senior with 15+ years describe this to a peer?**

| Generic | Practitioner-grade |
|---------|-------------------|
| "incremental indexing" | "incremental indexing — mtime-based staleness detection, tombstone removal for deleted files" |
| "full-text search" | "FTS5 virtual table — `rank` auxiliary function, column weight boosting via `bm25()`" |
| "handle errors" | "fail-fast with structured error types (sentinel errors, `errors.Is/As` unwrapping)" |
| "parallel processing" | "goroutine fan-out with `errgroup` (x/sync) — bounded concurrency, first-error cancellation" |
| "database migrations" | "Drizzle Kit `generate` + `migrate` — push-based schema sync, migration journal in `drizzle/`" |

### Step 3: Add Attribution

Include originator where known:
- "PageRank (Page & Brin, 1998)"
- "BM25 (Robertson & Zaragoza)"
- "circuit breaker pattern (Nygard)"
- "bounded context (Evans, DDD)"

Attribution activates more specific knowledge clusters than the term alone.

### Step 4: Cluster Organization

Group into 3-5 clusters that mirror **expert discourse patterns** — terms that would co-occur in an expert conversation about this topic.

**Good clustering (discourse-based):**
- "System Design" cluster: hexagonal architecture, bounded context, event-driven, CQRS
- "Data Integrity" cluster: transaction isolation, optimistic locking, idempotency keys

**Bad clustering (document-based):**
- "Section 1 terms", "Section 2 terms", "Section 3 terms"

Each cluster should have 4-8 terms with contextual detail.

### Step 5: Validation

Apply these tests. Cut anything that fails any test.

**15-year practitioner test:** Would a senior use this exact term with a peer?
- Pass: "Story mapping (Patton)", "connection pooling with PgBouncer"
- Fail: "best practices for planning", "optimize performance"

**No consultant-speak:** Ban these words entirely:
- "leverage", "best practices", "robust", "synergy", "cutting-edge", "world-class", "scalable solution"

**No buzzword stacking:** Each term should activate one specific cluster, not scatter across many:
- Fail: "AI-driven blockchain microservices"

**No superlatives:** Route to marketing clusters, not engineering:
- Fail: "most advanced", "state-of-the-art", "industry-leading"

## Target Output

3-5 clusters, 15-30 terms total. Each cluster: 4-8 terms with contextual detail and attribution where known.

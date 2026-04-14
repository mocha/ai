---
project: research-kb-ui
repo_path: /Users/deuley/code/research-kb-ui
domain: competitive-intelligence
last_updated: 2026-03-24
---

# Project Context

## Domain Summary

Internal intranet knowledge base for IonQ ("IonQ Market Knowledge Base") that aggregates quantum computing industry articles, academic publications, and company profiles into a Wikipedia-style browsable interface. Audience is IonQ staff across product, engineering, R&D, marketing, sales, and GTM. Greenfield project — protocol infrastructure initialized, PM working on first proposal.

## Key Navigation

- **Website concept doc:** `docs/2603240452-Website-concept.md` (transcript of product vision)
- **Example content:** `docs/examples/` (articles, companies, publications — sample data that defines the content model)
- **Proposals:** `docs/proposals/`
- **Projects:** `docs/projects/`
- **Tasks:** `docs/tasks/`

## Architecture Summary

Defined in `docs/2026-03-24-market-knowledge-base-design.md`:

- **Stack:** Next.js (App Router, SSR) + Meilisearch (search index) + GCS (content store) + Cloud Run (deployment)
- **Data flow:** Scraper team → markdown files in GCS → ingest pipeline (parse frontmatter + body) → Meilisearch → Next.js app queries Meilisearch at request time
- **Content types:** Company, Article, Source (PRJ-001); Publication, Author (PRJ-002); Topic pages derived from tags (PRJ-003)
- **Canonical schemas:** Defined in design spec. Flat tags (no prefixes), slug-based IDs for cross-references, no Obsidian wiki-links in canonical format
- **Design:** Wikipedia-style — typography-driven, monochrome, content-first, desktop-first responsive
- **No relational database.** Markdown in GCS is source of truth; Meilisearch is a derived search index
- **Stateless app.** No file system reads at runtime

## Active Work

**PRJ-001** (Company Directory + Industry News Feed) — tasks proposed, awaiting PgM review:
- T-001: Canonical data schemas (no deps)
- T-002: Project scaffolding + app shell (no deps)
- T-003: Ingest pipeline (depends T-001, T-002)
- T-004: Company Directory (depends T-002, T-003)
- T-005: Industry News Feed (depends T-002, T-003)
- T-006: Performance validation (depends T-004, T-005)

**PRJ-002** (Publications + Authors) — approved, blocked by PRJ-001. Not yet decomposed.
**PRJ-003** (Topic Pages + Cross-References + Global Search) — approved, blocked by PRJ-001 + PRJ-002. Not yet decomposed.

## Project-Specific Notes

- Content is scraped/aggregated by a separate team (not this project). This project is the UI/browsing layer.
- Example data in `docs/examples/` uses an older format than canonical schemas (e.g., `source` vs `source_id`, `industry/` tag prefixes, Obsidian `[[wiki-links]]`). Schemas document the differences for the scraper team.
- Some example content (quantum-computing-inc articles) is ~170KB each — includes boilerplate from source site. Scraper quality acknowledged as rough.
- Academic publications store `fulltext.md` + `summary.md` per paper — summaries are LLM-generated.
- Auth is unresolved — build without it, resolve as a deployment-time concern.
- GCS integration deferred — ingest pipeline reads local directory for dev, GCS swapped in at deployment.

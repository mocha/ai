# research-kb-agg — Program Manager Context

## Domain
IonQ Market Knowledge Base — Data Aggregation Layer. This is the backend data pipeline that feeds the research-kb-ui frontend. Responsible for scraping, ingesting, transforming, and serving structured content (industry articles, academic publications, company profiles) for the knowledge base.

## Project Root
`/Users/deuley/code/research-kb-agg/`

## Key Navigation
- `docs/proposals/` — PM proposals
- `docs/projects/` — Project files (PgM creates these)
- `docs/tasks/` — Task files (EM creates these)
- `docs/inbox/program-manager/unread/` — Incoming messages
- `docs/inbox/program-manager/read/` — Processed messages

## Current State
- **PMD-001:** All 3 projects validated (2026-03-25). Awaiting PM business outcome review and proposal status update. Work in 16 task worktrees pending EM merge to main.
- **PMD-002:** All 2 projects validated (2026-03-26). Fully delivered. Awaiting PM proposal close.
- **PRJ-001:** Validated. Core pipeline — 159 tests, 5 sources.
- **PRJ-002:** Validated. Autonomous ops — 44 sources, 447 tests, rate limiting, crash recovery, quality validation, health tracking, reporting.
- **PRJ-003:** Validated. Source extensibility — SourceTypeHandler protocol, 2 source types, 445 tests.
- **PRJ-004:** Validated. Source lifecycle tooling — 68 sources, 60 with tier evals, onboarding CLI, cost/quality metrics, 692 tests. LLM monitoring needs live API key test.
- **PRJ-005:** Validated (after 1 revision). Company enrichment — 47 companies enriched, 0 Zod failures. Confidence threshold added for disambiguation quality.
- **PMD-003:** PRJ-006 validated (2026-03-26). Fully delivered. Awaiting PM proposal close.
- **PRJ-006:** Validated. arXiv academic-paper handler, Paper + Person schemas, quant-ph + cs.ET categories, 62 tests. UI coordination pending (Paper/Person are new types).
- **Notable:** defuddle extraction tier non-functional (trafilatura effective default). 8 sources excluded (5 need html-crawl, 3 Cloudflare 403).
- **Relationship to research-kb-ui:** Data layer consumer. UI expects structured data conforming to PMD-001 schemas.
- **PM decisions:** Company stubs are auto-generated (enrichment is PRJ-005). Industry publications: Quantum Zeitgeist, QCR. Enrichment source: Wikipedia primary.

## Product Vision (derived from research-kb-ui context)

The aggregation layer must supply data for five content types:
1. **Company profiles** — Structured metadata, QPU info, publications, blog posts, external mentions
2. **Industry articles** — Scraped from ~10+ competitor/industry blogs, cleaned and tagged
3. **Academic papers** — From journals (arXiv etc.), with LLM-generated summaries and author tracking
4. **Topic aggregations** — Cross-referenced content grouped by topic
5. **Full-text search corpus** — Cached article text for search (potentially 20-40K articles)

Content is from external sources (blogs, journals, public company info). Summaries and tagging are LLM-generated. Articles link to original sources — full text cached for search only.

## Architecture Notes
- No tech stack decided yet
- research-kb-ui used markdown with YAML frontmatter for prototype/example data
- Article source metadata includes scraping recipes (strategy, URLs, health indicators)
- Deployment target: internal hub/intranet

## Authority Scope

### ALLOWED (within PgM authority)
- Decompose PM proposals into sequenced, sized projects with acceptance criteria
- Review EM task proposals for coverage against project criteria
- Validate completed projects against acceptance criteria
- Manage project dependency ordering and sequencing
- Refine acceptance criteria with business context the EM would not have
- Ensure data contracts align with what research-kb-ui expects

### ESCALATE (always requires human or adjacent agent)
- Tech stack selection and architecture decisions → EM / Patrick
- Scraper design and crawling strategy → Patrick
- Data pipeline architecture (batch vs streaming, storage, caching) → EM / Patrick
- LLM integration decisions (which models, prompt design, cost) → Patrick
- Content source selection (which blogs, journals, feeds to include) → PM / Patrick
- API design and data contract decisions → EM / Patrick
- Security model and access control → Patrick
- Deployment infrastructure choices → EM / Patrick
- Any scope expansion beyond what's in the approved proposal

## Escalation Contacts
- Patrick Deuley: Product owner, architecture, engineering, content strategy, all decision authority for this project

## Cross-Project Dependencies
- **research-kb-ui:** The primary consumer of this project's output. Data schemas and API contracts must align with what the UI expects. The UI's PMD-001 work defined example data structures that inform the expected shape of aggregated data.
- Scraper team schema adoption was noted as an open risk in research-kb-ui context — this project likely addresses that gap.

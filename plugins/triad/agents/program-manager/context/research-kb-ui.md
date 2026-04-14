# research-kb-ui — Program Manager Context

## Domain
IonQ Market Knowledge Base — an internal intranet site that aggregates industry articles, academic publications, and company profiles into a Wikipedia-style browsable interface. Audience is IonQ staff across product, engineering, R&D, marketing, sales/GTM. Internal-only, not customer-facing.

## Project Root
`/Users/deuley/code/research-kb-ui/`

## Key Navigation
- `docs/2603240452-Website-concept.md` — Patrick's vision document (transcript-style, comprehensive)
- `docs/examples/` — Prototype data: 33 articles (3 companies), 5 company profiles, 10 publication files (5 papers)
- `docs/proposals/` — PM proposals (empty, awaiting first proposal)
- `docs/projects/` — Project files (empty, PgM creates these)
- `docs/tasks/` — Task files (empty, EM creates these)
- `docs/inbox/program-manager/unread/` — Incoming messages
- `docs/inbox/program-manager/read/` — Processed messages

## Current State
- **Phase:** PMD-001 feature-complete. All 3 projects validated (PRJ-001, PRJ-002, PRJ-003). 15 tasks, 407 tests, production build green. Sent to PM for business outcome validation.
- **Remaining before ship:** Live infrastructure verification (Docker, Cloud Run, Lighthouse FCP), auth resolution, scraper team schema adoption + Author object production.
- **Open risks:** Auth approach still unresolved (deployment blocker). Scraper team needs to adopt canonical schemas and produce Author objects. FCP <500ms unverified against live infrastructure.

## Product Vision (from concept doc)

Five navigation paradigms:
1. **Company Index** — Searchable/browsable company list → Wikipedia-style profile pages with nutrition-facts card, QPUs, publications, blog posts, external mentions
2. **Industry News Aggregator** — Chronological feed from ~10+ industry/competitor blogs. Cleaned titles, 2-sentence descriptions, date/author/tags. Full-text search across cached article corpus (potentially 20-40K articles).
3. **Topic Pages** — Wikipedia-style pages per topic (e.g., "quantum chemistry") aggregating company articles, industry posts, and academic papers with cross-references
4. **Academic Paper Aggregator** — Feed of papers from journals (arXiv etc.), LLM-generated executive summaries, author tracking, timeline view, search
5. **Global Search** — Phrase search across all content types

**Key UX goals:** Wikipedia-like usability (high-performance reference tool), excellent mobile support, accessible design, clean navigation. Not flashy — functional. Cross-referenced hypertext enabling organic discovery ("Wikipedia rabbit holes").

**Content model:** Articles link out to original source (no reproduction). Full text cached for search only. Summaries and tagging are LLM-generated. Company profiles are Wikipedia-style markdown.

## Architecture Notes
- No tech stack decided yet — no source code exists
- Example data uses markdown with YAML frontmatter for structured metadata
- Article source metadata includes scraping recipes (strategy, URLs, health indicators)
- Content is entirely from external sources (blogs, journals, public company info)
- Deployment target: internal hub/intranet

## Authority Scope

### ALLOWED (within PgM authority)
- Decompose PM proposals into sequenced, sized projects with acceptance criteria
- Review EM task proposals for coverage against project criteria
- Validate completed projects against acceptance criteria
- Manage project dependency ordering and sequencing
- Refine acceptance criteria with business context the EM would not have

### ESCALATE (always requires human or adjacent agent)
- Tech stack selection and architecture decisions → EM / Patrick
- UX design decisions (navigation patterns, layout, mobile approach) → Patrick
- Content strategy (what sources to include, tagging taxonomy) → PM / Patrick
- Scraper design and data pipeline decisions → Patrick
- Security model (who gets access, authentication) → Patrick
- Deployment infrastructure choices → EM / Patrick
- Any scope expansion beyond what's in the approved proposal

## Escalation Contacts
- Patrick Deuley: Product owner, architecture, engineering, content strategy, all decision authority for this project

## Cross-Project Notes
- No dependencies on other active projects (dogproj, dogproj-app)
- The scraper/data pipeline is a separate concern from the UI — proposals may or may not address both. If a proposal covers only the UI, do not add scraper work to the project plan unless the PM explicitly includes it.

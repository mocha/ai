---
project: research-kb-agg
repo_path: /Users/deuley/code/research-kb-agg
domain: competitive-intelligence
last_updated: 2026-03-24
---

# Project Context

## Domain Summary

Data aggregation layer for the IonQ Market Knowledge Base. This is the scraping, processing, and delivery pipeline — the upstream data source that feeds the UI layer (research-kb-ui). Responsible for collecting quantum computing industry articles, academic publications, and company profiles, then structuring and delivering them for consumption.

Greenfield project — protocol infrastructure just initialized (`docs/inbox/`, `docs/proposals/`, `docs/projects/`, `docs/tasks/`). No git repo initialized yet. PM and PgM are working upstream on proposals and projects.

## Key Navigation

- **Proposals:** `docs/proposals/`
- **Projects:** `docs/projects/`
- **Tasks:** `docs/tasks/`

## Architecture Summary

Python pipeline (batch process). Source configs are YAML files in `configs/sources/`. Pipeline stages: discovery (sitemap/RSS) → fetch (trafilatura → defuddle → html2text) → normalize (to UI Zod schemas) → storage (abstracted backend, local filesystem for now).

Output contract: markdown files with YAML frontmatter matching research-kb-ui Zod schemas:
- `articles/<source-id>/<date>-<slug>.md` (Article schema)
- `sources/<id>.md` (Source schema)
- `companies/<id>.md` (Company schema — minimal stubs)

Key deps: Python 3.11+, Pydantic v2, httpx, trafilatura, html2text, PyYAML

## Active Work

**PRJ-001** (Core Collection Pipeline) — tasks proposed, awaiting PgM review:
- T-001: Project scaffolding + source config schema (no deps)
- T-002: Discovery engine — sitemap + RSS (depends T-001)
- T-003: Content fetcher with tiered fallback (depends T-001)
- T-004: Output normalizer to UI schema (depends T-001)
- T-005: Abstracted storage layer (depends T-001)
- T-006: Pipeline orchestrator + CLI (depends T-002, T-003, T-004, T-005)
- T-007: Five-source end-to-end validation (depends T-006)

T-002 through T-005 can run in parallel once T-001 completes.

**PRJ-002** (Autonomous Operations, Resilience & Content Quality) — approved, blocked on PRJ-001. Received project-ready message. Task decomposition deferred until PRJ-001 completes. Key themes: scheduled execution, adaptive rate limiting, circuit breaker, crash-safe state, content quality validation (inline + auditing), 40-source demo. PM's top concern is content quality.

**PRJ-003** (Source Extensibility Framework) — approved, blocked on PRJ-001 (but NOT PRJ-002 — can parallelize). Received project-ready message. Task decomposition deferred. Key theme: generalize pipeline from blog-specific to multi-source-type. PM prefers industry publications as second source type.

## Relationship to research-kb-ui

- research-kb-agg (this project) produces structured content
- research-kb-ui consumes it via ingest pipeline from GCS/local directory
- Canonical schemas are defined in the UI project's design spec — this project must produce content conforming to those schemas

## Project-Specific Notes

- No git repo initialized yet — T-001 will initialize it
- Prototype at `/Users/deuley/vault/research-kb` has ~3,400 LOC Python, ~81 source configs. Source URLs/strategies are the primary asset; format needs conversion to standalone YAML.
- Prototype uses LLM agents for discovery — we're replacing with direct HTTP + XML parsing
- Prototype fetch tiers (trafilatura → defuddle → raw → crawl4ai) map well; we omit crawl4ai (PRJ-002)
- Company stubs are auto-generated with placeholder values (founded: 0, hq: "Unknown") per PM guidance
- Adaptive rate limiting and crash-safe resume are PRJ-002 scope

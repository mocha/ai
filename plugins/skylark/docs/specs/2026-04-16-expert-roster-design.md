# Expert Roster System

Pre-built, reusable expert definitions for Skylark's vocabulary-routed review pipeline.

## Problem

Skylark generates expert reviewers from scratch on every panel review. This has two costs:

1. **No exemplars.** The generator works from rules alone (vocabulary-guide.md, expert-prompt-generator.md) with no finished examples to pattern-match against. Output quality depends entirely on how well the model interprets the methodology in the moment.

2. **No reuse.** A project running 6 panel reviews across its lifecycle generates ~18 experts, many sharing the same domain. Each is discarded after use.

Forge (the research project these principles come from) solves both: a curated library of expert definitions with quality lifecycle tracking, and a mission planner that checks the library before generating new experts.

## Design

### Component 1: Expert Exemplars (`_shared/expert-exemplars.md`)

3-4 complete expert definitions pulled from the Forge library, trimmed to the three sections Skylark actually generates:

- **Identity** (<50 tokens, real job title, responsibility, authority boundary)
- **Vocabulary** (3-5 clusters, 15-30 terms, practitioner-tested with attribution)
- **Anti-patterns** (5-10 named failure modes with detection + resolution)

Purpose: the generator references these as concrete examples of what a finished vocabulary payload looks like. Rules + exemplars > rules alone.

**Selected exemplars** (chosen for domain diversity):
- Software Architect (software/systems — Forge `curated`)
- QA Engineer (software/testing — Forge `curated`)
- Lead Auditor (security — Forge `curated`)
- Campaign Strategist (marketing — Forge `curated`, shows the methodology works outside engineering)

Sections not relevant to Skylark (Deliverables, Decision Authority, SOP, Interaction Model) are omitted. These are Forge team-coordination concerns.

### Component 2: Expert Roster (`_shared/expert-roster.json`)

A JSON file containing ~17 pre-built `general-` expert roles covering common tech company review perspectives. Each entry carries the fields the generator needs:

```json
{
  "role": "general-database-engineer",
  "identity": "<50 token identity statement>",
  "vocabulary": {
    "Cluster Name": ["term1 (attribution)", "term2", "..."]
  },
  "anti_patterns": [
    { "name": "...", "detection": "...", "resolution": "..." }
  ],
  "tags": ["database", "sql", "schema", "migration", "indexing"]
}
```

**Naming convention:** All roster entries use `general-` prefix. Tech-specific variants (e.g., `database-engineer-postgres`, `frontend-engineer-react`) can be added later by projects or by saving a generated expert back to the roster.

**Roster roles (17):**

High-frequency panel members:
- `general-software-architect` — system design, boundaries, trade-offs
- `general-backend-engineer` — server-side implementation, APIs, data flow
- `general-frontend-engineer` — UI implementation, state management, rendering
- `general-qa-engineer` — test strategy, coverage, edge cases
- `general-security-engineer` — code-level security, input validation, auth
- `general-database-engineer` — schema design, query patterns, migrations
- `general-devops-engineer` — CI/CD, infrastructure, deployment
- `general-sre` — reliability, observability, incident response

Domain specialists:
- `general-performance-engineer` — profiling, optimization, load testing
- `general-accessibility-engineer` — WCAG, keyboard nav, screen readers
- `general-api-design-engineer` — API ergonomics, versioning, contracts
- `general-data-engineer` — pipelines, ETL, data modeling
- `general-ml-engineer` — model integration, feature engineering, inference
- `general-mobile-engineer` — mobile platforms, offline, app lifecycle
- `general-infrastructure-engineer` — cloud architecture, networking, scaling

Non-engineering perspectives:
- `general-product-manager` — requirements, user impact, scope
- `general-technical-writer` — documentation clarity, developer experience

### Component 3: Generator Update (`_shared/expert-prompt-generator.md`)

Add a new step between current Step 1 (Analyze Subject Matter) and Step 2 (Draft Role Identity):

**New Step: Check Roster**

1. After analyzing the subject matter, identify what expert perspective is needed
2. Check `expert-roster.json` for a matching role:
   - First check for a tech-specific variant (e.g., `database-engineer-postgres`) by tag match
   - Then check for a `general-` variant (e.g., `general-database-engineer`)
3. If match found: **load and adapt** — use the roster entry's identity, vocabulary, and anti-patterns as a starting point, then specialize vocabulary to the specific project context (add project-specific terms, upgrade generic terms to match the actual tech stack)
4. If no match: **generate fresh** per existing methodology

Also add a reference to `expert-exemplars.md`: after "Follow the process in vocabulary-guide.md", add "See expert-exemplars.md for complete examples of finished expert prompts."

### What This Does NOT Do

- Replace the generator — roster entries are starting points, not final prompts
- Cache project-specific experts — that's a future enhancement (save generated experts back to the roster after use)
- Remove the ability to generate from scratch — no-match falls through to current behavior
- Change the prompt template structure — roster entries map 1:1 to the existing template sections

## Sources

- Forge library: `/Users/deuley/code/tools/forge/library/agents/` (11 curated experts)
- Forge methodology: `/Users/deuley/code/tools/forge/METHODOLOGY.md` (vocabulary routing principles)
- Skylark generator: `skills/_shared/expert-prompt-generator.md`, `vocabulary-guide.md`, `prompt-template.md`

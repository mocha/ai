---
name: prepare
description: Internal pipeline stage that enriches an input with execution context. Hunts architecture and code references, builds a vocabulary payload, sharpens acceptance criteria, and verifies dependency relations. Produces a prepared spec or enriched artifact ready for development or review. Called by implement — not user-invocable.
---

# Prepare

Enrich an input with the context needed for effective development. This stage bridges the gap between "what the input says" and "what the developer needs to know."

## When Called

Called by `/skylark:implement` for standard+ risk work. Receives the triage classification and the raw input.

## Process

### Step 1: Read Existing Context

Read all available context for the work:

**If an existing artifact was found by triage:**
1. Read the artifact fully (spec, plan, task, or raw notes)
2. Read its provenance chain — follow `parent` links up to the original input
3. Read any related artifacts (siblings, dependents) found during prior art search
4. Check the artifact's changelog for prior pipeline activity

**If starting from raw input or external reference:**
1. Read the input file or description
2. Search `docs/specs/`, `docs/plans/` for related work, and check beads (`bd search "<keywords>" --json`) for related tasks
3. Search `git log` for related commits

### Step 2: Assess Scope

Classify domain clusters touched by this work. Common clusters include:
- `database` — items like: schema definitions, table relations, ORM models, migrations, seed data, query builders, connection pooling, indexing strategies
- `api` — items like: route handlers, middleware, request validation, response serialization, error responses, API versioning, rate limiting, service boundaries
- `auth` — items like: identity providers, session management, access control, role-based permissions, token handling, OAuth flows, multi-tenancy scoping, API key management
- `events` — items like: event contracts, message queues, worker handlers, pub/sub, dead letter queues, retry policies, idempotency, event sourcing
- `ui` — items like: page components, routing, state management, form handling, data fetching, responsive layout, accessibility, client-side validation
- `infra` — items like: deployment configuration, secrets management, environment variables, CI/CD pipelines, container orchestration, monitoring, logging, cloud service integration

Identify which clusters apply by reading the input, referenced code, and the project's CLAUDE.md. The clusters above are starting points — adapt or extend them based on what the project actually uses.

If 3+ clusters are touched, flag for potential decomposition (return to triage).

### Step 3: Hunt References

Collect pointers to relevant context. Read each reference to verify it exists and is current.

**Architecture references:**
- Search `docs/architecture/` for ADRs relevant to this work — prior decisions that constrain or inform the approach
- Search `docs/strategy/` for design principles, JTBD, and user stories that provide context
- Search the project's docs or architecture directory for relevant specs, data objects, events
- Trace YAML frontmatter relationships to find connected components

**Code references:**
- Identify entry point(s) — the first file a developer should read
- Find existing patterns — similar features already implemented
- Find test files — existing test patterns for this area

**Git history:**
- Recent commits touching the same files/directories
- Related artifacts referenced in commit messages

### Step 4: Build Vocabulary Payload

Following `_shared/vocabulary-guide.md`, extract 10-20 domain terms from:
- Domain clusters identified in Step 2
- Architecture specs referenced in Step 3
- Project CLAUDE.md conventions
- Code patterns found in the codebase

Apply the 15-year practitioner test to every term. Group into 3-5 clusters.

### Step 5: Sharpen Acceptance Criteria

Review the input's ACs against the anti-pattern watchlist:

| Anti-Pattern | Signal | Fix |
|-------------|--------|-----|
| **Scope Fog** | Vague ACs like "handle errors appropriately" | Sharpen to measurable: "return 422 with validation errors in RFC 7807 format" |
| **Hidden Hydra** | Touches 3+ bounded contexts | Decompose into child artifacts with dependency relations |
| **Phantom Dependency** | References code that doesn't exist yet | Add explicit dependency to the artifact that creates it |
| **Gold Plating** | "Nice to have" mixed with requirements | Split into separate artifact |
| **Missing Entry Point** | No clear starting file | Add "Start here: `path/to/file.ts:functionName`" |

### Step 6: Produce Prepared Artifact

**For standard risk (no spec file needed):**
Create or update an artifact with:
- Sharpened ACs
- Domain clusters
- Key references (architecture specs, code entry points)
- Vocabulary payload (as a section at the end)

**For elevated+ risk (spec file needed):**
Allocate the next `SPEC-NNN` ID per `_shared/artifact-conventions.md` and create `docs/specs/SPEC-NNN-<slug>.md` with frontmatter:
- Context and user story
- Sharpened ACs
- Architecture references
- Design decisions and constraints
- Out of scope
- Vocabulary payload
- References and entry points
- Changelog section with creation event

If the work references an external tracker, include it in `external_ref` frontmatter.

### Step 7: Update Artifact Changelog

Append a changelog entry to the artifact per `_shared/artifact-conventions.md`:
```
- **YYYY-MM-DD HH:MM** — [PREPARE] Enriched with N references, N vocabulary terms. Domains: [clusters]. Entry point: [path].
```

### Step 8: Return to Implement

Report:
- Risk level (confirm or recommend escalation if scope grew)
- Artifact ID and path (if created or updated)
- Key references for downstream stages
- Any decomposition recommendations

---
name: prepare
description: Internal pipeline stage that enriches an issue or raw input with execution context. Pulls Linear metadata, hunts architecture and code references, builds a vocabulary payload, sharpens acceptance criteria, and verifies blocking relations. Produces a prepared spec or enriched issue ready for development or review. Called by implement — not user-invocable.
---

# Prepare

Enrich an issue or raw input with the context needed for effective development. This stage bridges the gap between "what the issue says" and "what the developer needs to know."

## When Called

Called by `/skylark:implement` for standard+ risk work. Receives the triage classification and the raw input.

## Process

### Step 1: Ingest from Linear

If a Linear issue exists:
1. Read the full issue: title, description, ACs, labels, project, priority
2. Read comments for additional context or decisions
3. Read blocking/blocked-by relations
4. Read parent/child issue relationships

### Step 2: Assess Scope

Classify domain clusters touched by this work. Common clusters include:
- `database` — items like: schema definitions, table relations, ORM models, migrations, seed data, query builders, connection pooling, indexing strategies
- `api` — items like: route handlers, middleware, request validation, response serialization, error responses, API versioning, rate limiting, service boundaries
- `auth` — items like: identity providers, session management, access control, role-based permissions, token handling, OAuth flows, multi-tenancy scoping, API key management
- `events` — items like: event contracts, message queues, worker handlers, pub/sub, dead letter queues, retry policies, idempotency, event sourcing
- `ui` — items like: page components, routing, state management, form handling, data fetching, responsive layout, accessibility, client-side validation
- `infra` — items like: deployment configuration, secrets management, environment variables, CI/CD pipelines, container orchestration, monitoring, logging, cloud service integration

Identify which clusters apply by reading the issue description, referenced code, and the project's CLAUDE.md. The clusters above are starting points — adapt or extend them based on what the project actually uses.

If 3+ clusters are touched, flag for potential decomposition (return to triage).

### Step 3: Hunt References

Collect pointers to relevant context. Read each reference to verify it exists and is current.

**Architecture references:**
- Search the project's architecture docs directory for relevant service specs, data objects, events
- Trace YAML frontmatter relationships to find connected components

**Code references:**
- Identify entry point(s) — the first file a developer should read
- Find existing patterns — similar features already implemented
- Find test files — existing test patterns for this area

**Git history:**
- Recent commits touching the same files/directories
- Related issues referenced in commit messages

### Step 4: Build Vocabulary Payload

Following `_shared/vocabulary-guide.md`, extract 10-20 domain terms from:
- Domain clusters identified in Step 2
- Architecture specs referenced in Step 3
- Sub-repo CLAUDE.md conventions
- Code patterns found in the codebase

Apply the 15-year practitioner test to every term. Group into 3-5 clusters.

### Step 5: Sharpen Acceptance Criteria

Review the issue's ACs against the anti-pattern watchlist:

| Anti-Pattern | Signal | Fix |
|-------------|--------|-----|
| **Scope Fog** | Vague ACs like "handle errors appropriately" | Sharpen to measurable: "return 422 with validation errors in RFC 7807 format" |
| **Hidden Hydra** | Touches 3+ bounded contexts | Decompose into child issues with blocking relations |
| **Phantom Dependency** | References code that doesn't exist yet | Add explicit blocking relation to the issue that creates it |
| **Gold Plating** | "Nice to have" mixed with requirements | Split into separate issue |
| **Missing Entry Point** | No clear starting file | Add "Start here: `path/to/file.ts:functionName`" |

### Step 6: Produce Prepared Artifact

**For standard risk (no spec file needed):**
Update the Linear issue description with:
- Sharpened ACs
- Domain clusters
- Key references (architecture specs, code entry points)
- Vocabulary payload (as a section at the end)

**For elevated+ risk (spec file needed):**
Create `docs/specs/YYYY-MM-DD-<slug>.md` with frontmatter per `_shared/artifact-conventions.md`:
- Context and user story
- Sharpened ACs
- Architecture references
- Design decisions and constraints
- Out of scope
- Vocabulary payload
- References and entry points

### Step 7: Update Linear

- Verify blocking relations are correct (add any discovered in Step 3)
- Post event comment per `linear/SKILL.md` conventions:
  ```
  [PREPARE] Enriched with N references, N vocabulary terms.
  Domains: [clusters]. Entry point: [path].
  Spec: [path if created]
  ```

### Step 8: Return to Implement

Report:
- Risk level (confirm or recommend escalation if scope grew)
- Spec path (if created)
- Key references for downstream stages
- Any decomposition recommendations

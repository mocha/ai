# Knowledge Graph Pipeline

A spec for the automation layer beneath the vault. The vault doesn't change. This adds plumbing that makes it healthier, more self-maintaining, and more resilient as it grows.

**Status:** Draft
**Date:** 2026-04-11
**Author:** Patrick Deuley + Claude

---

## Lineage

This design draws from three sources:

- **Getting Things Done (Allen, 2001)** — Universal capture, trusted external system, the five-stage workflow (capture, clarify, organize, reflect, engage). GTD for the information age was "get it out of your head." GTD for the agentic age is "get it into a structure agents can reason over."
- **The Phoenix Architecture (AI Coding, 2026)** — Redundancy across independent representations at every layer catches what any single tool misses. Diversity at each phase is the mechanism. The system absorbs change without requiring you to place a bet.
- **Forge Methodology (Deuley, 2026)** — Vocabulary routing, progressive disclosure, structured artifacts, named failure modes, cascade pattern. Research-backed principles for building agents that operate within rich knowledge environments.

---

## Principles

1. **Small files, rich connections.** ~1000 tokens per file. Relationships in frontmatter. Wiki-links as connective tissue. The value is in the graph, not the nodes.
2. **Domain-scoped taxonomies.** Each domain grows its own vocabulary naturally. Cross-domain connections are light hypertext links, not shared hierarchies. Universal taxonomy is impossible and shouldn't be pursued.
3. **Graceful decay over enforced maintenance.** Unused content withers naturally. The system never creates obligations. Freshness comes from new inputs, not gardening old ones.
4. **Redundancy is a feature.** Multiple independent sources covering the same fact reinforce confidence, surface contradictions, and provide richer analysis. More inputs make the graph more resilient, not noisier.
5. **Agents are the interface; humans are the operators.** The complexity lives in the graph. Agents navigate it. Humans talk to agents in natural language. The graph is invisible to anyone who isn't building it.
6. **Typed boundaries, organic interiors.** Layers have strict interface contracts at their edges. Inside each layer, structure is free to evolve. You can rebuild any layer's internals without touching its neighbors.
7. **Cost of participation must never exceed value of retrieval.** If the system is harder to feed than it is useful to query, it's dying. This is the only health metric that matters.
8. **Templates are the schema.** The structure of canonical data is encoded in templates. A template IS the contract for what a graphed object looks like. The act of structuring through a template transforms a note into a composable node in the graph.
9. **Agent ergonomics drive performance.** The system is designed for agent consumption first. File sizes, frontmatter schemas, llms.txt wayfinding, domain scoping — all exist because they make agents dramatically more effective. When you design storage and retrieval around context window efficiency, you get better outcomes without changing anything about the agents.
10. **The content is the vocabulary; the vocabulary compounds.** Well-structured content procedurally generates the routing signal that activates expert reasoning. As a domain accumulates more graphed objects, agents loading that domain activate richer knowledge clusters automatically. Each new fact reinforces the existing ones. The collective signal is stronger than the sum of its parts.
11. **Named failure modes at every layer.** Each layer declares what "broken" looks like. If you name the failures, you can detect them. If you don't, degradation is invisible until the whole thing feels wrong and you walk away.
12. **Start simple, escalate.** Don't add a taxonomy until the content demands it. Don't formalize a template until you've seen the pattern ten times. Don't add a layer until the current structure demonstrably fails.

---

## The Pipeline

Four conceptual layers describe how information flows from raw input to the graph. But architecturally, there is no separate "pipeline infrastructure." The pipeline is run by gardeners — scheduled agents that each own one step. The same mechanism (scheduled jobs, worktrees, PRs) handles both new-input processing and graph maintenance.

### Layer 0: The World

Things happen. Meetings occur. Articles get published. Colleagues write memos. Code gets shipped. Data gets generated. This is outside the system.

### Layer 1: The Inbox

The Obsidian vault itself. Files land here with zero friction and zero schema. Notes, pasted content, synced docs, URLs, PDFs, screenshots — whatever. The only contract between Layer 0 and Layer 1 is: **if you can save a file, you've captured it.**

No classification. No metadata. No routing. Just capture.

### Layer 2: Categorization

**Job:** Find new or changed files. Parse them. Apply frontmatter that routes them to the right decomposition pipeline. Handled by **The Classifier** gardener.

**What it produces:**

```yaml
categorized_at: 2026-04-11T09:30:00
categorized_as: <pipeline-type>
source_origin: internal | external
domains: [platform-deployments, hpc-integration]
entities: ["[[Edge Appliance]]", "[[Quantum Basel]]"]
categorization_confidence: high | medium | low
```

**Pipeline types** (each routes to an independent decomposition pipeline):

| Type | What it covers |
|---|---|
| `personal-notes` | Meeting notes, braindumps, dictated thoughts, standups |
| `customer-notes` | Customer meeting notes, sales calls, support interactions |
| `customer-profile` | CRM exports, account summaries, org charts |
| `project-proposal` | Proposals, PRDs, program overviews, initiative briefs |
| `article` | News articles, blog posts, press releases |
| `publication` | Research papers, whitepapers, technical reports |
| `presentation` | Decks, slide exports, talk transcripts |
| `codebase-review` | Investigation reports, code analysis, architecture docs |
| `internal-document` | Memos, reports, design docs, strategy documents |

This is the starter set. Types grow as new content patterns emerge. Each type represents an independent pipeline — add a type when content can't be processed well by an existing pipeline.

**Contract with Layer 3:** Decomposition receives a file with `categorized_as` present. If `categorization_confidence` is `low`, decomposition flags for human review rather than proceeding.

Files that arrive with sufficient frontmatter (synced Google Docs, research pipeline outputs) fast-path through categorization.

**Failure modes:**
- **Over-categorization** — trying to do decomposition's job at this layer, adding friction
- **Misroute** — wrong type sends content through the wrong pipeline
- **Capture abandonment** — system is too many steps from "I have a thing" to "the thing is in"

### Layer 3: Decomposition

**Job:** Take categorized content and break it into claims — atomic bits of knowledge that can be processed against the graph. Each pipeline type has its own decomposition strategy, but all pipelines produce claims. Handled by **The Decomposer(s)** — one per pipeline type.

**What comes in:** A categorized file.

**What comes out — Claims:**

```yaml
type: Claim
source_file: "[[2026-04-10 - Customer Meeting - Quantum Basel]]"
claimed_at: 2026-04-10T21:30:00
claim_type: entity-update | new-entity | relationship | requirement | event | signal
target_entity: "[[Quantum Basel]]"
target_type: company | project | feature | service | person | event | concept
domain: platform-deployments
content: |
  Quantum Basel confirmed they need airgapped deployment capability
  by Q3. Their CISO requires SCIF-level isolation for all quantum
  workloads. This is a hard requirement for the contract renewal.
```

Claims are persistent. They live as a provenance trail — when something in the graph seems wrong, you trace it back through the claim to the source file. Old claims don't get cleaned up. They wither (principle 3).

Each pipeline is a skill or agent chain tuned for its content type. The `personal-notes` pipeline looks for action items, decisions, entities. The `article` pipeline looks for claims, events, competitive signals. The `publication` pipeline extracts findings, methods, and citations.

**Contract with Layer 4:** A claim always has `target_entity`, `target_type`, `claimed_at`, and `content`. Everything else is enrichment.

**Failure modes:**
- **Claim inflation** — producing dozens of trivial claims from simple content
- **Lossy decomposition** — dropping nuance that was in the original (mitigated by `source_file` traceability)
- **Entity hallucination** — inventing entity references that don't match anything real

### Layer 4: Graphing

**Job:** Take claims and reconcile them against the existing graph. Create new graphed objects, update existing ones, surface contradictions. Handled by **The Grapher** gardener.

**What comes in:** Claims.

**What comes out:** Created or modified graphed objects — markdown files with full frontmatter, filed in the appropriate domain directory, connected to the graph via wiki-links.

**The four operations:**

1. **Create** — The `target_entity` doesn't exist. A new file is created from the appropriate template, populated with the claim, and filed. A dangling wiki-link becomes a real node.
2. **Update** — The entity exists. The claim adds new information. Newer claims take precedence. The graphed object gets enriched.
3. **Conflict** — The claim contradicts existing knowledge. Soft conflicts (field value changed) auto-resolve by recency. Hard conflicts (fundamental disagreement) get flagged for human review.
4. **Deduplicate** — The claim asserts something already captured. Reinforce the existing fact (add provenance, bump freshness). Redundancy makes the graph more trustworthy.

**Templates are the schema.** When graphing creates a new company profile, it uses the Company template. The template defines what fields exist. The template IS the API for that object type.

**Graphed object types** (existing in the vault today):

| Type | Template | Primary location |
|---|---|---|
| Company | Company Template | `research-kb/general/companies/` |
| Project | Project Template | `product-kb/projects/` |
| Assignment | Assignment Template | `projects-kb/planning/assignments/` |
| Person | Person Template | `projects-kb/teams/people/` |
| Feature | Feature Template | `product-kb/current-state/` |
| Publication | (convention) | `research-kb/general/publications/` |
| Service | Service Template | `eng-kb/` by domain |
| Event | Event Template | `research-kb/comp_intel/` |
| Strategy Object | various | `product-kb/strategy/` |

New types emerge when patterns repeat. Formalize a template after seeing the pattern ten times (principle 12).

**Contract:** A graphed object has valid frontmatter conforming to its template, at least one wiki-link to another graphed object, and a `last_updated` timestamp.

**Failure modes:**
- **Orphan creation** — new objects with no connections. Islands in the graph.
- **Merge cowardice** — flagging everything for human review instead of auto-resolving soft conflicts.
- **Stale override** — older claims overwriting newer information.

---

## The Gardeners

Scheduled agents that run periodically against the vault. Each gardener runs as an autonomous job, works in a git worktree, and creates a PR with batched changes from each run. Some gardeners run the pipeline (processing new inputs). Others maintain the health of the existing graph. Same mechanism, same scheduling, same operational model.

**Default posture: propose, don't act.** Gardeners produce PRs, not direct edits. A human reviews and merges. Over time, low-risk gardeners (The Connector, The Organizer) can graduate to auto-merge.

### Pipeline gardeners

These run the intake-to-graph pipeline described above.

| Gardener | Watches for | Action |
|---|---|---|
| **The Classifier** | New or changed files lacking categorization frontmatter | Applies frontmatter and routes to the right decomposer |
| **The Decomposer(s)** | Freshly categorized content (one per pipeline type) | Breaks content into claims based on category-specific rules |
| **The Grapher** | Freshly created claims | Reconciles claims against the existing graph — create, update, conflict, deduplicate |

### Maintenance gardeners

These keep the graph healthy over time.

| Gardener | Watches for | Action |
|---|---|---|
| **The Connector** | Implicit relationships in prose not expressed in structure — mentions of entities, missing tags, unlinked references | Propose wiki-links, tags, cross-references. Highest-value gardener. Candidate for early auto-merge. |
| **The Organizer** | Misplaced files, messy directory structures | Moves files into clearer directory structures |
| **The Splitter** | Files past ~1000 tokens or covering multiple distinct concepts | Propose decomposition into smaller files |
| **The Staleness Monitor** | Objects not reinforced by new claims in a long time, especially in active domains | Flag for review, recommend refresh research |
| **The Contradiction Detector** | Claims or objects that conflict with each other | Surface conflict with evidence from both sides |
| **The Gap Detector** | Dangling wiki-links, thin domain coverage, frequently-referenced but never-graphed entities | Propose research targets |
| **The Change Monitor** | Files modified outside the pipeline (human edits) | Determine if re-categorization and re-processing is warranted |
| **The Link Auditor** | Broken wiki-links, orphaned objects, disconnected clusters | Propose connections, flag dead nodes |
| **The Conformance Auditor** | Objects predating current template version, missing fields that affect query reliability | Propose updates — only when it matters, not for cosmetic drift |
| **The Provenance Auditor** | Objects with no claim trail, claims with deleted source files | Flag trust degradation |

---

## Structural Implication: KB Merge

This pipeline treats all knowledge as one graph. External research facts and internal product facts get categorized, decomposed, and graphed the same way. The current separation of `research-kb` and `product-kb` into independent repositories creates an artificial boundary that the pipeline ignores.

**Decision:** Merge `research-kb` and `product-kb` back into a single KB. The boundary between "what the market is doing" and "what we're building" should be a domain tag on graphed objects, not a repository boundary.

This merge is desirable but not a prerequisite. The pipeline can start against `product-kb` alone — that's where the highest-value internal content lives. The merge happens when the pipeline is stable enough to handle both, or when cross-KB analysis becomes a bottleneck.

---

## Scope Boundaries

**In scope:** The gardener system (13 gardeners — 3 pipeline, 10 maintenance) running against `product-kb`.

**Out of scope (future work):**
- **The execution cycle** — proposals decomposed into tasks, agent dispatch, autonomous code generation. This is the Triad v2 work. The interface point is: the graph exists and is queryable. The execution side pulls from it and produces outputs that land back in the inbox.
- **Progressively evolving views** — generated artifacts that present commonly-queried data, getting richer over time. Depends on the graph being healthy first.
- **Team adoption** — making the system usable by people who didn't build it. Depends on the agent interface layer being mature enough that humans never touch the graph directly.

---

## What Gets Built

The implementation sequence, at a high level:

1. **Gardener infrastructure** — Scheduling, worktree management, PR creation. The shared chassis all gardeners run on.
2. **The Classifier** — First pipeline gardener. Finds uncategorized files, applies frontmatter. Start with 2-3 pipeline types covering the highest-volume content.
3. **First Decomposer** — Pick the highest-value type (likely `personal-notes` or `customer-notes`) and build one complete decomposition pipeline from categorized file to claims.
4. **The Grapher** — Claim processing against existing graph objects. Create, update, conflict, deduplicate.
5. **The Connector** — First maintenance gardener. Highest value, lowest risk. Let it run, observe, tune.
6. **Additional Decomposers** — Add pipelines as content types demand them.
7. **Additional maintenance gardeners** — Add based on observed graph health issues.
8. **KB merge** — When the pipeline is stable, merge research-kb into the unified graph.

Each step is independently valuable. The system gets better at every step without depending on future steps being complete.

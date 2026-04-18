# Garden

A Claude Code plugin that maintains an Obsidian vault's knowledge graph through autonomous pipeline agents. Raw markdown notes go in; a connected, cited knowledge graph comes out.

## How It Works

Content flows through a three-stage pipeline. Each stage is an autonomous agent with a pinned model and its own context.

```
library/          shed/claims/        graph/
  raw notes  -->    JSON claims   -->   typed entities
             classify    decompose           graph
```

1. **Classify** — Scans uncategorized markdown files, reads content, and applies categorization frontmatter (`categorized_as`, `source_origin`, `source_trust`, `domains`, `entities`). Routes each file to the appropriate decomposer variant.

2. **Decompose** — Reads categorized files and extracts atomic claims: discrete assertions about entities with type, domain, and self-contained content. Claims are stored as JSON in `shed/claims/`. Each content type has its own decomposer variant with calibrated epistemic stance and extraction priorities.

3. **Graph** — Resolves claims against the existing knowledge graph. Creates new entity files from schemas, enriches existing entities with new facts, and writes footnote citations linking every fact back to its source.

The orchestrator (`/garden:garden`) chains all three in sequence. Each stage is independently idempotent.

## Skills

| Skill | What it does |
|---|---|
| `/garden:garden` | Run the full pipeline: classify -> decompose -> graph |
| `/garden:classify` | Categorize uncategorized files in `library/` |
| `/garden:decompose` | Extract claims from categorized files |
| `/garden:graph` | Reconcile claims against the knowledge graph |
| `/garden:check-queue` | Show pipeline status (what's pending at each stage) |

## Setup

### Prerequisites

- **[vq](https://github.com/mocha/vaultquery)** — Go CLI for indexed vault queries (PageRank + BM25 + recency). Required for scanning and entity resolution.
- **An Obsidian vault** (or any directory of markdown files with YAML frontmatter).

### Installation

```bash
# From the mocha-ai marketplace
claude plugin install garden@mocha-ai

# Or link locally for development
claude --plugin-dir /path/to/this/plugin
```

### Project Structure

Garden expects the following directory layout in your vault:

```
your-vault/
  library/              # Human input. Raw notes, articles, documents.
  graph/                # Machine output. Typed entity files following schemas.
  shed/
    claims/             # Pipeline state. JSON claim files (git-tracked).
    object-schemas/     # The graph's type system. One schema per entity type.
    decompose-variants/ # Decomposer variant prompts (project-specific).
    scripts/            # Utility scripts (check-queue.py, etc.)
  needs-review.md       # Items flagged for human attention.
```

A future `/garden:init` skill will scaffold this structure automatically.

### Decomposer Variants

Decomposer variants live in your project at `shed/decompose-variants/`, not in the plugin. Each variant is a markdown file that tells the decomposer how to handle a specific content type — what epistemic stance to take, what to extract, and what to skip.

The plugin ships starter templates at `_templates/decompose-variants/`:

| Template | Purpose |
|---|---|
| `personal-notes.md` | Meeting notes, braindumps, dictated thoughts. High trust. |
| `recipe.md` | Cooking recipes, how-to guides. Extract ingredients, techniques, relationships. |
| `web-snippet.md` | Bookmarked web content. Variable trust based on source. |

Copy a template to get started, then customize for your domain:

```bash
cp <plugin-path>/_templates/decompose-variants/personal-notes.md shed/decompose-variants/
```

Create new variants by following the same structure: define an epistemic stance, extraction priorities, and variant-specific guidance.

## The Claim Model

Claims are the intermediate representation between raw content and the knowledge graph:

| Type | What it captures |
|---|---|
| `entity-update` | New information about a known entity |
| `new-entity` | Something not yet in the graph |
| `relationship` | Connection between two entities (always paired a/b) |
| `event` | Something that happened or will happen |
| `signal` | Weak indicator, opinion, competitive intelligence |

Claims are stored as JSON in `shed/claims/`, git-tracked for provenance.

## Object Schemas

Every entity in `graph/` must conform to a schema from `shed/object-schemas/`. Schemas define required frontmatter fields, body sections, and link conventions for each entity type (Company, Person, Product, Feature, etc.).

Formalize a new schema after seeing that type of entity ten times.

## Provenance

Every fact the Grapher writes carries a markdown footnote citation linking back to the source file. More claims processed = more citations = richer graph connectivity.

## Pipeline State Flags

| Flag | Meaning |
|---|---|
| `categorized_at` | File has been classified |
| `decomposed_at` | File has been decomposed into claims |
| `needs_review: true` | File needs human attention before processing continues |
| `skip_processing: true` | File is permanently excluded from the pipeline |

## Agents

The plugin ships three agents, each pinned to a model appropriate for its workload:

| Agent | Model | Role |
|---|---|---|
| `classify` | Haiku | Fast triage — categorization is lightweight work |
| `decompose` | Opus | Heavy semantic extraction — the most demanding stage |
| `graph` | Sonnet | Schema-bound reconciliation — structured but not trivial |

## Design Principles

- **Files are the API** — state tracked in frontmatter, not external databases
- **Start simple, escalate** — 5 claim types, grow when needed
- **Provenance is non-negotiable** — every graphed fact links back to its source
- **The graph is the structure** — entity resolution by search, not assumed paths
- **Batch discipline** — fixed limits per run, most-recent-first, next run picks up the rest
- **Variants are project-specific** — decomposer behavior is configured per-vault, not hardcoded in the plugin

## Plugin Structure

```
garden/
  .claude-plugin/
    plugin.json
  agents/
    classify.md           # Classifier agent definition
    decompose.md          # Decomposer agent (shared mechanics)
    graph.md              # Grapher agent definition
  skills/
    _shared/
      gardener-operations.md   # Common operational model
      vq-reference.md          # vq CLI reference
      claim-schema.md          # JSON claim format and types
      pipeline-types.md        # Content type classification table
    classify/SKILL.md
    decompose/SKILL.md
    graph/SKILL.md
    garden/SKILL.md            # Pipeline orchestrator
    check-queue/SKILL.md       # Queue status checker
  _templates/
    decompose-variants/        # Starter variant templates
  docs/
    specs/                     # Design specs and gardener documentation
```

## License

MIT

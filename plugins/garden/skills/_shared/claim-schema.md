# Claim Schema

Claims are the intermediate representation between raw notes and the
knowledge graph. Each claim captures one assertion about one entity.

## Storage

Claims are stored in `shed/claims/` as JSON files, one file per decomposer
run. This directory is:
- **Git-tracked** — provenance stays intact
- **Machine-readable** — JSON, not markdown

**Filename:** `shed/claims/<EPOCH_TIMESTAMP>.json`
Example: `shed/claims/1744382400.json`

Each decomposer run produces one file, timestamped at run start using the
Unix epoch. A single run may process multiple source files.

## File Structure

```json
{
  "source_files": [
    "library/notes/2026-03-10-1400 - Meeting with PartnerCo.md",
    "library/notes/2026-03-11-0930 - Follow-up with PartnerCo.md"
  ],
  "decomposed_at": "2026-04-11T14:30:00Z",
  "decomposer": "personal-notes",
  "source_trust": "corporate-first-party",
  "claims": [
    {
      "id": "20260411T1430-001",
      "claim_type": "entity-update",
      "source_file": "library/notes/2026-03-10-1400 - Meeting with PartnerCo.md",
      "target_entity": "PartnerCo",
      "target_type": "company",
      "domain": "applications",
      "content": "Concise, self-contained statement of what the source asserts."
    }
  ]
}
```

The top-level `source_files` array lists all files processed in this run.
Each individual claim also carries its own `source_file` field for per-claim
provenance — linking the specific assertion back to the specific document
it came from.

`source_trust` — Trust tier of the source (`independent`, `editorial`,
`corporate-first-party`, `press-release`). Stamped by the Decomposer from
the article's `source_trust` frontmatter field. Consumed by the Grapher for
trust-dependent conflict handling. Only present on claim files produced by
the article decomposer for researcher-sourced content.

## Structured Field Payloads (`fields`)

When a decomposer variant produces schema-mapped structured data (currently
only the `structured-content` variant), the claim MAY include an optional
top-level `fields:` object carrying mapped frontmatter values. The Grapher
uses `fields:` to populate graph-node frontmatter directly, rather than
attempting to parse values out of prose `content`.

```json
{
  "id": "20260417T0900-001",
  "claim_type": "new-entity",
  "target_entity": "Auto-Scaling",
  "target_type": "feature",
  "fields": {
    "status": "ga",
    "tags": ["capability/infrastructure", "surface/scaling"],
    "docs_url": "https://docs.example.com/features/auto-scaling",
    "source_metadata": {
      "surface": "scaling",
      "date_created": "2026-03-16"
    }
  },
  "content": "Body placed under target schema section headers, source prose preserved verbatim.",
  "tags": ["schema_review"]
}
```

**Semantics:**
- `fields` is a flat map of target-schema frontmatter field → value.
- `fields.source_metadata` is a reserved sub-object for preserving source
  frontmatter fields that had no direct home in the target schema. The
  Grapher writes this as a `source_metadata:` block on the graph node's
  frontmatter so the signal survives for a later schema-extension pass.
- `fields` is OPTIONAL on every claim type. When absent, the Grapher
  populates frontmatter only from template defaults and from explicit
  parsing of claim `content`.

**Claim-level tags (`tags` at claim root, distinct from `fields.tags`):**
- `schema_review` — a field or section in the source had no natural home
  in the target schema. Preserved via `source_metadata` or `## Notes`.
  Signals a later schema-extension pass.
- `unresolved_ref` — a cross-reference in the source points at an entity
  in a foreign namespace we have not imported. Preserved verbatim in the
  claim's `content`. The Grapher does NOT create a graph node for the
  foreign target.

## Claim Types

| Type | What it captures | Grapher action |
|---|---|---|
| `entity-update` | New information about a known entity — facts, attributes, status changes | Update fields or add content to the entity's file |
| `new-entity` | Introduces something not yet in the graph — a name, product, concept | Create a new file from the appropriate template |
| `relationship` | Connection between two entities. **Always produces paired claims** (a/b suffix) targeting each entity, with `related_entity` field on both. | Add links and relationship references on both entity files |
| `event` | Something that happened or will happen — org changes, announcements, milestones | Add to timeline/events section of the target entity |
| `signal` | Weak indicator, opinion, competitive intelligence, trend observation | Add to signals/intelligence section. May not trigger a graph change if too weak. |

## Claim ID Convention

IDs are timestamp-based for uniqueness and natural ordering:
- `<YYYYMMDD>T<HHMM>-<NNN>` — sequential within a run (e.g., `20260411T1430-001`)
- Relationship pairs use `a`/`b` suffix (e.g., `20260411T1430-002a`, `20260411T1430-002b`)

## Relationship Claims

Relationships ALWAYS produce paired claims:
- Claim `002a` targets entity A with `related_entity: "B"`
- Claim `002b` targets entity B with `related_entity: "A"`
- Same or slightly reframed content on both
- The Grapher processes each independently, creating links on both sides

## Review Queue

Claims with `"needs_review": true` are skipped by the Grapher. They accumulate
in `shed/claims/` until a human works through them using the
`/garden:triage-review-warnings` skill.

**What triggers `needs_review`:**
- `new-entity` claims where `target_type` doesn't match an existing template
  (concepts, frameworks, strategic models)
- Claims where the decomposer is genuinely uncertain about type or targeting
- Any claim that requires user judgment to process

Include a `"review_reason"` explaining what judgment is needed.

## Grapher Annotations

After the Grapher processes a claim, it adds:

```json
{
  "graphed_at": "2026-04-11T15:00:00Z",
  "graphed_as": "create | update | conflict | deduplicate | skip",
  "graphed_file": "graph/companies/kipu-quantum.md"
}
```

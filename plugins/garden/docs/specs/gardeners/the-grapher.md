# The Grapher

**Type:** Pipeline gardener (Layer 4 — Graphing)
**Schedule:** Every 30 minutes (runs after decomposers)
**Priority:** Phase 1, Step 3

## Outcome

Claims get reconciled against the existing knowledge graph. New graphed objects are created from templates with only the known facts populated. Existing objects get enriched with new information. Every fact written to the graph carries a footnote citation linking back to the source note where it was learned. The graph gets denser with every run — provenance IS enrichment.

## Watch Condition

Claim files in `.garden/claims/` that contain unprocessed claims (claims without a `graphed_at` field).

```bash
# Find claim files with unprocessed claims
find .garden/claims/ -name "*.json" -newer .garden/last-grapher-run
```

## How It Works

For each unprocessed claim:

### Step 1: Skip review-flagged claims
If `needs_review: true`, skip. These queue for human review.

### Step 2: Entity resolution
Find whether the target entity already exists as a file in the graph.

```bash
# Primary: search by name (works regardless of where the file lives)
vq search "<target_entity>" --format json --limit 5

# Secondary: field match if entity type has a name field
vq find --field "name=<target_entity>"
```

**Resolution rules:**
- The graph is the canonical structure, not the filesystem. Do NOT assume entities live at expected paths.
- A confident match = high BM25 score on a file whose type matches `target_type`. The entity's name appearing in the filename or a `name` frontmatter field is the strongest signal.
- Multiple plausible matches = pick the best, flag the duplicates in the PR description.
- No match = new entity. Create from template.

### Step 3: Process by claim type

**`entity-update`** — Entity exists. Read its current content with `vq read --frontmatter <path>` and `vq read --body <path>`. Add the claim's content to the appropriate section of the file. Add a footnote citation.

**`new-entity`** — Entity doesn't exist. Find the template for the `target_type`:
```bash
vq find --in "product-kb/_meta/templates" --path "*<type>*Template*"
```
Create a new file from the template. Populate only the fields you actually know from the claim — leave everything else blank. Add the claim content to the appropriate body section. Add a footnote citation. Ensure at least one wiki-link connects it to another entity.

**`relationship`** — Claims come in pairs (a/b). Process each independently — the claim targeting entity A adds the relationship info to A's file, and the claim targeting entity B adds it to B's file. Each gets its own footnote. This naturally creates wiki-links on both sides.

**`event`** — If the target is a person or company, add to their file. If the event is significant enough to warrant its own file (major announcement, org restructure), create one from the Event template.

**`signal`** — Lighter touch than entity-update. Add to a Signals or Intelligence section if one exists, otherwise append to the most relevant section. Signals may not warrant a graph change if too weak — use judgment.

### Step 4: Write citations

Every fact the Grapher writes carries a **markdown footnote** linking back to the source note.

**Inline marker:** `[^N]` placed immediately after the sentence or paragraph the fact appears in.

**Footnote entry:** Appended to a `## Sources` section at the bottom of the file.

```markdown
## Sources

[^1]: [[2026-02-24-1202 - Meeting with PartnerCo]] — Partner meeting, 2026-02-24
[^2]: [[2026-03-15 - PartnerCo Series A Announcement]] — Article, 2026-03-15
```

**Rules:**
- The `## Sources` section is NOT in templates — the Grapher creates it when writing the first citation to a file.
- If a Sources section already exists (from a user or prior run), append after the last footnote.
- Footnote numbers auto-increment based on what's already in the file.
- The footnote text is a wiki-link to the source note plus a brief description (type + date).
- Users can add their own sources manually — the Grapher just appends after them.

**Why this matters:** Every footnote is a wiki-link. More claims processed = more footnotes = more wiki-links = denser graph node = higher PageRank. The provenance mechanism IS the graph enrichment mechanism.

### Step 5: Mark claim as processed

Add `graphed_at` and `graphed_as` to the claim in the JSON file:

```json
{
  "id": "20260411T1430-001",
  "claim_type": "entity-update",
  "target_entity": "PartnerCo",
  "graphed_at": "2026-04-11T15:00:00Z",
  "graphed_as": "update",
  "graphed_file": "research-kb/general/companies/partnerco.md",
  ...
}
```

`graphed_as` values: `create`, `update`, `conflict`, `deduplicate`, `skip`

## Template Lookup

Every canonical object type has a template. If it's in the graph, it follows a template. Templates define the schema — the Grapher populates only what the claim provides and leaves everything else blank.

```bash
vq find --in "product-kb/_meta/templates"
```

| target_type | Template | Notes |
|---|---|---|
| company | Company Template | Overview, Key Facts sections |
| person | Person Template | Minimal — org, title in frontmatter |
| project | Project Template | Frontmatter-heavy, status tracking |
| feature | Feature Template | In `product-kb/current-state/` |
| service | Service Template | Rich body structure |
| event | Event Template | Date-based |
| concept | No template yet | Flag `needs_review` until template exists |

When a claim's `target_type` has no template, set `needs_review: true` on the claim and skip it. Don't create unstructured files.

## Conflict Handling

When a claim contradicts existing content:

- **Soft conflict** (value changed over time): Auto-resolve by recency. The newer claim wins. Update the content and add the new citation. The old footnote stays — it's provenance for what was previously known.
- **Hard conflict** (fundamental disagreement): Flag in the PR description with evidence from both the existing content and the claim. Don't auto-resolve.

## Example: Full Grapher Run

**Input claim:**
```json
{
  "id": "20260224T1202-002",
  "claim_type": "entity-update",
  "target_entity": "PartnerCo",
  "target_type": "company",
  "domain": "platform",
  "content": "PartnerCo positions itself around 'Agentic cloud computing.' Their product stack has three layers: PartnerCo Hub (core services, infrastructure integrations, developer framework), Tooling (optimization solvers, analytics engine, API-accessible algorithms), and Visualization (end-user application layer with public and private library)."
}
```

**Step 2 — Entity resolution:**
```bash
$ vq search "PartnerCo" --format json --limit 3
→ research-kb/general/companies/partnerco.md (score: 0.70)
→ research-kb/comp_intel/data/companies/partnerco.md (score: 0.65)
```
Two matches — pick the `general/companies/` one (richer file), flag the duplicate in PR.

**Step 3 — Read existing file, add to Overview section:**
```bash
$ vq read --frontmatter research-kb/general/companies/partnerco.md
$ vq read --body research-kb/general/companies/partnerco.md
```

**Step 4 — Write with citation:**
Add to Overview section:
```markdown
## Overview

PartnerCo positions itself around "Agentic cloud computing." Their product stack has three layers: PartnerCo Hub (core services, infrastructure integrations, developer framework), Tooling (optimization solvers, analytics engine, API-accessible algorithms), and Visualization (end-user application layer with public and private library).[^1]

## Sources

[^1]: [[2026-02-24-1202 - Meeting with PartnerCo]] — Partner meeting, 2026-02-24
```

**Step 5 — Mark processed:**
Add `graphed_at`, `graphed_as: "update"`, `graphed_file` to the claim JSON.

## File Manifest

Context the Grapher needs loaded each run:
- This prompt file
- The claim JSON file being processed
- The target entity's existing file (if it exists) — read via `vq read`
- The relevant template (if creating) — read via `vq find` + `Read`
- `vq search` and `vq find` for entity resolution (called per-claim)

## Batch Limits

- **Max 10 claim files per run.** Graphing is the heaviest operation — each claim requires entity resolution, file reading, and careful writing.
- **Process all claims within a single claim file together.** Claims from the same source often reference the same entities — batch the entity resolution.

## Prompt

```
You are a knowledge graph engineer responsible for reconciling claims against an Obsidian vault's knowledge graph.

Your job: read unprocessed claims from .garden/claims/*.json files, resolve each claim's target entity against the graph, and either create new graphed objects or enrich existing ones. Every fact you write carries a footnote citation linking back to the source.

For each claim file:

1. Parse the JSON. Skip claims where needs_review is true.
2. Group remaining claims by target_entity for efficient resolution.
3. For each unique target_entity:
   a. Search: vq search "<entity>" --format json --limit 5
   b. Also try: vq find --field "name=<entity>"
   c. Evaluate results — confident match, multiple matches, or no match.
4. For each claim, based on claim_type:

   ENTITY-UPDATE (entity exists):
   - Read the file: vq read --frontmatter <path> and vq read --body <path>
   - Identify the appropriate section for this claim's content
   - Add the content with a footnote marker [^N]
   - Append the footnote to ## Sources at the end of the file

   NEW-ENTITY (entity doesn't exist):
   - Find the template: vq find --in "product-kb/_meta/templates"
   - Create a new file from the template
   - Populate ONLY the fields you know from the claim. Leave everything else blank.
   - Add the claim content to the appropriate body section with [^1]
   - Create ## Sources with the first footnote
   - Ensure at least one wiki-link to another entity

   RELATIONSHIP (paired claims):
   - Process each claim in the pair independently
   - Each adds relationship info + citation to its target entity's file
   - This naturally creates wiki-links on both sides

   EVENT:
   - Add to the target entity's file, or create an event file if significant
   - Citation as always

   SIGNAL:
   - Lighter touch. Add to relevant section. May skip if too weak.

5. Mark each processed claim with graphed_at, graphed_as, graphed_file in the JSON.
6. Add decomposed_at to source files if not already set.

CITATION FORMAT:
- Inline: [^N] immediately after the fact
- Footer: ## Sources section at bottom of file
- Each footnote: [^N]: [[Source Note Name]] — <type>, <date>
- Auto-increment N based on existing footnotes in the file
- Create ## Sources on first citation; append thereafter

SECTION PLACEMENT:
- Read the existing file structure. Place content in the most relevant section.
- For Company files: Overview for general info, Key Facts for specifics
- For Person files: body text below frontmatter (minimal template)
- If no section fits, append before ## Sources
- NEVER reorganize or rewrite existing content. Only ADD.

ENTITY RESOLUTION JUDGMENT:
- The graph is the structure, not the filesystem. Don't assume paths.
- Prefer files where the entity name appears in the filename or name field
- When you find duplicates, pick the richer file and flag the other in the PR
- When genuinely ambiguous, flag for human review rather than guessing

DO NOT:
- Delete or remove existing content from graphed objects
- Create files without a template (flag needs_review instead)
- Process claims with needs_review: true
- Reorganize or rewrite any existing content in entity files
- Create orphan nodes — every new file must have at least one wiki-link out
```

## Failure Modes

- **Orphan creation** — new objects with no wiki-links to anything else. The one-link-minimum rule mitigates this.
- **Merge cowardice** — flagging everything for review instead of auto-resolving soft conflicts. The Grapher should be confident on recency-based resolution.
- **Stale override** — older claims overwriting newer information. Always check timestamps.
- **Template ignorance** — creating files that don't conform to the existing template structure. Always read and follow the template.
- **Citation drift** — footnote numbers getting out of sync. Auto-increment from the file's current highest footnote number.
- **Entity misresolution** — matching the wrong file. The PR review step catches this — every graphed change is in a PR.

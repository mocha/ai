# The Decomposer: personal-notes

**Type:** Pipeline gardener (Layer 3 — Decomposition)
**Schedule:** Every 30 minutes
**Priority:** Phase 1, Step 2

## Outcome

Personal notes (meeting notes, braindumps, dictated thoughts, session readouts) get decomposed into claims — atomic bits of knowledge with entity references, timestamps, and domain tags. The original note is untouched. Claims are stored as JSON in `.garden/claims/` for The Grapher to process against the graph.

## Watch Condition

Markdown files where:
- `categorized_as: personal-notes`
- No `decomposed_at` field (not yet decomposed)
- `categorization_confidence` is NOT `low` (those need human review first)

**vq scan commands:**
```bash
# Find categorized personal-notes not yet decomposed
vq find --field "categorized_as=personal-notes" --no decomposed_at --sort mtime --limit 20

# Count the backlog
vq find --field "categorized_as=personal-notes" --no decomposed_at --format count

# Exclude low-confidence files (need human review first)
# NOTE: field!=value negation syntax for confidence filtering.
# If not supported, post-filter in the agent after reading frontmatter.
vq find --field "categorized_as=personal-notes" --no decomposed_at --field "categorization_confidence!=low" --sort mtime --limit 20
```

## Claim Storage

Claims are stored in `.garden/claims/` as JSON files, one file per source document. This directory is:
- **Git-tracked** — provenance stays intact, changes come through PRs
- **Hidden from Obsidian** — dot-directory is invisible in the sidebar
- **Machine-readable** — JSON, not markdown. Agents and scripts consume claims directly.

**Filename:** `.garden/claims/<source-stem>.json`
Example: `.garden/claims/2026-02-24-1202-meeting-with-partnerco.json`

**File structure:**

```json
{
  "source_file": "notes/2026/2026-02-24-1202 - Meeting with PartnerCo.md",
  "decomposed_at": "2026-04-11T14:30:00Z",
  "decomposer": "personal-notes",
  "claims": [
    {
      "id": "20260411T1430-001",
      "claim_type": "entity-update",
      "target_entity": "PartnerCo",
      "target_type": "company",
      "domain": "platform",
      "content": "PartnerCo positions itself around 'Agentic cloud computing'. Their product stack has three layers: PartnerCo Hub (core services, infrastructure integrations, developer framework), Tooling (optimization solvers, analytics engine, API-accessible algorithms), and Visualization (end-user application layer with public and private library)."
    },
    {
      "id": "20260411T1430-002a",
      "claim_type": "relationship",
      "target_entity": "PartnerCo",
      "related_entity": "Acme Corp",
      "target_type": "company",
      "domain": "platform",
      "content": "Three partnership models under discussion with Acme Corp: (1) access-only with API keys and usage billing, (2) PartnerCo tech embedded in Acme Corp applications, (3) Acme Corp as storefront with PartnerCo as direct vendor."
    },
    {
      "id": "20260411T1430-002b",
      "claim_type": "relationship",
      "target_entity": "Acme Corp",
      "related_entity": "PartnerCo",
      "target_type": "company",
      "domain": "platform",
      "content": "Three partnership models under discussion with PartnerCo: (1) access-only with API keys and usage billing, (2) PartnerCo tech embedded in Acme Corp applications, (3) Acme Corp as storefront with PartnerCo as direct vendor."
    },
    {
      "id": "20260411T1430-003",
      "claim_type": "new-entity",
      "target_entity": "Acme Corp Developer Platform",
      "target_type": "concept",
      "domain": "strategy",
      "needs_review": true,
      "review_reason": "New entity with no matching template. Requires human judgment on entity type and graph placement.",
      "content": "..."
    }
  ]
}
```

### Review Queue

Claims with `"needs_review": true` are skipped by the Grapher and accumulate in `.garden/claims/` until a human works through them. This is the pipeline's equivalent of GTD's "waiting for" list.

**What triggers `needs_review`:**
- `new-entity` claims where `target_type` doesn't match an existing template (concepts, frameworks, strategic models)
- Claims where the decomposer is genuinely uncertain about type or targeting
- Any claim that requires user judgment to process

Review queue processing is deferred — for now, flagged claims sit until reviewed. The mechanism for working through them (likely an agent-assisted 1:1 session) will be designed when the queue grows large enough to warrant it.

## Claim Types

Five types to start. Add more when a pattern repeats and the existing types demonstrably can't express it (principle 12).

| Type | What it captures | Grapher action |
|---|---|---|
| `entity-update` | New information about a known entity — facts, attributes, status changes | Update fields or add content to the entity's file |
| `new-entity` | Introduces something not yet in the graph — a name, product, concept that should become a node | Create a new file from the appropriate template |
| `relationship` | Connection between two entities. **Always produces paired claims** — one targeting each entity, with `related_entity` field on both. Same or slightly reframed content. | Add wiki-links and relationship references on both entity files |
| `event` | Something that happened or will happen — org changes, announcements, milestones, decisions | Add to timeline/events section of the target entity, or create an event file |
| `signal` | Weak indicator, opinion, competitive intelligence, trend observation. Lower confidence than other types. | Add to signals/intelligence section. May not trigger a graph change if too weak. |

**Deferred types (revisit when needed):**
- `decision` — using `event` for now; split out if decisions need different Grapher treatment
- `action-item` — using `signal` for now; split out if we build an action tracking system
- `requirement` — deferred entirely; requirements need a persona/context model we don't have yet

## Claim ID Convention

IDs are timestamp-based for uniqueness and natural ordering:
- `<YYYYMMDD>T<HHMM>-<NNN>` — sequential within a run (e.g., `20260411T1430-001`)
- Relationship pairs use `a`/`b` suffix (e.g., `20260411T1430-002a`, `20260411T1430-002b`)

## Output Contract

For each source file:
1. Creates one JSON file in `.garden/claims/` with all extracted claims
2. Adds `decomposed_at: <timestamp>` to the source file's YAML frontmatter

## File Manifest

Context the Decomposer needs loaded each run:
- This prompt file
- The source file being decomposed (full content + frontmatter):
  ```bash
  vq read --frontmatter <path>  # people, org, tags — free context for entity recognition
  vq read --body <path>         # full body for claim extraction
  ```
- **Source frontmatter is free context** — `people`, `org`, `tags`, `domains` from the Classifier all inform entity recognition and domain assignment. Use them.
- List of known entities for matching target_entity to existing graph nodes vs. flagging as new-entity:
  ```bash
  vq rank --limit 200                    # high-importance entities first
  vq find --field "type=Company" --sort rank --limit 50   # known companies
  vq find --field "type=Person" --sort rank --limit 50    # known people
  ```
- Existing links from the source file (helps identify already-connected entities):
  ```bash
  vq read --links <path>
  ```

## Batch Limits

- **Max 20 files per run.** Decomposition is heavier than classification — each file requires full reading and careful extraction.
- **Read the full source file.** Unlike the Classifier, the Decomposer needs all the content — claims can come from anywhere in the document.

## Prompt

```
You are a knowledge analyst responsible for decomposing personal notes into atomic claims.

Your job: read personal notes that have been categorized but not yet decomposed, and extract discrete claims from each one. Each claim captures one assertion about one entity. Claims are the intermediate representation between raw notes and the knowledge graph.

For each undecomposed personal-notes file:

1. Read the full content AND the existing frontmatter. The frontmatter's `people`, `org`, and `tags` fields are free context — use them for entity recognition and domain assignment.

2. Identify every distinct assertion, observation, fact, relationship, or event in the content.

3. For each, create a claim with:
   - `claim_type`: one of entity-update, new-entity, relationship, event, signal
   - `target_entity`: the primary entity this claim is about (use the canonical name if known)
   - `target_type`: company | project | feature | service | person | event | concept
   - `domain`: the thematic area (use domain slugs from the vault)
   - `content`: a concise, self-contained statement of what the source asserts. Include enough context that someone reading only the claim understands the assertion without reading the source. ~50-200 words.

4. For RELATIONSHIP claims: create paired claims (a/b) with the same content targeting each entity. Add `related_entity` field to both.

5. For NEW-ENTITY claims: check the known entity list. If the entity might already exist under a different name, use `entity-update` instead and note the potential alias.

6. Write all claims to a single JSON file in `.garden/claims/`.

7. Add `decomposed_at: <timestamp>` to the source file's frontmatter.

CALIBRATION:
- A typical meeting note produces 5-10 claims. A quick braindump or standup produces 2-3.
- A rich partner/customer meeting might produce 10-15. More than 15 from a single note means you're probably too granular.
- Fewer than 3 from any substantive note means you're probably too coarse.
- NOT every sentence is a claim. Skip: small talk, logistics ("let's meet next Tuesday"), incomplete fragments, and filler.
- DO capture: opinions and impressions as `signal` claims. "The team seemed uncertain about the timeline" is worth capturing. "Dana referenced 'the way we work with GlobalTech'" is competitive intelligence worth a signal.
- Action items are `signal` claims for now. "Alex needs to follow up with X" is a signal about what's pending.
- Some redundancy between claims is acceptable. A relationship claim and a signal claim covering similar ground may each add depth or different hypertext connections.

MEETING-AS-EVENT CLAIMS:
- Meetings with EXTERNAL parties (customers, partners, competitors) SHOULD produce an event claim — it's worth noting on the other party's file that a meeting occurred.
- Internal meetings, 1:1s, standups, and all-hands do NOT need event claims — the meeting already exists as a file and the fact of the meeting isn't noteworthy. Extract the content, skip the meeting-happened event.

DOMAIN SLUGS:
- Use existing vault domain slugs when they fit (platform, infrastructure, developer-tools, billing, applications, etc.)
- When no existing slug fits, create a new one. New domains emerge naturally from content. Don't force content into ill-fitting existing domains.

ENTITY TARGETING:
- Each claim has exactly ONE target_entity (except relationship pairs which target both).
- Use canonical names: "PartnerCo" not "Partner", "Acme Corp" not "we".
- When the same entity appears in multiple claims, each claim should be independently readable.
- People are valid target entities: "Jordan Lee is new VP Engineering" targets Jordan Lee.

NEW-ENTITY REVIEW FLAG:
- When a new-entity claim targets something with no obvious template (a concept, framework, strategic model, or entity type that doesn't exist in the graph yet), set `"needs_review": true` and add a `"review_reason"` explaining what judgment is needed.
- The Grapher will skip these. They queue for human review.
- Straightforward new entities that match existing templates (a new person, a new company, a new project) do NOT need review — the Grapher can handle those.

DO NOT:
- Modify the body content of the source file (only add `decomposed_at` to frontmatter)
- Attempt to reconcile claims against the graph (that's The Grapher's job)
- Invent information not present in the source
- Create claims about things merely mentioned in passing — "GlobalTech" appearing once in a quote doesn't warrant an entity-update claim about GlobalTech unless the quote contains substantive information
- Produce claims that are incomprehensible without reading the source — each claim must stand alone
- Editorialize about strategic motives or intentions, especially when the source signals they should remain confidential. Capture FACTS and OBSERVATIONS, not commentary on why someone is doing something or what the political implications are. If the source says "this should stay confidential," that's a signal not to extract it as a claim.
```

## Failure Modes

- **Claim inflation** — producing dozens of trivial claims from simple content. Calibration targets mitigate this.
- **Lossy decomposition** — dropping nuance from the original. Mitigated by `source_file` traceability — you can always go back.
- **Entity hallucination** — inventing entities not present in the source. The known entity list helps, but doesn't prevent this entirely.
- **Context starvation** — claims that are incomprehensible without reading the source. The self-contained content rule mitigates this.
- **Relationship asymmetry** — creating a relationship claim targeting entity A but forgetting the paired claim targeting entity B. The paired claim convention (a/b suffixes) makes this explicit.

## Test Results

Empirical testing against 3 real vault files (Sonnet, v1 prompt):

| Source | Claims | Within calibration? |
|---|---|---|
| Team all-hands (18 lines) | 6 | Yes (target: 3-6) |
| Partner meeting (56 lines) | 9 | Yes (target: 5-10) |
| Strategy readout (177 lines) | 15 | Yes (target: 8-15) |

**Findings applied to prompt:**
- Meeting-as-event claims: only for external parties (internal meetings skipped)
- Domain slugs: let new ones emerge, don't constrain
- Redundancy between signal and relationship claims: acceptable (principle 4)
- Editorializing/sensitivity: added DO NOT rule against extracting strategic motives or confidential intentions
- New-entity review queue: `needs_review` flag for concepts/frameworks with no template
- Claim content length: variable, no constraint

Full test output: `gardening/_test-results/decomposer-v1-results.md`

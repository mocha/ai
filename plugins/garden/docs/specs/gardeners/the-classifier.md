# The Classifier

**Type:** Pipeline gardener (Layer 2 — Categorization)
**Schedule:** Every 15 minutes
**Priority:** Phase 1, Step 1

## Outcome

Every new or significantly changed markdown file in the vault gets categorization frontmatter applied — `categorized_as`, `source_origin`, `domains`, `entities`, `categorization_confidence` — routing it to the appropriate decomposition pipeline. Files that already have sufficient frontmatter are fast-pathed (skipped).

## Watch Condition

Markdown files that either:
- Have no `categorized_at` field in frontmatter
- Have been modified more recently than their `categorized_at` timestamp AND have substantive content changes (not just formatting or link additions)

**Exclude:** files in `_meta/`, `.obsidian/`, `gardening/`, `docs/superpowers/`, template files, claim files (`type: Claim`), and infrastructure files (Source configs, Base files, Canvas files).

**vq scan commands:**
```bash
# Find uncategorized files (most recently modified first)
vq find --no categorized_at --exclude "_meta" --exclude ".obsidian" --exclude "gardening" --exclude "docs/superpowers" --exclude ".garden" --sort mtime --limit 50

# Count the backlog
vq find --no categorized_at --exclude "_meta" --exclude ".obsidian" --exclude "gardening" --exclude "docs/superpowers" --exclude ".garden" --format count

# Find files needing re-categorization (modified since last categorization)
vq find --has categorized_at --modified-after-field categorized_at --sort mtime --limit 20

# Count re-categorization candidates
vq find --has categorized_at --modified-after-field categorized_at --format count
```

## Fast-Path

Files that arrive with `categorized_as` already set in frontmatter skip classification entirely. The Classifier only stamps `categorized_at` to mark them as seen.

This handles:
- Agent-created files that self-categorize at creation time (see Upstream Tagging Convention below)
- Research pipeline outputs with pre-set metadata
- Google Doc syncs with existing frontmatter

## Output Contract

Adds to or updates frontmatter on the source file:

```yaml
categorized_at: <ISO 8601 timestamp>
categorized_as: personal-notes | customer-notes | customer-profile | project-proposal | article | publication | presentation | codebase-review | internal-document
source_origin: internal | external
domains: [<domain-slugs>]
entities: ["[[Entity Name]]", ...]
categorization_confidence: high | medium | low
```

## Batch Limits

- **Max 50 files per run.** If more than 50 uncategorized files exist, process the 50 most recently modified. The next run picks up the rest.
- **Max ~1000 tokens read per file for classification.** Read the title, first 3 paragraphs, and any headings. Most files are classifiable from the first 200 words. For very long files, don't read the entire body.

## File Manifest

Context the Classifier needs loaded each run:
- This prompt file
- The pipeline type table below (embedded in prompt)
- List of existing tag vocabulary for domain assignment:
  ```bash
  vq stats count --by tags | head -30
  ```
- List of high-PageRank entities for entity recognition:
  ```bash
  vq rank --limit 100
  ```
- For each file being classified, read the first ~1000 tokens:
  ```bash
  vq read --body <path>  # (truncate in the agent, not in vq)
  vq read --frontmatter <path>  # check for existing fields
  ```

The Classifier does NOT need: templates, example files, or full file contents of reference material.

## Pipeline Types

| Type | What it covers | Key signals |
|---|---|---|
| `personal-notes` | Meeting notes, braindumps, dictated thoughts, standups, 1:1s. **Includes agent-synthesized outputs from personal sessions:** session retrospectives, braindump syntheses, dictation summaries, research syntheses created as part of personal workflow. If the content originated from a person's thinking or meeting, it's personal-notes regardless of how polished the output is. | Attendee lists, action items, dates, personal pronouns, "session readout", "retrospective", informal tone, wiki-links to people |
| `customer-notes` | Notes from meetings or interactions WITH a customer or partner, focused on the relationship and their needs | External company names, attendees from multiple orgs, product feedback, requirements, contract details, "customer", "partner" |
| `customer-profile` | Structured descriptions of a company, customer, or competitor. The file DESCRIBES an entity — overview, capabilities, key facts — rather than recording interactions. | "Overview", "Key Facts", structured sections, funding data, capability tables, company metadata |
| `project-proposal` | Proposals, PRDs, program overviews, initiative briefs, product inputs. Content that PROPOSES action or advocates for building something. | "Product Inputs", "Proposal", problem statement, user stories, scope, sequencing, "we should build" |
| `article` | News articles, blog posts, press releases from external sources | Bylines, publication dates, forward-looking statements, media contacts, external URLs |
| `publication` | Research papers, whitepapers, technical reports with academic structure | Abstract, authors with affiliations, citations, index terms, methodology sections |
| `presentation` | Decks, slide exports, talk transcripts | "Slide 1", sequential slide structure, embedded images, speaker notes |
| `codebase-review` | Investigation reports examining a specific codebase — architecture analysis, code walkthroughs, feasibility assessments | Repository names, code snippets, file paths, function signatures, "investigation", "architecture" |
| `internal-document` | Memos, reports, design docs, strategy documents that RECORD institutional decisions or knowledge. NOT proposals (those are project-proposal), NOT notes (those are personal-notes). | "To/From" headers, formal structure, policy language, decision records, "approved by" |

This is the starter set. Types grow as new content patterns emerge.

## Prompt

```
You are a librarian responsible for categorizing incoming documents in a knowledge vault.

Your job: scan for uncategorized markdown files, read each one, and apply categorization frontmatter. You are ONLY categorizing — do not summarize, restructure, or decompose the content.

For each uncategorized file:

1. Read the file's title (from filename or first heading) and the first ~1000 tokens of content. For most files, the first few paragraphs are sufficient.
2. Check if `categorized_as` is already set. If yes, this is a fast-path file — stamp `categorized_at` and move on.
3. Determine `categorized_as` from the pipeline type table in this prompt.
   - Classify by CONTENT and PURPOSE, not by file location.
   - Agent-synthesized outputs (session readouts, research syntheses, braindump summaries) are personal-notes if they originated from a person's session, meeting, or brainstorm — regardless of polish level.
   - When a file could be two types, classify by PRIMARY PURPOSE: does it CAPTURE thoughts, DESCRIBE an entity, PROPOSE action, or RECORD a decision?
4. Determine `source_origin`: `internal` (created within the organization) or `external` (created by someone outside).
5. Identify `domains` — the thematic areas this content touches. Use existing domain slugs from the vault (e.g., platform-deployments, hpc-integration, compiler, billing, applications, backends, hardware, developer-tools, runtime-environments, user-experience).
6. Identify `entities` — proper nouns, project names, company names, technology terms that could be wiki-link targets. Write as `"[[Entity Name]]"`. Include both existing and potentially new entities.
7. Assess `categorization_confidence`:
   - `high` — content clearly fits one type, no ambiguity
   - `medium` — reasonable classification but another type is arguable. Name the alternative in the PR description.
   - `low` — genuinely ambiguous, stub file with insufficient content, or infrastructure file that shouldn't be in the pipeline. Flag for human review.

Add these fields to the file's YAML frontmatter. Preserve all existing frontmatter — only add or update categorization fields. Set `categorized_at` to the current ISO 8601 timestamp.

DO NOT:
- Modify the body content of any file
- Split or restructure files (that's The Splitter's job)
- Create new files
- Attempt to decompose content into claims (that's The Decomposer's job)
- Remove or overwrite existing frontmatter fields that aren't categorization fields
- Classify files with fewer than 3 lines of body content as anything other than `low` confidence

BATCH DISCIPLINE:
- Process up to 50 files per run
- Group changes into a single PR
- In the PR description, list each classified file with its type and confidence
- Flag any `low` confidence files separately for human review
```

## Failure Modes

- **Over-categorization** — adding structure beyond the categorization fields, doing decomposition work
- **Misroute** — wrong `categorized_as` sends content to the wrong decomposer. Mitigated by confidence flagging.
- **False recategorization** — treating minor edits (link additions, formatting) as requiring full recategorization. The watch condition should check for substantive content changes, not any mtime bump.
- **Stub over-classification** — assigning `high` confidence to files with almost no content. Empty and near-empty files must get `low` confidence.

## Upstream Tagging Convention

The Classifier's hardest cases are agent-generated files that don't preserve their session context (research syntheses, data tables assembled for meetings). These are indistinguishable from internal documents.

**Convention for agents creating files:** When an agent creates a file as output of any workflow, it SHOULD include `categorized_as` and `source_origin` in the frontmatter at creation time. This triggers the fast-path — the Classifier stamps `categorized_at` and moves on.

This convention improves classification accuracy automatically over time as more agents adopt it. It doesn't require changes to the Classifier — the fast-path already handles it.

Agents and skills that should adopt this convention:
- Session retrospective notes → `categorized_as: personal-notes`
- Research pipeline outputs → `categorized_as: article` or `categorized_as: publication`
- Investigation reports → `categorized_as: codebase-review`
- Google Doc syncs → type depends on content; `/gdoc-sync` should infer
- Summarize-document outputs → `categorized_as: publication`

## Test Results

Empirical testing against 29 real vault files (frontmatter stripped):

| Metric | v1 (baseline) | v2 (current prompt) |
|---|---|---|
| Accuracy (clear types) | 95% | 95%+ |
| Accuracy (hard cases) | n/a | 75% (6/8) |
| Confidence calibration | Weak (misses rated high) | Improved (misses rated medium) |
| Stub handling | Not tested | 3/3 correct (low confidence) |
| source_origin | 100% | 100% |

Remaining edge cases (research syntheses, pure data tables) accepted as `internal-document` — close enough for downstream processing.

Full test results: `gardening/_test-results/classifier-v1-results.md`, `gardening/_test-results/classifier-v2-results.md`

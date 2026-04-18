# Gardener Operations

Every gardener follows the same operational model. This file defines the
shared mechanics — individual skills add their domain-specific logic on top.

## Operational Sequence

1. **Scan** — find files matching the watch condition using `vq find`
2. **Batch** — select up to the batch limit, most recently modified first
3. **Load context** — read the file manifest for this gardener type
4. **Act** — process each file according to the gardener's rules
5. **Stamp** — mark processed files with the appropriate timestamp field
6. **Flag** — set `needs_review: true` in frontmatter if uncertain about any action taken
7. **Report** — summarize what was done

## State Tracking

Gardeners track processing state through frontmatter fields on the files
themselves. No external state database — the files ARE the state.

| Field | Set by | Meaning |
|---|---|---|
| `categorized_at` | Classifier | File has been categorized |
| `decomposed_at` | Decomposer | File has been decomposed into claims |
| `graphed_at` | Grapher | Claim has been reconciled against the graph (in claim JSON) |
| `needs_review` | Any gardener | File needs human attention before further processing |
| `skip_processing` | Human via triage | File is permanently excluded from all gardener processing |

Files with `skip_processing: true` are skipped permanently by all gardeners.
No gardener should process, classify, decompose, or graph a file carrying
this field.

## Vault Exclusions

All gardener scans MUST exclude infrastructure directories. The scan target
is `library/`.

```
--exclude "shed" --exclude "docs" --exclude "skills" --exclude "graph" --exclude "testing_workspace"
```

These directories contain templates, configuration, pipeline infrastructure,
and agent prompts — not knowledge content.

## Review Warning Protocol

When a gardener is uncertain about an action — ambiguous classification,
unclear claim targeting, or any situation requiring human judgment — it
follows this protocol:

1. **Set frontmatter flag** — add `needs_review: true` to the file's YAML frontmatter
2. **Append to review checklist** — add a checklist entry to `needs-review.md` at the vault root:
   ```
   - [ ] [[filename]] — One-sentence description of what needs attention
   ```
3. **Append to review log** — add a timestamped entry to `shed/logs/needs-review-entries.log`:
   ```
   [2026-04-12T14:30:00Z] [classifier] filename.md — One-sentence description
   ```

The `/garden:triage-review-warnings` skill works through accumulated review
entries.

## Frontmatter Discipline

- **Preserve all existing frontmatter** — only add or update fields owned by this gardener
- **Never remove fields** set by other gardeners or humans
- **Timestamps are ISO 8601** — e.g., `2026-04-11T14:30:00Z`
- **Frontmatter fields that reference graph objects** use relative markdown links: `company: "[Acme Corp](../companies/acme-corp.md)"` — not bare strings like `company: Acme Corp`. This applies even when the target does not yet exist (dangling links are expected and useful).

## Link Conventions

All references to entities in graph objects — both in frontmatter and body text — use **relative markdown links** to the entity's expected location in `graph/`:

```markdown
# In frontmatter
company: "[Acme Corp](../companies/acme-corp.md)"
product_line: "[Pro](../product-lines/acme-pro.md)"

# In body text
[PartnerCo](../companies/partnerco.md) is a true reseller...
Natural buyers for the [Enterprise](../products/acme-enterprise.md) bundle tier...
```

- Links are relative to the file's location within `graph/`
- Same-directory links omit the parent path: `[Enterprise Buyers](enterprise-buyers.md)`
- Cross-directory links use `../`: `[Acme Corp](../companies/acme-corp.md)`
- Dangling links are expected — they signal future nodes
- Source citations in `## Sources` link back to `library/`: `[filename](../../library/path/to/file.md)`

Company-specific objects (Products, Features, Capabilities) use a company prefix in the filename to prevent collisions: `acme-pro-tier.md`, `acme-dashboard.md`. Company-independent objects (Segments, Personas) do not use prefixes.

## Product Status Taxonomy

The `status` field on Product, ProductLine, and Feature objects uses a controlled vocabulary that distinguishes how a product is available in the market. The key distinction is between things that are sold repeatably and things that are delivered per-engagement.

| Status | What it means | Example |
|---|---|---|
| `ga` | **General Availability.** Publicly marketed. Any qualified buyer in the marketplace can purchase it directly. Repeatable, standardized offering. | A pay-as-you-go plan anyone can sign up for |
| `limited` | **Limited Availability.** A real product being sold, but to a restricted or invited audience. May include customizations per buyer. Not yet publicly marketed. | A product offered to select partners before broad launch |
| `beta` | **Beta.** Pre-commercial. Being tested with market participants to validate product-market fit. Not sold commercially — participants may receive free or discounted access in exchange for feedback. | Hosted Functions (Solvers) if shipped to early testers |
| `alpha` | **Alpha.** Earlier stage than beta. Internal testing or a very small number of external participants. The product may change substantially based on findings. | An internal prototype shown to one customer for feedback |
| `contract-only` | **Contract-only / Bespoke.** Available only through a specific contract engagement where a customer has explicitly requested a defined outcome. Not a repeatable product — each engagement is scoped individually. The existence of contracts does not make this a marketed product. | Custom consulting engagements scoped per client |
| `planned` | **Planned.** Announced or in active development but not yet available to any external party. | 3rd Party Integrations (per the cloud deck) |
| `deprecated` | **Deprecated.** No longer sold or actively supported. May still be in use by existing customers under existing contracts. | — |
| `launched-not-marketed` | **Launched but not marketed.** The product exists and is technically available, but is not being actively sold or promoted. Often indicates a chicken-and-egg problem where the product needs market signal but isn't generating it. | A feature shipped but never promoted, seeing no adoption |

When assigning status, the test is: **how does a new customer encounter this product today?** If they can find it on a website and buy it, that's `ga`. If they need an introduction, `limited`. If they need to negotiate a bespoke contract for a specific project, `contract-only`. If it doesn't exist yet, `planned`.

## Batch Discipline

Each gardener has its own batch limit (defined in the skill). General rules:

- Process most recently modified files first
- If the backlog exceeds the batch limit, process the limit and stop — the next run picks up the rest
- Group related changes together (e.g., all claims from one source file)

## Reading Files

Use `vq read` subcommands to load file content efficiently:

```bash
vq read --frontmatter <path>   # YAML frontmatter only
vq read --body <path>          # body content only
vq read --links <path>         # all links (wikilinks + frontmatter refs)
vq read --field "<key>" <path> # single field value
```

For classification (shallow read), read only the first ~1000 tokens.
For decomposition (deep read), read the full file.

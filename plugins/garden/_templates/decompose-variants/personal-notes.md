# Decompose Variant: Personal Notes

Load this prompt when processing a file with `categorized_as: personal-notes`.
Combine with the shared mechanics in the decompose agent (step 5).

## Epistemic stance

High trust. These are first-person observations from the vault owner. Treat
assertions as reliable.

## Extraction priorities

All claim types. Personal notes are the richest source — meetings, decisions,
observations, and competitive signals all appear here.

## Variant-specific guidance

- Opinions and impressions become `signal` claims ("the team seemed uncertain
  about the timeline")
- Competitive intelligence becomes `signal` ("they referenced how they work
  with a competitor")
- Action items become `signal` claims for now ("need to follow up with X")
- Meetings with EXTERNAL parties (customers, partners, vendors) SHOULD
  produce an `event` claim — it's worth noting on the other party's file
- Internal meetings, 1:1s, standups, and all-hands do NOT need event claims —
  the meeting already exists as a file

## Entity resolution before claim type

**Before emitting a `new-entity` claim, cross-check the entity context you
loaded in step 4.** If the entity already has a node in `graph/` under any
name or alias, use `entity-update` instead. The check is fast and prevents
duplicate nodes downstream.

## Be generous with new entities (after resolution check)

Once the entity-resolution check is clean — the entity genuinely has no
existing node — **prefer to create a `new-entity` claim over skipping the
mention.** The graph is designed so low-connectivity orphans surface
naturally during review: a node referenced by one claim and nothing else
is a visible anomaly we can audit cheaply. The cost of a missed entity
(never captured) is higher than the cost of an oddball orphan (visible,
pruneable).

Apply this bias to:
- **People with substantive involvement** — meeting participants whose
  contribution is described, external contacts named in context,
  colleagues whose views or actions are recorded. Create a Person
  new-entity for these even from a single mention.
  **Do NOT** create Person nodes for passive cc-line recipients,
  distribution-list names, or bare name-drops without context.
- **Companies mentioned as competitors, partners, customers, or
  vendors** — if they're in the commercial ecosystem and don't have a
  graph node, create one.
- **Projects, initiatives, or named efforts** discussed in the notes —
  even if details are thin, the mention itself is signal.
- **Products, features, or capabilities** referenced by name that
  don't yet exist in the graph.

Exceptions — still skip:
- Passing mentions with no substantive content ("like Google does").
- Hypothetical or analogical references ("imagine a company that...").
- Quoted historical figures or rhetorical constructs.

## Category matching (mandatory for product-hierarchy claims)

**Every claim whose `target_type` is `feature`, `product`, `product-line`,
or `offering` MUST attempt a category match.** This is not optional
decoration — it is how cross-entity comparison gets wired up.

**Process:**
1. Load the available categories once per run (cache in context):
   - `ls graph/feature-categories/` → FeatureCategory slugs
   - `ls graph/product-categories/` → ProductCategory slugs
   - `ls graph/product-family-categories/` → ProductFamilyCategory slugs
   - `ls graph/offering-categories/` → OfferingCategory slugs
2. For each product-hierarchy claim, pick the best-fitting category.
3. Add exactly this field: `primary_category_match: <slug>` —
   slug only (e.g., `job-management`), no directory, no display name.
4. If no existing category is a clean fit, omit the field AND add
   `"needs_review": true` with a `"review_reason"` proposing a
   candidate category name. Do not invent categories silently.

Do NOT use any other field name for this purpose
(`matched_category`, `category_match`, etc. are all wrong).

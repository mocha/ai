# Decompose Variant: Web Snippet

Load this prompt when processing a file with `categorized_as: web-snippet`.
Combine with the shared mechanics in the decompose agent (step 5).

## Epistemic stance

Variable trust. Web snippets are saved bookmarks, clipped articles, or
copied passages from the internet. Trust depends on the source:
- Authoritative reference sites (documentation, encyclopedias) → high trust
- Personal blogs and opinion pieces → moderate trust, quote claims verbatim
- Social media, forums, comments → low trust, frame as `signal` claims

Check `source_trust` in frontmatter if available; otherwise infer from
content signals (URL domain, author credentials, publication context).

## Extraction priorities

Focus on `entity-update` and `signal` claims. Web snippets are usually
saved because they contain a specific piece of information the vault
owner found valuable.

## Variant-specific guidance

- The vault owner saved this for a reason — prioritize extracting the
  core insight or fact that motivated the save
- Quantitative claims (statistics, dates, measurements) are high-value —
  extract with source attribution
- Author opinions from external sources become `signal` claims, not
  `entity-update` — frame as "Source X asserts that..."
- Product announcements or feature descriptions become `entity-update`
  or `new-entity` claims depending on whether the entity exists
- If the snippet includes a URL or publication date in frontmatter,
  preserve that provenance in the claim's `content` field
- Lists (e.g., "top 10 tools for X") should be decomposed into
  individual entity claims, not captured as a single list

## What to skip

- Navigation chrome, cookie banners, sidebar content that leaked
  into the clip
- "Read more" links and cross-promotion
- Comment sections unless a specific comment contains substantive signal
- Boilerplate author bios and publication footers

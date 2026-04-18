# The Connector

**Type:** Maintenance gardener
**Schedule:** Daily
**Priority:** Phase 2, Step 4

## Outcome

Implicit relationships in prose become explicit structural connections. Entity mentions get wiki-linked. Missing tags get proposed. Cross-references in frontmatter get added. The graph becomes more traversable with every run — agents loading any file find richer connections to follow.

Highest-value maintenance gardener. Candidate for early auto-merge because adding wiki-links and tags is low-risk and easily reversible.

## Watch Condition

Graphed objects (files with template-conforming frontmatter) and categorized files. Prioritize recently modified files and files with few existing wiki-links.

## Output Contract

Modifications to existing files:
- Body text: proper nouns and entity names wrapped in `[[wiki-links]]` where they match existing graphed objects
- Frontmatter: relevant tags added from the existing tag vocabulary
- Frontmatter: cross-reference fields populated where relationships exist but aren't expressed

Does NOT create new files. Only enriches existing ones.

## Draft Prompt

```
You are a knowledge graph connector responsible for making implicit relationships explicit.

Your job: scan vault files for mentions of entities, concepts, and topics that exist in the graph but aren't structurally linked. Add wiki-links in prose, tags in frontmatter, and cross-references where relationships exist but aren't expressed.

For each file in your scan batch:

1. Read the file content and frontmatter.
2. Scan body text for proper nouns, project names, company names, technology terms, and person names.
3. For each mention, check whether a matching file exists in the vault (search by filename).
4. If a match exists and the mention is NOT already a wiki-link, wrap it: `Entity Name` → `[[Entity Name]]`.
5. Review the file's tags against the vault's tag vocabulary. If the content clearly relates to tags it doesn't carry, add them.
6. Check frontmatter cross-reference fields (where the template defines them) for missing relationships evident from the content.

JUDGMENT CALLS:
- Link meaningful references, not passing mentions. "We're partnering with [[IBM]] on this deployment" deserves a link. "IBM does this too" probably doesn't.
- When in doubt, link. Links are cheap, easily removed, and make the graph more traversable.
- Don't link the same entity more than once per section. First mention gets the link.
- Don't add tags speculatively. The content should clearly relate to the tag's meaning.

DO NOT:
- Create new files
- Modify the semantic content of any file — only add structural connections
- Add wiki-links to entities that don't exist as files (dangling links are The Gap Detector's domain)
- Restructure or rewrite any content
- Remove existing links or tags
```

## Failure Modes

- **Over-linking** — turning every noun into a wiki-link, making content unreadable
- **Speculative tagging** — adding tags based on tangential relevance
- **Duplicate linking** — linking the same entity multiple times in one paragraph

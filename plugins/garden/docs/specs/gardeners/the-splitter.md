# The Splitter

**Type:** Maintenance gardener
**Schedule:** Weekly
**Priority:** Phase 4, Step 9

## Outcome

Files that have grown past ~1000 tokens or that cover multiple distinct concepts get proposed for decomposition into smaller, more focused files. Produces PRs with the proposed split — human reviews before merge.

## Watch Condition

Markdown files (excluding templates, claims, and infrastructure) that are either:
- Over ~1000 tokens in body content
- Cover multiple distinct topics identifiable by headers or content shifts

## Draft Prompt

```
You are responsible for keeping vault files small and focused (~1000 tokens per file).

Your job: find oversized or multi-topic files and split them into smaller, single-concept files. Each resulting file should be self-contained with proper frontmatter and wiki-links back to siblings.

PROCESS:
1. Identify files over ~1000 tokens or covering multiple distinct concepts
2. Determine natural split points (by header, by topic, by entity)
3. Create the split files with proper frontmatter inherited from the parent
4. Add wiki-links between the split files so the relationship is preserved
5. Replace the original with a brief hub file linking to the parts, OR delete the original if the parts fully cover it

JUDGMENT: Not every large file needs splitting. A 1500-token file that covers one cohesive topic is fine. A 800-token file that covers two unrelated topics should split. Size is a signal, not a rule.
```

## Failure Modes

- **Splitting for splitting's sake** — fragmenting cohesive content that reads better as one file
- **Lost context** — splits that are incomprehensible without the original

# The Conformance Auditor

**Type:** Maintenance gardener
**Schedule:** Monthly
**Priority:** Phase 4, Step 15

## Outcome

Graphed objects whose frontmatter has drifted from the current template version get proposed for update — but only when the missing fields actually affect query reliability or agent retrieval. Cosmetic drift is ignored.

## Watch Condition

Graphed objects whose frontmatter is missing fields that the current template version defines AND those fields are used by Obsidian Bases queries or agent wayfinding.

## Draft Prompt

```
You are responsible for maintaining template conformance across graphed objects in the knowledge graph.

Your job: find objects whose frontmatter has drifted from the current template and propose updates — but ONLY when the drift matters.

PROCESS:
1. For each graphed object type, read the current template from _meta/templates/
2. Compare each object's frontmatter against the template
3. Identify missing fields
4. For each missing field, determine: does this affect queries, filtering, or agent retrieval?
   - YES → propose adding the field (with a reasonable default or empty value)
   - NO → skip. Cosmetic conformance is not worth the churn.

This gardener runs monthly because template drift is slow and low-urgency. Only propose changes that improve the graph's queryability.

DO NOT update the body content of files. Only frontmatter fields.
```

## Failure Modes

- **Cosmetic churn** — proposing updates for fields nobody queries
- **Default pollution** — filling fields with meaningless defaults that look like real data

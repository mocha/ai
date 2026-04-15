# Artifact Conventions

Standard naming, location, and frontmatter for all pipeline artifacts. Every skill that creates or reads artifacts must follow these conventions.

## File Structure

```
docs/
├── specs/           # Spec documents (design specs, brainstorming output)
│   └── SPEC-NNN-<slug>.md
├── plans/           # Implementation plans
│   └── PLAN-NNN-<slug>.md
├── tasks/           # Individual task specs (from plan decomposition)
│   └── TASK-NNN-<slug>.md
├── reports/         # Panel review reports (audit trail)
│   └── R-<YYYYMMDDHHMMSS>-panel-<expert-slug>.md
├── notes/           # Session notes (from finish stage)
│   └── NOTE-NNN-<slug>.md
```

**Backwards compatibility:** Skills also check `docs/superpowers/specs/` and `docs/superpowers/plans/` when searching for existing artifacts. New artifacts always go in `docs/specs/`, `docs/plans/`, etc.

## Internal ID Allocation

Each artifact type has its own sequential counter. To allocate the next ID:

1. Scan the relevant directory (e.g., `docs/specs/`) for existing files
2. Extract the highest `NNN` from filenames matching the pattern (e.g., `SPEC-NNN-*`)
3. Increment by 1. If no files exist, start at `001`
4. Zero-pad to 3 digits (001, 002, ... 999)

The internal ID is the canonical reference used in cross-references, changelogs, branch names, and commit messages. It appears in both the filename and the `id` frontmatter field.

## Naming Conventions

- Artifact filenames: `TYPE-NNN-<slug>.md` (e.g., `SPEC-001-auth-session.md`)
- Slug should be a short, descriptive kebab-case label
- Reports use timestamp prefix for uniqueness: `R-20260412143022-panel-expert-database-engineer.md`
- Task specs from plan decomposition: `TASK-NNN-<slug>.md` where NNN continues the global task counter

## External References

If the work originates from an external tracker (GitHub Issues, Linear, Jira, etc.), include the reference in frontmatter via `external_ref`. This is always optional — the internal ID is the primary identifier.

```yaml
external_ref: "ENG-142"           # Linear issue
external_ref: "owner/repo#42"     # GitHub issue
external_ref: "PROJ-1234"         # Jira ticket
```

When an external reference exists, include it in branch names and commit messages alongside the internal ID.

## Frontmatter Schema

### All Artifacts (minimum)

```yaml
---
id: SPEC-001                # Internal ID — canonical reference
title: Human-readable title
type: spec | plan | task | report | notes
status: draft | reviewed | approved | in-progress | complete | blocked
external_ref: ""            # Optional — link to external tracker
parent: <relative path>     # What this was derived from (provenance chain)
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

### Task Specs (additional fields)

```yaml
task_number: 1
depends_on: []            # Other task IDs this depends on (e.g., ["TASK-001"])
domain: database | api | auth | events | ui | infra
```

### Reports (additional fields)

```yaml
round: 1 | 2
verdict: ship | revise | rethink
target: <relative path>  # What was reviewed
expert: <role description>
model: sonnet | opus
```

## Provenance Chain

Every artifact links to its parent via the `parent` frontmatter field:

```
Input (file path, description, or external ref)
  → spec         (parent: null or external ref)
    → plan        (parent: spec path)
      → TASK-001  (parent: plan path)
      → TASK-002  (parent: plan path)
        → report  (target: task/spec/plan path)
  → notes         (parent: spec path or plan path)
```

This chain allows state reconstruction from any position. If you find a task file, you can trace back to the plan, spec, and original input.

## State Detection from Artifacts

Skills detect pipeline state by examining artifacts, not by relying on agent memory:

| Question | How to detect |
|----------|--------------|
| Spec reviewed? | Panel report exists in `docs/reports/` with `target` pointing to this spec |
| Spec approved? | Panel report exists with `verdict: ship` |
| Plan decomposed? | Task spec files exist in `docs/tasks/` with `parent` pointing to this plan |
| Task in progress? | Git worktree exists for this task's branch |
| Task complete? | Task frontmatter has `status: complete` |

## In-File Changelog

Every artifact maintains a changelog section at the bottom of the file. This is the primary audit trail — no external system required.

### Format

```markdown
## Changelog

- **YYYY-MM-DD HH:MM** — [STAGE] Description of what happened.
- **YYYY-MM-DD HH:MM** — [STAGE] Another event. See `docs/reports/R-YYYYMMDD-panel-synthesis.md`.
```

### When to Append

At every pipeline event that affects the artifact:
- Creation: `[TRIAGE] Created. Risk: standard. Pipeline: PREPARE → DEVELOP → FINISH.`
- Enrichment: `[PREPARE] Enriched with N references, N vocabulary terms. Entry point: path/to/file.ts.`
- Review: `[SPEC-REVIEW] Round 1: revise. 2 blocking issues. Report: docs/reports/R-YYYYMMDD-synthesis.md.`
- Revision: `[SPEC-REVIEW] Revised per round 1 findings. Updated ACs 2 and 4.`
- Approval: `[SPEC-REVIEW] Round 2: approved. Report: docs/reports/R-YYYYMMDD-synthesis.md.`
- Decomposition: `[PLAN-REVIEW] Decomposed into 4 tasks. See TASK-012 through TASK-015.`
- Completion: `[DEVELOP] Task complete. Tests pass. Branch: task/TASK-012-schema-migration.`
- Finish: `[FINISH] Merged to main. Session notes: docs/notes/NOTE-003-auth-session.md.`

### Rules

- Always use `[STAGE_NAME]` prefix for machine-parseable events
- Use absolute timestamps (YYYY-MM-DD HH:MM), not relative
- Reference other artifacts by their internal ID or relative path
- Append only — never modify or delete existing changelog entries

# Artifact Conventions

Standard naming, location, and frontmatter for all pipeline artifacts. Every skill that creates or reads artifacts must follow these conventions.

## File Structure

```
docs/
├── specs/           # Spec documents (design specs, brainstorming output)
│   └── YYYY-MM-DD-<slug>.md
├── plans/           # Implementation plans
│   └── YYYY-MM-DD-<slug>.md
├── tasks/           # Individual task specs (from plan decomposition)
│   └── YYYY-MM-DD-<slug>-task-NN.md
├── reports/         # Panel review reports (audit trail)
│   └── R-<YYYYMMDDHHMMSS>-panel-<expert-slug>.md
├── notes/           # Session notes (from finish stage)
│   └── YYYY-MM-DD-<slug>.md
```

**Backwards compatibility:** Skills also check `docs/superpowers/specs/` and `docs/superpowers/plans/` when searching for existing artifacts. New artifacts always go in `docs/specs/` or `docs/plans/`.

## Naming Conventions

- All artifacts use `YYYY-MM-DD-<slug>` prefix
- Slug should match the Linear issue ID when one exists: `2026-04-12-eng-142-core-database-abstractions`
- Slug should be descriptive when no issue: `2026-04-12-auth-session-management`
- Reports use timestamp prefix for uniqueness: `R-20260412143022-panel-expert-database-engineer.md`
- Task specs append task number: `2026-04-12-eng-142-task-01.md`

## Frontmatter Schema

### All Artifacts (minimum)

```yaml
---
title: Human-readable title
type: spec | plan | task | report | notes
status: draft | reviewed | approved | in-progress | complete | blocked
issue: ENG-XXX           # Linear issue ID (if applicable)
parent: <relative path>  # What this was derived from (provenance chain)
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

### Task Specs (additional fields)

```yaml
task_number: 1
depends_on: []            # Other task filenames this depends on
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
Linear issue (or raw idea)
  → spec         (parent: null or issue ID)
    → plan        (parent: spec path)
      → task-01   (parent: plan path)
      → task-02   (parent: plan path)
        → report  (target: task/spec/plan path)
  → notes         (parent: issue ID or spec path)
```

This chain allows state reconstruction from any position. If you find a task file, you can trace back to the plan, spec, and original issue.

## State Detection from Artifacts

Skills detect pipeline state by examining artifacts, not by relying on agent memory:

| Question | How to detect |
|----------|--------------|
| Spec reviewed? | Panel report exists in `docs/reports/` with `target` pointing to this spec |
| Spec approved? | Panel report exists with `verdict: ship` |
| Plan decomposed? | Task spec files exist in `docs/tasks/` with `parent` pointing to this plan |
| Task in progress? | Git worktree exists for this task's branch |
| Task complete? | Task frontmatter has `status: complete` |

## Linear Event Comments

At every pipeline event, post a comment on the associated Linear issue. Format:

```
[STAGE] message

Details:
- artifact: path/to/artifact.md
- verdict: ship|revise|rethink (if review)
- next: what happens next
```

This creates a timeline of pipeline activity visible from within Linear.

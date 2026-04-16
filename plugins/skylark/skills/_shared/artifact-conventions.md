# Artifact Conventions

Standard naming, location, and frontmatter for all pipeline artifacts. Every skill that creates or reads artifacts must follow these conventions.

## Hybrid Model: docs/ + Beads

The pipeline uses two persistence layers with distinct purposes:

- **`docs/`** — collaborative design artifacts authored interactively with agents and humans. Readable markdown you open in an editor and discuss. Versioned in git.
- **Beads (`bd`)** — executable task management. Structured data optimized for querying, claiming, splitting, dependency tracking, and status management. Lives in the project's `.beads/` database.

**The boundary is clear: specs, plans, and reference material live in `docs/`. Tasks live in beads.**

## File Structure (docs/)

```
docs/
├── specs/           # Spec documents (design specs, brainstorming output)
│   └── SPEC-NNN-<slug>.md
├── plans/           # Implementation plans
│   └── PLAN-NNN-<slug>.md
├── reports/         # Panel review reports (audit trail)
│   └── R-<YYYYMMDDHHMMSS>-panel-<expert-slug>.md
├── notes/           # Session notes (from finish stage)
│   └── NOTE-NNN-<slug>.md
├── strategy/        # Design principles, jobs to be done, user stories
│   └── <slug>.md    #   (produced during brainstorm/spec design)
├── architecture/    # Architectural decision records (ADRs)
│   └── <slug>.md    #   (produced during brainstorm/plan design)
```

**Backwards compatibility:** Skills also check `docs/superpowers/specs/` and `docs/superpowers/plans/` when searching for existing artifacts. New artifacts always go in `docs/specs/`, `docs/plans/`, etc.

## Task Management (Beads)

Tasks are the granular, executable units of work that get dispatched to workers. They are managed exclusively via `bd` (beads), not as markdown files.

### Task Lifecycle

```
bd create → bd ready → bd update --claim → work → bd close --reason
```

### Creating Tasks (plan-review stage)

When plan-review decomposes a plan into tasks, each task becomes a bead:

```bash
# Create a task linked to its parent plan
bd create "Task title" \
  -t task \
  -p 2 \
  --description="Scope: what this task builds/changes" \
  --design="Steps, code samples, verification commands" \
  --acceptance="Concrete, testable acceptance criteria" \
  --spec-id "docs/plans/PLAN-NNN-slug.md" \
  --json

# Add parent-child dependency to the plan's epic bead (if one exists)
bd dep add <task-id> <epic-id> --type parent-child

# Add blocking dependencies between tasks
bd dep add <task-id> <dependency-id> --type blocks
```

Task content maps to bead fields:
| Plan task section | Bead field |
|-------------------|------------|
| Scope / description | `--description` |
| Steps, code, verification | `--design` |
| Acceptance criteria | `--acceptance` |
| Parent plan path | `--spec-id` |
| Domain (database, api, etc.) | `--metadata='{"domain":"database"}'` or label |
| Dependencies | `bd dep add ... --type blocks` |

### Finding Ready Work

```bash
# Find unblocked, unclaimed tasks
bd ready --json

# Show dependency tree for a task
bd dep tree <task-id>
```

### Claiming and Completing Tasks

```bash
# Atomic claim (prevents race conditions in parallel dispatch)
bd update <task-id> --claim --json

# Mark blocked
bd update <task-id> --status blocked --json

# Complete with reason
bd close <task-id> --reason "Implemented. Tests pass. Branch: task/<bead-id>-slug." --json
```

### Discovering Work During Implementation

```bash
# Bug found during task work
bd create "Found bug in auth validation" \
  -t bug \
  -p 1 \
  --description="Details" \
  --deps discovered-from:<current-task-id> \
  --json
```

### Splitting Oversized Tasks

If a task exceeds the size guardrail (~2,000 tokens per task spec, 40,000 tokens total dispatch payload per `risk-matrix.md`), split it using beads' parent-child relationships:

```bash
# Create child tasks
bd create "Subtask A" -t task --description="..." --json
bd create "Subtask B" -t task --description="..." --json

# Link as children of the original
bd dep add <subtask-a-id> <original-id> --type parent-child
bd dep add <subtask-b-id> <original-id> --type parent-child

# If B depends on A
bd dep add <subtask-b-id> <subtask-a-id> --type blocks
```

### State Detection

| Question | How to detect |
|----------|--------------|
| Plan decomposed into tasks? | Beads exist with `spec_id` pointing to this plan |
| Task ready to work? | `bd ready --json` returns it (no blockers, not claimed) |
| Task in progress? | `bd show <id> --json` shows `status: in_progress` |
| Task complete? | `bd show <id> --json` shows `status: closed` |
| Task blocked? | `bd show <id> --json` shows `status: blocked` |

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
- Tasks use beads IDs (e.g., `bd-a1b2c3`) — no file naming convention needed

## External References

If the work originates from an external tracker (GitHub Issues, Linear, Jira, etc.), include the reference in frontmatter via `external_ref`. This is always optional — the internal ID is the primary identifier.

```yaml
external_ref: "ENG-142"           # Linear issue
external_ref: "owner/repo#42"     # GitHub issue
external_ref: "PROJ-1234"         # Jira ticket
```

When an external reference exists, include it in branch names and commit messages alongside the internal ID.

## Frontmatter Schema

### All docs/ Artifacts (minimum)

```yaml
---
id: SPEC-001                # Internal ID — canonical reference
title: Human-readable title
type: spec | plan | report | notes
status: draft | reviewed | approved | in-progress | complete | blocked
external_ref: ""            # Optional — link to external tracker
parent: <relative path>     # What this was derived from (provenance chain)
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

Tasks do not use markdown frontmatter — their metadata lives in beads fields.

### Reports (additional fields)

```yaml
round: 1 | 2
verdict: ship | revise | rethink
target: <relative path>  # What was reviewed
expert: <role description>
model: sonnet | opus
```

## Provenance Chain

Artifacts link to their parents via `parent` frontmatter (docs/) or `spec_id` + dependency graph (beads):

```
Input (file path, description, or external ref)
  → spec         (parent: null or external ref)          [docs/specs/]
    → plan        (parent: spec path)                    [docs/plans/]
      → task      (spec_id: plan path, deps: blocks)     [beads]
      → task      (spec_id: plan path, deps: blocks)     [beads]
        → report  (target: spec/plan path)               [docs/reports/]
  → notes         (parent: spec path or plan path)       [docs/notes/]
```

This chain allows state reconstruction from any position. A bead's `spec_id` traces to the plan; the plan's `parent` traces to the spec; the spec's `parent` traces to the original input.

## State Detection

Skills detect pipeline state by examining artifacts (docs/) and beads, not by relying on agent memory:

| Question | How to detect |
|----------|--------------|
| Spec reviewed? | Panel report exists in `docs/reports/` with `target` pointing to this spec |
| Spec approved? | Panel report exists with `verdict: ship` |
| Plan decomposed? | `bd list --json` returns beads with `spec_id` pointing to this plan |
| Task ready? | `bd ready --json` returns it (no blockers, not claimed) |
| Task in progress? | `bd show <id> --json` shows `status: in_progress` |
| Task complete? | `bd show <id> --json` shows `status: closed` |
| Task blocked? | `bd show <id> --json` shows `status: blocked` |

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
- Decomposition: `[PLAN-REVIEW] Decomposed into 4 tasks via beads. See bd-a1b2 through bd-e5f6.`
- Completion: `[DEVELOP] Task bd-a1b2 complete. Tests pass. Branch: task/bd-a1b2-schema-migration.`
- Finish: `[FINISH] Merged to main. Session notes: docs/notes/NOTE-003-auth-session.md.`

### Rules

- Always use `[STAGE_NAME]` prefix for machine-parseable events
- Use absolute timestamps (YYYY-MM-DD HH:MM), not relative
- Reference other artifacts by their internal ID or relative path
- Append only — never modify or delete existing changelog entries

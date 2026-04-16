# Layer 1 — Triage & Routing

## 1. Purpose

Triage is the entry point for all work entering the composed pipeline. It classifies the user's input, searches for existing pipeline artifacts from prior runs, assesses risk level, and determines which pipeline stages to execute. It emits a structured `triage_result` event that the orchestrator (Layer 2) consumes to begin driving the pipeline.

This layer is stateless and cheap to re-run. It reads artifacts but never writes them.

## 2. Components

| Component | Path | Role |
|-----------|------|------|
| Triage skill | `skills/triage/SKILL.md` | Classification logic, prior art search, path determination |
| Risk matrix | `skills/_shared/risk-matrix.md` | Risk classification criteria, gate activation table, model selection rules |
| Artifact conventions | `skills/_shared/artifact-conventions.md` | Naming patterns, frontmatter schemas, state detection rules |

The triage skill is invoked by `/skylark:implement` as the first pipeline stage. It is not user-invocable directly.

### Artifact search locations

Triage searches the following directories for prior art:

```
docs/specs/                  # Current spec artifacts
docs/plans/                  # Current plan artifacts
docs/tasks/                  # Task specs from plan decomposition
docs/reports/                # Panel review reports
docs/superpowers/specs/      # Legacy spec artifacts (backwards compat)
docs/superpowers/plans/      # Legacy plan artifacts (backwards compat)
```

It also searches `git log` for related commit messages.

## 3. Input

```yaml
# Received from user via /skylark:implement
input:
  type: file_path | description | idea | external_ref | bug_report
  content: string                # The actual input text or file path
  user_risk_override: null | trivial | standard | elevated | critical
```

| Field | Required | Description |
|-------|----------|-------------|
| `type` | yes | Coarse category of the user's input. Determined by the implement skill before calling triage. |
| `content` | yes | The raw input. A file path, free-text description, issue key, or error output. |
| `user_risk_override` | no | Explicit risk declaration from the user. When present, overrides all inferred risk signals. |

## 4. Workflow

Triage executes six steps in sequence. Each step depends on results from the prior step.

### Step 1: Prior art search

Before classifying anything, search for existing artifacts that match the input:

1. Extract keywords from the input content.
2. Grep `docs/specs/`, `docs/plans/`, `docs/tasks/` for matching keywords.
3. Also check `docs/superpowers/specs/` and `docs/superpowers/plans/` (legacy locations).
4. Search `git log` for related commit messages.
5. If a match is found, surface it to the user: "Found SPEC-003 which looks related. Should we continue with that, or is this separate?"
6. User confirmation determines whether to adopt the existing artifact or proceed as new work.

### Step 2: Input classification

Classify the input into a normalized type:

| Input shape | Classified as | Detection rule |
|-------------|---------------|----------------|
| File path to `docs/specs/*.md` | `spec` | Path contains `/specs/` and file has spec frontmatter |
| File path to `docs/plans/*.md` | `plan` | Path contains `/plans/` and file has plan frontmatter |
| File path to `docs/tasks/*.md` | `task` | Path contains `/tasks/` and file has task frontmatter |
| File path to any other file | `raw-input` | Read file and evaluate content maturity (see below) |
| External tracker reference (`#42`, `ENG-142`) | `external-ref` | Matches common tracker patterns: `#\d+`, `[A-Z]+-\d+`, `owner/repo#\d+` |
| Bug report, error message, failing test | `raw-problem` | Describes a malfunction, includes stack traces or error output |
| Feature idea, "I want...", "we should..." | `raw-idea` | Describes desired behavior without implementation detail |

**Raw input maturity evaluation.** When the user points at an arbitrary file, read it and assess:

- Has clear acceptance criteria, architecture decisions, data flow? Treat as `spec`.
- Has ordered tasks with file paths and code references? Treat as `plan`.
- Has a single bounded task description? Treat as `task`.
- Rough notes, half-formed ideas? Treat as `raw-idea`.
- Describes something broken? Treat as `raw-problem`.
- Ambiguous? Ask the user.

### Step 3: State detection

Determine how far prior work has progressed by examining artifacts on disk. State is never inferred from conversation history or agent memory.

**Spec state:**

| State | Detection |
|-------|-----------|
| `draft` | File exists, no panel report references it |
| `reviewed` | Panel report exists in `docs/reports/` with `target` pointing to this spec |
| `approved` | Panel report exists with `verdict: ship` |

**Plan state:**

| State | Detection |
|-------|-----------|
| `draft` | File exists, no panel reports reference it |
| `reviewed` | Panel reports exist for the plan |
| `approved` | All panel reports show `verdict: ship` |
| `decomposed` | Task spec files exist in `docs/tasks/` with `parent` pointing to this plan |

**Task state:**

| State | Detection |
|-------|-----------|
| `pending` | File exists, `status: pending` or no worktree |
| `in-progress` | Git worktree exists for this task |
| `complete` | `status: complete` in frontmatter |
| `blocked` | `status: blocked` or panel report with `verdict: rethink` |

**External reference state:**

1. Check if any existing artifact has `external_ref` matching the reference.
2. If found, detect state from that artifact using the rules above.
3. If not found, state is `new`.

### Step 4: Risk assessment

Apply risk signals in priority order. The first match wins.

**Priority 1 — User declaration.** If `user_risk_override` is set, use it. If the user says "this is load-bearing" or "this is critical" in the input content, classify as `critical`. User override always wins.

**Priority 2 — Domain analysis.**

| Signal | Risk level |
|--------|------------|
| Single file, clear fix, no architectural impact | `trivial` |
| Few files, one bounded context, clear acceptance criteria | `standard` |
| Multiple bounded contexts, schema changes, auth/billing touches | `elevated` |
| Architectural change, new integration, breaking change, load-bearing system | `critical` |

**Priority 3 — Dependency density.** Artifacts that many other tasks depend on trend toward `elevated` or higher.

**Domain cluster extraction.** Identify which domains the work touches (e.g., `["database", "api", "auth"]`). Domain clusters inform risk assessment and are passed through to the output for downstream use by Layer 4 (expert generation).

### Step 5: Path determination

Based on classified type, detected state, and assessed risk, determine the ordered list of pipeline stages to execute.

**New work — path by risk:**

| Risk | Pipeline path |
|------|---------------|
| `trivial` | `[develop, finish]` |
| `standard` | `[prepare, develop, finish]` |
| `elevated` | `[prepare, spec_review, write_plan, plan_review, develop, finish]` |
| `critical` | `[prepare, spec_review, write_plan, plan_review, develop, finish]` (with larger panels and user confirmation at every gate) |

**Conditional modifiers:**

| Condition | Modification |
|-----------|-------------|
| Any risk + no spec exists + feature-scale idea | Prepend `brainstorm` to the path |
| Raw problem at any risk | Path is `[prepare]` (investigate), then re-triage based on findings |
| Input spans 3+ bounded contexts | Set `decompose: true`; orchestrator will decompose before entering expensive review gates |
| Plan would produce 8+ tasks | Set `decompose: true` |

**Existing artifacts — entry point by state:**

| Type | State | Entry point |
|------|-------|-------------|
| `spec` | `draft` | `[spec_review, write_plan, plan_review, develop, finish]` |
| `spec` | `approved` | `[write_plan, plan_review, develop, finish]` |
| `plan` | `draft` | `[plan_review, develop, finish]` |
| `plan` | `approved` | `[plan_review, develop, finish]` (decompose only) |
| `plan` | `decomposed` | `[develop, finish]` |
| `task` | `pending` | `[develop, finish]` |
| `task` | `in-progress` | `[develop, finish]` (resume) |
| `external-ref` | `new` | `[prepare]`, then route by risk |
| `external-ref` | has artifact | Enter at detected artifact state |

### Step 6: Emit triage result

Assemble and return the structured `triage_result`. This result is ephemeral and not persisted to disk. Triage is cheap to re-run.

## 5. Output

```yaml
# Emitted as TRIAGE_COMPLETE event to Layer 2 (Orchestrator)
triage_result:
  input_type: spec | plan | task | raw-idea | raw-problem | raw-input | external-ref
  risk: trivial | standard | elevated | critical
  path: [string]                # Ordered list of stages, e.g. [prepare, develop, finish]
  existing_artifact:
    id: null | string           # e.g. "SPEC-001" if found
    path: null | string         # e.g. "docs/specs/SPEC-001-auth.md"
    state: null | draft | reviewed | approved | in-progress | complete
  external_ref: null | string   # e.g. "ENG-142", "owner/repo#42"
  decompose: boolean            # true if input spans multiple independent subsystems
  domain_clusters: [string]     # e.g. ["database", "api", "auth"] — domains touched
```

| Field | Type | Description |
|-------|------|-------------|
| `input_type` | enum | Normalized classification of the user's input |
| `risk` | enum | Assessed risk level after applying override and domain analysis |
| `path` | string[] | Ordered list of pipeline stages the orchestrator should activate |
| `existing_artifact.id` | string or null | Internal ID of a prior artifact found during prior art search |
| `existing_artifact.path` | string or null | File path to the prior artifact |
| `existing_artifact.state` | enum or null | Detected state of the prior artifact |
| `external_ref` | string or null | External tracker reference if input originated from one |
| `decompose` | boolean | Whether the orchestrator should decompose before entering review gates |
| `domain_clusters` | string[] | Domain areas touched by this work; used by Layer 4 for expert generation |

## 6. Downstream

The `triage_result` is emitted as a `TRIAGE_COMPLETE` event to the XState orchestrator (Layer 2).

The orchestrator consumes these fields as follows:

| Field | Orchestrator use |
|-------|------------------|
| `path` | Determines which states to activate in the state machine. Stages not in the path are skipped. |
| `risk` | Configures gate shape: panel sizes, model selection (Sonnet vs Opus), number of review rounds, and whether user confirmation gates are active. See `_shared/risk-matrix.md` gate activation matrix. |
| `existing_artifact` | If present, the orchestrator loads the artifact and enters the pipeline at the detected state rather than starting from scratch. |
| `decompose` | If `true`, the orchestrator dispatches a `DECOMPOSE` command to Layer 3 (Task substrate) before entering expensive review stages. |
| `domain_clusters` | Forwarded to Layer 4 when generating expert prompts. The vocabulary router uses domain clusters to select domain-specific terminology and anti-patterns. |
| `external_ref` | Propagated into artifact frontmatter and branch naming for traceability. |

## 7. Error Handling

### Ambiguous input classification

If the input cannot be confidently classified into a single type (e.g., a file with both spec-like and plan-like content), triage asks the user: "This looks like it could be a spec or a plan. Which should I treat it as?" Triage never guesses on ambiguous input.

### Conflicting risk signals

If domain analysis suggests one risk level but the content has mixed signals (e.g., single file change but it touches auth), triage escalates to the higher risk level. Risk assessment is conservative — it rounds up, never down.

### Missing artifacts

If an existing artifact is referenced (by ID or path) but the file does not exist on disk, triage treats the work as `new` and logs a warning: "Referenced artifact SPEC-003 not found on disk. Proceeding as new work."

### External reference resolution failure

If an external reference (e.g., `ENG-142`) cannot be resolved to a local artifact, triage classifies the input as `external-ref` with state `new` and sets the path to `[prepare]` so the prepare stage can fetch context from the external system.

### Prior art search ambiguity

If multiple existing artifacts match the input keywords, triage lists all matches and asks the user to select: "Found SPEC-003 and SPEC-007 that look related. Which should I use, or is this separate work?"

### Scope escalation after triage

Triage itself does not handle mid-pipeline scope escalation. If a downstream stage discovers the work is more complex than triage assessed, the orchestrator (Layer 2) handles escalation by pausing and notifying the user per the escalation rules in `_shared/risk-matrix.md`. Triage can be re-invoked with updated information if the user requests re-assessment.

## 8. Configuration

### User risk override

Users can set `user_risk_override` to force a specific risk level. This is the highest-priority signal and bypasses all heuristic assessment. Supported values: `trivial`, `standard`, `elevated`, `critical`.

### Domain cluster vocabulary

The default domain clusters recognized by triage are:

```yaml
default_domains:
  - database
  - api
  - auth
  - events
  - ui
  - infra
  - billing
  - integrations
```

These correspond to the `domain` field in task spec frontmatter (per `_shared/artifact-conventions.md`). Projects can extend this list by adding domain labels to their task specs; triage will recognize any domain that appears in existing artifact frontmatter.

### Decomposition thresholds

| Threshold | Default | Description |
|-----------|---------|-------------|
| Bounded context count | 3 | If input touches this many or more bounded contexts, set `decompose: true` |
| Projected task count | 8 | If a plan would produce this many or more tasks, set `decompose: true` |

### Legacy artifact paths

For backwards compatibility, triage searches these additional paths during prior art search:

```yaml
legacy_paths:
  - docs/superpowers/specs/
  - docs/superpowers/plans/
```

New artifacts are never written to legacy paths. This configuration exists to support migration from the prior superpowers plugin layout.

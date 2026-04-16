# Gas Town — Artifact and Task Substrate Conformance Evaluation

## Summary

- Conformance at a glance: **11 MEETS, 2 PARTIAL, 0 MISSING, 0 N/A** (out of 13)
- Headline: Gas Town's Beads substrate is a purpose-built, git-versioned SQL
  issue tracker with rich schema, atomic transactions, dependency graph
  queryability, stable short IDs, and event emission — essentially a
  direct implementation of this domain's requirements; the two partials
  concern decision/spec-and-plan artifact typing (first-class `decision`
  type and `spec_id` field exist, but dedicated `spec`/`plan`/`review`
  types do not).

## Per-Requirement Findings

### Req 1: Structured schema. Work items have a defined schema: at minimum `id`, `title`, `type` (task/spec/plan/review/PR/etc.), `status`, `blocked_by`, `blocks`, `parent`, `assignee`, `created_at`, `updated_at`, `labels`.

- Verdict: **MEETS**
- Evidence:
  - `docs/design/dolt-storage.md` schema (Dolt schema v6):
    ```sql
    CREATE TABLE issues (
      id VARCHAR(255) PRIMARY KEY,
      title VARCHAR(500) NOT NULL,
      description TEXT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'open',
      priority INT NOT NULL DEFAULT 2,
      issue_type VARCHAR(32) NOT NULL DEFAULT 'task',
      assignee VARCHAR(255),
      owner VARCHAR(255) DEFAULT '',
      ...
      metadata JSON DEFAULT (JSON_OBJECT()),
      created_at DATETIME, updated_at DATETIME, closed_at DATETIME
    );
    CREATE TABLE dependencies (issue_id, depends_on_id, type ... DEFAULT 'blocks');
    CREATE TABLE labels (issue_id, label);
    ```
  - Actual row in `.beads/backup/issues.jsonl` confirms fields: `id`,
    `title`, `status`, `priority`, `issue_type`, `assignee`, `owner`,
    `created_at`, `updated_at`, `closed_at`, `description`, `metadata`,
    `spec_id`, `external_ref`, `content_hash`, `parent` semantics via
    dependency `type='parent-child'`, plus many more (`hook_bead`,
    `role_bead`, `agent_state`, `wisp_type`, `mol_type`, `waiters`,
    `defer_until`, `due_at`, `pinned`, `ephemeral`, `is_template`).
  - `bd create --help` exposes flags for all core schema fields
    including `--parent`, `--deps`, `--labels`, `--assignee`, `--type`,
    `--external-ref`, `--spec-id`, `--priority`.
  - `blocks` / `blocked_by` modeled via the `dependencies` table
    (`type='blocks'`); `bd dep`, `bd link`, `bd dep tree`, `bd graph`
    traverse it.
- Notes: schema exceeds the required minimum; `parent` is encoded as a
  dependency row with `type='parent-child'` (confirmed: 54 such rows in
  backup) rather than a scalar column, but is first-class.

### Req 2: Version-controlled storage. The substrate is git-backed (or equivalent) so history is replayable and auditable.

- Verdict: **MEETS**
- Evidence:
  - `docs/design/dolt-storage.md`: "Gas Town uses Dolt, an open-source
    SQL database with Git-like versioning (Apache 2.0). One Dolt SQL
    server per town ... `dolt_history_*` tables | Full row-level history,
    queryable via SQL ... `AS OF` queries | Time-travel ... `dolt_diff()`
    | 'What changed between these two points?'"
  - `bd show --as-of <commit|branch>` (from `bd show --help`): "Show
    issue as it existed at a specific commit hash or branch (requires
    Dolt)".
  - `bd history <id>` shows "complete version history of an issue,
    including all commits where the issue was modified".
  - JSONL ledger export: "the JSONL Dog exports scrubbed snapshots every
    15 minutes to a git-backed archive ... this is the durable record
    that survives disasters".
  - `bd vc commit`, `bd vc merge`, `bd vc status`, `bd branch`,
    `bd diff` provide git-semantic operations.
- Notes: backing is Dolt, not plain git. Disaster-recovery JSONL export
  is separately git-pushed; primary operational plane is Dolt.

### Req 3: Queryable without LLM. State can be inspected by dependency graph, status, label, or origin using a CLI or simple query — no LLM scan required to answer "what's blocking X?"

- Verdict: **MEETS**
- Evidence:
  - `bd query` with a full query language (`bd query --help`):
    ```
    bd query "status=open AND priority>1"
    bd query "(status=open OR status=blocked) AND priority<2"
    bd query "type=bug AND label=urgent"
    ```
  - `bd list` flags for filtering by status, priority, assignee, label,
    `--label-any`, `--label-pattern`, `--label-regex`, parent, spec
    prefix, mol-type, wisp-type, date ranges, `--ready`, metadata
    fields.
  - `bd graph <id>`, `bd dep tree`, `bd dep list`, `bd graph --dot`,
    `bd graph --html` — direct dependency graph queries.
  - `bd show --refs` — reverse lookup ("issues that reference this").
  - `bd status` — database overview by state.
  - Direct SQL via `bd sql` / `gt dolt sql`.

### Req 4: Atomic writes. Concurrent worker writes cannot corrupt state via interleaved edits. Transitions are all-or-nothing.

- Verdict: **MEETS**
- Evidence:
  - `docs/design/dolt-storage.md` §"Write Concurrency: All-on-Main":
    > "All agents — polecats, crew, witness, refinery, deacon — write
    > directly to `main`. Concurrency is managed through transaction
    > discipline: every write wraps `BEGIN` / `DOLT_COMMIT` / `COMMIT`
    > atomically."
    >
    > "bd update <bead> --status=in_progress
    >   → BEGIN
    >   → UPDATE issues SET status='in_progress' ...
    >   → CALL DOLT_COMMIT('-Am', 'update status')
    >   → COMMIT"
    >
    > "Multi-statement `bd` commands batch their writes inside a single
    > transaction to maintain atomicity."
  - `bd set-state` help: "Atomically set operational state on an
    issue. This command: 1. Creates an event bead ... 2. Removes any
    existing label ... 3. Adds the new dimension:value label" — all
    under a transaction.
  - `bd merge-slot` provides an explicit exclusive-access primitive for
    serialized conflict resolution ("only one agent can hold it at a
    time. This prevents 'monkey knife fights'...").

### Req 5: Cross-references by ID. Artifacts link to each other by stable ID — task → spec → plan → PR — not by file path or title.

- Verdict: **MEETS**
- Evidence:
  - Dependency table keyed by `issue_id` + `depends_on_id` with typed
    edges: `bd link --type blocks|tracks|related|parent-child|discovered-from`.
  - `spec_id` column on every bead (`issues.jsonl` every row has
    `"spec_id":""` or a value) and `bd create --spec-id` flag.
  - `external_ref` column for outside-world IDs (`bd create --external-ref 'gh-9'`
    or `'jira-ABC'`).
  - Convoys reference tracked beads via `type='tracks'` dependency
    edges (`docs/design/convoy/convoy-lifecycle.md`: "Track issues via
    dep add --type=tracks").
  - `hook_bead`, `role_bead`, `parent`, `waits_for` are bead-ID
    references on the issue row itself.
  - Merge requests are beads (`mr→merge-request` alias in `bd list -t`).
  - Bead IDs are short, stable strings (e.g. `gt-00us`, `hq-deacon`,
    `gt-wisp-st5bf`); cross-rig references use `<prefix>:<id>` (from
    `bd gate --help`: "await_id format is <rig>:<bead-id> (e.g.,
    'other-project:op-abc123')").

### Req 6: Survives compaction and session boundaries. The substrate is canonical; conversation memory is ephemeral scaffolding around it.

- Verdict: **MEETS**
- Evidence:
  - `docs/HOOKS.md` §Overview: "The hook is the 'durability
    primitive' — work on your hook survives session restarts, context
    compaction, and handoffs. When you restart (via gt handoff), your
    SessionStart hook finds the attached work and you continue from
    where you left off."
  - `gt hook` attaches an in-flight bead to an agent so `gt handoff`
    can rehydrate a fresh session from disk.
  - `gt resume` — "Check for handoff messages".
  - `docs/design/dolt-storage.md` §"Three Data Planes": Operational
    plane in Dolt SQL server, Ledger plane exported to git as JSONL
    ("permanent record ... survives disasters").
  - Agent state is itself stored in the same substrate (`agent_state`
    column on `issues`; agent beads `hq-mayor`, `gastown/polecats/...`
    are rows).

### Req 7: Idempotent re-runs. Re-running the pipeline skips items already in terminal states; the orchestrator inspects the substrate rather than replaying.

- Verdict: **MEETS**
- Evidence:
  - `docs/design/convoy/spec.md` §S-01: "Idempotent — safe to call
    multiple times for the same event ... High-water mark advances
    monotonically (no duplicate processing)".
  - Convoy auto-convoy creation checks substrate before acting
    (`docs/design/convoy/convoy-lifecycle.md`: "Checks if `sh-task-1`
    is already tracked by an open convoy. If not tracked: creates
    one ...").
  - `gt convoy check` and the stranded-scan both reinspect bead state
    and close convoys only when tracked issues are closed.
  - `bd list --ready` filters to status=open excluding hooked /
    in_progress / blocked / deferred — orchestrators query ready work
    rather than replay.
  - `content_hash` field on every bead (SHA-256 per `issues.jsonl`
    row) enables idempotent change detection.

### Req 8: Human-readable, machine-parseable. Items can be inspected by a human without special tools (plain text fallback) but are structured enough for CLI queries and tool automation.

- Verdict: **MEETS**
- Evidence:
  - `bd show <id>` renders plain-text detail; `--json` flag on every
    bd command emits JSON.
  - `bd export` / `bd import` round-trip JSONL; `.beads/backup/*.jsonl`
    on disk are human-readable line-delimited JSON.
  - `bd graph --html` / `--dot` / `--compact` multiple rendering
    formats.
  - Descriptions are markdown (observed in issues.jsonl descriptions
    containing fenced code blocks, headings).

### Req 9: Event emission on transition. Item status changes emit structured events for telemetry and downstream automation (e.g., "item X moved to ready" triggers dispatch).

- Verdict: **MEETS**
- Evidence:
  - `events` table schema: `(id BIGINT AUTO_INCREMENT, issue_id,
    event_type, actor, old_value, new_value, created_at)`
    (`docs/design/dolt-storage.md`).
  - Observed event types in `.beads/backup/events.jsonl` (3,667
    events): `closed, created, label_added, label_removed, renamed,
    reopened, status_changed, updated`.
  - Sample row:
    ```json
    {"actor":"mayor","event_type":"status_changed","id":1,
     "issue_id":"gt-69dai","new_value":"{\"assignee\":\"gastown/polecats/furiosa\",
     \"status\":\"hooked\"}","old_value":"{...}"}
    ```
  - Dedicated `event` issue_type with `--event-actor --event-category
    --event-payload --event-target` flags on `bd create`.
  - `docs/design/convoy/spec.md` §S-01: "Event-driven convoy
    completion detection ... Polls `GetAllEventsSince` on a 5-second
    interval ... Detects `EventClosed` events ... Detects
    `EventStatusChanged` where `new_value == 'closed'`".
  - Events drive downstream automation: `ConvoyManager.runEventPoll`
    reacts to close events to dispatch next ready issue via
    `gt sling`.

### Req 10: Stable, portable, short IDs. IDs are short enough for conversational reference, stable across the item's lifetime, and portable across workspaces.

- Verdict: **MEETS**
- Evidence:
  - Observed IDs: `gt-00us`, `gt-02431`, `gt-69dai`, `hq-mayor`,
    `hq-deacon`, `bd-a3f8e9`, `gt-wisp-st5bf`, `hq-cv-*` (convoys).
  - `docs/design/architecture.md` §"Two-Level Beads Architecture"
    documents prefix conventions (`hq-*` town, `gt-*`/`bd-*` rig).
  - `routes` table + `routes.jsonl` map prefixes to databases,
    enabling cross-workspace ID resolution:
    `CREATE TABLE routes (prefix PRIMARY KEY, path)`.
  - Cross-rig reference format `<rig>:<bead-id>` for federation gates
    (`bd gate --help`).
  - `issue_counter` table allocates sequential IDs per prefix;
    `bd create --id` for explicit assignment; `bd rename-prefix` for
    workspace-wide rename.
  - `bd federation` commands (`add-peer`, `list-peers`, `status`) for
    cross-workspace sync.

### Req 11: Decision capture. Items store the *why* of decisions — rationale, alternatives considered, constraints — not just the *what*.

- Verdict: **PARTIAL**
- Evidence:
  - Dedicated `decision` issue type exists: `bd create -t` accepts
    `bug|feature|task|epic|chore|decision`, with aliases `dec/adr →
    decision`. Zero `decision` beads exist in `.beads/backup/` — the
    type is defined but appears unused in the Gas Town repo itself.
  - Structured fields that can hold rationale: `description`
    (markdown), `design` / `--design-file`, `acceptance_criteria`,
    `notes` / `--append-notes`, `context` (per `bd create --context`),
    plus `metadata` JSON for arbitrary structure.
  - Audit trail preserves `old_value` and `new_value` for every
    change via the `events` table, and `bd set-state --reason`
    records a reason string on state transitions.
  - Comments (`bd comment`) and `interactions` table capture free-form
    discussion.
- Notes: the fields and type exist to capture rationale/alternatives,
  but there is no schema-enforced "alternatives considered" or
  "constraints" section. `bd lint` checks for "missing template
  sections" (per `bd --help`), but no template content for decision
  rationale was observed in the docs reviewed.

### Req 12: Specs and plans are first-class. Specs, plans, and reviews are artifact types in the substrate, not ad-hoc files in a docs directory.

- Verdict: **PARTIAL**
- Evidence:
  - `spec_id` is a first-class column on every bead and `bd create
    --spec-id` links a bead to a spec doc. `bd list --spec <prefix>`
    filters by spec prefix. `bd query` supports `spec=<pattern>`.
  - Issue types in practice (from `bd create --help` and
    `bd list --type`): `bug, feature, task, epic, chore, decision,
    merge-request, molecule, gate, convoy`. There is no native
    `spec`, `plan`, or `review` type.
  - Plans are represented via `bd create --graph <json>` which
    "Create a graph of issues with dependencies from JSON plan file" —
    i.e., a plan compiles into a set of tracked beads with edges, not
    a dedicated plan artifact.
  - `epic` + `bd swarm` + `bd epic` provide hierarchical grouping that
    Gas Town uses in lieu of "plan" artifacts. Convoys (`convoy` type,
    `hq-cv-*` IDs) serve as work-bundle artifacts.
  - Reviews: Gas Town's primary review artifact appears to be
    `merge-request` (from the type list and `mr→merge-request`
    alias); no `review` artifact type was observed in sources
    consulted.
  - Observed docs in this repo still live as markdown in
    `docs/design/` (e.g., `convoy/spec.md` is a Markdown spec, not a
    spec bead). `docs/design/dolt-storage.md` references a "Design
    plane ... DoltHub commons ... Planned" — a federated design
    artifact plane that is not yet implemented.
- Notes: specs are referenced by ID (`spec_id`) but authored as
  markdown files outside the substrate; plans are first-class *as
  dependency graphs of beads*; `review` is not a native type.

### Req 13: Migration path. Existing ad-hoc artifacts (markdown in `docs/`, Linear issues) can be imported into or referenced from the substrate without rewriting history.

- Verdict: **MEETS**
- Evidence:
  - `bd import [file]` — "Import issues from a JSONL file ... upsert
    semantics ... This command makes the git-tracked JSONL portable
    again — after 'git pull' brings new issues, 'bd import' loads
    them into the local Dolt database."
  - `bd create -f <markdown-file>` — "Create multiple issues from
    markdown file".
  - `bd create --graph <json>` — batch import a dependency graph.
  - `bd create --body-file` / `--description-file` / `--design-file`
    ingest existing markdown as bead fields.
  - `external_ref` column (`bd create --external-ref 'gh-9'` or
    `'jira-ABC'`) keeps references to external systems without
    importing them.
  - `.beads/config.yaml` has `integration settings` for
    `jira.url, jira.project, linear.url, linear.api-key, github.org,
    github.repo`.
  - `bd export | bd import` round-trips issues + memories.
  - `bd find-duplicates` and `bd duplicate` help reconcile imported
    records with existing beads.

## Surprises

- **Mail, agents, roles, and workflow molecules are all beads.** The
  `issues` table is polymorphic (via `issue_type` + `mol_type` +
  `wisp_type`): agents (`issue_type='agent'`, 27 rows in backup),
  messages (`issue_type='message'`), molecules (workflow templates),
  gates, and merge-slots share one schema and one query surface. This
  means the same CLI/query tools work for work items, workflow state,
  and coordination primitives.
- **Explicit three data planes** (`docs/design/dolt-storage.md`):
  Operational (Dolt), Ledger (JSONL→git, permanent), Design (DoltHub
  commons, planned). Different durability/transport per plane.
- **Ephemeral "wisps"** reuse the issues table but are Dolt-ignored so
  they don't generate commits — explicit compaction lifecycle (CREATE →
  LIVE → CLOSE → DECAY → COMPACT → FLATTEN) with scheduled dogs.
- **Two-level prefix architecture** (`hq-*` town vs `<prefix>-*` rig)
  with a routing table is a deliberate namespacing layer for
  cross-workspace work.
- **`bd rebase` for storage reclaim** (`CALL DOLT_REBASE()`) rewrites
  the commit graph to actually remove deleted rows — DELETE alone
  leaves them in history. This is unusual for an issue tracker and
  reflects direct Dolt exposure.
- **`bd merge-slot`** — an explicit mutex primitive stored as a bead —
  serializes conflict resolution across agents racing to merge.
- The two-level beads store (town vs rig) and Dolt's multi-database
  server mean atomicity is per-database; cross-rig transitions rely on
  federation/gates rather than global atomicity.

## Open Questions for Trial

- Does `bd lint` enforce template sections for `decision` beads (ADR
  format with alternatives/rationale), or is that left to description
  markdown convention?
- Can a long markdown spec (3000+ words) be stored as a single
  description without readability degrading in `bd show`? The
  `description TEXT` column is unbounded, but `bd show` rendering is
  not tested here.
- What is the end-to-end latency of `bd query` for "what is blocking X
  across the graph" on a realistic 10k-bead database? Graph traversal
  appears supported by `bd dep tree` / `bd graph`, but scale was not
  measured.
- How does `gt sling` batch-convoy creation behave when beads span
  multiple rigs? Docs say "All beads must resolve to the same rig" for
  batch sling — cross-rig bundling appears to require `gt convoy
  create` + manual `bd dep add --type=tracks`.
- Concrete conflict behavior: the "newest wins" default for `updated_at`
  is documented, but concurrent edits to `metadata` JSON fields were
  not tested here.
- Whether the `review` concept has any native bead type or is strictly
  delegated to `merge-request` + comments.

## Source Index

- `/Users/deuley/code/tools/gastown/docs/design/architecture.md`
- `/Users/deuley/code/tools/gastown/docs/design/dolt-storage.md`
- `/Users/deuley/code/tools/gastown/docs/design/convoy/convoy-lifecycle.md`
- `/Users/deuley/code/tools/gastown/docs/design/convoy/spec.md`
- `/Users/deuley/code/tools/gastown/docs/HOOKS.md`
- `/Users/deuley/code/tools/gastown/.beads/config.yaml`
- `/Users/deuley/code/tools/gastown/.beads/README.md`
- `/Users/deuley/code/tools/gastown/.beads/backup/issues.jsonl` (677 rows)
- `/Users/deuley/code/tools/gastown/.beads/backup/events.jsonl` (3,667 rows)
- `/Users/deuley/code/tools/gastown/.beads/backup/dependencies.jsonl` (315 rows)
- `/Users/deuley/code/tools/gastown/.beads/backup/labels.jsonl` (169 rows)
- `/Users/deuley/code/tools/gastown/.beads/backup/comments.jsonl` (14 rows)
- `/Users/deuley/code/tools/gastown/.beads/backup/config.jsonl`
- CLI output: `bd --help`, `bd create --help`, `bd show --help`,
  `bd list --help`, `bd link --help`, `bd dep --help`, `bd query --help`,
  `bd set-state --help`, `bd history --help`, `bd export --help`,
  `bd import --help`, `bd graph --help`, `bd vc --help`, `bd gate --help`,
  `bd merge-slot --help`, `bd federation --help`, `gt --help`,
  `gt convoy --help`, `gt hook --help`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/03-artifact-and-task-substrate.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/evaluation-prompts.md`

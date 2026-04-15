# Triad — Artifact and Task Substrate Conformance Evaluation

## Summary

- Conformance at a glance: 5 MEETS, 6 PARTIAL, 2 MISSING, 0 N/A (out of 13)
- Headline: Triad defines a disciplined, versioned, human-readable markdown substrate with prefixed IDs and explicit cross-references, but it offers no non-LLM query layer, no atomic-write primitive, and no event emission — discoverability and coordination rely on directory scanning and filesystem watchers that fire only on inbox writes.

## Per-Requirement Findings

### Req 1: Structured schema. Work items have a defined schema: at minimum `id`, `title`, `type` (task/spec/plan/review/PR/etc.), `status`, `blocked_by`, `blocks`, `parent`, `assignee`, `created_at`, `updated_at`, `labels`.

- Verdict: PARTIAL
- Evidence: Three distinct templates define YAML frontmatter schemas.
  - `templates/task.md`: `id`, `title`, `status`, `project` (parent), `author` (assignee), `depends_on`, `blocks`, `created`, `completed`, `scope.boundaries`, `scope.references`, `acceptance_criteria`, `actual_tokens`, `actual_duration_minutes`.
  - `templates/project.md`: `id`, `title`, `status`, `proposal` (parent), `author`, `sequence`, `depends_on`, `blocks`, `created`, `updated`, `acceptance_criteria`, `estimated_complexity`.
  - `templates/proposal.md`: `id`, `title`, `status`, `author`, `created`, `updated`, `customer_need`, `personas`, `success_criteria`.
- Notes: Schemas are type-specific rather than a shared header. `type` is implicit in the ID prefix and file location. No `labels` field on any artifact. `blocked_by` is named `depends_on`. Proposals lack `depends_on`/`blocks`. Parent is named differently per type (`project`, `proposal`, none for proposal). `updated_at` absent on task.

### Req 2: Version-controlled storage. The substrate is git-backed (or equivalent) so history is replayable and auditable.

- Verdict: MEETS
- Evidence: `docs/specs/2026-03-23-agent-triad-protocol-design.md` §5.5: "Canonical documents (`docs/proposals/`, `docs/projects/`, `docs/tasks/`) — always committed" and "Message archives (`docs/inbox/*/read/`) — committed as decision record". `scripts/init-project.sh` creates `.gitkeep` files and an `.gitignore` noting "All messages (both unread and read) are tracked as part of the decision record". README §"What went wrong" confirms the substrate lives in the project repo.
- Notes: Unread messages are described as transient and not committed, but read/ archives are. Artifacts themselves are always committed.

### Req 3: Queryable without LLM. State can be inspected by dependency graph, status, label, or origin using a CLI or simple query — no LLM scan required to answer "what's blocking X?"

- Verdict: MISSING
- Evidence: No query CLI is present in `scripts/` — only `init-project.sh`, `inbox-watcher.service`, and the launchd plist. No index file is maintained. Dependency-graph traversal requires reading each task's YAML frontmatter. `update-task/SKILL.md` describes a workflow: "Find the task file. Search `docs/tasks/T-<id>-*.md` first. If not found, check `docs/tasks/_completed/T-*.md`". `create-task/SKILL.md` assigns IDs via "Scan both `docs/tasks/T-*.md` and `docs/tasks/_completed/T-*.md` for the highest existing T-NNN ID number". These are glob scans, not indexed queries; resolving `blocks`/`depends_on` graphs requires opening each file.
- Notes: A `grep`/`yq` user could hand-roll queries, but Triad ships no query tool and no convention for one.

### Req 4: Atomic writes. Concurrent worker writes cannot corrupt state via interleaved edits. Transitions are all-or-nothing.

- Verdict: MISSING
- Evidence: No file-locking, transaction, or atomic-rename discipline is documented. `update-task/SKILL.md` step 4 is "Write back the updated file, preserving all other content" with no atomicity guarantee. `create-task/SKILL.md` assigns next ID by scanning, a pattern vulnerable to races when two creators run concurrently. The protocol spec §6.1 states "Negotiations are sequential — one active negotiation per document at a time" as a convention, not a mechanism. Per-agent tmux sessions (README, `docs/operations/session-startup.md`) serialize writes per role by convention but offer no interlock across roles (e.g., EM and a worker both touching a task file).
- Notes: Filesystem-watcher debounce noted as unreliable in README ("Inbox watchers were noisy. Debouncing helped but never felt solid").

### Req 5: Cross-references by ID. Artifacts link to each other by stable ID — task → spec → plan → PR — not by file path or title.

- Verdict: MEETS
- Evidence: Task frontmatter carries `project: PRJ-000`; project frontmatter carries `proposal: PMD-000`; message frontmatter carries `proposal`, `project`, `task` ID fields. Protocol spec §4.3: "`project` field links back to the parent project for traceability." Filenames embed IDs (e.g., `T-001-qb-oauth-route.md`) and message filenames use ID-stripped forms (`PMD001`, `PRJ001`, `T015`) per §5.2.
- Notes: `scope.references` in task frontmatter uses file paths, not IDs, for external doc links — but those are pointers to unstructured material, not artifact cross-refs. PR linkage is not part of the schema.

### Req 6: Survives compaction and session boundaries. The substrate is canonical; conversation memory is ephemeral scaffolding around it.

- Verdict: MEETS
- Evidence: Protocol spec §5.4 "State recovery: If an agent restarts and has lost its in-memory context about which negotiation cycle it is in, it can reconstruct state by reading the messages in `docs/inbox/<agent>/read/` for the relevant object ID. The `round` field in each message and the chronological filename ordering provide a complete history." EM `CLAUDE.md` "Session Startup" step 5: "If resuming after a restart, scan `docs/inbox/engineering-manager/read/` to reconstruct negotiation state". `update-task/SKILL.md` "This Ensures — The task file is the system of record for all work performed".
- Notes: Canonicality is asserted explicitly; agents are expected to rehydrate from disk.

### Req 7: Idempotent re-runs. Re-running the pipeline skips items already in terminal states; the orchestrator inspects the substrate rather than replaying.

- Verdict: PARTIAL
- Evidence: Terminal states exist (`done`, `cancelled` on task; `completed`, `cancelled` on project/proposal). Completed tasks are moved to `docs/tasks/_completed/` per `update-task/SKILL.md` step 3, keeping active-queue listings clean. EM `CLAUDE.md` "Session Startup" step 3: "Review the active task queue in `docs/tasks/` (files here are the current work queue)". No explicit idempotency guard is documented when a dispatch is re-invoked on an already-done task; skipping is implicit from scanning only `docs/tasks/` not `_completed/`.
- Notes: There is no orchestrator entry point that enumerates the substrate and resumes — agents operate on inbox messages, not on pipeline-wide state sweeps.

### Req 8: Human-readable, machine-parseable. Items can be inspected by a human without special tools (plain text fallback) but are structured enough for CLI queries and tool automation.

- Verdict: MEETS
- Evidence: All artifacts are markdown with YAML frontmatter. `templates/task.md` `templates/project.md` `templates/proposal.md` `templates/message.md` show human-readable prose sections (`## Description`, `## Scope`, `## Context`) with structured frontmatter parseable by any YAML library. Message filenames encode timestamp and object ID (§5.2): `<YYMMDDHHMMSS>-<object-id>-<step>.md`.
- Notes: Parseable in principle; no shipped parser.

### Req 9: Event emission on transition. Item status changes emit structured events for telemetry and downstream automation (e.g., "item X moved to ready" triggers dispatch).

- Verdict: PARTIAL
- Evidence: Transitions are signaled by writing message files to inboxes, which `fswatch`/`inotifywait` watch (`scripts/inbox-watcher.service`, `scripts/com.deuleyville.inbox-watcher.plist`; `docs/operations/session-startup.md`). Protocol §5.4: "On new file: `tmux send-keys -t <session-name> \"NEW_MESSAGE: <filename>\" Enter`". The event substrate is the inbox, not the artifact itself — artifact status changes (e.g., task status updated by `update-task`) do not themselves emit events; only explicit inter-agent messages do. No structured event bus, only directory-watch keystrokes.
- Notes: README explicitly calls this brittle ("Inbox watchers were noisy. Debouncing helped but never felt solid"). Telemetry is not captured as structured events; per-task `actual_tokens` and `actual_duration_minutes` are recorded post-hoc in the frontmatter by `update-task/SKILL.md` but no emission occurs.

### Req 10: Stable, portable, short IDs. IDs are short enough for conversational reference (agents can say "gt-abc12" or similar), stable across the item's lifetime, and portable across workspaces.

- Verdict: PARTIAL
- Evidence: IDs are `PMD-NNN`, `PRJ-NNN`, `T-NNN` — short, prefixed, human-speakable. `create-task/SKILL.md` step 1: "Scan both `docs/tasks/T-*.md` and `docs/tasks/_completed/T-*.md` for the highest existing T-NNN ID number. Increment by 1." IDs are stable across a workspace (file moves from `docs/tasks/` to `_completed/` preserve the filename with ID).
- Notes: Monotonic-integer scheme means IDs are only unique within a single repo; spec §"Open questions" in the criteria mentions cross-repo portability, and Triad offers no namespacing (e.g., a repo prefix). IDs are not globally unique across workspaces.

### Req 11: Decision capture. Items store the *why* of decisions — rationale, alternatives considered, constraints — not just the *what*.

- Verdict: MEETS
- Evidence: `templates/project.md` has explicit `## Rationale` section: "Why this approach was chosen over alternatives. Link to any decision documents or tradeoff analyses if they exist." `templates/proposal.md` has `## Context` ("Why this proposal exists") and `## Open Questions`. `templates/project.md` has `## Dependencies & Risks`. Message frontmatter includes a `reason` field and `## Detail` section. Protocol spec §2 Design Thesis: "The negotiation records become the observability layer." Read-archive inboxes preserve the full negotiation trail (§5.5).
- Notes: Task template has no rationale section directly — only `## Description` and `## Acceptance Criteria Detail` — but decision trail is preserved through messages referring to task IDs.

### Req 12: Specs and plans are first-class. Specs, plans, and reviews are artifact types in the substrate, not ad-hoc files in a docs directory.

- Verdict: PARTIAL
- Evidence: Proposals (spec-equivalent) and Projects (plan-equivalent) are first-class schema-bearing artifacts with IDs and directories (`docs/proposals/`, `docs/projects/`). Protocol spec §4 "Document Hierarchy: Three canonical artifact types flow through the system." Tasks are first-class. However, review is not a persisted artifact type — reviews happen as messages (disposition `approved`/`revise`) carried in `docs/inbox/*/read/`, not as standalone schema-bearing records. PRs are not artifacts; the protocol ends at dev worker → code.
- Notes: Reviews are discoverable in read-archive but have no independent schema; they are message envelopes.

### Req 13: Migration path. Existing ad-hoc artifacts (markdown in `docs/`, Linear issues) can be imported into or referenced from the substrate without rewriting history.

- Verdict: PARTIAL
- Evidence: `templates/task.md` `scope.references` accepts arbitrary paths or URLs — free-form pointers to existing docs. `templates/proposal.md` `## Context` invites "links to research or vault notes if available". `templates/project-context.md` provides a per-project file with free-form `## Key Navigation` section pointing to "Architecture docs", "Documentation root", "Other key files" — an explicit bridge to ad-hoc content. `scripts/init-project.sh` lays the substrate atop an existing repo without altering prior files.
- Notes: No import tool, no format converter, no Linear bridge. References by path are free text — not validated or resolvable by any tooling.

## Surprises

- Triad's substrate is explicitly multi-owner: Proposals are owned by PM, Projects by PgM, Tasks by EM (`templates/proposal.md` header comments, `docs/specs/2026-03-23-agent-triad-protocol-design.md` §4). Messages carry a `disposition` enum (`approved | revise | escalate | info`) that is structurally identical to a review verdict, but the review is not persisted as a standalone artifact.
- The read-inbox archive (`docs/inbox/*/read/`) is treated as the audit trail. Protocol §2: "The negotiation records become the observability layer." This is an intentional substitution for structured event emission, though the README retrospective flags it as brittle at scale.
- Message filenames strip hyphens from IDs for filename compactness (e.g., `PMD001` not `PMD-001` per §5.2). Frontmatter uses hyphenated form. This asymmetry means ID-based filename search requires normalizing both forms.
- `templates/task.md` records `actual_tokens` and `actual_duration_minutes` in-line — a telemetry channel inside the artifact itself. This is unusual; most substrates keep metrics separate.
- Task completion writes a worker-authored summary below the `---` divider in the task file (`templates/task.md`: "Completion summary written by executing agent below this line"). The substrate thus mixes schema-above with free-form-below.
- `.worktrees/` under the project is the physical isolation unit for workers (EM `CLAUDE.md` "Worker Dispatch"). Worktrees are not themselves substrate artifacts but are named by task ID (`.worktrees/<task-id>`), giving an implicit file-system cross-reference back to the substrate.

## Open Questions for Trial

- Concurrent-write behavior under a real multi-pane session: does `update-task` stepping on an in-progress worker edit corrupt YAML? (No mechanism observed; needs empirical test.)
- Performance of ID-assignment scan at ~1000 tasks: `create-task/SKILL.md` step 1 scans all files to find max ID — does this remain viable at scale?
- Does fswatch-based inbox notification survive large message flurries without dropping events? (README admits it does not in practice.)
- How does the substrate behave when two proposals are in flight simultaneously and their tasks interleave in the flat `docs/tasks/` directory?
- Can reviews be reconstructed reliably from `docs/inbox/*/read/` when message counts climb into the hundreds? Filename ordering gives chronology, but no structured query exists.

## Source Index

- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/README.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/templates/proposal.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/templates/project.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/templates/task.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/templates/message.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/templates/project-context.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/templates/workspace-layout/docs/` (inbox, projects, proposals, tasks scaffolding)
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/scripts/init-project.sh`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/scripts/inbox-watcher.service`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/scripts/com.deuleyville.inbox-watcher.plist`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/docs/specs/2026-03-23-agent-triad-protocol-design.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/docs/operations/session-startup.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/docs/operations/onboarding.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/CLAUDE.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/skills/create-task/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/skills/update-task/SKILL.md`

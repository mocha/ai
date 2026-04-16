# Gas Town — Orchestration Model Conformance Evaluation

## Summary

- Conformance at a glance: 7 MEETS, 3 PARTIAL, 0 MISSING, 0 N/A (out of 10)
- Headline: Gas Town splits orchestration across a state-machine substrate (Beads/Dolt + TOML formulas + capacity scheduler) and an LLM-backed Mayor for strategic routing; the data-plane pieces meet most spec requirements, while bounded-context and edge-case reasoning are only partially encoded.

## Per-Requirement Findings

### Req 1: Declarative pipeline definition. The pipeline is expressed in a machine-readable format (YAML/TOML/equivalent) separate from any LLM prompt. Stage order, dependencies, and transitions are data, not prose.

- Verdict: MEETS
- Evidence: `internal/formula/formulas/*.toml` contains 40+ TOML formula files. Each defines stages as `[[steps]]` with `id`, `title`, `description`, and `needs = [...]` arrays. Example from `shiny.formula.toml`:
  ```toml
  [[steps]]
  id = "implement"
  needs = ["design"]
  ```
  `docs/concepts/molecules.md`: "Formula (source TOML) ─── 'Ice-9' │ ▼ bd cook Protomolecule (frozen template)". `bd cook` and `gt formula` load these TOML files; prompts (step `description` fields) are embedded but the DAG structure (`id`, `needs`, `[vars]`) is data.
- Notes: Step bodies are Markdown/prose prompts, but order, dependencies, variable schema, and composition rules are structured TOML. Overlays (`formula-overlays/<name>.toml`) further layer replace/append/skip modes on the data side.

### Req 2: Bounded orchestrator context. The orchestrator's working context has a measurable ceiling (target ≤20K tokens) that is invariant to pipeline length or run count.

- Verdict: PARTIAL
- Evidence: Two orchestration layers exist. (a) The Mayor is explicitly an LLM (`gt mayor start` launches `exec claude --dangerously-skip-permissions`, per `internal/config/roles/mayor.toml`) — no token ceiling. Its template (`internal/templates/roles/mayor.md.tmpl`, 357 lines) urges it to offload work via `gt sling` ("The Solo Artist trap... every file you read... burns context"), and `gt handoff --cycle` + `gt prime` exist to recycle sessions. (b) The data-plane orchestrator is deterministic: the daemon calls `gt scheduler run` as a subprocess on each heartbeat (`docs/design/scheduler.md` step 14), with no persistent LLM state. `mol-polecat-work.formula.toml` explicitly instructs polecats: "Context filling → Use gt handoff to cycle to fresh session".
- Notes: Measurable ceiling is not stated anywhere reviewed. Scheduler/daemon layer is effectively bounded by design (Go code), but the Mayor is an unbounded LLM mitigated by cultural guidance and handoff tooling rather than a hard ceiling.

### Req 3: Typed state transitions. Every pipeline step has a typed status (`pending`, `in_progress`, `complete`, `failed`, `needs_review`, `blocked`). Transitions are explicit; re-entry from any terminal state is supported.

- Verdict: PARTIAL
- Evidence: `internal/beads/status.go` defines `StatusOpen`, `StatusClosed`, `StatusInProgress`, `StatusTombstone`, `StatusBlocked`, `IssueStatusPinned`, `IssueStatusHooked`. `bd statuses --help` describes categories `active|wip|done|frozen` and allows custom statuses via `bd config set status.custom`. `bd reopen` exists. The sling-context state machine (`docs/design/scheduler.md`): `CONTEXT OPEN → CLOSED (dispatched|circuit-broken|cleared)`. `bd set-state <id> <dimension>=<value>` atomically writes an event bead + label. No distinct `failed` or `needs_review` status is built in; failure is modeled via labels, circuit-breaker reasons, and custom status config.
- Notes: Built-in set does not include `failed` or `needs_review`. `blocked` is represented both as a status and via `blocks`/`blocked_by` dep edges. Re-entry (`bd reopen`) is supported. Step-level state inside a root-only wisp is implicit (agent reads inline), not typed per step; poured wisps materialize sub-wisps with their own statuses.

### Req 4: Disk-first state resolution. The orchestrator determines the current pipeline state by reading persisted artifacts, not by recalling conversation history.

- Verdict: MEETS
- Evidence: All state lives in Dolt SQL Server (`docs/design/architecture.md`: "All beads data is stored in a single Dolt SQL Server process per town"). `gt prime` re-injects context at every SessionStart hook from disk/DB. Scheduler reads state each cycle: `docs/design/scheduler.md` — "Fresh state on save: Dispatch re-reads state before saving to avoid clobbering concurrent pause". `mol-polecat-work.formula.toml`: "Persist findings as you go (CRITICAL for session survival)... Code changes survive in git, but analysis... exists only in your context window. Persist them to the bead". Scheduling state sits on "separate ephemeral beads called sling contexts" persisted in Dolt.
- Notes: The Mayor/polecat agents can drift on in-memory context, but the canonical orchestration substrate (Dolt + git + formulas + `.runtime/scheduler-state.json`) is disk-first.

### Req 5: DAG dependency tracking. Steps declare `blocked_by` relations. Completion of one step automatically unblocks dependents.

- Verdict: MEETS
- Evidence: Formula step `needs = ["prev-id"]` declares blockers (`mol-polecat-work.formula.toml` chains 8 steps via `needs`). Beads layer has `bd link`, `bd dep`, `bd graph`, and `bd ready` returns issues whose blockers are closed. Scheduler explicitly "Join with bd ready to determine unblocked beads" (`docs/design/scheduler.md`). `gt convoy stage` "analyze dependencies, compute waves, create staged convoy"; `gt convoy launch` dispatches Wave 1 and subsequent waves unblock as deps close. `docs/design/convoy/stage-launch/prd.md`: "Tasks not reachable by any blocking dep chain are placed in Wave 1 (maximum parallelism)".
- Notes: Two distinct DAGs coexist: intra-formula step DAG (`needs`), and inter-bead DAG via dependency edges. Convoys operate on the latter.

### Req 6: Bounded reasoning for edge cases. The orchestrator follows the declarative plan for the happy path but has a constrained reasoning affordance for naming/pattern mismatches... without requiring code changes to the state machine.

- Verdict: PARTIAL
- Evidence: Mayor is the explicit LLM escape hatch — `internal/config/roles/mayor.toml` role "Global coordinator for cross-rig work"; `gt mayor --help`: "Routes strategic decisions and cross-project issues... When in doubt, escalate to the Mayor." Formula overlays (`docs/design/architecture.md`: "replace | append | skip" modes) let operators override specific steps without binary changes. `gt doctor` "validates overlay step IDs against current formula definitions and can auto-fix stale references". `gt escalate` provides a structured escalation channel (`gt escalate --help`).
- Notes: Mayor reasoning is unconstrained (full LLM), not a "bounded" affordance in the spec sense. There is no evidence of a narrow-scope pattern-matcher specifically for naming drift; the pattern is "if rules fail, escalate to the Mayor (another LLM)".

### Req 7: Explicit resume semantics. Any new orchestrator session can resume at the last terminal artifact state, without replaying prior conversation.

- Verdict: MEETS
- Evidence: `gt prime --hook` is the SessionStart hook: "Session ID resolution... Persisted .runtime/session_id (from prior SessionStart)". `gt handoff` "End watch. Hand off to a fresh agent session... Any molecule on the hook will be auto-continued by the new session." `gt resume` scans inbox for HANDOFF messages. `docs/concepts/molecules.md`: "Poured wisps (pour = true): Steps ARE materialized as sub-wisps with checkpoint recovery. If a session dies, completed steps remain closed and work resumes from the last checkpoint." Polecats "Spawn with work on hook → gt prime → shows formula checklist inline". MERGE REJECTION recovery flow in `mol-polecat-work.formula.toml` inspects bead notes to resume rejected work on the prior branch.
- Notes: Root-only wisps rely on agent re-reading the formula checklist; they don't track per-step completion. Poured wisps track checkpoints. Either way, resumption reads disk, not conversation.

### Req 8: Parallel fan-out. Independent DAG branches can run concurrently; the orchestrator schedules them without serializing.

- Verdict: MEETS
- Evidence: Convoy wave computation (`gt convoy stage`) explicitly packs independent tasks into Wave 1 for "maximum parallelism" (`convoy/stage-launch/prd.md`). Scheduler `max_polecats` config controls concurrency (`docs/design/scheduler.md`). `mol-plan-review.formula.toml`: "Parallel implementation plan review via specialized analysts... Each leg spawns as a separate polecat, Polecats work in parallel". `type = "convoy"` formulas (code-review, design, plan-review) fan out multiple legs simultaneously. Dog infrastructure supports "5 concurrent shutdown dances" (`docs/design/dog-infrastructure.md`).
- Notes: Parallelism is both a first-class scheduling concept (waves) and a formula type (convoy formulas). Backpressure is provided via `scheduler.max_polecats` + `batch_size` + `spawn_delay`.

### Req 9: No substantive delegation of domain decisions. The orchestrator never decides "is this spec approved?" or "is this code correct?" — those are always delegated to specialized workers or to human gates.

- Verdict: MEETS
- Evidence: Scheduler (Go code) never inspects work content. `dispatchSingleBead` in `docs/design/scheduler.md`: "ReconstructFromContext(b.Context) → DispatchParams... Call executeSling(params) — that's it." Refinery (merge queue, `docs/design/architecture.md`): batch-then-bisect runs gates (test/lint commands configured per-rig); "Gates... are pluggable." Mayor template enforces "File It, Sling It": "The Mayor is a coordinator, not a solo coder... File a bead, sling it. This is the default." Review dimensions are delegated to polecats (mol-plan-review legs). Witness "monitors for stuck/zombie polecats" but "does NOT process completion — that's the polecat's job" (`docs/design/architecture.md`).
- Notes: The Mayor can answer policy questions directly for trivial items per its template, but the design pressure is strongly toward delegation.

### Req 10: Crash-safe transitions. A mid-transition crash leaves the pipeline in a recoverable state; no transition writes are half-applied.

- Verdict: MEETS
- Evidence: `docs/design/dolt-storage.md`: "every write wraps `BEGIN` / `DOLT_COMMIT` / `COMMIT` atomically"; `docs/design/architecture.md` line 169: "all agents write directly to `main` using transaction discipline... This eliminates branch proliferation and ensures immediate cross-agent visibility." Scheduler: "Atomic scheduling: Single `bd create --ephemeral` — no two-step write, no rollback needed" and "Dispatch serialization: flock(scheduler-dispatch.lock) prevents double-dispatch"; pause-state writes "atomic (temp file + rename)". Sling context beads were introduced specifically to eliminate the prior "two-step writes with rollback" on work beads (`docs/design/scheduler.md`). `bd set-state` "atomically... creates an event bead... removes existing label... adds the new dimension:value label". Poured wisp checkpoint recovery: completed step rows persist through crash.
- Notes: Crash-safety is explicitly engineered at the Dolt transaction layer and the sling-context level.

## Surprises

- Two orchestrators in one system: a deterministic data-plane (Beads + scheduler + convoy waves + refinery) and an LLM Mayor that handles strategic routing and escalations. The framework openly treats this as two roles rather than collapsing them.
- Root-only wisps (default) do NOT materialize per-step beads — the formula checklist is rendered inline at `gt prime`. Only `pour = true` formulas get sub-wisp checkpointing. This is a deliberate choice ("~6,000+ rows/day → ~400/day").
- Sling context beads are a notable design: scheduling metadata lives on a separate ephemeral bead that `tracks` the work bead, so the work bead is "pristine" and schedule state is a single atomic create/close. The docs explicitly describe the refactor away from the prior label-mutation scheme.
- Formula overlays allow replace/append/skip of individual steps at town or rig level without binary changes — an operator-side escape hatch that avoids forking formulas.
- Agents are instructed to persist findings to the bead BEFORE closing steps because "If your session dies between persisting and closing, the findings survive. If you close first, they're lost."
- Built-in status taxonomy is thinner than the spec's (`open`, `closed`, `in_progress`, `blocked`, `tombstone`, `hooked`, `pinned`). `failed` and `needs_review` are not built-in; they're expected to come from `status.custom` or label dimensions via `bd set-state`.

## Open Questions for Trial

- What is the actual token footprint of a Mayor session after a full multi-rig pipeline run? The template urges offloading but provides no measured ceiling.
- How does a root-only wisp behave on crash partway through step 4 of 8? The design says "agent reads steps inline from the embedded formula at prime time" — does the resumed session detect which step it was on, or does it re-run idempotently from step 1?
- When a polecat hits a naming/pattern drift (e.g., merge rejection with unexpected branch format), does the Mayor escalation path actually self-correct, or does it wedge until a human intervenes?
- How does `gt convoy launch` sequence wave transitions when Wave 1 legs fail intermittently? Does Wave 2 start partially or wait for full Wave 1 closure?
- Does `bd reopen` on a closed formula step (sub-wisp) cleanly re-trigger dependents, or is re-entry intended only at the root bead level?

## Source Index

- `/Users/deuley/code/tools/gastown/README.md` (not read in full; CLI-exposed concepts covered via `--help`)
- `/Users/deuley/code/tools/gastown/docs/design/architecture.md`
- `/Users/deuley/code/tools/gastown/docs/concepts/molecules.md`
- `/Users/deuley/code/tools/gastown/docs/design/scheduler.md`
- `/Users/deuley/code/tools/gastown/docs/design/dolt-storage.md` (excerpts)
- `/Users/deuley/code/tools/gastown/docs/design/convoy/stage-launch/prd.md` (excerpt)
- `/Users/deuley/code/tools/gastown/docs/design/dog-infrastructure.md` (excerpt)
- `/Users/deuley/code/tools/gastown/internal/formula/formulas/shiny.formula.toml`
- `/Users/deuley/code/tools/gastown/internal/formula/formulas/mol-polecat-work.formula.toml`
- `/Users/deuley/code/tools/gastown/internal/formula/formulas/mol-plan-review.formula.toml` (excerpt)
- `/Users/deuley/code/tools/gastown/internal/formula/formulas/code-review.formula.toml` (excerpt)
- `/Users/deuley/code/tools/gastown/internal/beads/status.go`
- `/Users/deuley/code/tools/gastown/internal/config/roles/mayor.toml`
- `/Users/deuley/code/tools/gastown/internal/templates/roles/mayor.md.tmpl` (head)
- `/Users/deuley/code/tools/gastown/templates/witness-CLAUDE.md` (excerpts)
- CLI: `gt --help`, `gt mayor --help`, `gt mayor start --help`, `gt convoy --help`, `gt convoy stage --help`, `gt convoy launch --help`, `gt scheduler --help`, `gt sling --help`, `gt prime --help`, `gt handoff --help`, `gt resume --help`, `gt formula --help`, `bd --help`, `bd mol --help`, `bd cook --help`, `bd state --help`, `bd set-state --help`, `bd statuses --help`, `bd create --help`

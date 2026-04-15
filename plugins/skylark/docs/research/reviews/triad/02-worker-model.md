# Triad — Worker Model Conformance Evaluation

## Summary

- Conformance at a glance: 3 MEETS, 4 PARTIAL, 5 MISSING, 0 N/A (out of 12)
- Headline: Triad has two worker layers — persistent manager agents (PM/PgM/EM) running in tmux panes with filesystem inbox coordination, and ephemeral Dev workers dispatched by the EM into isolated worktrees. The Dev layer meets the "typed outcomes" and "curated inputs" parts of the spec well, but static task-file dispatch (no per-task prompt generation, no vocabulary injection) and the absence of a pluggable-runtime or peer-awareness log leave most advanced requirements MISSING. The manager layer is explicitly persistent and thus directly contradicts the ephemerality and bounded-lifetime requirements.

## Per-Requirement Findings

### Req 1: Ephemeral sessions. Worker session terminates at task completion. No long-lived worker accumulates conversation across tasks.

- Verdict: PARTIAL
- Evidence:
  - Dev layer is ephemeral. `agents/engineering-manager/CLAUDE.md` describes dispatch-per-task into a fresh worktree: "Create a worktree from main inside the project: `git worktree add .worktrees/<task-id> -b <branch>`… Use the dispatch template in `.claude/worker-dispatch-template.md` — fill in the variables, dispatch".
  - Manager layer is explicitly persistent. `README.md`: "Each agent ran as its own Claude Code session in a tmux pane." `docs/specs/2026-03-23-agent-triad-protocol-design.md` §3.3: "Agents are always running. They process messages when notified, complete their current atomic operation before checking the inbox".
- Notes: If "worker" is interpreted broadly to include the manager agents (which do substantive reasoning on tasks), this fails. If only the Dev layer counts, it meets.

### Req 2: Persistent identity, ephemeral state. Worker identity (role, accumulated telemetry, reputation) persists across sessions, decoupled from the conversation state of any one session.

- Verdict: PARTIAL
- Evidence:
  - Manager identities persist via their CLAUDE.md / philosophy / context directories. `agents/engineering-manager/CLAUDE.md` defines identity; `agents/program-manager/CLAUDE.md` references `philosophy/principles.md`, `playbook.md`, `anti-patterns.md` read at every session start, plus `context/<project>.md` "Per-project context files that persist cross-session learning".
  - State recovery across restart is explicit: `docs/specs/2026-03-23-agent-triad-protocol-design.md` §5.4 "If an agent restarts and has lost its in-memory context… it can reconstruct state by reading the messages in `docs/inbox/<agent>/read/`".
  - Dev workers have no persistent identity. Dispatch template uses generic `WORKER_ID` slots ("W1, W2") with no telemetry, reputation, or per-worker state mechanism.
- Notes: The identity/state split exists for managers, not for Dev workers.

### Req 3: Per-task prompt generation. Worker prompts are generated at dispatch time based on the specific task, not baked into static config at orchestrator startup. A dispatch call can pass a full prompt body.

- Verdict: PARTIAL
- Evidence:
  - The dispatch prompt IS generated per dispatch from a fill-in-the-blanks template. `agents/engineering-manager/.claude/worker-dispatch-template.md` shows the template body with `{WORKER_ID}`, `{TASK_ID}`, `{TASK_TITLE}`, `{PROJECT_PATH}`, `{WORKTREE_PATH}`, `{BRANCH_NAME}`, `{LIST_OF_FILES}`, `{TASK_SPECIFIC_NOTES}` slots.
  - However the template is deliberately static and the EM rules explicitly suppress task-specific prompt generation: `agents/engineering-manager/CLAUDE.md` §Worker Dispatch step 5: "No custom per-task prompts. The task file IS the contract. `TASK_SPECIFIC_NOTES` should almost always be empty." Worker-dispatch-template.md reiterates: "If all three are good, TASK_SPECIFIC_NOTES should be empty."
  - What varies per dispatch is pointers (task file path, worktree, pattern file paths), not prompt body.
- Notes: The task file substitutes for a generated prompt, but the prompt body itself is fixed template text. The design choice is explicit and intentional, not absent.

### Req 4: Dynamic context injection. Prompt generation supports injecting domain vocabulary, scoped file paths, relevant prior artifacts, and task-specific constraints.

- Verdict: PARTIAL
- Evidence:
  - Scoped file paths and task-specific constraints are injected via the task file's `scope.boundaries` and `scope.references`: `templates/task.md` defines `scope: boundaries: []` (modifiable directories) and `scope: references: []` (paths to relevant files/docs).
  - Pattern files are passed through `{LIST_OF_FILES}` in the dispatch template.
  - No evidence of domain-vocabulary injection or expert-prompt generation. Searched `triad-source/` — no vocabulary, glossary, or expert-generation methodology found.
- Notes: Scoped paths and references are supported; vocabulary and expert-generation are absent from the injection model.

### Req 5: Curated inputs only. Workers never receive a blanket dump of parent context or unrelated artifacts — only the inputs the task requires.

- Verdict: MEETS
- Evidence:
  - Dispatch is pointer-based: `worker-dispatch-template.md` "Level of Detail Guide" explicitly lists each information type and its location, with "Prompt includes? No — just a path" for conventions, acceptance criteria, and code patterns.
  - `agents/engineering-manager/CLAUDE.md` §Worker Dispatch step 3: "Provide the worker with: task file path + pattern file paths (existing code that demonstrates the patterns to follow)".
  - Context boundaries for the broader pipeline are defined in `docs/specs/2026-03-23-agent-triad-protocol-design.md` §3.2 with a role/access matrix (Dev Worker: "task-scoped", "scoped", "single", "—").
- Notes: Dev worker inputs are explicitly curated to task file + pattern files + worker-context briefing.

### Req 6: Structured outputs. Worker returns a typed result (status enum + typed fields), not free-form prose.

- Verdict: MEETS
- Evidence:
  - `agents/engineering-manager/.claude/worker-context.md` §Report Format:
    ```
    Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
    Decisions: (anything ambiguous you resolved — skip if none)
    Deviations: (anything different from prompt/task — skip if none)
    Concerns: (anything fragile or wrong — skip if none)
    ```
  - The report explicitly suppresses prose: "Do NOT list files changed or what you implemented — git shows that. Report only what git CANNOT show: your reasoning, your doubts, your judgment calls."
- Notes: The structure is prose-in-named-fields rather than typed JSON, but it is a defined schema with an enum status.

### Req 7: Typed status outcomes. At minimum: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, BLOCKED.

- Verdict: MEETS
- Evidence:
  - `worker-context.md` report format lists exactly these four: "Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT".
  - `agents/engineering-manager/CLAUDE.md` §Task Completion Validation enumerates the same four with handling per status: "DONE — task complete, no issues / DONE_WITH_CONCERNS — task complete but something feels off — investigate concerns before accepting / BLOCKED — cannot proceed, requires EM intervention… / NEEDS_CONTEXT — ambiguous decision the worker is not confident making — provide clarity and re-dispatch".

### Req 8: Per-role tool scoping. Worker tool access is configurable per-role (narrowing, not broadening).

- Verdict: MISSING
- Evidence:
  - No evidence found in the dispatch template, worker-context, agent CLAUDE.md files, or start/kick/resume/status skill definitions of per-role tool allow/deny lists, `tools:` frontmatter, or permissionMode scoping.
  - The closest constraint is scope.boundaries (filesystem paths), not tool access.
  - At the sandbox level, `skills/start/SKILL.md` §3 uses a single `safehouse` invocation with the same `--workdir`, `--add-dirs`, and `--add-dirs-ro=$HOME/vault` flags for all three manager panes — not per-role narrowing.
- Notes: no evidence found in `triad-source/agents/`, `triad-source/skills/`, or `triad-source/templates/`.

### Req 9: Pluggable runtime. The same task definition runs under multiple runtimes (Claude Code, Codex, Copilot CLI) via a thin adapter — no per-task rewrite.

- Verdict: MISSING
- Evidence:
  - `skills/start/SKILL.md` hardcodes Claude Code: "tmux send-keys -t \"$SESSION.0\" \"$SAFE_CMD claude --dangerously-skip-permissions\" Enter" (three times, one per pane).
  - `worker-dispatch-template.md` header: "**IMPORTANT: Always dispatch workers using model: 'sonnet'.**" — Claude-specific.
  - `docs/specs/2026-03-22-three-agent-system-design.md` §6.3 mandates `npm install -g @anthropic-ai/claude-code`.
  - No adapter layer, provider abstraction, or runtime enum found anywhere in triad-source/.

### Req 10: Peer-awareness log. Workers emit a decision/work log that concurrent or subsequent workers can consume to avoid conflicting choices. Format must be short enough to inject without context bloat.

- Verdict: MISSING
- Evidence:
  - Worker "Decisions" / "Deviations" / "Concerns" fields (`worker-context.md`) are written to the task's completion summary after the `---` divider (`templates/task.md`: "Completion summary written by executing agent below this line"), consumed by the EM — not by peer workers.
  - The EM serializes task dispatch via dependency ordering (`agents/engineering-manager/CLAUDE.md` §Task Creation: "`depends_on` lists task IDs that must be `done` before this task can start"). The model assumes dependency-ordered execution rather than concurrent peer awareness.
  - No evidence of a shared decision log, inter-worker log channel, or log-injection step in the dispatch template.
- Notes: The inbox read/ archives serve cross-agent awareness at the manager layer but are not surfaced to Dev workers.

### Req 11: Single-session discipline. Any worker exceeding ~60% of its context window must hand off (produce a structured continuation artifact) rather than compact.

- Verdict: MISSING
- Evidence:
  - No mention of context-window percentage, compaction thresholds, or continuation artifacts found in `worker-context.md`, the dispatch template, or the EM CLAUDE.md.
  - `agents/engineering-manager/CLAUDE.md` §Task Creation states: "**Completable in a single context window.** If a task requires the worker to hold more context than fits, split it." — this is a pre-dispatch sizing rule, not a mid-session handoff mechanism.
  - Related but distinct: the 30-minute wall-clock timeout (see Req 12) is not a context-utilization signal.
- Notes: The design prevents overflow by up-front decomposition but provides no in-session handoff artifact.

### Req 12: Bounded lifetime. Workers have an explicit timeout; exceeding it escalates rather than silently hangs.

- Verdict: MEETS
- Evidence:
  - `agents/engineering-manager/CLAUDE.md` §Worker Dispatch: "**30-minute task timeout.** If any worker has been running for more than 30 minutes wall-clock time, stop and evaluate: 1. **Is the worker making progress?**… 2. **Decide:** Either (a) kill the worker, split the task into smaller pieces, and re-dispatch, (b) kill and re-scope with a smaller target… or (c) let it continue with explicit justification. 3. **Notify the PgM** via an `info` message…".
  - "Normal tasks complete in 7-15 minutes. 30 minutes is 2x the p95. Anything beyond that is a signal the task is scoped wrong".
- Notes: The timeout is enforced by the EM supervisor, not by an automatic process kill. The escalation path is defined (info → PgM).

## Surprises

- **Two-layer worker model is asymmetric by design.** Manager agents are explicitly persistent and coordinate via filesystem inboxes; Dev workers are explicitly ephemeral and coordinate via task files. The spec's "worker model" concepts apply differently to each. The retired-status README lists inbox-watcher brittleness and state drift between managers as the reason the project was shelved.
- **"No custom per-task prompts" is an explicit design principle.** `agents/engineering-manager/CLAUDE.md` step 5 prohibits what the spec's Req 3-4 require ("The task file IS the contract. `TASK_SPECIFIC_NOTES` should almost always be empty"). Triad's philosophy is that good decomposition + good patterns files obsolete prompt generation.
- **Model selection is hardcoded to Sonnet.** `worker-dispatch-template.md`: "Always dispatch workers using model: 'sonnet'… If a task seems to need more judgment than Sonnet can provide, the task is scoped wrong".
- **Manager-layer filesystem inbox is the observability substrate.** `docs/specs/2026-03-23-agent-triad-protocol-design.md` §2: "The negotiation records become the observability layer." This is a manager-layer feature and does not extend to Dev workers.
- **Worker dispatch template lives at `agents/engineering-manager/.claude/worker-dispatch-template.md`** — a hidden-directory location that the main EM CLAUDE.md references by path but is easy to miss when surveying the agent's files.

## Open Questions for Trial

- Whether the task file's `scope.references` array in practice does the job of vocabulary injection (pointing workers at the right patterns) or whether workers drift because the injection is pointer-based rather than inlined.
- Whether the 30-minute wall-clock timeout fires in time to prevent the context-utilization degradation the spec warns about (~60%); only instrumentation can answer this.
- How the EM reconciles the "no peer log" design with truly concurrent worker dispatch — the CLAUDE.md dispatches workers sequentially per dependency graph, but does not forbid parallel dispatch of independent tasks.
- Whether the persistent manager agents ever hit their own context ceiling and, if so, how `/triad:kick` state recovery compares to a proper handoff artifact.

## Source Index

- `docs/research/triad-source/README.md`
- `docs/research/triad-source/agents/engineering-manager/CLAUDE.md`
- `docs/research/triad-source/agents/engineering-manager/.claude/worker-dispatch-template.md`
- `docs/research/triad-source/agents/engineering-manager/.claude/worker-context.md`
- `docs/research/triad-source/agents/program-manager/CLAUDE.md`
- `docs/research/triad-source/templates/task.md`
- `docs/research/triad-source/templates/message.md`
- `docs/research/triad-source/docs/specs/2026-03-23-agent-triad-protocol-design.md`
- `docs/research/triad-source/docs/specs/2026-03-22-three-agent-system-design.md`
- `docs/research/triad-source/skills/start/SKILL.md`
- `docs/research/triad-source/skills/kick/SKILL.md`
- `docs/research/triad-source/skills/status/SKILL.md`

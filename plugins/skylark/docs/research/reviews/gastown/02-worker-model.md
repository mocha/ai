# Gas Town — Worker Model Conformance Evaluation

## Summary

- Conformance at a glance: 7 MEETS, 4 PARTIAL, 1 MISSING, 0 N/A (out of 12)
- Headline: Polecats implement persistent identity with ephemeral sessions and a strong multi-runtime adapter layer, but per-task prompt generation is template-driven (formula + directive + natural-language --args) rather than a first-class dispatch-time prompt body, and there is no explicit context-budget hand-off gate or bounded timeout per worker.

## Per-Requirement Findings

### Req 1: Ephemeral sessions. Worker session terminates at task completion. No long-lived worker accumulates conversation across tasks.

- Verdict: MEETS
- Evidence: `docs/design/polecat-lifecycle-patrol.md`, §1: "Polecats do NOT complete complex molecules end-to-end. Instead, each molecule step gets one polecat session. The sandbox (branch, worktree) persists across sessions. Sessions are the pistons; sandboxes are the cylinders." §3.1: "Session cycles... voluntary `gt handoff` or crash recovery." §3.2: "Polecat runs `gt done`... Session terminated, sandbox preserved." `gt polecat --help`: "Polecats have PERSISTENT IDENTITY but EPHEMERAL SESSIONS."
- Notes: Session-per-step is a design target, not hard constraint (§2.2). A single session may complete multiple small steps; but no session outlives the molecule's final `gt done`.

### Req 2: Persistent identity, ephemeral state. Worker identity (role, accumulated telemetry, reputation) persists across sessions, decoupled from the conversation state of any one session.

- Verdict: MEETS
- Evidence: `gt polecat --help`: "Each polecat has a permanent agent bead and CV chain that accumulates work history across assignments. Sessions and sandboxes are ephemeral — spawned for specific tasks, cleaned up on completion — but the identity persists." `templates/polecat-CLAUDE.md` §"The Capability Ledger": "Every completion is recorded. Every handoff is logged. Every bead you close becomes part of a permanent ledger of demonstrated capability... Your history is your reputation." `docs/design/polecat-lifecycle-patrol.md` §3.2: "Identity survives: Agent bead still exists; CV chain has new entry; polecat ready for reuse."
- Notes: Identity persists via an agent bead keyed by polecat name (e.g. `furiosa`), with `agent_state`, `cleanup_status`, `hook_bead` fields; CV chain accumulates via completed work beads.

### Req 3: Per-task prompt generation. Worker prompts are generated at dispatch time based on the specific task, not baked into static config at orchestrator startup. A dispatch call can pass a full prompt body.

- Verdict: PARTIAL
- Evidence: `gt sling --help`: "`--args string` Natural language instructions for the executor (e.g., 'patch release')" and "The --args string is stored in the bead and shown via gt prime. Since the executor is an LLM, it interprets these instructions naturally." Stdin mode supports multi-line: "echo 'review for security issues' | gt sling gt-abc gastown --stdin" and HEREDOC form. `--message`/`--subject` and `--formula`/`--var key=value` also flow into the hook bead. The Polecat role prompt itself is loaded from a static template: `internal/templates/roles/polecat.md.tmpl` (rendered at session start via `gt prime`), and formulas such as `mol-polecat-work.formula.toml` define the step checklist. `gt directive --help`: "Directives are markdown files that customize agent behavior per role. They are injected at prime time and override formula defaults where they conflict." File layout is fixed per-role: `<townRoot>/directives/<role>.md`.
- Notes: The dispatch-time surface is `--args` + `--message` + `--subject` + `--var` + chosen `--formula`, stored on a bead and rendered inline by `gt prime`. There is no path for the dispatcher to supply an arbitrary full prompt body — the role prompt, directive, and formula are resolved from files; only the task-specific arguments and formula selection are free-form per call. Role templates are Go template files (`polecat.md.tmpl`), not generated per task.

### Req 4: Dynamic context injection. Prompt generation supports injecting domain vocabulary, scoped file paths, relevant prior artifacts, and task-specific constraints.

- Verdict: PARTIAL
- Evidence: `gt prime --help`: "Detect the agent role from the current directory and output context." The `gt prime --hook` SessionStart hook (`internal/hooks/templates/claude/settings-autonomous.json`) plus `gt mail check --inject` inject role context, mail, formula steps, and hook bead contents into the session. `mol-polecat-work.formula.toml` exposes `{{issue}}`, `{{base_branch}}`, `{{setup_command}}`, `{{typecheck_command}}`, `{{test_command}}`, `{{lint_command}}`, `{{build_command}}` as formula variables pulled from rig config + sling vars. `gt sling --args "focus on security"` and stdin mode provide free-form task constraints. Prior artifacts flow via the bead (`bd show {{issue}}`: Findings, MERGE REJECTION notes, `--notes`/`--design` fields; `gt seance --talk <session-id>` resumes predecessor session context).
- Notes: No evidence of a structured domain-vocabulary payload mechanism. Constraints and paths flow through (a) bead description + notes, (b) formula variables from rig settings, (c) free-form `--args` natural language. The bead acts as the per-task artifact store; vocabulary is implicit in bead content rather than a typed schema.

### Req 5: Curated inputs only. Workers never receive a blanket dump of parent context or unrelated artifacts — only the inputs the task requires.

- Verdict: MEETS
- Evidence: Polecat startup context via `gt prime` is scoped by role+rig+name (`internal/templates/roles/polecat.md.tmpl` is the polecat-only template; `gt role def polecat` shows `GT_ROLE = "{rig}/polecats/{name}"`). The hook is singular: `gt hook --help` — "The hook is the 'durability primitive' - work on your hook survives session restarts... When you restart, your SessionStart hook finds the attached work and you continue from where you left off." `docs/design/polecat-lifecycle-patrol.md` §2.4: "No explicit 'handoff payload' is needed. The beads state IS the handoff." Mail is per-address (`<rig>/polecats/<name>`). Polecats work in their own git worktree (`polecats/{name}/`) and `templates/polecat-CLAUDE.md` warns strictly against leaving it.
- Notes: Directory discipline section explicitly prohibits cross-worktree access. Witness/refinery/mayor outputs are not dumped to the polecat — only what is on its hook + mail inbox.

### Req 6: Structured outputs. Worker returns a typed result (status enum + typed fields), not free-form prose.

- Verdict: MEETS
- Evidence: `gt done --help`: "Exit statuses: COMPLETED - Work done, MR submitted (default); ESCALATED - Hit blocker, needs human intervention; DEFERRED - Work paused, issue still open." Typed fields: `--status`, `--cleanup-status {clean,uncommitted,unpushed,stash,unknown}`, `--pre-verified`, `--target`, `--issue`, `--priority`. `docs/design/polecat-lifecycle-patrol.md` §3.1: `cleanup_status=clean` on the agent bead; mail protocol (§4.3) uses typed subjects (`POLECAT_DONE`, `MERGE_READY`, `MERGED`, `MERGE_FAILED`, `HELP:`, `LIFECYCLE:Shutdown`).
- Notes: Structured outcome is delivered via (1) `gt done` CLI flags mutating the agent bead + sending `POLECAT_DONE` mail, and (2) the branch/MR artifact. Free-form findings go to `bd update --notes`/`--design`.

### Req 7: Typed status outcomes. At minimum: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, `BLOCKED`.

- Verdict: PARTIAL
- Evidence: `gt done --help`: `COMPLETED`, `ESCALATED`, `DEFERRED`. `gt escalate --help`: severity enum `critical|high|medium|low` for out-of-band escalation. HELP mail: "If stuck, mail Witness: gt mail send <rig>/witness -s 'HELP: Unclear requirements'" (`mol-polecat-work.formula.toml`, load-context step).
- Notes: `COMPLETED` maps to DONE; `ESCALATED` maps to BLOCKED; `DEFERRED` maps loosely to NEEDS_CONTEXT/paused. There is no explicit `DONE_WITH_CONCERNS` outcome — concerns are written to `bd update --notes` or filed as new beads. No explicit `NEEDS_CONTEXT` enum value; missing context is handled by a `HELP:` mail to Witness rather than a typed status return.

### Req 8: Per-role tool scoping. Worker tool access is configurable per-role (narrowing, not broadening).

- Verdict: PARTIAL
- Evidence: `docs/HOOKS.md`: "Merge strategy: base → role → rig+role (more specific wins)... `~/.gt/hooks-overrides/ ├── crew.json ├── witness.json ├── gastown__crew.json`." Role-keyed `.claude/settings.json` files: `<rig>/polecats/.claude/settings.json`, `<rig>/crew/.claude/settings.json`, etc. Registry hooks are role-scoped: "pr-workflow-guard... Roles: crew, polecat"; "dangerous-command-guard... Roles: crew, polecat"; "clone-guard... Roles: crew, polecat" (`docs/HOOKS.md` Current Registry Hooks table). `internal/hooks/templates/claude/settings-autonomous.json` installs `PreToolUse` matchers for `Bash(sudo *)`, `Bash(apt install*)`, `Bash(git checkout -b*)`, `Bash(gh pr create*)` routing to `gt tap guard <name>`. `docs/agent-provider-integration.md` Capability Matrix shows per-agent hooks support.
- Notes: Scoping is implemented as PreToolUse denylist/guard hooks per role, not as an allowlist of tools. "Narrowing, not broadening" is achieved by running claude with `--dangerously-skip-permissions` and then blocking specific dangerous patterns via PreToolUse matchers. There is no evidence of a per-role allowlist of tool names. `docs/HOOKS.md` §"Known Gaps": "No `gt tap disable/enable` convenience commands — Per-worktree enable/disable is possible via the override mechanism... but there is no convenience wrapper yet."

### Req 9: Pluggable runtime. The same task definition runs under multiple runtimes (Claude Code, Codex, Copilot CLI) via a thin adapter — no per-task rewrite.

- Verdict: MEETS
- Evidence: `docs/agent-provider-integration.md`: "Gas Town is a multi-agent workspace manager that orchestrates coding agents (Claude, Gemini, Codex, Cursor, AMP, OpenCode, Copilot, and others) through tmux sessions." Capability Matrix lists seven supported agents (Claude, Gemini, Codex, Cursor, Auggie, AMP, OpenCode) with per-agent hook/resume/non-interactive/prompt-mode columns. Four integration tiers (§Integration Tiers): "0: Zero / 1: Preset / 2: Hooks / 3: Deep." Tier-1 preset schema in `AgentPresetInfo`: `command`, `args`, `resume_flag`, `prompt_mode`, `hooks_provider`, `hooks_dir`, `hooks_settings_file`, `non_interactive {subcommand, prompt_flag, output_flag}`, `process_names`, `ready_prompt_prefix`. `gt sling --help`: "`--agent string` Override agent/runtime for this sling (e.g., claude, gemini, codex, or custom alias)." `gt config agent --help`: list/get/set/remove custom agents. Town-level `role_agents` map allows per-role runtime: "`role_agents: { 'witness': 'kiro', 'polecat': 'kiro' }`." Design principle: "Gas Town orchestrates agents through tmux and environment variables. It does not import agent libraries, link against agent code, or require agents to import Gas Town code. Integration is configuration, not compilation."
- Notes: The same formula (`mol-polecat-work`) runs under any registered agent; the adapter layer handles startup command, resume, hooks, and non-interactive mode. Graceful degradation fallback matrix (`docs/agent-provider-integration.md`, Pattern C) defines how context injection adapts from hooks → prompt arg → tmux nudge.

### Req 10: Peer-awareness log. Workers emit a decision/work log that concurrent or subsequent workers can consume to avoid conflicting choices. Format must be short enough to inject without context bloat.

- Verdict: PARTIAL
- Evidence: `mol-polecat-work.formula.toml` implement step: "Persist findings as you go (CRITICAL for session survival)... `bd update {{issue}} --notes 'Findings so far...'` ... If your session dies between persisting and closing, the findings survive." `docs/design/polecat-lifecycle-patrol.md` §4.1: "Mail creates beads entries (observable, discoverable)" and §4.3 message protocol. `gt trail` ("Show recent agent activity"), `gt audit` ("Query work history by actor"), `gt feed`, `gt activity` provide event feeds. `gt seance --help`: "Seance lets you literally talk to predecessor sessions. 'Where did you put the stuff you left for me?' - The #1 handoff question... The --talk flag spawns: claude --fork-session --resume <id>. This loads the predecessor's full context without modifying their session." Bead notes preserve MERGE REJECTION context across polecats (`mol-polecat-work`, load-context: "If the bead notes contain 'MERGE REJECTION', a previous polecat's work was rejected by the refinery. Read the failure details carefully...").
- Notes: Peer awareness exists via (a) bead notes/design fields, (b) event feeds, (c) seance. There is no dedicated "peer-log" with a size budget designed for injection at turn-start; polecats explicitly operate in parallel on non-overlapping issues (hook is exclusive: "one hook_bead per agent bead, one agent bead per polecat name" — §8.5), so cross-worker conflict is structurally limited rather than log-mediated. Seance is a pull-on-demand predecessor channel; it is not a push to concurrent workers.

### Req 11: Single-session discipline. Any worker exceeding ~60% of its context window must hand off (produce a structured continuation artifact) rather than compact.

- Verdict: PARTIAL
- Evidence: `gt handoff --help`: "End watch. Hand off to a fresh agent session... The --cycle flag triggers automatic session cycling (used by PreCompact hooks). Unlike --auto (state only) or normal handoff (polecat→gt-done redirect), --cycle always does a full respawn regardless of role. This enables crew workers and polecats to get a fresh context window when the current one fills up." `--collect` flag "gathers current state (hooked work, inbox, ready beads, in-progress items) and includes it in the handoff mail." `docs/design/polecat-lifecycle-patrol.md` §2.3 triggers: "Context filling | Claude Code | Auto-compaction; PreCompact hook saves state." `internal/hooks/templates/claude/settings-autonomous.json` SessionStart and PreCompact both run `gt prime --hook`. `mol-polecat-work.formula.toml` failure modes: "Context filling | Use gt handoff to cycle to fresh session." `templates/polecat-CLAUDE.md` prescribes `gt handoff` on context fill.
- Notes: Handoff infrastructure exists (bead hook + PreCompact hook + `gt handoff --cycle --collect`), but the trigger is compaction-driven by Claude Code itself. No evidence of a ~60%-utilization-enforced gate; the polecat decides when to cycle or the PreCompact hook fires at Claude's threshold. The continuation artifact is the hooked bead + optional handoff mail, not a structured "continuation document" per se.

### Req 12: Bounded lifetime. Workers have an explicit timeout; exceeding it escalates rather than silently hangs.

- Verdict: MEETS
- Evidence: `gt role def polecat`: "`[health] ping_timeout = '30s'; consecutive_failures = 3; kill_cooldown = '5m0s'; stuck_threshold = '2h0m0s'`." `docs/design/polecat-lifecycle-patrol.md` §7 Q2: "Concrete thresholds (agent-determined, not hardcoded): GUPP violation: 30 minutes with hook_bead but no progress; Hung session: 30 minutes of no tmux output (HungSessionThresholdMinutes); Stuck-in-done: 60 seconds with done-intent label." §8.4 "Three crashes on the same step triggers escalation. Recovery: Witness stops respawning, creates a bug bead, mails the mayor." Formula `[execution] timeout = '5m'` for plugin dogs (`docs/design/plugin-system.md`). Witness patrol `DetectStalePolecats`, `DetectZombiePolecats` enforce these.
- Notes: Timeouts are intentionally generous to avoid false positives (§7 Q2: "The murder spree lesson: Mechanical detection of 'stuck' is fragile... Only the witness (an AI agent) should make judgment calls"). Escalation path is concrete: 3-crash rule → witness → mayor mail → bug bead.

## Surprises

- **Beads state IS the handoff** (`polecat-lifecycle-patrol.md` §2.4): Gas Town's design principle "discover, don't track" means there is intentionally no dedicated handoff payload — the durable bead ledger + git state is the handoff substrate. This is a strong architectural commitment, not an omission.
- **Self-cleaning termination**: `gt done` is mandatory; `templates/polecat-CLAUDE.md` calls idle-after-complete "The Idle Polecat Heresy" with zombie patrol and respawn protection. Session termination is pushed into the worker's own action, not orchestrator kill.
- **GUPP (Gas-Up-Pinned-Propulsion) invariant** (§5.1): "As long as work is pinned, sandbox persists, and someone keeps spawning sessions, a molecule WILL eventually complete." Worker survivability is a first-class property.
- **Agent-agnostic CLI contract**: Hook commands (`gt prime`, `gt mail check --inject`, `gt tap guard`) are identical across Claude/Gemini/Cursor/OpenCode/Copilot — the adapter layer only varies the hook file format and installation location (`docs/agent-provider-integration.md` §Common Mistakes: "The hook commands (gt prime, gt mail check) are agent-agnostic").
- **Polecat-to-polecat isolation is hook-enforced, not runtime-enforced** (§9): "One hook_bead per agent bead, one agent bead per polecat name." Conflict avoidance is at the work-assignment layer, not an inter-worker log.
- **Sandboxed exec design** (`docs/design/sandboxed-polecat-execution.md`, Proposal status): Future work to add an `ExecWrapper` (exitbox / daytona) slot to wrap the agent process; not yet shipped.

## Open Questions for Trial

- Can a dispatcher inject a full prompt body (not just `--args` natural language) at `gt sling` time — e.g. a bespoke vocabulary-expert persona drafted per task?
- Does a polecat running a complex formula actually trigger `gt handoff --cycle` before Claude Code's native compaction, or does compaction fire first in practice?
- When two polecats are slung to adjacent issues simultaneously, how does the peer-awareness channel (bead notes vs mail vs seance) prevent conflicting design decisions in practice?
- Does swapping `--agent claude` for `--agent codex` on the same `mol-polecat-work` formula produce parity of output, or do formula steps implicitly assume Claude's tool surface?
- How does `DONE_WITH_CONCERNS` get communicated — is there convention beyond `bd update --notes` that downstream readers can reliably parse?

## Source Index

- `/Users/deuley/code/tools/gastown/docs/design/polecat-lifecycle-patrol.md`
- `/Users/deuley/code/tools/gastown/docs/agent-provider-integration.md`
- `/Users/deuley/code/tools/gastown/docs/HOOKS.md`
- `/Users/deuley/code/tools/gastown/docs/design/plugin-system.md`
- `/Users/deuley/code/tools/gastown/docs/design/sandboxed-polecat-execution.md`
- `/Users/deuley/code/tools/gastown/internal/formula/formulas/mol-polecat-work.formula.toml`
- `/Users/deuley/code/tools/gastown/internal/templates/roles/polecat.md.tmpl`
- `/Users/deuley/code/tools/gastown/templates/polecat-CLAUDE.md`
- `/Users/deuley/code/tools/gastown/internal/hooks/templates/claude/settings-autonomous.json`
- CLI: `gt --help`, `gt sling --help`, `gt agents --help`, `gt prime --help`, `gt handoff --help`, `gt done --help`, `gt hook --help`, `gt directive --help`, `gt polecat --help`, `gt role list`, `gt role def polecat`, `gt seance --help`, `gt escalate --help`, `gt config agent --help`, `gt mayor start --help`
